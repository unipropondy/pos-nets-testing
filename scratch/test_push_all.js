const { poolPromise, remotePoolPromise, sql } = require("../backend/config/db");

// Table configuration defining business unique keys and identity column handling
const SYNC_SPECS = [
  // 1. Settlements
  {
    table: "SettlementHeader",
    keys: ["SettlementID"],
    dateCol: "CreatedOn",
    omitIdentity: true
  },
  {
    table: "SettlementItemDetail",
    keys: ["OrderDetailId"],
    fallbackKeys: ["SettlementID", "DishId"],
    dateCol: "OrderDateTime",
    omitIdentity: true
  },
  {
    table: "SettlementTotalSales",
    keys: ["SettlementID", "PayMode"],
    omitIdentity: true
  },
  {
    table: "SettlementDetail",
    keys: ["SettlementId", "Paymode"],
    omitIdentity: true
  },
  {
    table: "SettlementTranDetail",
    keys: ["SettlementID", "PayMode"],
    omitIdentity: true
  },
  {
    table: "SettlementDiscountDetail",
    keys: ["SettlementId", "DiscountId"],
    omitIdentity: true
  },
  {
    table: "SettlementCreditSales",
    keys: ["SettlementID", "PayMode"],
    omitIdentity: true
  },
  {
    table: "PaymentDetail",
    keys: ["PaymentId"],
    fallbackKeys: ["SettlementID", "PaymentMode"],
    omitIdentity: true
  },
  {
    table: "PaymentDetailCur",
    keys: ["PaymentId"],
    fallbackKeys: ["SettlementID", "PaymentMode"],
    omitIdentity: true
  },
  {
    table: "ArtistCashBox",
    keys: ["CashBoxId"],
    omitIdentity: true
  },
  {
    table: "dishOrderItemShare",
    keys: ["Id"],
    omitIdentity: true
  },

  // 2. Orders & Invoices (Sales Reports)
  {
    table: "RestaurantInvoice",
    keys: ["RestaurantBillId"],
    dateCol: "CreatedOn",
    omitIdentity: true
  },
  {
    table: "RestaurantInvoiceCur",
    keys: ["RestaurantBillId"],
    dateCol: "CreatedOn",
    omitIdentity: true
  },
  {
    table: "RestaurantOrder",
    keys: ["OrderId"],
    dateCol: "CreatedOn",
    omitIdentity: true
  },
  {
    table: "RestaurantOrderDetail",
    keys: ["OrderDetailId"],
    dateCol: "CreatedOn",
    omitIdentity: true
  },
  {
    table: "Restaurantmodifierdetail",
    keys: ["OrderDetailId", "ModifierId"],
    omitIdentity: true
  },

  // 3. Day End & Cash Drawer
  {
    table: "BusinessDayLog",
    keys: ["BusinessDate"],
    omitIdentity: true,
    updateIfExists: true // Ensure EndedAt / EndedBy gets updated on Day End!
  },
  {
    table: "BusinessDayAuditLog",
    keys: ["BusinessDate", "EventType", "EventTime"],
    fallbackKeys: ["AuditId"],
    omitIdentity: true
  },
  {
    table: "CashInEntry",
    keys: ["CashInId"],
    fallbackKeys: ["CashInNo"],
    dateCol: "CreatedOn",
    omitIdentity: true
  },
  {
    table: "CashOutEntry",
    keys: ["CashOutId"],
    fallbackKeys: ["CashOutNo"],
    dateCol: "CreatedOn",
    omitIdentity: true
  },
  {
    table: "OpeningCashDenomination",
    keys: ["Id"],
    omitIdentity: true
  },

  // 4. Members & Loyalty
  {
    table: "MemberMaster",
    keys: ["MemberId"],
    omitIdentity: true,
    updateIfExists: true
  },
  {
    table: "RewardPointDetails",
    keys: ["MemberId", "SettlementId", "BillNo"],
    omitIdentity: true
  },
  {
    table: "LoyaltyCustomer",
    keys: ["LoyaltyCustomerId"],
    fallbackKeys: ["Phone"],
    omitIdentity: true,
    updateIfExists: true
  },
  {
    table: "LoyaltyVisit",
    keys: ["LoyaltyVisitId"],
    omitIdentity: true
  },
  {
    table: "CustomerDishLoyaltyState",
    keys: ["CustomerId", "RuleId"],
    omitIdentity: true,
    updateIfExists: true
  },

  // 5. Credit Customers
  {
    table: "CreditCustomerMaster",
    keys: ["CustomerId"],
    omitIdentity: true,
    updateIfExists: true
  },
  {
    table: "CustomerCreditTransactions",
    keys: ["TransactionId"],
    dateCol: "CreatedDate",
    omitIdentity: true
  },
  {
    table: "CustomerCreditAllocations",
    keys: ["AllocationId"],
    omitIdentity: true
  }
];

