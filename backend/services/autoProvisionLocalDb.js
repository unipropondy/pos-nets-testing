const sql = require("mssql");
const { getPool, getRemotePool, isRemoteOnline, connectRemote } = require("../config/db");

// Master reference tables to copy initial data from Remote DB to Local DB
const MASTER_DATA_TABLES = [
  "UserGroupMaster",
  "UserMaster",
  "CompanyMaster",
  "CompanySettings",
  "CategoryMaster",
  "SubCategoryMaster",
  "DishGroupMaster",
  "DishMaster",
  "ImageList",
  "ComboGroupMaster",
  "ComboGroupDishMapping",
  "ParentDishComboGroupMapping",
  "ModifierMaster",
  "DishModifier",
  "DishGroupModifier",
  "DishModifierGroup",
  "TableMaster",
  "DiningSectionMaster",
  "Paymode",
  "MemberMaster",
  "CreditCustomerMaster",
  "CustomerCreditTransactions",
  "PrintMaster",
  "KitchenMaster",
  "TerminalMaster",
  "SettingsMaster",
  "AppSettings",
  "DateEntry"
];

// Step 1: Ensure Local Database exists (creates DB on local SQL Server if missing)
async function ensureLocalDatabaseExists() {
  const rawServer = process.env.LOCAL_DB_SERVER || "127.0.0.1";
  let serverHost = rawServer;
  let instanceName = undefined;
  if (rawServer.includes("\\")) {
    const parts = rawServer.split("\\");
    serverHost = parts[0] || "127.0.0.1";
    instanceName = parts[1];
  }

  const port = parseInt(process.env.LOCAL_DB_PORT || process.env.DB_PORT || "1433");
  const user = process.env.LOCAL_DB_USER || process.env.DB_USER;
  const password = process.env.LOCAL_DB_PASSWORD || process.env.DB_PASSWORD;
  const targetDbName = process.env.LOCAL_DB_NAME || process.env.DB_NAME || "UCSPONDY_HYBRID";

  const masterConfig = {
    user,
    password,
    server: serverHost,
    ...(instanceName ? {} : { port }),
    database: "master",
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
      connectTimeout: 3000,
      ...(instanceName ? { instanceName } : {})
    }
  };

  let masterPool = null;
  try {
    console.log(`🔍 [Auto-Provision] Checking if database '${targetDbName}' exists on Local SQL Server (${serverHost}:${port})...`);
    masterPool = await new sql.ConnectionPool(masterConfig).connect();
    
    const checkDbResult = await masterPool.request()
      .input("DbName", sql.NVarChar, targetDbName)
      .query(`SELECT database_id FROM sys.databases WHERE name = @DbName`);

    if (checkDbResult.recordset.length === 0) {
      console.log(`✨ [Auto-Provision] Database '${targetDbName}' NOT found on Local SQL Server! Creating database automatically...`);
      await masterPool.request().query(`CREATE DATABASE [${targetDbName}]`);
      console.log(`✅ [Auto-Provision] Local database '${targetDbName}' created successfully!`);
    } else {
      console.log(`✅ [Auto-Provision] Local database '${targetDbName}' already exists.`);
    }
  } catch (err) {
    console.warn(`⚠️ [Auto-Provision] Database creation check on master failed:`, err.message);
  } finally {
    if (masterPool) {
      try { await masterPool.close(); } catch (_) {}
    }
  }
}

// Step 2: Sync full schema and tables from Remote DB -> Local DB
async function syncSchemaFromRemoteToLocal(localPoolOverride) {
  let remotePool = getRemotePool();
  if (!isRemoteOnline()) {
    remotePool = await connectRemote();
  }

  if (!remotePool || !isRemoteOnline()) {
    console.log("🟡 [Auto-Provision] Remote DB is offline. Skipping remote schema replication.");
    return false;
  }

  const localPool = localPoolOverride || getPool();
  if (!localPool) {
    console.warn("⚠️ [Auto-Provision] Local DB pool not ready.");
    return false;
  }

  console.log("🔄 [Auto-Provision] Fetching remote table schemas from Remote Cloud Database...");

  try {
    // 1. Get all base tables from Remote DB
    const tablesResult = await remotePool.request().query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME NOT IN ('sysdiagrams', 'POS_SyncQueue')
      ORDER BY TABLE_NAME
    `);

    const remoteTables = tablesResult.recordset.map(r => r.TABLE_NAME);
    console.log(`📋 [Auto-Provision] Found ${remoteTables.length} tables in Remote DB.`);

    for (const tableName of remoteTables) {
      await replicateTableSchema(remotePool, localPool, tableName);
    }

    // 1.2. Replicate default constraints for any tables that exist on Local DB
    await replicateDefaultConstraintsFromRemote(remotePool, localPool);

    // 1.5. Ensure database views exist on Local DB
    await ensureEssentialLocalViews(localPool);
    await replicateViewsFromRemote(remotePool, localPool);

    // 2. Hydrate ALL tables and master data from Remote DB to Local DB
    console.log("🚚 [Auto-Provision] Hydrating ALL tables & data from Remote Cloud DB to Local DB...");
    await hydrateAllTablesFromRemote(remotePool, localPool);

    // 2.5. Hydrate & 2-Way Sync Master Catalog from Remote DB to Local DB
    console.log("🚚 [Auto-Provision] Verifying 2-Way Sync for Master Catalog (Categories, Dishes, Tables, Settings)...");
    await syncMasterCatalog2Way(remotePool, localPool);

    // 3. Sync Active Operational State (Table status, active orders, Day-Start sequence)
    console.log("⚡ [Auto-Provision] Syncing Active Floor State & Business Day status from Remote DB...");
    await syncOperationalStateFromRemote(remotePool, localPool);

    console.log("✅ [Auto-Provision] Local Database schema & ALL tables/data provisioning complete!");
    return true;
  } catch (err) {
    console.error("❌ [Auto-Provision] Error syncing schema from Remote DB:", err.message);
    return false;
  }
}

// Helper: Replicate a single table's schema (CREATE TABLE or ADD MISSING COLUMNS)
async function replicateTableSchema(remotePool, localPool, tableName) {
  try {
    // Check if table exists in Local DB
    const checkLocalTable = await localPool.request().query(`
      SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = '${tableName}'
    `);

    // Fetch column details from Remote DB (including identity info)
    const remoteColumnsRes = await remotePool.request().query(`
      SELECT 
        c.COLUMN_NAME, 
        c.DATA_TYPE, 
        c.CHARACTER_MAXIMUM_LENGTH, 
        c.NUMERIC_PRECISION, 
        c.NUMERIC_SCALE, 
        c.IS_NULLABLE, 
        c.COLUMN_DEFAULT,
        COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity') AS is_identity
      FROM INFORMATION_SCHEMA.COLUMNS c
      WHERE c.TABLE_NAME = '${tableName}'
      ORDER BY c.ORDINAL_POSITION
    `);

    const remoteCols = remoteColumnsRes.recordset;
    if (remoteCols.length === 0) return;

    if (checkLocalTable.recordset.length === 0) {
      // Table does not exist in Local DB -> Generate CREATE TABLE statement
      console.log(`🛠️ [Auto-Provision] Creating table [${tableName}] in Local DB...`);
      
      let pkCols = [];
      let pkClause = "";
      try {
        const pkRes = await remotePool.request().query(`
          SELECT kcu.COLUMN_NAME
          FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
          JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc 
            ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME 
           AND kcu.TABLE_NAME = tc.TABLE_NAME
          WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' 
            AND kcu.TABLE_NAME = '${tableName}'
          ORDER BY kcu.ORDINAL_POSITION
        `);
        if (pkRes.recordset && pkRes.recordset.length > 0) {
          pkCols = pkRes.recordset.map(r => r.COLUMN_NAME);
          pkClause = `,\n  PRIMARY KEY (${pkCols.map(c => `[${c}]`).join(", ")})`;
        }
      } catch (_) {}

      const buildColDefs = (includeDefaults = true) => remoteCols.map(col => {
        let typeStr = col.DATA_TYPE.toUpperCase();
        if (["TIMESTAMP", "ROWVERSION"].includes(typeStr)) {
          return `[${col.COLUMN_NAME}] ROWVERSION`;
        }
        if (["NVARCHAR", "VARCHAR", "NCHAR", "CHAR", "VARBINARY", "BINARY"].includes(typeStr)) {
          if (col.CHARACTER_MAXIMUM_LENGTH === -1 || col.CHARACTER_MAXIMUM_LENGTH > 8000) {
            typeStr += "(MAX)";
          } else if (col.CHARACTER_MAXIMUM_LENGTH) {
            typeStr += `(${col.CHARACTER_MAXIMUM_LENGTH})`;
          }
        } else if (["DECIMAL", "NUMERIC"].includes(typeStr)) {
          typeStr += `(${col.NUMERIC_PRECISION || 18}, ${col.NUMERIC_SCALE || 2})`;
        }

        if (col.is_identity === 1) {
          typeStr += " IDENTITY(1,1)";
        }

        let defaultClause = "";
        if (includeDefaults && col.COLUMN_DEFAULT && col.is_identity !== 1) {
          defaultClause = ` DEFAULT ${col.COLUMN_DEFAULT}`;
        }

        const isPk = pkCols.some(pk => pk.toLowerCase() === col.COLUMN_NAME.toLowerCase());
        const nullableStr = (isPk || col.IS_NULLABLE === "NO") ? "NOT NULL" : "NULL";
        return `[${col.COLUMN_NAME}] ${typeStr}${defaultClause} ${nullableStr}`;
      });

      const createTableSql = `CREATE TABLE [dbo].[${tableName}] (\n  ${buildColDefs(true).join(",\n  ")}${pkClause}\n);`;
      try {
        await localPool.request().query(createTableSql);
        console.log(`✅ [Auto-Provision] Table [${tableName}] created in Local DB.`);
      } catch (createErr) {
        // Fallback: retry without default clauses in case a default expression is incompatible
        try {
          const fallbackSql = `CREATE TABLE [dbo].[${tableName}] (\n  ${buildColDefs(false).join(",\n  ")}${pkClause}\n);`;
          await localPool.request().query(fallbackSql);
          console.log(`✅ [Auto-Provision] Table [${tableName}] created in Local DB (clean fallback).`);
        } catch (innerErr) {
          console.warn(`⚠️ [Auto-Provision] Failed to create table [${tableName}]:`, innerErr.message);
        }
      }
    } else {
      // Table exists -> Add missing columns if any
      const localColsRes = await localPool.request().query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}'
      `);
      const localColNames = new Set(localColsRes.recordset.map(r => r.COLUMN_NAME.toLowerCase()));

      for (const col of remoteCols) {
        if (!localColNames.has(col.COLUMN_NAME.toLowerCase())) {
          console.log(`➕ [Auto-Provision] Adding missing column [${col.COLUMN_NAME}] to Local table [${tableName}]...`);
          let typeStr = col.DATA_TYPE.toUpperCase();
          if (["TIMESTAMP", "ROWVERSION"].includes(typeStr)) {
            typeStr = "ROWVERSION";
          } else if (["NVARCHAR", "VARCHAR", "NCHAR", "CHAR"].includes(typeStr)) {
            if (col.CHARACTER_MAXIMUM_LENGTH === -1 || col.CHARACTER_MAXIMUM_LENGTH > 8000) {
              typeStr += "(MAX)";
            } else if (col.CHARACTER_MAXIMUM_LENGTH) {
              typeStr += `(${col.CHARACTER_MAXIMUM_LENGTH})`;
            }
          } else if (["DECIMAL", "NUMERIC"].includes(typeStr)) {
            typeStr += `(${col.NUMERIC_PRECISION || 18}, ${col.NUMERIC_SCALE || 2})`;
          }

          const addColSql = `ALTER TABLE [dbo].[${tableName}] ADD [${col.COLUMN_NAME}] ${typeStr} NULL;`;
          await localPool.request().query(addColSql).catch(() => {});
        }
      }

      // Ensure UserPassword column is at least NVARCHAR(255) for bcrypt hashes
      if (tableName.toLowerCase() === "usermaster") {
        await localPool.request().query(`
          IF EXISTS (
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'UserMaster' AND COLUMN_NAME = 'UserPassword' AND CHARACTER_MAXIMUM_LENGTH < 255
          )
          BEGIN
            ALTER TABLE [dbo].[UserMaster] ALTER COLUMN [UserPassword] NVARCHAR(255) NULL;
          END
        `).catch(() => {});
      }
    }
  } catch (err) {
    console.warn(`⚠️ [Auto-Provision] Error replicating table schema for [${tableName}]:`, err.message);
  }
}

