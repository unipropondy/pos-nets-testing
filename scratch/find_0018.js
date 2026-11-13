const { poolPromise } = require('../backend/config/db');

async function run() {
  const pool = await poolPromise;
  
  console.log('=== SEARCHING FOR 20261015-0018 IN RestaurantOrderDetailCur ===');
  const d1 = await pool.request().query("SELECT * FROM RestaurantOrderDetailCur WHERE OrderNumber = '20261015-0018'");
  console.table(d1.recordset);

  console.log('=== SEARCHING FOR 20261015-0018 IN RestaurantOrderCur ===');
  const d2 = await pool.request().query("SELECT * FROM RestaurantOrderCur WHERE OrderNumber = '20261015-0018'");
  console.table(d2.recordset);

  console.log('=== SEARCHING FOR MUTTON DUM BRIYANI IN RestaurantOrderDetailCur ON 2026-10-15 ===');
  const d3 = await pool.request().query("SELECT OrderNumber, DishName, Quantity, TotalDetailLineAmount, CAST(OrderDateTime AS VARCHAR(19)) as ODate FROM RestaurantOrderDetailCur WHERE DishName LIKE '%MUTTON%' OR DishName LIKE '%KANAVA%'");
  console.table(d3.recordset);

  process.exit(0);
}

run().catch(console.error);
