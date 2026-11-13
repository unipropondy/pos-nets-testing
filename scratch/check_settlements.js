const path = require('path');
const { poolPromise, sql } = require(path.join(__dirname, '../backend/config/db'));

async function run() {
  try {
    const pool = await poolPromise;
    console.log("Checking if OrderMergeHistory exists...");
    const omh = await pool.request().query("SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'OrderMergeHistory'");
    console.log("OrderMergeHistory exists:", omh.recordset.length > 0);

    console.log("Checking settlements with their order numbers:");
    const set = await pool.request().query(`
      SELECT s.BillNo, s.TableNo, r.OrderNumber, r.isOrderClosed
      FROM SettlementHeader s
      LEFT JOIN RestaurantOrderCur r ON r.OrderNumber = s.BillNo
      WHERE s.CreatedOn >= '2026-10-15'
      ORDER BY s.CreatedOn DESC
    `);
    console.table(set.recordset);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