// Helper to push a single table from Local -> Remote
async function pushTableLocalToRemote(localPool, remotePool, spec) {
  const { table, keys, fallbackKeys, omitIdentity, updateIfExists } = spec;

  // 1. Fetch column metadata from remote
  const rColsRes = await remotePool.request().query(`
    SELECT c.COLUMN_NAME, c.DATA_TYPE, 
           COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity') as is_identity,
           c.IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS c 
    WHERE c.TABLE_NAME = '${table}'
  `).catch(() => ({ recordset: [] }));

  if (!rColsRes.recordset || rColsRes.recordset.length === 0) {
    return { table, pushed: 0, status: "NOT_ON_REMOTE" };
  }

  const rColMap = new Map(rColsRes.recordset.map(c => [c.COLUMN_NAME.toLowerCase(), c]));

  // Determine active keys (ensure they exist on remote)
  let activeKeys = keys.filter(k => rColMap.has(k.toLowerCase()));
  if (activeKeys.length === 0 && fallbackKeys) {
    activeKeys = fallbackKeys.filter(k => rColMap.has(k.toLowerCase()));
  }
  if (activeKeys.length === 0) {
    return { table, pushed: 0, status: "NO_VALID_KEYS" };
  }

  const keyColsSql = activeKeys.map(k => `[${k}]`).join(", ");

  // 2. Fetch existing key sets from local and remote
  const lKeyRes = await localPool.request().query(`SELECT ${keyColsSql} FROM [dbo].[${table}]`).catch(() => ({ recordset: [] }));
  const rKeyRes = await remotePool.request().query(`SELECT ${keyColsSql} FROM [dbo].[${table}]`).catch(() => ({ recordset: [] }));

  const makeRowKey = (row) => activeKeys.map(k => String(row[k] ?? row[k.toLowerCase()] ?? '')).join('___');

  const rKeySet = new Set(rKeyRes.recordset.map(r => makeRowKey(r)));
  const missingRows = lKeyRes.recordset.filter(r => !rKeySet.has(makeRowKey(r)));

  let pushed = 0;
  let updated = 0;

  // 3. Push missing rows
  for (const mRow of missingRows) {
    // Fetch full row from local
    const whereParts = activeKeys.map((k, idx) => `[${k}] = @k_${idx}`);
    const fetchReq = localPool.request();
    activeKeys.forEach((k, idx) => {
      fetchReq.input(`k_${idx}`, mRow[k] ?? mRow[k.toLowerCase()]);
    });

    const fullRowRes = await fetchReq.query(`SELECT TOP 1 * FROM [dbo].[${table}] WHERE ${whereParts.join(" AND ")}`);
    const fullRow = fullRowRes.recordset[0];
    if (!fullRow) continue;

    // Filter columns for remote insert
    const insertCols = Object.keys(fullRow).filter(k => {
      const rCol = rColMap.get(k.toLowerCase());
      if (!rCol) return false;
      if (omitIdentity && rCol.is_identity === 1) return false;
      if (fullRow[k] === null && rCol.IS_NULLABLE === 'NO') return false;
      return true;
    });

    if (insertCols.length === 0) continue;

    const colList = insertCols.map(k => `[${k}]`).join(", ");
    const insertReq = remotePool.request();
    const valList = insertCols.map((k, idx) => {
      const val = fullRow[k];
      if (val === null) return "NULL";
      insertReq.input(`p_${idx}`, val);
      return `@p_${idx}`;
    }).join(", ");

    const whereCheck = activeKeys.map((k, idx) => {
      insertReq.input(`chk_${idx}`, mRow[k] ?? mRow[k.toLowerCase()]);
      return `[${k}] = @chk_${idx}`;
    }).join(" AND ");

    const insertSql = `
      IF NOT EXISTS (SELECT 1 FROM [dbo].[${table}] WHERE ${whereCheck})
      BEGIN
        INSERT INTO [dbo].[${table}] (${colList}) VALUES (${valList});
      END
    `;

    try {
      await insertReq.query(insertSql);
      pushed++;
    } catch (err) {
      console.warn(`⚠️ Error pushing ${table}:`, err.message);
    }
  }

  // 4. Update if exists for tables like BusinessDayLog, MemberMaster, CreditCustomerMaster
  if (updateIfExists && lKeyRes.recordset.length > 0) {
    for (const lRow of lKeyRes.recordset) {
      // If table is BusinessDayLog, check if EndedAt is set on Local and update Remote
      if (table === "BusinessDayLog") {
        const bDate = lRow.BusinessDate;
        const lLogRes = await localPool.request().input("d", bDate).query("SELECT TOP 1 * FROM BusinessDayLog WHERE BusinessDate = @d");
        const lLog = lLogRes.recordset[0];
        if (lLog && lLog.EndedAt) {
          await remotePool.request()
            .input("d", bDate)
            .input("endedAt", lLog.EndedAt)
            .input("endedBy", lLog.EndedBy || 'admin')
            .query(`
              UPDATE BusinessDayLog 
              SET EndedAt = @endedAt, EndedBy = @endedBy 
              WHERE BusinessDate = @d AND (EndedAt IS NULL OR EndedAt <> @endedAt)
            `).catch(() => {});
          updated++;
        }
      }
    }
  }

  return { table, pushed, updated, totalLocal: lKeyRes.recordset.length, totalRemote: rKeyRes.recordset.length + pushed };
}