// Helper: Find computed columns for a table to prevent SQL insertion errors
async function getReadOnlyColumns(pool, tableName) {
  try {
    const res = await pool.request().query(`
      SELECT c.name
      FROM sys.columns c
      JOIN sys.tables t ON c.object_id = t.object_id
      WHERE t.name = '${tableName}' AND c.is_computed = 1
    `);
    return new Set(res.recordset.map(r => r.name.toLowerCase()));
  } catch (_) {
    return new Set();
  }
}

// Helper: Check if a table has an identity column
async function hasIdentityCol(pool, tableName) {
  try {
    const res = await pool.request().query(`
      SELECT 1 FROM sys.columns c JOIN sys.tables t ON c.object_id = t.object_id
      WHERE t.name = '${tableName}' AND c.is_identity = 1
    `);
    return res.recordset && res.recordset.length > 0;
  } catch (_) {
    return false;
  }
}

// Helper: Safely get row property case-insensitively
function getRowVal(row, col) {
  if (!row) return undefined;
  if (row[col] !== undefined) return row[col];
  const lower = col.toLowerCase();
  for (const k of Object.keys(row)) {
    if (k.toLowerCase() === lower) return row[k];
  }
  return undefined;
}

// Helper: Get valid column names for a table
async function getTableColumns(pool, tbl) {
  try {
    const res = await pool.request().query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tbl}'
    `);
    return new Set(res.recordset.map(r => r.COLUMN_NAME.toLowerCase()));
  } catch (_) {
    return new Set();
  }
}

// Helper: Get primary key columns for a table (supports composite primary keys)
async function getPrimaryKeyColumns(pool, tableName, fallbackPk) {
  try {
    const res = await pool.request().query(`
      SELECT kcu.COLUMN_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
      JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc 
        ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME 
       AND kcu.TABLE_NAME = tc.TABLE_NAME
      WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' 
        AND kcu.TABLE_NAME = '${tableName}'
      ORDER BY kcu.ORDINAL_POSITION
    `);
    if (res.recordset.length > 0) {
      return res.recordset.map(r => r.COLUMN_NAME);
    }
  } catch (_) {}
  if (Array.isArray(fallbackPk)) return fallbackPk;
  return fallbackPk ? [fallbackPk] : [];
}

// Top-level 2-Way table delta sync (Missing rows pushed/pulled + timestamp-based updates)
// syncMode: 'twoWay' (default) | 'pullOnly' (Remote -> Local) | 'pushOnly' (Local -> Remote)
async function syncTable2Way(remotePool, localPool, tableName, fallbackPk, maxDelta = 100, syncMode = 'twoWay') {
  try {
    let lCols = await getTableColumns(localPool, tableName);
    const rCols = await getTableColumns(remotePool, tableName);

    // If table doesn't exist on remote, nothing to sync
    if (rCols.size === 0) return { tableName, pushed: 0, pulled: 0, updatedLocal: 0, updatedRemote: 0 };

    // If table doesn't exist on local, auto-replicate schema from remote
    if (lCols.size === 0) {
      await replicateTableSchema(remotePool, localPool, tableName);
      lCols = await getTableColumns(localPool, tableName);
    }

    const lReadOnly = await getReadOnlyColumns(localPool, tableName);
    const rReadOnly = await getReadOnlyColumns(remotePool, tableName);
    const readOnlyCols = new Set([...lReadOnly, ...rReadOnly]);

    // Session columns are STRICTLY LOCAL and must never be pushed to cloud or overwritten by cloud
    const LOCAL_SESSION_PROTECTED_COLS = new Set([
      "isloggedin",
      "lastheartbeat",
      "activesessionid"
    ]);

    // TableMaster protected columns: Visual editor layout, dimensions, locking,
    // and live floor operational state are strictly managed on Local DB.
    // They must NEVER be overwritten by Remote SQL Server data pulls or updates.
    const TABLEMASTER_PROTECTED_COLS = new Set([
      "tabletype",
      "xsize",
      "ysize",
      "xpos",
      "ypos",
      "pos",
      "lockedbyname",
      "islocked",
      "totalamount",
      "currentorderid",
      "entry_status",
      "payment_status",
      "customername",
      "pax",
      "status",
      "starttime",
      "endtime",
      "loginuser"
    ]);

    const isProtectedColumn = (col) => {
      const lowerTbl = String(tableName).toLowerCase();
      const lowerCol = String(col).toLowerCase();
      if (lowerTbl === 'usermaster') {
        return LOCAL_SESSION_PROTECTED_COLS.has(lowerCol);
      }
      if (lowerTbl === 'tablemaster' && syncMode === 'pullOnly') {
        return TABLEMASTER_PROTECTED_COLS.has(lowerCol);
      }
      return false;
    };

    const pkCols = await getPrimaryKeyColumns(localPool, tableName, fallbackPk);
    if (!pkCols || pkCols.length === 0) return { tableName, pushed: 0, pulled: 0, updatedLocal: 0, updatedRemote: 0 };
    const pkColSql = pkCols.map(p => `[${p}]`).join(", ");

    const dateCandidates = [
      'ModifiedOn', 'ModifyOn', 'ModifyDate', 'UpdatedOn',
      'CreatedOn', 'CreateDate', 'CreatedDate',
      'OrderDateTime', 'LastSettlementDate', 'InvoiceDate', 'start_date', 'Id', 'ID'
    ];
    const sortCol = dateCandidates.find(c => lCols.has(c.toLowerCase()) && rCols.has(c.toLowerCase()));
    const orderSql = sortCol ? `ORDER BY [${sortCol}] DESC` : '';

    const modCandidates = ['ModifiedOn', 'ModifyOn', 'ModifyDate', 'UpdatedOn', 'UpdatedDate'];
    const modCol = modCandidates.find(c => lCols.has(c.toLowerCase()) && rCols.has(c.toLowerCase()));

    const selectColsSql = modCol ? `${pkColSql}, [${modCol}]` : pkColSql;

    const lPkRes = await localPool.request().query(`SELECT ${selectColsSql} FROM [dbo].[${tableName}] ${orderSql}`).catch(() => ({ recordset: [] }));
    const rPkRes = await remotePool.request().query(`SELECT ${selectColsSql} FROM [dbo].[${tableName}] ${orderSql}`).catch(() => ({ recordset: [] }));

    const makePkKey = (row) => pkCols.map(pk => String(getRowVal(row, pk) ?? '')).join('___');

    const lPkMap = new Map();
    lPkRes.recordset.forEach(r => lPkMap.set(makePkKey(r), r));

    const rPkMap = new Map();
    rPkRes.recordset.forEach(r => rPkMap.set(makePkKey(r), r));

    const missingOnRemote = lPkRes.recordset.filter(r => !rPkMap.has(makePkKey(r)));
    const missingOnLocal = rPkRes.recordset.filter(r => !lPkMap.has(makePkKey(r)));

    const allowPush = syncMode === 'twoWay' || syncMode === 'pushOnly';
    const allowPull = syncMode === 'twoWay' || syncMode === 'pullOnly';

    const toPush = allowPush ? missingOnRemote : [];
    const toPull = allowPull ? missingOnLocal : [];

    const lHasIdent = await hasIdentityCol(localPool, tableName);
    const rHasIdent = await hasIdentityCol(remotePool, tableName);

    let pushed = 0, pulled = 0, updatedLocal = 0, updatedRemote = 0;

    // 1. LOCAL -> REMOTE (Push new local records to Remote Cloud DB - only if allowPush)
    if (allowPush) {
      for (const targetPkRow of toPush) {
        const reqWhere = pkCols.map((pk, idx) => `[${pk}] = @lpk_${idx}`).join(" AND ");
        const fetchReq = localPool.request();
        pkCols.forEach((pk, idx) => fetchReq.input(`lpk_${idx}`, getRowVal(targetPkRow, pk)));

        const lRowRes = await fetchReq.query(`SELECT TOP 1 * FROM [dbo].[${tableName}] WHERE ${reqWhere}`).catch(() => ({ recordset: [] }));
        const lRow = lRowRes.recordset[0];
        if (!lRow) continue;

        const keys = Object.keys(lRow).filter(k => 
          lRow[k] !== null && 
          !readOnlyCols.has(k.toLowerCase()) && 
          !isProtectedColumn(k) &&
          rCols.has(k.toLowerCase())
        );
        if (keys.length === 0) continue;
        const colList = keys.map(k => `[${k}]`).join(", ");
        const req = remotePool.request();
        const valList = keys.map((k, idx) => {
          const paramName = `lp_${idx}`;
          req.input(paramName, lRow[k]);
          return `@${paramName}`;
        }).join(", ");

        const insertWhere = pkCols.map((pk, idx) => `[${pk}] = @rpk_${idx}`).join(" AND ");
        pkCols.forEach((pk, idx) => req.input(`rpk_${idx}`, getRowVal(targetPkRow, pk)));

        const identOn = rHasIdent ? `SET IDENTITY_INSERT [dbo].[${tableName}] ON;` : '';
        const identOff = rHasIdent ? `SET IDENTITY_INSERT [dbo].[${tableName}] OFF;` : '';

        const sqlQuery = `
          ${identOn}
          IF NOT EXISTS (SELECT 1 FROM [dbo].[${tableName}] WHERE ${insertWhere})
          BEGIN
            INSERT INTO [dbo].[${tableName}] (${colList}) VALUES (${valList});
          END;
          ${identOff}
        `;
        await req.query(sqlQuery).catch((err) => console.warn(`⚠️ [Auto-Provision] Local->Remote ${tableName} push warning:`, err.message));
        pushed++;
      }
    }

    // 2. REMOTE -> LOCAL (Pull cloud updates to Local DB)
    for (const targetPkRow of toPull) {
      const reqWhere = pkCols.map((pk, idx) => `[${pk}] = @rpk_${idx}`).join(" AND ");
      const fetchReq = remotePool.request();
      pkCols.forEach((pk, idx) => fetchReq.input(`rpk_${idx}`, getRowVal(targetPkRow, pk)));

      const rRowRes = await fetchReq.query(`SELECT TOP 1 * FROM [dbo].[${tableName}] WHERE ${reqWhere}`).catch(() => ({ recordset: [] }));
      const rRow = rRowRes.recordset[0];
      if (!rRow) continue;

      const keys = Object.keys(rRow).filter(k => 
        rRow[k] !== null && 
        !readOnlyCols.has(k.toLowerCase()) && 
        !isProtectedColumn(k) &&
        lCols.has(k.toLowerCase())
      );
      if (keys.length === 0) continue;
      const colList = keys.map(k => `[${k}]`).join(", ");
      const req = localPool.request();
      const valList = keys.map((k, idx) => {
        const paramName = `p_${idx}`;
        req.input(paramName, rRow[k]);
        return `@${paramName}`;
      }).join(", ");

      const insertWhere = pkCols.map((pk, idx) => `[${pk}] = @lpk_${idx}`).join(" AND ");
      pkCols.forEach((pk, idx) => req.input(`lpk_${idx}`, getRowVal(targetPkRow, pk)));

      const identOn = lHasIdent ? `SET IDENTITY_INSERT [dbo].[${tableName}] ON;` : '';
      const identOff = lHasIdent ? `SET IDENTITY_INSERT [dbo].[${tableName}] OFF;` : '';

      const sqlQuery = `
        ${identOn}
        IF NOT EXISTS (SELECT 1 FROM [dbo].[${tableName}] WHERE ${insertWhere})
        BEGIN
          INSERT INTO [dbo].[${tableName}] (${colList}) VALUES (${valList});
        END;
        ${identOff}
      `;
      await req.query(sqlQuery).catch((err) => console.warn(`⚠️ [Auto-Provision] Remote->Local ${tableName} pull warning:`, err.message));
      pulled++;
    }

    // 3. UPDATES & DETERMINISTIC CONFLICT RESOLUTION
    // If modCol exists, compare timestamps for items present on both sides
    if (modCol) {
      for (const [key, lRowSummary] of lPkMap.entries()) {
        const rRowSummary = rPkMap.get(key);
        if (!rRowSummary) continue;

        const lRawTime = getRowVal(lRowSummary, modCol);
        const rRawTime = getRowVal(rRowSummary, modCol);
        const lTime = lRawTime ? new Date(lRawTime).getTime() : 0;
        const rTime = rRawTime ? new Date(rRawTime).getTime() : 0;

        if (lTime === rTime) {
          // If timestamps are identical, check if values actually diverge (simultaneous edits or identical clocks)
          const reqWhere = pkCols.map((pk, idx) => `[${pk}] = @cpk_${idx}`).join(" AND ");
          const lFetch = localPool.request();
          const rFetch = remotePool.request();
          pkCols.forEach((pk, idx) => {
            lFetch.input(`cpk_${idx}`, getRowVal(lRowSummary, pk));
            rFetch.input(`cpk_${idx}`, getRowVal(rRowSummary, pk));
          });
          const lFull = (await lFetch.query(`SELECT TOP 1 * FROM [dbo].[${tableName}] WHERE ${reqWhere}`).catch(() => ({ recordset: [] }))).recordset[0];
          const rFull = (await rFetch.query(`SELECT TOP 1 * FROM [dbo].[${tableName}] WHERE ${reqWhere}`).catch(() => ({ recordset: [] }))).recordset[0];

          if (lFull && rFull) {
            const compareCols = Object.keys(lFull).filter(k => 
              !readOnlyCols.has(k.toLowerCase()) && 
              !isProtectedColumn(k) &&
              rCols.has(k.toLowerCase()) && 
              lCols.has(k.toLowerCase()) &&
              !pkCols.some(pk => pk.toLowerCase() === k.toLowerCase())
            );
            const hasValueDivergence = compareCols.some(k => String(lFull[k] ?? '') !== String(rFull[k] ?? ''));
            if (!hasValueDivergence) {
              // Exactly identical values and identical timestamp -> skip
              continue;
            }

            // VALUE DIVERGENCE DETECTED WITH IDENTICAL TIMESTAMPS:
            // Deterministic Tie-Breaker Policy:
            // When timestamps match exactly (e.g. smalldatetime minute-level resolution or simultaneous edits):
            // - Remote ERP is the authoritative tie-breaker for Master, Settings, and Reward data.
            // - Local DB is tie-breaker only for strictly local live checkout cart state.
            const winner = 'REMOTE';
            if (winner === 'REMOTE' && allowPull) {
              const uReq = localPool.request();
              const updateAssignments = compareCols.map((k, idx) => {
                uReq.input(`up_${idx}`, rFull[k]);
                return `[${k}] = @up_${idx}`;
              }).join(", ");
              pkCols.forEach((pk, idx) => uReq.input(`up_pk_${idx}`, getRowVal(rRowSummary, pk)));
              const uWhere = pkCols.map((pk, idx) => `[${pk}] = @up_pk_${idx}`).join(" AND ");
              const upRes = await uReq.query(`UPDATE [dbo].[${tableName}] SET ${updateAssignments} WHERE ${uWhere}`).catch((uErr) => {
                console.warn(`⚠️ [Auto-Provision] ${tableName} tie-breaker update failed:`, uErr.message);
                return { rowsAffected: [0] };
              });
              if (upRes.rowsAffected && upRes.rowsAffected[0] > 0) {
                updatedLocal++;
              }

              localPool.request()
                .input("tbl", tableName)
                .input("key", String(key))
                .input("lTime", lRawTime ? new Date(lRawTime) : null)
                .input("rTime", rRawTime ? new Date(rRawTime) : null)
                .input("winner", "REMOTE")
                .input("res", "Identical timestamp conflict: resolved by deterministic Remote tie-breaker rule.")
                .query(`
                  IF OBJECT_ID('SyncConflictLog', 'U') IS NOT NULL
                  INSERT INTO SyncConflictLog (TableName, RecordKey, LocalTime, RemoteTime, WinningSource, Resolution)
                  VALUES (@tbl, @key, @lTime, @rTime, @winner, @res)
                `).catch(() => {});
            } else if (winner === 'LOCAL' && allowPush) {
              const uReq = remotePool.request();
              const updateAssignments = compareCols.map((k, idx) => {
                uReq.input(`up_${idx}`, lFull[k]);
                return `[${k}] = @up_${idx}`;
              }).join(", ");
              pkCols.forEach((pk, idx) => uReq.input(`up_pk_${idx}`, getRowVal(lRowSummary, pk)));
              const uWhere = pkCols.map((pk, idx) => `[${pk}] = @up_pk_${idx}`).join(" AND ");
              await uReq.query(`UPDATE [dbo].[${tableName}] SET ${updateAssignments} WHERE ${uWhere}`).catch(() => {});
              updatedRemote++;

              localPool.request()
                .input("tbl", tableName)
                .input("key", String(key))
                .input("lTime", lRawTime ? new Date(lRawTime) : null)
                .input("rTime", rRawTime ? new Date(rRawTime) : null)
                .input("winner", "LOCAL")
                .input("res", "Identical timestamp conflict: resolved by deterministic Local tie-breaker rule.")
                .query(`
                  IF OBJECT_ID('SyncConflictLog', 'U') IS NOT NULL
                  INSERT INTO SyncConflictLog (TableName, RecordKey, LocalTime, RemoteTime, WinningSource, Resolution)
                  VALUES (@tbl, @key, @lTime, @rTime, @winner, @res)
                `).catch(() => {});
            }
          }
          continue;
        }

        // Time difference evaluation:
        // Remote is newer: Pull remote to local
        if (rTime > lTime && allowPull) {
          const reqWhere = pkCols.map((pk, idx) => `[${pk}] = @rpk_${idx}`).join(" AND ");
          const fetchReq = remotePool.request();
          pkCols.forEach((pk, idx) => fetchReq.input(`rpk_${idx}`, getRowVal(rRowSummary, pk)));
          const rRowRes = await fetchReq.query(`SELECT TOP 1 * FROM [dbo].[${tableName}] WHERE ${reqWhere}`).catch(() => ({ recordset: [] }));
          const rRow = rRowRes.recordset[0];
          if (rRow) {
            const keys = Object.keys(rRow).filter(k => 
              rRow[k] !== null && 
              !readOnlyCols.has(k.toLowerCase()) && 
              !isProtectedColumn(k) &&
              lCols.has(k.toLowerCase()) && 
              !pkCols.some(pk => pk.toLowerCase() === k.toLowerCase())
            );
            if (keys.length > 0) {
              const uReq = localPool.request();
              const updateAssignments = keys.map((k, idx) => {
                uReq.input(`up_${idx}`, rRow[k]);
                return `[${k}] = @up_${idx}`;
              }).join(", ");
              pkCols.forEach((pk, idx) => uReq.input(`up_pk_${idx}`, getRowVal(rRowSummary, pk)));
              const uWhere = pkCols.map((pk, idx) => `[${pk}] = @up_pk_${idx}`).join(" AND ");
              await uReq.query(`UPDATE [dbo].[${tableName}] SET ${updateAssignments} WHERE ${uWhere}`).catch(() => {});
              updatedLocal++;

              // Record conflict diagnosis
              localPool.request()
                .input("tbl", tableName)
                .input("key", String(key))
                .input("lTime", lRawTime ? new Date(lRawTime) : null)
                .input("rTime", rRawTime ? new Date(rRawTime) : null)
                .input("winner", "REMOTE")
                .input("res", `Remote timestamp is newer by ${rTime - lTime}ms. Updated Local record.`)
                .query(`
                  IF OBJECT_ID('SyncConflictLog', 'U') IS NOT NULL
                  INSERT INTO SyncConflictLog (TableName, RecordKey, LocalTime, RemoteTime, WinningSource, Resolution)
                  VALUES (@tbl, @key, @lTime, @rTime, @winner, @res)
                `).catch(() => {});
            }
          }
        } else if (lTime > rTime && allowPush) {
          // Local is newer: Push local to remote
          const reqWhere = pkCols.map((pk, idx) => `[${pk}] = @lpk_${idx}`).join(" AND ");
          const fetchReq = localPool.request();
          pkCols.forEach((pk, idx) => fetchReq.input(`lpk_${idx}`, getRowVal(lRowSummary, pk)));
          const lRowRes = await fetchReq.query(`SELECT TOP 1 * FROM [dbo].[${tableName}] WHERE ${reqWhere}`).catch(() => ({ recordset: [] }));
          const lRow = lRowRes.recordset[0];
          if (lRow) {
            const keys = Object.keys(lRow).filter(k => 
              lRow[k] !== null && 
              !readOnlyCols.has(k.toLowerCase()) && 
              !isProtectedColumn(k) &&
              rCols.has(k.toLowerCase()) && 
              !pkCols.some(pk => pk.toLowerCase() === k.toLowerCase())
            );
            if (keys.length > 0) {
              const uReq = remotePool.request();
              const updateAssignments = keys.map((k, idx) => {
                uReq.input(`up_${idx}`, lRow[k]);
                return `[${k}] = @up_${idx}`;
              }).join(", ");
              pkCols.forEach((pk, idx) => uReq.input(`up_pk_${idx}`, getRowVal(lRowSummary, pk)));
              const uWhere = pkCols.map((pk, idx) => `[${pk}] = @up_pk_${idx}`).join(" AND ");
              await uReq.query(`UPDATE [dbo].[${tableName}] SET ${updateAssignments} WHERE ${uWhere}`).catch(() => {});
              updatedRemote++;

              // Record conflict diagnosis
              localPool.request()
                .input("tbl", tableName)
                .input("key", String(key))
                .input("lTime", lRawTime ? new Date(lRawTime) : null)
                .input("rTime", rRawTime ? new Date(rRawTime) : null)
                .input("winner", "LOCAL")
                .input("res", `Local timestamp is newer by ${lTime - rTime}ms. Pushed to Remote record.`)
                .query(`
                  IF OBJECT_ID('SyncConflictLog', 'U') IS NOT NULL
                  INSERT INTO SyncConflictLog (TableName, RecordKey, LocalTime, RemoteTime, WinningSource, Resolution)
                  VALUES (@tbl, @key, @lTime, @rTime, @winner, @res)
                `).catch(() => {});
            }
          }
        }
      }
    }

    // 3B. RECONCILIATION FOR PULL-ONLY MASTER CATALOG TABLES (Category A)
    // If a record exists locally but was deleted from the Remote source of truth:
    // 1. Check if the record is referenced by historical sales/orders/invoices/KOTs.
    // 2. If referenced, NEVER hard delete: soft-deactivate (IsActive = 0) to preserve history while disabling menu selection.
    // 3. If unreferenced, hard delete safely.
    let deletedLocal = 0;
    if (syncMode === 'pullOnly' && missingOnRemote.length > 0) {
      for (const delPkRow of missingOnRemote) {
        try {
          const lowerTbl = String(tableName).toLowerCase();
          let isReferenced = false;

          // Check historical order/settlement references for DishMaster
          if (lowerTbl === 'dishmaster') {
            const dishIdVal = getRowVal(delPkRow, 'DishId');
            const refCheck = await localPool.request()
              .input("did", dishIdVal)
              .query(`
                SELECT TOP 1 1 AS hasRef FROM [dbo].[RestaurantOrderDetail] WHERE DishId = @did
                UNION ALL
                SELECT TOP 1 1 AS hasRef FROM [dbo].[SettlementItemDetail] WHERE DishId = @did
              `).catch(() => ({ recordset: [] }));
            if (refCheck.recordset.length > 0) {
              isReferenced = true;
            }
          }

          const delReq = localPool.request();
          const delWhere = pkCols.map((pk, idx) => {
            delReq.input(`dpk_${idx}`, getRowVal(delPkRow, pk));
            return `[${pk}] = @dpk_${idx}`;
          }).join(" AND ");

          if (isReferenced) {
            // Preserve historical reporting integrity and make it unavailable for new orders
            if (lCols.has("isactive")) {
              await localPool.request().query(`UPDATE [dbo].[${tableName}] SET IsActive = 0 WHERE ${delWhere}`).catch(() => {});
            }
          } else {
            const delRes = await delReq.query(`DELETE FROM [dbo].[${tableName}] WHERE ${delWhere}`).catch(async (fkErr) => {
              if (lCols.has("isactive")) {
                await localPool.request().query(`UPDATE [dbo].[${tableName}] SET IsActive = 0 WHERE ${delWhere}`).catch(() => {});
              }
              return { rowsAffected: [0] };
            });
            if (delRes.rowsAffected && delRes.rowsAffected[0] > 0) {
              deletedLocal += delRes.rowsAffected[0];
            }
          }
        } catch (_) {}
      }
    }

    // 4. Special Master Sync for UserMaster: Always sync AllowedLogins and credentials down from Cloud to Local
    if (String(tableName).toLowerCase() === 'usermaster') {
      try {
        const rUsersRes = await remotePool.request().query(`
          SELECT UserId, UserName, AllowedLogins, UserPassword, FullName, UserGroupid, IsDisabled
          FROM [dbo].[UserMaster]
        `).catch(() => ({ recordset: [] }));

        for (const ru of rUsersRes.recordset) {
          if (!ru.UserId && !ru.UserName) continue;
          const uReq = localPool.request()
            .input("UserId", ru.UserId)
            .input("UserName", ru.UserName)
            .input("AllowedLogins", ru.AllowedLogins !== null && ru.AllowedLogins !== undefined ? ru.AllowedLogins : 1)
            .input("UserPassword", ru.UserPassword)
            .input("FullName", ru.FullName)
            .input("UserGroupid", ru.UserGroupid)
            .input("IsDisabled", ru.IsDisabled ? 1 : 0);

          const upRes = await uReq.query(`
            UPDATE [dbo].[UserMaster]
            SET AllowedLogins = @AllowedLogins,
                UserPassword = CASE WHEN @UserPassword IS NOT NULL AND @UserPassword <> '' THEN @UserPassword ELSE UserPassword END,
                FullName = CASE WHEN @FullName IS NOT NULL AND @FullName <> '' THEN @FullName ELSE FullName END,
                UserGroupid = CASE WHEN @UserGroupid IS NOT NULL THEN @UserGroupid ELSE UserGroupid END,
                IsDisabled = @IsDisabled
            WHERE (UserId = @UserId OR UserName = @UserName)
              AND (
                ISNULL(AllowedLogins, 1) <> @AllowedLogins
                OR IsDisabled <> @IsDisabled
                OR (@UserPassword IS NOT NULL AND @UserPassword <> '' AND ISNULL(UserPassword, '') <> @UserPassword)
                OR (@FullName IS NOT NULL AND @FullName <> '' AND ISNULL(FullName, '') <> @FullName)
                OR (@UserGroupid IS NOT NULL AND ISNULL(UserGroupid, '00000000-0000-0000-0000-000000000000') <> @UserGroupid)
              )
          `).catch((uErr) => {
            console.warn("⚠️ [Auto-Provision] UserMaster special update error:", uErr.message);
            return { rowsAffected: [0] };
          });

          if (upRes.rowsAffected && upRes.rowsAffected[0] > 0) {
            updatedLocal++;
            console.log(`👤 [UserMaster Sync] Updated user '${ru.UserName}' credentials/details from Remote DB.`);
          }
        }
      } catch (uErr) {
        console.warn("⚠️ [Auto-Provision] UserMaster sync warning:", uErr.message);
      }
    }

    return { tableName, pushed, pulled, updatedLocal, updatedRemote, deletedLocal };
  } catch (err) {
    console.warn(`⚠️ [Auto-Provision] 2-way sync error for ${tableName}:`, err.message);
    return { tableName, pushed: 0, pulled: 0, updatedLocal: 0, updatedRemote: 0, deletedLocal: 0 };
  }
}

// =========================================================================================
// CATEGORY A: STRICTLY ONE-WAY PULL ONLY (Remote Cloud ERP -> Local DB)
// The Remote database is the source of truth for these tables.
// Local changes are NEVER pushed to Remote.
// =========================================================================================
const CATEGORY_A_PULL_ONLY_TABLES = [
  { name: 'CategoryMaster', pk: 'CategoryId' },
  { name: 'CategoryKitchenType', pk: ['CategoryId', 'KitchenTypeCode'] },
  { name: 'DishGroupKitchentype', pk: ['DishGroupid', 'KitchenTypeCode'] },
  { name: 'DishGroupMapping', pk: ['DishId', 'DishGroupId'] },
  { name: 'DishMaster', pk: 'DishId' },
  { name: 'DishGroupMaster', pk: 'DishGroupId' },
  { name: 'ModifierMaster', pk: 'ModifierID' },
  { name: 'DishGroupModifier', pk: ['DishGroupId', 'ModifierId'] },
  { name: 'DishModifier', pk: ['DishId', 'ModifierId'] },
  { name: 'DishModifierGroup', pk: 'DishModifierGroupId' },
  { name: 'ComboGroupMaster', pk: 'ComboGroupId' },
  { name: 'ComboGroupDishMapping', pk: 'MappingId' },
  { name: 'TableMaster', pk: 'TableId' },
  { name: 'Paymode', pk: 'PayMode' },
  { name: 'ParentDishComboGroupMapping', pk: ['ParentDishId', 'ComboGroupId'] },
  { name: 'ImageList', pk: 'Imageid' },
  { name: 'UserGroupMaster', pk: 'UserGroupId' },
  { name: 'UserMaster', pk: 'UserId' },
  { name: 'UserPermission', pk: ['UserGroupCode', 'FormCode'] }
];

// =========================================================================================
// CATEGORY B: TWO-WAY PUSH AND PULL SYNCHRONIZATION (Local DB <-> Remote DB)
// Changes in either database are synchronized bidirectionally with conflict resolution.
// =========================================================================================
const CATEGORY_B_TWOWAY_TABLES = [
  { name: 'TerminalMaster', pk: 'TerminalId' },
  { name: 'CompanySettings', pk: 'Id' },
  { name: 'AppSettings', pk: 'Id' },
  { name: 'MemberMaster', pk: 'MemberId' },
  { name: 'RewardPointDetails', pk: 'Id' },
  { name: 'LoyaltyCustomer', pk: 'LoyaltyCustomerId' },
  { name: 'LoyaltyVisit', pk: 'LoyaltyVisitId' },
  { name: 'CustomerDishLoyaltyState', pk: ['CustomerId', 'RuleId'] },
  { name: 'CreditCustomerMaster', pk: 'CustomerId' },
  { name: 'CustomerCreditTransactions', pk: 'TransactionId' },
  { name: 'CustomerCreditAllocations', pk: 'AllocationId' }
];

let lastMasterCatalogSyncTime = 0;
const MASTER_CATALOG_SYNC_INTERVAL_MS = 180000; // Check catalog every 3-5 minutes (default: 3 minutes)

let isMasterCatalogSyncing = false;
const tableSyncStateMap = new Map();
const cartSyncStateMap = new Map();

// Execute synchronization for Category A (Pull-Only) and Category B (2-Way)
async function syncMasterCatalog2Way(remotePool, localPool) {
  if (!remotePool || !localPool) return;
  if (isMasterCatalogSyncing) {
    console.log("⏳ [CatalogSync] Catalog sync already running. Skipping overlapping cycle.");
    return;
  }
  isMasterCatalogSyncing = true;
  lastMasterCatalogSyncTime = Date.now();
  let totalChanges = 0;

  try {
    // 1. Sync Category A tables: STRICTLY ONE-WAY PULL ONLY (Remote -> Local)
    console.log("📥 [CatalogSync] Pulling Category A Master Catalog tables (Remote -> Local Only)...");
    for (const t of CATEGORY_A_PULL_ONLY_TABLES) {
      try {
        const res = await syncTable2Way(remotePool, localPool, t.name, t.pk, 2000, 'pullOnly');
        if (res && (res.pulled > 0 || res.updatedLocal > 0 || (res.deletedLocal && res.deletedLocal > 0))) {
          totalChanges += (res.pulled + res.updatedLocal + (res.deletedLocal || 0));
          console.log(`📦 [PullOnly] ${t.name}: Pulled=${res.pulled}, UpdLocal=${res.updatedLocal}, DelLocal=${res.deletedLocal || 0}`);
        }
      } catch (tblErr) {
        console.warn(`⚠️ [PullOnly] ${t.name} warning:`, tblErr.message);
      }
    }

    // 2. Sync Category B tables: TWO-WAY (Local <-> Remote)
    console.log("🔄 [CatalogSync] Synchronizing Category B Operational & Settings tables (2-Way)...");
    for (const t of CATEGORY_B_TWOWAY_TABLES) {
      try {
        const res = await syncTable2Way(remotePool, localPool, t.name, t.pk, 500, 'twoWay');
        if (res && (res.pulled > 0 || res.pushed > 0 || res.updatedLocal > 0 || res.updatedRemote > 0)) {
          totalChanges += (res.pulled + res.pushed + res.updatedLocal + res.updatedRemote);
          console.log(`📦 [TwoWay] ${t.name}: Pulled=${res.pulled}, Pushed=${res.pushed}, UpdLocal=${res.updatedLocal}, UpdRemote=${res.updatedRemote}`);
        }
      } catch (tblErr) {
        console.warn(`⚠️ [TwoWay] ${t.name} warning:`, tblErr.message);
      }
    }

    if (totalChanges > 0) {
      console.log(`✨ [CatalogSync] Catalog updated with ${totalChanges} total changes! Invalidating menu cache...`);
      try {
        const menuRoute = require("../routes/menu");
        if (menuRoute && typeof menuRoute.clearMenuCache === "function") {
          menuRoute.clearMenuCache();
        }
      } catch (_) {}
    }
  } finally {
    isMasterCatalogSyncing = false;
  }
}

// Helper: Fast batch hydrator for any table from Remote DB -> Local DB
async function hydrateTableFast(remotePool, localPool, tableName) {
  try {
    const rCountRes = await remotePool.request().query(`SELECT COUNT(*) as cnt FROM [dbo].[${tableName}]`);
    const rCount = rCountRes.recordset[0].cnt;
    if (rCount === 0) return { tableName, synced: 0 };

    let lCount = 0;
    try {
      const lCountRes = await localPool.request().query(`SELECT COUNT(*) as cnt FROM [dbo].[${tableName}]`);
      lCount = lCountRes.recordset[0].cnt;
    } catch (_) {}

    if (lCount >= rCount) {
      return { tableName, synced: 0 };
    }

    console.log(`📦 [Auto-Provision] Hydrating table [${tableName}] (Local: ${lCount}, Remote: ${rCount})...`);

    const readOnlyCols = await getReadOnlyColumns(localPool, tableName);
    const hasIdent = await hasIdentityCol(localPool, tableName);

    const pkRes = await localPool.request().query(`
      SELECT kcu.COLUMN_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
      JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc 
        ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME 
       AND kcu.TABLE_NAME = tc.TABLE_NAME
      WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' 
        AND kcu.TABLE_NAME = '${tableName}'
      ORDER BY kcu.ORDINAL_POSITION
    `).catch(() => ({ recordset: [] }));
    const pkCols = pkRes.recordset.map(r => r.COLUMN_NAME);

    let existingLocalPks = new Set();
    if (lCount > 0 && pkCols.length > 0) {
      const pkSql = pkCols.map(c => `[${c}]`).join(", ");
      const lPkRes = await localPool.request().query(`SELECT ${pkSql} FROM [dbo].[${tableName}]`);
      lPkRes.recordset.forEach(r => {
        const key = pkCols.map(p => String(r[p] ?? '')).join('___');
        existingLocalPks.add(key);
      });
    }

    const rDataRes = await remotePool.request().query(`SELECT * FROM [dbo].[${tableName}]`);
    let records = rDataRes.recordset;

    if (existingLocalPks.size > 0 && pkCols.length > 0) {
      records = records.filter(r => {
        const key = pkCols.map(p => String(r[p] ?? '')).join('___');
        return !existingLocalPks.has(key);
      });
    }

    if (records.length === 0) {
      return { tableName, synced: 0 };
    }

    const lColsRes = await localPool.request().query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tableName}'`);
    const validLocalCols = new Set(lColsRes.recordset.map(r => r.COLUMN_NAME.toLowerCase()));

    const firstRow = records[0];
    const isUserMaster = String(tableName).toLowerCase() === 'usermaster';
    const insertCols = Object.keys(firstRow).filter(k => {
      const lower = k.toLowerCase();
      if (isUserMaster && (lower === 'isloggedin' || lower === 'lastheartbeat' || lower === 'activesessionid')) {
        return false;
      }
      return !readOnlyCols.has(lower) && validLocalCols.has(lower);
    });

    if (insertCols.length === 0) return { tableName, synced: 0 };

    const colListSql = insertCols.map(c => `[${c}]`).join(", ");
    const batchSize = Math.max(1, Math.min(100, Math.floor(1800 / insertCols.length)));

    let inserted = 0;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const req = localPool.request();
      const valueTuples = [];

      batch.forEach((row, rowIdx) => {
        const rowParams = insertCols.map((col, colIdx) => {
          const val = row[col];
          if (val === null || val === undefined) {
            return "NULL";
          }
          const paramName = `p_${rowIdx}_${colIdx}`;
          req.input(paramName, val);
          return `@${paramName}`;
        });
        valueTuples.push(`(${rowParams.join(", ")})`);
      });

      const identOn = hasIdent ? `SET IDENTITY_INSERT [dbo].[${tableName}] ON;` : '';
      const identOff = hasIdent ? `SET IDENTITY_INSERT [dbo].[${tableName}] OFF;` : '';

      const batchSql = `
        ${identOn}
        INSERT INTO [dbo].[${tableName}] (${colListSql}) VALUES ${valueTuples.join(",\n")};
        ${identOff}
      `;

      try {
        await req.query(batchSql);
        inserted += batch.length;
      } catch (batchErr) {
        // Fallback row-by-row on error
        for (const row of batch) {
          try {
            const singleReq = localPool.request();
            let pIdx = 0;
            const singleParams = insertCols.map((col) => {
              const val = row[col];
              if (val === null || val === undefined) {
                return "NULL";
              }
              const pName = `sp_${pIdx++}`;
              singleReq.input(pName, val);
              return `@${pName}`;
            });
            await singleReq.query(`
              ${identOn}
              INSERT INTO [dbo].[${tableName}] (${colListSql}) VALUES (${singleParams.join(", ")});
              ${identOff}
            `);
            inserted++;
          } catch (_) {}
        }
      }
    }

    if (inserted > 0) {
      console.log(`✅ [Auto-Provision] Hydrated ${inserted} records into Local table [${tableName}].`);
    }
    return { tableName, synced: inserted };
  } catch (err) {
    console.warn(`⚠️ [Auto-Provision] Hydration warning for [${tableName}]:`, err.message);
    return { tableName, synced: 0, error: err.message };
  }
}

