const path = require('path');
const { poolPromise, sql } = require(path.join(__dirname, '../backend/config/db'));

async function run() {
  try {
    const pool = await poolPromise;

    console.log("=== Was order 20261015-0012 ever settled in SettlementHeader? ===");
    const setRes = await pool.request().query(`
      SELECT BillNo, TableNo, Section, SubTotal, CreatedOn
      FROM SettlementHeader
      WHERE BillNo = '20261015-0012' OR LegacyOrderId = '20261015-0012'
    `);
    console.log("Settlement count:", setRes.recordset.length);
    if (setRes.recordset.length > 0) console.table(setRes.recordset);

    console.log("=== All orders today on Tableno = '1A' ===");
    const orders1A = await pool.request().query(`
      SELECT OrderId, OrderNumber, Tableno, isOrderClosed, TotalAmount, CreatedOn
      FROM RestaurantOrderCur
      WHERE Tableno LIKE '%1A%'
      ORDER BY CreatedOn DESC
    `);
    console.table(orders1A.recordset);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