async function main() {
  const localPool = await poolPromise;
  const remotePool = await remotePoolPromise;

  console.log("🚀 Starting Full Push of all Sales, Settlements, Day End, Reports, Members & Credit to Remote DB...");

  for (const spec of SYNC_SPECS) {
    const res = await pushTableLocalToRemote(localPool, remotePool, spec);
    console.log(
      spec.table.padEnd(30) + 
      ` Pushed: ${String(res.pushed).padStart(4)} | ` +
      ` Local: ${String(res.totalLocal || 0).padStart(6)} | ` +
      ` Remote: ${String(res.totalRemote || 0).padStart(6)}`
    );
  }

  // Also 2-way mirror DateEntry (Business Day Active status)
  const lDateRes = await localPool.request().query("SELECT * FROM DateEntry");
  if (lDateRes.recordset.length === 0) {
    // Local ended day! Remote must also clear DateEntry!
    await remotePool.request().query("DELETE FROM DateEntry").catch(() => {});
    console.log("✅ [DayEnd Sync] DateEntry is empty on Local -> Cleared DateEntry on Remote DB!");
  } else {
    // Local has active business day -> Ensure Remote has it
    const activeDe = lDateRes.recordset[0];
    await remotePool.request()
      .input("id", activeDe.DateEntryId)
      .input("user", activeDe.username)
      .input("start", activeDe.StartDate)
      .input("createdBy", activeDe.Createdby)
      .input("createdDate", activeDe.CreatedDate)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM DateEntry WHERE DateEntryId = @id)
        BEGIN
          DELETE FROM DateEntry;
          INSERT INTO DateEntry (DateEntryId, username, StartDate, Createdby, CreatedDate)
          VALUES (@id, @user, @start, @createdBy, @createdDate);
        END
      `).catch(() => {});
    console.log("✅ [DayStart Sync] DateEntry active on Local -> Synced active DateEntry to Remote DB!");
  }

  console.log("\n🎉 Full Push Completed!");
  process.exit(0);
}

main().catch(console.error);