// Helper: Hydrate postal code master table (Singapore postal code directory)
async function hydratePostalCodeTable(remotePool, localPool) {
  try {
    const lCntRes = await localPool.request().query("SELECT COUNT(*) as cnt FROM [dbo].[Mas_PostalCode]").catch(() => ({ recordset: [{ cnt: 0 }] }));
    if (lCntRes.recordset[0].cnt >= 100000) {
      return; // Already populated
    }

    console.log("🚚 [Auto-Provision] Hydrating Singapore Postal Code database (Mas_PostalCode)...");
    const res = await remotePool.request().query("SELECT Postcode, Street, Block, Country, BuildingName FROM Mas_PostalCode");
    const records = res.recordset;
    if (!records || records.length === 0) return;

    const batchSize = 300;
    for (let i = 0; i < records.length; i += batchSize) {
      const chunk = records.slice(i, i + batchSize);
      const req = localPool.request();
      const tuples = chunk.map((r, idx) => {
        req.input(`p_${idx}_0`, r.Postcode);
        req.input(`p_${idx}_1`, r.Street);
        req.input(`p_${idx}_2`, r.Block);
        req.input(`p_${idx}_3`, r.Country);
        req.input(`p_${idx}_4`, r.BuildingName);
        return `(@p_${idx}_0, @p_${idx}_1, @p_${idx}_2, @p_${idx}_3, @p_${idx}_4)`;
      });
      await req.query(`INSERT INTO Mas_PostalCode (Postcode, Street, Block, Country, BuildingName) VALUES ${tuples.join(",")}`).catch(() => {});
    }
    console.log(`✅ [Auto-Provision] Mas_PostalCode hydrated (${records.length} postal codes).`);
  } catch (err) {
    console.warn("⚠️ [Auto-Provision] Mas_PostalCode hydration warning:", err.message);
  }
}

