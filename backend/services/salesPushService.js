const { sql } = require("../config/db");

// Table specifications with proper business unique keys and identity column handling
const SYNC_SPECS = [
  // 1. Settlements & Payments
  {
    table: "PrintMaster",
    keys: ["PrinterId"],
    omitIdentity: true,
    updateIfExists: true
  },
  {
    table: "SettlementHeader",
    keys: ["SettlementID"],
    fallbackKeys: ["BillNo"],
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

  // 2. Sales Invoices & Orders (for All Reports)
  {
    table: "RestaurantInvoice",
    keys: ["RestaurantBillId"],
    fallbackKeys: ["BillNumber"],
    dateCol: "CreatedOn",
    omitIdentity: true
  },
  {
    table: "RestaurantInvoiceCur",
    keys: ["RestaurantBillId"],
    fallbackKeys: ["BillNumber"],
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
  {
    table: "OrderSequences",
    keys: ["RestaurantId", "SequenceDate"],
    omitIdentity: true,
    updateIfExists: true
  },
  {
    table: "PrintReport",
    keys: ["OrderId", "Ordernumber", "PrintType"],
    omitIdentity: true
  },

  // 3. Day End, Day Start & Cash Drawer
  {
    table: "BusinessDayLog",
    keys: ["BusinessDate"],
    omitIdentity: true,
    updateIfExists: true
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
  {
    table: "CashDrawerLog",
    keys: ["LogId"],
    fallbackKeys: ["OrderId", "CreatedOn"],
    omitIdentity: true
  }
];

// Helper: Push a single table from Local DB -> Remote DB
async function pushTable(localPool, remotePool, spec) {
  const { table, keys, fallbackKeys, omitIdentity, updateIfExists } = spec;

  try {
    // 1. Verify remote table columns
    const rColsRes = await remotePool.request().query(`
      SELECT c.COLUMN_NAME, c.DATA_TYPE, 
             COLUMNPROPERTY(OBJECT_ID(QUOTENAME(c.TABLE_SCHEMA) + '.' + QUOTENAME(c.TABLE_NAME)), c.COLUMN_NAME, 'IsIdentity') as is_identity,
             c.IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS c 
      WHERE c.TABLE_NAME = '${table}'
    `).catch(() => ({ recordset: [] }));

    if (!rColsRes.recordset || rColsRes.recordset.length === 0) {
      return { table, inserted: 0, updated: 0, skipped: 0, failed: 0, pushed: 0 };
    }

    const rColMap = new Map(rColsRes.recordset.map(c => [c.COLUMN_NAME.toLowerCase(), c]));

    // Determine active keys
    let activeKeys = keys.filter(k => rColMap.has(k.toLowerCase()));
    if (activeKeys.length === 0 && fallbackKeys) {
      activeKeys = fallbackKeys.filter(k => rColMap.has(k.toLowerCase()));
    }
    if (activeKeys.length === 0) {
      return { table, inserted: 0, updated: 0, skipped: 0, failed: 0, pushed: 0 };
    }

    const keyColsSql = activeKeys.map(k => `[${k}]`).join(", ");

    // 2. Fetch existing keys from both sides
    const lKeyRes = await localPool.request().query(`SELECT DISTINCT ${keyColsSql} FROM [dbo].[${table}]`).catch(() => ({ recordset: [] }));
    const rKeyRes = await remotePool.request().query(`SELECT DISTINCT ${keyColsSql} FROM [dbo].[${table}]`).catch(() => ({ recordset: [] }));

    const makeKey = (row) => activeKeys.map(k => String(row[k] ?? row[k.toLowerCase()] ?? '')).join('___');

    const rKeySet = new Set(rKeyRes.recordset.map(r => makeKey(r)));
    const missing = lKeyRes.recordset.filter(r => !rKeySet.has(makeKey(r)));

    let inserted = 0, updated = 0, skipped = 0, failed = 0;

    // 3. Push missing records (in batches of 50 for max network throughput)
    const BATCH_SIZE = 50;
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      const batchRows = missing.slice(i, i + BATCH_SIZE);

      for (const mRow of batchRows) {
        const whereParts = activeKeys.map((k, idx) => `[${k}] = @k_${idx}`);
        const fetchReq = localPool.request();
        activeKeys.forEach((k, idx) => fetchReq.input(`k_${idx}`, mRow[k] ?? mRow[k.toLowerCase()]));

        const fullRowRes = await fetchReq.query(`SELECT TOP 1 * FROM [dbo].[${table}] WHERE ${whereParts.join(" AND ")}`).catch(() => ({ recordset: [] }));
        const fullRow = fullRowRes.recordset[0];
        if (!fullRow) continue;

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

        const updateAssignments = insertCols
          .filter(k => !activeKeys.some(ak => ak.toLowerCase() === k.toLowerCase()))
          .map((k, idx) => `[${k}] = @p_${idx}`)
          .join(", ");

        const insertSql = updateIfExists && updateAssignments.length > 0 ? `
          IF NOT EXISTS (SELECT 1 FROM [dbo].[${table}] WHERE ${whereCheck})
          BEGIN
            INSERT INTO [dbo].[${table}] (${colList}) VALUES (${valList});
          END
          ELSE
          BEGIN
            UPDATE [dbo].[${table}] SET ${updateAssignments} WHERE ${whereCheck};
          END
        ` : `
          IF NOT EXISTS (SELECT 1 FROM [dbo].[${table}] WHERE ${whereCheck})
          BEGIN
            INSERT INTO [dbo].[${table}] (${colList}) VALUES (${valList});
          END
        `;

        try {
          const qRes = await insertReq.query(insertSql);
          const affected = (qRes && qRes.rowsAffected && qRes.rowsAffected[0]) || 0;
          if (affected > 0) {
            inserted++;
          } else {
            skipped++;
          }
        } catch (err) {
          failed++;
        }
      }
    }

    // 4. Update if exists (for BusinessDayLog Day End updates, OrderSequences, PrintMaster)
    if (updateIfExists && lKeyRes.recordset.length > 0) {
      if (table === "BusinessDayLog") {
        for (const lRow of lKeyRes.recordset) {
          const bDate = lRow.BusinessDate;
          const lLogRes = await localPool.request().input("d", bDate).query("SELECT TOP 1 * FROM BusinessDayLog WHERE BusinessDate = @d");
          const lLog = lLogRes.recordset[0];
          if (lLog && lLog.EndedAt) {
            const upRes = await remotePool.request()
              .input("d", bDate)
              .input("endedAt", lLog.EndedAt)
              .input("endedBy", lLog.EndedBy || 'admin')
              .query(`
                UPDATE BusinessDayLog 
                SET EndedAt = @endedAt, EndedBy = @endedBy 
                WHERE BusinessDate = @d AND (EndedAt IS NULL OR EndedAt <> @endedAt)
              `).catch(() => ({ rowsAffected: [0] }));
            if (upRes.rowsAffected && upRes.rowsAffected[0] > 0) {
              updated++;
            } else {
              skipped++;
            }
          }
        }
      } else if (table === "OrderSequences") {
        const localSeqs = await localPool.request().query("SELECT TOP 50 RestaurantId, SequenceDate, LastNumber FROM OrderSequences").catch(() => ({ recordset: [] }));
        for (const seq of localSeqs.recordset) {
          const upRes = await remotePool.request()
            .input("rid", seq.RestaurantId)
            .input("sdate", seq.SequenceDate)
            .input("lnum", seq.LastNumber)
            .query(`
              IF EXISTS (SELECT 1 FROM OrderSequences WHERE RestaurantId = @rid AND SequenceDate = @sdate)
                UPDATE OrderSequences SET LastNumber = @lnum WHERE RestaurantId = @rid AND SequenceDate = @sdate AND LastNumber <> @lnum;
              ELSE
                INSERT INTO OrderSequences (RestaurantId, SequenceDate, LastNumber) VALUES (@rid, @sdate, @lnum);
            `).catch(() => ({ rowsAffected: [0] }));
          if (upRes.rowsAffected && upRes.rowsAffected[0] > 0) {
            updated++;
          } else {
            skipped++;
          }
        }
      } else if (table === "PrintMaster") {
        const localPrinters = await localPool.request().query("SELECT PrinterId, PrinterName, PrinterPath, PrinterIP, PrinterType, PrintSection, KitchenTypeName, KitchenTypeValue, IsActive, PrintCopy, IsEnabled FROM PrintMaster").catch(() => ({ recordset: [] }));
        for (const pr of localPrinters.recordset) {
          const upRes = await remotePool.request()
            .input("pid", pr.PrinterId)
            .input("pname", pr.PrinterName)
            .input("ppath", pr.PrinterPath)
            .input("pip", pr.PrinterIP)
            .input("ptype", pr.PrinterType)
            .input("psec", pr.PrintSection)
            .input("ktname", pr.KitchenTypeName)
            .input("ktval", pr.KitchenTypeValue)
            .input("act", pr.IsActive ? 1 : 0)
            .input("copy", pr.PrintCopy)
            .input("en", pr.IsEnabled ? 1 : 0)
            .query(`
              IF EXISTS (SELECT 1 FROM PrintMaster WHERE PrinterId = @pid)
              BEGIN
                UPDATE PrintMaster 
                SET PrinterName = @pname, PrinterPath = @ppath, PrinterIP = @pip,
                    PrinterType = @ptype, PrintSection = @psec, KitchenTypeName = @ktname,
                    KitchenTypeValue = @ktval, IsActive = @act, PrintCopy = @copy, IsEnabled = @en
                WHERE PrinterId = @pid 
                  AND (PrinterName <> @pname OR PrinterPath <> @ppath OR PrinterIP <> @pip OR IsActive <> @act);
              END
              ELSE
              BEGIN
                INSERT INTO PrintMaster (PrinterId, PrinterName, PrinterPath, PrinterIP, PrinterType, PrintSection, KitchenTypeName, KitchenTypeValue, IsActive, PrintCopy, IsEnabled)
                VALUES (@pid, @pname, @ppath, @pip, @ptype, @psec, @ktname, @ktval, @act, @copy, @en);
              END
            `).catch(() => ({ rowsAffected: [0] }));
          if (upRes.rowsAffected && upRes.rowsAffected[0] > 0) {
            updated++;
          } else {
            skipped++;
          }
        }
      }
    }

    const pushed = inserted + updated;
    return { table, inserted, updated, skipped, failed, pushed };
  } catch (err) {
    console.warn(`⚠️ [SalesPush] Error pushing table ${table}:`, err.message);
    return { table, inserted: 0, updated: 0, skipped: 0, failed: 1, pushed: 0 };
  }
}

// 2-Way Mirror for Business Day Active Status (DateEntry)
async function mirrorBusinessDateEntry(localPool, remotePool) {
  try {
    const lDateRes = await localPool.request().query("SELECT * FROM DateEntry").catch(() => ({ recordset: [] }));
    if (lDateRes.recordset.length === 0) {
      // Local business day has ended -> Clear Remote DateEntry!
      await remotePool.request().query("DELETE FROM DateEntry").catch(() => {});
    } else {
      // Local business day is active -> Mirror to Remote DateEntry!
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
    }
  } catch (err) {
    console.warn("⚠️ [SalesPush] Error mirroring DateEntry:", err.message);
  }
}

let lastSalesPushTime = 0;
const SALES_PUSH_THROTTLE_MS = 3000;

let isSalesPushing = false;

// Main execution function: Pushes all sales, settlements, day end, reports, members & credit
async function pushAllSalesAndOperationalToRemote(localPool, remotePool, force = false) {
  if (!localPool || !remotePool) return false;
  if (isSalesPushing) {
    return true; // Another sales push cycle is currently active
  }
  isSalesPushing = true;

  try {
    const now = Date.now();
    if (!force && (now - lastSalesPushTime < SALES_PUSH_THROTTLE_MS)) {
      return true; // Throttle redundant back-to-back execution
    }
    lastSalesPushTime = now;

    let totalPushed = 0;
    for (const spec of SYNC_SPECS) {
      const res = await pushTable(localPool, remotePool, spec);
      totalPushed += res.pushed;
    }

    // Mirror DateEntry
    await mirrorBusinessDateEntry(localPool, remotePool);

    if (totalPushed > 0) {
      console.log(`⚡ [SalesPush] Successfully pushed ${totalPushed} sales/settlement/operational records to Remote Cloud DB!`);
    }
    return true;
  } finally {
    isSalesPushing = false;
  }
}

module.exports = {
  pushAllSalesAndOperationalToRemote,
  mirrorBusinessDateEntry,
  pushTable,
  SYNC_SPECS
};
