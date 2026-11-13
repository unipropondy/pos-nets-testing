const { poolPromise } = require('../backend/config/db');

async function run() {
  const pool = await poolPromise;
  
  console.log('=== COLUMNS OF RestaurantOrderCur ===');
  const oCols = await pool.request().query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'RestaurantOrderCur'");
  console.table(oCols.recordset);

  console.log('=== ACTIVE TABLES IN TableMaster ===');
  const activeTables = await pool.request().query("SELECT TableId, TableNumber, DiningSection, Status, CurrentOrderId, TotalAmount FROM TableMaster WHERE Status > 0");
  console.table(activeTables.recordset);

  console.log('=== RECENT 10 RestaurantOrderCur ===');
  const orders = await pool.request().query("SELECT TOP 10 OrderId, OrderNumber, TableNumber, ActualTableNo, BillAmount, StatusCode, OrderDateTime FROM RestaurantOrderCur ORDER BY OrderDateTime DESC");
  console.table(orders.recordset);

  process.exit(0);
}

run().catch(console.error);