// Step: Hydrate all base tables that have data on Remote DB
async function hydrateAllTablesFromRemote(remotePool, localPool) {
  try {
    console.log("🚚 [Auto-Provision] Checking and hydrating all tables with data from Remote Cloud DB...");
    const tablesResult = await remotePool.request().query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME NOT IN ('sysdiagrams', 'POS_SyncQueue', 'Mas_PostalCode')
      ORDER BY TABLE_NAME
    `);
    const tables = tablesResult.recordset.map(r => r.TABLE_NAME);

    let totalHydrated = 0;
    for (const tableName of tables) {
      const res = await hydrateTableFast(remotePool, localPool, tableName);
      if (res && res.synced > 0) {
        totalHydrated += res.synced;
      }
    }

    // Hydrate postal codes if empty
    await hydratePostalCodeTable(remotePool, localPool);

    if (totalHydrated > 0) {
      console.log(`🎉 [Auto-Provision] Successfully hydrated ${totalHydrated} total records across all tables into Local DB!`);
    } else {
      console.log("✅ [Auto-Provision] All tables already fully hydrated in Local DB.");
    }
  } catch (err) {
    console.error("❌ [Auto-Provision] Error hydrating all tables:", err.message);
  }
}

let remoteOrderColsCache = null;
let remoteDetailColsCache = null;

/**
 * ⚡ INSTANT 1-WAY PUSH: Local DB -> Remote DB
 * Instantly synchronizes an active or modified order and all its items
 * from Local DB's RestaurantOrderCur & RestaurantOrderDetailCur to Remote DB.
 * Strictly 1-way: NEVER pulls from Remote to Local.
 */
async function pushActiveOrderToRemote(orderIdOrNumber, customRemotePool, customLocalPool) {
  if (!orderIdOrNumber) return;
  try {
    const { getPool, getRemotePool, isRemoteOnline } = require("../config/db");
    const remotePool = customRemotePool || (isRemoteOnline() ? getRemotePool() : null);
    const localPool = customLocalPool || getPool();

    if (!remotePool || !localPool) return;

    // Cache Remote column names so we never insert non-existent columns
    if (!remoteOrderColsCache) {
      const oCols = await remotePool.request().query("SELECT LOWER(COLUMN_NAME) AS col FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'RestaurantOrderCur'").catch(() => ({ recordset: [] }));
      if (oCols.recordset.length > 0) remoteOrderColsCache = new Set(oCols.recordset.map(r => r.col));
    }
    if (!remoteDetailColsCache) {
      const dCols = await remotePool.request().query("SELECT LOWER(COLUMN_NAME) AS col FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'RestaurantOrderDetailCur'").catch(() => ({ recordset: [] }));
      if (dCols.recordset.length > 0) remoteDetailColsCache = new Set(dCols.recordset.map(r => r.col));
    }

    const idStr = String(orderIdOrNumber).replace(/^\{|\}$/g, "").trim();

    // 1. Fetch Order Header from Local DB
    const localOrderRes = await localPool.request()
      .input("idStr", idStr)
      .query(`
        SELECT TOP 1 * FROM RestaurantOrderCur WITH (NOLOCK)
        WHERE OrderId = TRY_CAST(@idStr AS UNIQUEIDENTIFIER) OR OrderNumber = @idStr
        ORDER BY ModifiedOn DESC
      `).catch(() => ({ recordset: [] }));

    let lo = localOrderRes.recordset[0];

    // If order was already closed/settled and moved out of Cur, check RestaurantOrder
    if (!lo) {
      const closedOrderRes = await localPool.request()
        .input("idStr", idStr)
        .query(`
          SELECT TOP 1 * FROM RestaurantOrder WITH (NOLOCK)
          WHERE OrderId = TRY_CAST(@idStr AS UNIQUEIDENTIFIER) OR OrderNumber = @idStr
        `).catch(() => ({ recordset: [] }));
      const clo = closedOrderRes.recordset[0];
      if (clo) {
        // Mark closed on remote
        await remotePool.request()
          .input("oid", clo.OrderId)
          .query(`
            UPDATE RestaurantOrderCur 
            SET isOrderClosed = 1, StatusCode = 3, ModifiedOn = GETDATE() 
            WHERE OrderId = @oid
          `).catch(() => {});
        return;
      }
      return;
    }

    const orderId = lo.OrderId;

    // 2. Push Header to Remote DB
    const keys = Object.keys(lo).filter(k => lo[k] !== null && (!remoteOrderColsCache || remoteOrderColsCache.has(k.toLowerCase())));
    if (keys.length > 0) {
      const colList = keys.map(k => `[${k}]`).join(", ");
      const req = remotePool.request();
      keys.forEach((k, idx) => {
        req.input(`lp_${idx}`, lo[k]);
      });
      const valList = keys.map((k, idx) => `@lp_${idx}`).join(", ");
      const updateAssignments = keys
        .map((k, idx) => ({ key: k, idx }))
        .filter(item => item.key.toLowerCase() !== 'orderid')
        .map(item => `[${item.key}] = @lp_${item.idx}`)
        .join(", ");
      req.input("lp_OrderId", orderId);

      await req.query(`
        IF NOT EXISTS (SELECT 1 FROM RestaurantOrderCur WHERE OrderId = @lp_OrderId)
        BEGIN
          INSERT INTO RestaurantOrderCur (${colList}) VALUES (${valList})
        END
        ELSE
        BEGIN
          UPDATE RestaurantOrderCur SET ${updateAssignments} WHERE OrderId = @lp_OrderId
        END
      `).catch((err) => console.warn(`⚠️ [Instant-Push] Header warning (${orderId}):`, err.message));
    }

    // 3. Fetch all line items from Local DB RestaurantOrderDetailCur
    const localDetailsRes = await localPool.request()
      .input("oid", orderId)
      .query(`
        SELECT * FROM RestaurantOrderDetailCur WITH (NOLOCK) 
        WHERE OrderId = @oid AND StatusCode <> 0
      `).catch(() => ({ recordset: [] }));

    const localDetails = localDetailsRes.recordset;
    const localDetailIds = localDetails.map(d => d.OrderDetailId);

    // 4. Sync details to Remote DB
    if (localDetailIds.length > 0) {
      const cleanDetailIds = localDetailIds.map(id => `'${id}'`).join(",");
      await remotePool.request().query(`
        DELETE FROM RestaurantOrderDetailCur 
        WHERE OrderId = '${orderId}' AND StatusCode = 1 AND OrderDetailId NOT IN (${cleanDetailIds})
      `).catch(() => {});
    } else {
      await remotePool.request().query(`
        DELETE FROM RestaurantOrderDetailCur 
        WHERE OrderId = '${orderId}' AND StatusCode = 1
      `).catch(() => {});
    }

    for (const lod of localDetails) {
      const dKeys = Object.keys(lod).filter(k => lod[k] !== null && (!remoteDetailColsCache || remoteDetailColsCache.has(k.toLowerCase())));
      if (dKeys.length === 0) continue;
      const dColList = dKeys.map(k => `[${k}]`).join(", ");
      const dReq = remotePool.request();
      dKeys.forEach((k, idx) => {
        dReq.input(`ldp_${idx}`, lod[k]);
      });
      const dValList = dKeys.map((k, idx) => `@ldp_${idx}`).join(", ");
      const dUpdateAssignments = dKeys
        .map((k, idx) => ({ key: k, idx }))
        .filter(item => item.key.toLowerCase() !== 'orderdetailid')
        .map(item => `[${item.key}] = @ldp_${item.idx}`)
        .join(", ");
      dReq.input("ldp_OrderDetailId", lod.OrderDetailId);

      await dReq.query(`
        IF NOT EXISTS (SELECT 1 FROM RestaurantOrderDetailCur WHERE OrderDetailId = @ldp_OrderDetailId)
        BEGIN
          INSERT INTO RestaurantOrderDetailCur (${dColList}) VALUES (${dValList})
        END
        ELSE
        BEGIN
          UPDATE RestaurantOrderDetailCur SET ${dUpdateAssignments} WHERE OrderDetailId = @ldp_OrderDetailId
        END
      `).catch((err) => console.warn(`⚠️ [Instant-Push] Detail warning (${lod.OrderDetailId}):`, err.message));
    }

    // 5. Also push TableMaster for the table if assigned
    const tableIdentifier = lo.Tableno || lo.TableNumber;
    if (tableIdentifier) {
      const tblRes = await localPool.request()
        .input("tblNo", String(tableIdentifier).trim())
        .query(`
          SELECT TOP 1 TableNumber, Status, StartTime, TotalAmount, CurrentOrderId, CustomerName, Pax, LockedByName, entry_status, ModifiedOn
          FROM TableMaster WITH (NOLOCK)
          WHERE TableNumber = @tblNo
        `).catch(() => ({ recordset: [] }));
      const tbl = tblRes.recordset[0];
      if (tbl) {
        await remotePool.request()
          .input("tblNo", tbl.TableNumber)
          .input("status", tbl.Status !== undefined ? tbl.Status : 0)
          .input("startTime", tbl.StartTime)
          .input("totalAmt", tbl.TotalAmount || 0)
          .input("currOrder", tbl.CurrentOrderId)
          .input("custName", tbl.CustomerName)
          .input("pax", tbl.Pax)
          .input("lockedBy", tbl.LockedByName)
          .input("entryStatus", tbl.entry_status)
          .input("modifiedOn", tbl.ModifiedOn || new Date())
          .query(`
            UPDATE TableMaster
            SET Status = @status, StartTime = @startTime, TotalAmount = @totalAmt,
                CurrentOrderId = @currOrder, CustomerName = @custName, Pax = @pax,
                LockedByName = @lockedBy, entry_status = @entryStatus, ModifiedOn = @modifiedOn
            WHERE TableNumber = @tblNo
          `).catch(() => {});
      }
    }

    console.log(`⚡ [Instant-Push] Pushed Order ${lo.OrderNumber || orderId} (${localDetails.length} items) Local -> Remote DB`);
  } catch (err) {
    console.warn(`⚠️ [Instant-Push] Error pushing order ${orderIdOrNumber}:`, err.message);
  }
}

// Helper: Sync active floor plan, active open orders, and Day-Start sequence from Remote DB
async function syncOperationalStateFromRemote(remotePool, localPool) {
  try {
    // 0. Mirror business day (DateEntry) to Remote DB
    const { mirrorBusinessDateEntry } = require("./salesPushService");
    await mirrorBusinessDateEntry(localPool, remotePool);

    // 0B. SyncDeletedLog & SyncConflictLog Table Creation & Offline Deletion Processing
    const createDeletedLogTblSql = `
      IF OBJECT_ID('SyncDeletedLog', 'U') IS NULL
      BEGIN
        CREATE TABLE SyncDeletedLog (
          Id INT IDENTITY(1,1) PRIMARY KEY,
          TableName VARCHAR(100) NOT NULL,
          RecordId VARCHAR(100) NOT NULL,
          DeletedAt DATETIME DEFAULT GETDATE()
        );
      END;
      IF OBJECT_ID('SyncConflictLog', 'U') IS NULL
      BEGIN
        CREATE TABLE SyncConflictLog (
          ConflictId INT IDENTITY(1,1) PRIMARY KEY,
          TableName VARCHAR(100) NOT NULL,
          RecordKey VARCHAR(255) NOT NULL,
          LocalTime DATETIME NULL,
          RemoteTime DATETIME NULL,
          WinningSource VARCHAR(50) NOT NULL,
          Resolution VARCHAR(255) NOT NULL,
          LoggedAt DATETIME DEFAULT GETDATE()
        );
      END;
    `;
    await localPool.request().query(createDeletedLogTblSql).catch(() => {});
    await remotePool.request().query(createDeletedLogTblSql).catch(() => {});

    // Table PK lookup map for Category A and Category B tables deletion synchronization
    const deletionTablePkMap = {
      // Category A (Remote -> Local deletions)
      'CategoryMaster': 'CategoryId',
      'CategoryKitchenType': 'CategoryId',
      'DishGroupKitchentype': 'DishGroupid',
      'DishGroupMapping': 'DishId',
      'DishMaster': 'DishId',
      'DishGroupMaster': 'DishGroupId',
      'ModifierMaster': 'ModifierID',
      'DishGroupModifier': 'DishGroupId',
      'DishModifier': 'DishId',
      'DishModifierGroup': 'DishModifierGroupId',
      'ComboGroupMaster': 'ComboGroupId',
      'ComboGroupDishMapping': 'MappingId',
      'TableMaster': 'TableId',
      'Paymode': 'PayMode',
      'ParentDishComboGroupMapping': 'ParentDishId',
      'ImageList': 'Imageid',
      'UserGroupMaster': 'UserGroupId',
      'UserMaster': 'UserId',
      'UserPermission': 'UserGroupCode',
      // Category B (Two-Way deletions)
      'TerminalMaster': 'TerminalId',
      'CompanySettings': 'Id',
      'AppSettings': 'Id',
      'MemberMaster': 'MemberId',
      'RewardPointDetails': 'Id',
      'LoyaltyCustomer': 'LoyaltyCustomerId',
      'LoyaltyVisit': 'LoyaltyVisitId',
      'CustomerDishLoyaltyState': 'CustomerId',
      'CreditCustomerMaster': 'CustomerId',
      'CustomerCreditTransactions': 'TransactionId',
      'CreditCustomerTransaction': 'TransactionId',
      'CustomerCreditAllocations': 'AllocationId'
    };

    // Category A tables are STRICTLY PULL-ONLY: Local deletions must NEVER be pushed to Remote!
    const CATEGORY_A_SET = new Set(CATEGORY_A_PULL_ONLY_TABLES.map(t => t.name.toLowerCase()));

    // Process Local Deletions -> Remote DB (Category B only)
    const localDeletions = await localPool.request().query("SELECT Id, TableName, RecordId FROM SyncDeletedLog").catch(() => ({ recordset: [] }));
    for (const del of localDeletions.recordset) {
      if (CATEGORY_A_SET.has(del.TableName.toLowerCase())) {
        // Discard local deletion of Category A table to prevent polluting Remote source of truth
        await localPool.request().input("id", del.Id).query("DELETE FROM SyncDeletedLog WHERE Id = @id").catch(() => {});
        continue;
      }
      const pkName = deletionTablePkMap[del.TableName] || 'Id';
      await remotePool.request()
        .input("recId", del.RecordId)
        .query(`DELETE FROM [dbo].[${del.TableName}] WHERE [${pkName}] = @recId`).catch(() => {});
      await localPool.request()
        .input("id", del.Id)
        .query("DELETE FROM SyncDeletedLog WHERE Id = @id").catch(() => {});
    }

    // Process Remote Deletions -> Local DB (Category A and Category B)
    const remoteDeletions = await remotePool.request().query("SELECT Id, TableName, RecordId FROM SyncDeletedLog").catch(() => ({ recordset: [] }));
    for (const rDel of remoteDeletions.recordset) {
      const pkName = deletionTablePkMap[rDel.TableName] || 'Id';
      await localPool.request()
        .input("recId", rDel.RecordId)
        .query(`DELETE FROM [dbo].[${rDel.TableName}] WHERE [${pkName}] = @recId`).catch(() => {});
      await remotePool.request()
        .input("id", rDel.Id)
        .query("DELETE FROM SyncDeletedLog WHERE Id = @id").catch(() => {});
    }

    // 0A. Master Catalog Sync: verify all menu, catalog, settings & terminals every 3 minutes (or on first run)
    const now = Date.now();
    if (now - lastMasterCatalogSyncTime >= MASTER_CATALOG_SYNC_INTERVAL_MS || lastMasterCatalogSyncTime === 0) {
      lastMasterCatalogSyncTime = now;
      await syncMasterCatalog2Way(remotePool, localPool);
    }

    // 0C. Operational Table Sync for Non-Transactional Staff & Attendance Entities
    // (Note: Category A & Category B are synchronized above in syncMasterCatalog2Way)
    await syncTable2Way(remotePool, localPool, "TimeEntry", ["Userid", "ClockinTime"], 50);
    await syncTable2Way(remotePool, localPool, "DailyAttendance", ["DeliveryPersonId", "StartDateTime"], 50);
    await syncTable2Way(remotePool, localPool, "DailyAttendanceLog", ["DeliveryPersonId", "StartDateTime"], 50);

    // 1. Sync DailyOrderSequenceNumber (Business Day Start/End status)
    const remoteSeq = await remotePool.request().query("SELECT TOP 50 * FROM DailyOrderSequenceNumber");
    for (const seq of remoteSeq.recordset) {
      const val = seq.NextDailyOrderSequenceNumber || seq.LastNumber || 1;
      await localPool.request()
        .input("val", val)
        .query(`
          IF EXISTS (SELECT 1 FROM DailyOrderSequenceNumber)
            UPDATE DailyOrderSequenceNumber SET NextDailyOrderSequenceNumber = @val;
          ELSE
            INSERT INTO DailyOrderSequenceNumber (NextDailyOrderSequenceNumber) VALUES (@val);
        `).catch(() => {});
    }

    // 2. 1-Way Floor Plan Table State Sync: Push Local DB Table State -> Remote DB ONLY
    // (Remote -> Local pull is completely DISABLED so Remote DB never resets or overrides local dining floor status)
    const localTables = await localPool.request().query(`
      SELECT TableNumber, Status, StartTime, TotalAmount, CurrentOrderId, CustomerName, Pax, LockedByName, entry_status, ModifiedOn
      FROM TableMaster WITH (NOLOCK)
    `).catch(() => ({ recordset: [] }));

    for (const lTbl of localTables.recordset) {
      const tblKey = String(lTbl.TableNumber);
      const stateSig = `${lTbl.Status}_${lTbl.TotalAmount}_${lTbl.CurrentOrderId}_${lTbl.LockedByName}_${lTbl.entry_status}_${lTbl.CustomerName}_${lTbl.Pax}_${lTbl.StartTime}`;
      if (tableSyncStateMap.get(tblKey) === stateSig) {
        continue; // Unchanged table floor state: skip redundant remote network query
      }

      await remotePool.request()
        .input("tblNo", lTbl.TableNumber)
        .input("status", lTbl.Status !== undefined ? lTbl.Status : 0)
        .input("startTime", lTbl.StartTime)
        .input("totalAmt", lTbl.TotalAmount || 0)
        .input("currOrder", lTbl.CurrentOrderId)
        .input("custName", lTbl.CustomerName)
        .input("pax", lTbl.Pax)
        .input("lockedBy", lTbl.LockedByName)
        .input("entryStatus", lTbl.entry_status)
        .input("modifiedOn", lTbl.ModifiedOn || new Date())
        .query(`
          UPDATE TableMaster
          SET Status = @status, StartTime = @startTime, TotalAmount = @totalAmt,
              CurrentOrderId = @currOrder, CustomerName = @custName, Pax = @pax,
              LockedByName = @lockedBy, entry_status = @entryStatus, ModifiedOn = @modifiedOn
          WHERE TableNumber = @tblNo
        `).then(() => {
          tableSyncStateMap.set(tblKey, stateSig);
        }).catch(() => {});
    }

    // 3. 1-Way CartItems Sync: Push Local DB -> Remote DB ONLY
    // (Remote -> Local cart pull is completely DISABLED so stale remote carts never pollute local tables)
    const localCartItems = await localPool.request().query("SELECT * FROM CartItems WITH (NOLOCK)").catch(() => ({ recordset: [] }));
    for (const lItem of localCartItems.recordset) {
      const cartKey = String(lItem.Id);
      const cartSig = `${lItem.CartId}_${lItem.CartPayload}`;
      if (cartSyncStateMap.get(cartKey) === cartSig) {
        continue; // Unchanged cart: skip redundant remote network query
      }

      await remotePool.request()
        .input("id", lItem.Id)
        .input("cartId", lItem.CartId)
        .input("payload", lItem.CartPayload)
        .query(`
          IF EXISTS (SELECT 1 FROM CartItems WHERE Id = @id)
            UPDATE CartItems SET CartId = @cartId, CartPayload = @payload, UpdatedAt = GETDATE() WHERE Id = @id;
          ELSE
            INSERT INTO CartItems (Id, CartId, CartPayload, UpdatedAt) VALUES (@id, @cartId, @payload, GETDATE());
        `).then(() => {
          cartSyncStateMap.set(cartKey, cartSig);
        }).catch(() => {});
    }

    // Prune stale entries in cartSyncStateMap to keep memory strictly bounded
    if (cartSyncStateMap.size > localCartItems.recordset.length) {
      const activeCartKeys = new Set(localCartItems.recordset.map(i => String(i.Id)));
      for (const k of cartSyncStateMap.keys()) {
        if (!activeCartKeys.has(k)) {
          cartSyncStateMap.delete(k);
        }
      }
    }

    // 4. 1-WAY SYNC: Active Open Orders & Line Items (Local DB -> Remote DB ONLY)
    // 🛡️ REMOTE PULL DISABLED: Never pull open orders or details from Remote DB into Local DB!
    // Local DB is the sole authoritative master of on-ground orders and item lists.

    // A. Sync Closed Status from Local DB -> Remote DB (close Remote orders if closed on Local)
    const localClosedOrders = await localPool.request().query(`
      SELECT OrderId FROM RestaurantOrderCur WITH (NOLOCK) WHERE isOrderClosed = 1 AND ModifiedOn >= DATEADD(DAY, -1, GETDATE())
      UNION
      SELECT OrderId FROM RestaurantOrder WITH (NOLOCK) WHERE ModifiedOn >= DATEADD(DAY, -1, GETDATE())
    `).catch(() => ({ recordset: [] }));
    for (const lco of localClosedOrders.recordset) {
      if (lco.OrderId) {
        await remotePool.request().query(`
          UPDATE RestaurantOrderCur SET isOrderClosed = 1, StatusCode = 3, ModifiedOn = GETDATE() WHERE OrderId = '${lco.OrderId}' AND (isOrderClosed = 0 OR isOrderClosed IS NULL)
        `).catch(() => {});
      }
    }

    // B. Push Local Active Open Orders & Details -> Remote DB (sweep recently modified active orders)
    const localOrders = await localPool.request().query(`
      SELECT TOP 10 OrderId FROM RestaurantOrderCur WITH (NOLOCK) 
      WHERE (isOrderClosed = 0 OR isOrderClosed IS NULL)
      ORDER BY ModifiedOn DESC
    `).catch(() => ({ recordset: [] }));

    for (const lo of localOrders.recordset) {
      await pushActiveOrderToRemote(lo.OrderId, remotePool, localPool);
    }

    console.log("⚡ [Auto-Provision] Operational state, carts & active open orders synced (1-way Local -> Remote push)!");
  } catch (err) {
    console.warn("⚠️ [Auto-Provision] Operational state sync warning:", err.message);
  }
}

// Helper: Ensure core views like Vw_UserMaster exist on Local DB even if Remote is offline
async function ensureEssentialLocalViews(localPool) {
  if (!localPool) return;
  try {
    const checkTable = await localPool.request().query(`SELECT OBJECT_ID('UserMaster', 'U') AS id`).catch(() => ({ recordset: [] }));
    if (!checkTable.recordset[0]?.id) {
      return; // Wait until UserMaster table exists
    }

    const checkView = await localPool.request().query(`
      SELECT OBJECT_ID('vw_UserMaster', 'V') AS v1, OBJECT_ID('Vw_UserMaster', 'V') AS v2
    `).catch(() => ({ recordset: [] }));

    const r = checkView.recordset[0] || {};
    if (!r.v1 && !r.v2) {
      let created = false;
      await localPool.request().batch(`
        CREATE VIEW [dbo].[Vw_UserMaster] AS
        SELECT UserMaster.*, UG.UserGroupName 
        FROM UserMaster
        LEFT JOIN UserGroupMaster UG ON UG.UserGroupId = UserMaster.UserGroupId
      `).then(() => { created = true; }).catch((err) => {
        console.warn("⚠️ [Auto-Provision] Failed to create essential Vw_UserMaster view:", err.message);
      });
      if (created) {
        console.log("✅ [Auto-Provision] Created essential Vw_UserMaster view on Local DB!");
      }
    }
  } catch (err) {
    console.warn("⚠️ [Auto-Provision] View creation error:", err.message);
  }
}

// Helper: Replicate database views from Remote DB -> Local DB
async function replicateViewsFromRemote(remotePool, localPool) {
  if (!remotePool || !localPool) return;
  try {
    const viewsRes = await remotePool.request().query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.VIEWS
    `).catch(() => ({ recordset: [] }));

    for (const vRow of viewsRes.recordset) {
      const viewName = vRow.TABLE_NAME;
      try {
        const defRes = await remotePool.request()
          .input("vName", viewName)
          .query(`SELECT OBJECT_DEFINITION(OBJECT_ID(@vName)) AS ViewDef`);
        const viewDef = defRes.recordset[0]?.ViewDef;
        if (viewDef) {
          const createOrAlterSql = viewDef.replace(/CREATE\s+VIEW/i, 'CREATE OR ALTER VIEW');
          await localPool.request().query(createOrAlterSql).catch(() => {});
        }
      } catch (_) {}
    }
    console.log("✅ [Auto-Provision] Database views replicated successfully to Local DB!");
  } catch (err) {
    console.warn("⚠️ [Auto-Provision] View replication warning:", err.message);
  }
}

