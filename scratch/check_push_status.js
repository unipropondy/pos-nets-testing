const { poolPromise, remotePoolPromise, sql } = require("../backend/config/db");

async function main() {
  const localPool = await poolPromise;
  const remotePool = await remotePoolPromise;

  console.log("Local connected:", !!localPool);
  console.log("Remote connected:", !!remotePool);

  if (!localPool || !remotePool) {
    console.error("Could not connect to both DBs");
    process.exit(1);
  }

  const tables = [
    "SettlementHeader",
    "SettlementItemDetail",
    "SettlementTotalSales",
    "SettlementDetail",
    "SettlementTranDetail",
    "SettlementDiscountDetail",
    "SettlementCreditSales",
    "RestaurantInvoice",
    "RestaurantInvoiceCur",
    "RestaurantOrder",
    "RestaurantOrderDetail",
    "Restaurantmodifierdetail",
    "BusinessDayLog",
    "BusinessDayAuditLog",
    "DateEntry",
    "CashInEntry",
    "CashOutEntry",
    "MemberMaster",
    "CreditCustomerMaster",
    "CustomerCreditTransactions",
    "CustomerCreditAllocations",
    "POS_SyncQueue"
  ];

  console.log("\n================ TABLE ROW COUNTS ================");
  console.log(
    "Table Name".padEnd(30) + 
    "Local Count".padStart(15) + 
    "Remote Count".padStart(15) + 
    "Diff (Local - Remote)".padStart(25)
  );
  console.log("-".repeat(85));

  for (const tbl of tables) {
    try {
      const lRes = await localPool.request().query(`SELECT COUNT(*) as cnt FROM [dbo].[${tbl}]`).catch(e => ({ recordset: [{ cnt: 'ERR: ' + e.message.substring(0, 15) }] }));
      const rRes = await remotePool.request().query(`SELECT COUNT(*) as cnt FROM [dbo].[${tbl}]`).catch(e => ({ recordset: [{ cnt: 'ERR: ' + e.message.substring(0, 15) }] }));
      const lCnt = lRes.recordset[0].cnt;
      const rCnt = rRes.recordset[0].cnt;
      const diff = (typeof lCnt === 'number' && typeof rCnt === 'number') ? (lCnt - rCnt) : 'N/A';

      console.log(
        tbl.padEnd(30) + 
        String(lCnt).padStart(15) + 
        String(rCnt).padStart(15) + 
        String(diff).padStart(25)
      );
    } catch (e) {
      console.log(tbl.padEnd(30) + "ERROR: " + e.message);
    }
  }

  // Check pending in POS_SyncQueue
  try {
    const qRes = await localPool.request().query("SELECT TOP 10 * FROM POS_SyncQueue ORDER BY SyncID DESC");
    console.log("\nRecent POS_SyncQueue items in Local DB:");
    console.dir(qRes.recordset, { depth: null });
  } catch (e) {
    console.log("Error querying POS_SyncQueue:", e.message);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
