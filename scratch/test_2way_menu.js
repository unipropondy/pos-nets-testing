const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../backend/.env") });
const { poolPromise, remotePoolPromise, connectRemote } = require("../backend/config/db");

async function testSync() {
  try {
    const localPool = await poolPromise;
    const remotePool = await remotePoolPromise || await connectRemote();
    console.log("Connected to both DBs!");

    // Helper to get valid column names
    const getTableColumns = async (pool, tbl) => {
      try {
        const res = await pool.request().query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${tbl}'`);
        return new Set(res.recordset.map(r => r.COLUMN_NAME.toLowerCase()));
      } catch (_) {
        return new Set();
      }
    };

    const getReadOnlyColumns = async (pool, tableName) => {
      try {
        const res = await pool.request().query(`
          SELECT c.name FROM sys.columns c JOIN sys.tables t ON c.object_id = t.object_id WHERE t.name = '${tableName}' AND (c.is_computed = 1)
        `);
        return new Set(res.recordset.map(r => r.name.toLowerCase()));
      } catch (_) {
        return new Set();
      }
    };

    const syncTable2Way = async (tableName, fallbackPk) => {
      console.log(`\n--- Testing 2-Way Sync for [${tableName}] ---`);
      const lCols = await getTableColumns(localPool, tableName);
      const rCols = await getTableColumns(remotePool, tableName);

      const pkCols = Array.isArray(fallbackPk) ? fallbackPk : [fallbackPk];
      const pkColSql = pkCols.map(p => `[${p}]`).join(", ");

      const dateCandidates = ['ModifiedOn', 'ModifyDate', 'UpdatedOn', 'CreatedOn', 'CreatedDate'];
      const sortCol = dateCandidates.find(c => lCols.has(c.toLowerCase()) && rCols.has(c.toLowerCase()));
      const selectCols = sortCol ? `${pkColSql}, [${sortCol}]` : pkColSql;

      const lPkRes = await localPool.request().query(`SELECT ${selectCols} FROM ${tableName}`).catch(err => ({ error: err.message, recordset: [] }));
      const rPkRes = await remotePool.request().query(`SELECT ${selectCols} FROM ${tableName}`).catch(err => ({ error: err.message, recordset: [] }));

      if (lPkRes.error || rPkRes.error) {
        console.log(`Error querying PKs: L=${lPkRes.error}, R=${rPkRes.error}`);
        return;
      }

      const makePkKey = (row) => pkCols.map(pk => String(row[pk] || '').trim().toLowerCase()).join('___');

      const lPkMap = new Map();
      lPkRes.recordset.forEach(r => lPkMap.set(makePkKey(r), r));

      const rPkMap = new Map();
      rPkRes.recordset.forEach(r => rPkMap.set(makePkKey(r), r));

      const missingOnRemote = lPkRes.recordset.filter(r => !rPkMap.has(makePkKey(r)));
      const missingOnLocal = rPkRes.recordset.filter(r => !lPkMap.has(makePkKey(r)));

      console.log(`[${tableName}]: Local total=${lPkRes.recordset.length}, Remote total=${rPkRes.recordset.length}`);
      console.log(`[${tableName}]: Missing on Local=${missingOnLocal.length}, Missing on Remote=${missingOnRemote.length}`);

      // Check modified rows
      if (sortCol) {
        let remoteNewerCount = 0;
        let localNewerCount = 0;
        for (const [key, lRowSummary] of lPkMap.entries()) {
          const rRowSummary = rPkMap.get(key);
          if (!rRowSummary) continue;
          const lTime = lRowSummary[sortCol] ? new Date(lRowSummary[sortCol]).getTime() : 0;
          const rTime = rRowSummary[sortCol] ? new Date(rRowSummary[sortCol]).getTime() : 0;
          if (rTime > lTime) remoteNewerCount++;
          else if (lTime > rTime) localNewerCount++;
        }
        console.log(`[${tableName}]: Remote newer=${remoteNewerCount}, Local newer=${localNewerCount} (based on ${sortCol})`);
      }
    };

    await syncTable2Way("CategoryMaster", "CategoryId");
    await syncTable2Way("DishGroupMaster", "DishGroupId");
    await syncTable2Way("DishMaster", "DishId");
    await syncTable2Way("TableMaster", "TableId");
    await syncTable2Way("Paymode", "PayMode");
    await syncTable2Way("ModifierMaster", "ModifierID");
    await syncTable2Way("DishModifier", ["DishId", "ModifierId"]);
    await syncTable2Way("DishGroupModifier", ["DishGroupId", "ModifierId"]);
    await syncTable2Way("ComboGroupMaster", "ComboGroupId");
    await syncTable2Way("ComboGroupDishMapping", "MappingId");
    await syncTable2Way("ParentDishComboGroupMapping", ["ComboGroupId", "ParentDishId"]);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

testSync();
