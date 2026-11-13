const path = require('path');
const { poolPromise, remotePoolPromise, sql } = require(path.join(__dirname, '../backend/config/db'));

async function cleanupSettledOrders() {
  try {
    const localPool = await poolPromise;
    const remotePool = await remotePoolPromise;

    console.log("=== 1. Find all settled orders on Local DB ===");
    const settledRes = await localPool.request().query(`
      SELECT DISTINCT BillNo FROM SettlementHeader WHERE CreatedOn >= DATEADD(DAY, -2, GETDATE())
    `);
    const settledBillNos = settledRes.recordset.map(r => r.BillNo).filter(Boolean);
    console.log(`Found ${settledBillNos.length} settled bills in the last 2 days.`);

    if (settledBillNos.length > 0) {
      const inClause = settledBillNos.map(b => `'${b}'`).join(",");

      // 1. Mark closed on Local DB
      const lRes = await localPool.request().query(`
        UPDATE RestaurantOrderCur
        SET isOrderClosed = 1, StatusCode = 3, ModifiedOn = GETDATE()
        WHERE OrderNumber IN (${inClause}) AND (isOrderClosed = 0 OR isOrderClosed IS NULL);

        UPDATE TableMaster
        SET Status = 0, entry_status = NULL, TotalAmount = 0, StartTime = NULL, CurrentOrderId = NULL, CustomerName = NULL, Pax = NULL, ModifiedOn = GETDATE()
        WHERE CurrentOrderId IN (${inClause});
      `);
      console.log("Local DB update done.");

      // 2. Mark closed on Remote DB
      const rRes = await remotePool.request().query(`
        UPDATE RestaurantOrderCur
        SET isOrderClosed = 1, StatusCode = 3, ModifiedOn = GETDATE()
        WHERE OrderNumber IN (${inClause}) AND (isOrderClosed = 0 OR isOrderClosed IS NULL);

        UPDATE TableMaster
        SET Status = 0, entry_status = NULL, TotalAmount = 0, StartTime = NULL, CurrentOrderId = NULL, CustomerName = NULL, Pax = NULL, ModifiedOn = GETDATE()
        WHERE CurrentOrderId IN (${inClause});
      `);
      console.log("Remote DB update done.");
    }

    // Verify Table 1A status on both DBs
    const check1A = await localPool.request().query(`
      SELECT TableNumber, Status, CurrentOrderId, TotalAmount FROM TableMaster WHERE TableNumber = '1A'
    `);
    console.log("Local Table 1A:", check1A.recordset[0]);

    const check1ARemote = await remotePool.request().query(`
      SELECT TableNumber, Status, CurrentOrderId, TotalAmount FROM TableMaster WHERE TableNumber = '1A'
    `);
    console.log("Remote Table 1A:", check1ARemote.recordset[0]);

    process.exit(0);
  } catch (err) {
    console.error("Cleanup error:", err);
    process.exit(1);
  }
}

cleanupSettledOrders();