// Helper: Replicate column default constraints from Remote DB -> Local DB
async function replicateDefaultConstraintsFromRemote(remotePool, localPool) {
  if (!remotePool || !localPool) return;
  try {
    const remoteDefaults = await remotePool.request().query(`
      SELECT 
        t.name AS TableName,
        c.name AS ColumnName,
        d.definition AS DefaultDefinition
      FROM sys.default_constraints d
      INNER JOIN sys.tables t ON d.parent_object_id = t.object_id
      INNER JOIN sys.columns c ON d.parent_object_id = c.object_id AND d.parent_column_id = c.column_id
    `).catch(() => ({ recordset: [] }));

    if (!remoteDefaults.recordset || remoteDefaults.recordset.length === 0) return;

    const localDefaults = await localPool.request().query(`
      SELECT 
        t.name AS TableName,
        c.name AS ColumnName
      FROM sys.default_constraints d
      INNER JOIN sys.tables t ON d.parent_object_id = t.object_id
      INNER JOIN sys.columns c ON d.parent_object_id = c.object_id AND d.parent_column_id = c.column_id
    `).catch(() => ({ recordset: [] }));

    const localSet = new Set(
      (localDefaults.recordset || []).map(r => `${r.TableName.toLowerCase()}.${r.ColumnName.toLowerCase()}`)
    );

    let addedCount = 0;
    for (const row of remoteDefaults.recordset) {
      const key = `${row.TableName.toLowerCase()}.${row.ColumnName.toLowerCase()}`;
      if (!localSet.has(key)) {
        try {
          const colCheck = await localPool.request().query(`
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = '${row.TableName}' AND COLUMN_NAME = '${row.ColumnName}'
          `).catch(() => ({ recordset: [] }));

          if (colCheck.recordset && colCheck.recordset.length > 0) {
            const constraintName = `DF_${row.TableName}_${row.ColumnName}`;
            await localPool.request().query(`
              ALTER TABLE [dbo].[${row.TableName}] 
              ADD CONSTRAINT [${constraintName}] DEFAULT ${row.DefaultDefinition} FOR [${row.ColumnName}]
            `).catch(async () => {
              const fallbackName = `DF_${row.TableName}_${row.ColumnName}_${Math.floor(Math.random() * 10000)}`;
              await localPool.request().query(`
                ALTER TABLE [dbo].[${row.TableName}] 
                ADD CONSTRAINT [${fallbackName}] DEFAULT ${row.DefaultDefinition} FOR [${row.ColumnName}]
              `).catch(() => {});
            });
            addedCount++;
            localSet.add(key);
          }
        } catch (_) {}
      }
    }
    if (addedCount > 0) {
      console.log(`✅ [Auto-Provision] Replicated ${addedCount} default constraints to Local DB.`);
    }
  } catch (err) {
    console.warn("⚠️ [Auto-Provision] Default constraint replication warning:", err.message);
  }
}

module.exports = {
  ensureLocalDatabaseExists,
  ensureEssentialLocalViews,
  replicateTableSchema,
  hydrateTableFast,
  hydrateAllTablesFromRemote,
  syncSchemaFromRemoteToLocal,
  syncOperationalStateFromRemote,
  syncMasterCatalog2Way,
  syncTable2Way,
  pushActiveOrderToRemote,
  CATEGORY_A_PULL_ONLY_TABLES,
  CATEGORY_B_TWOWAY_TABLES
};
