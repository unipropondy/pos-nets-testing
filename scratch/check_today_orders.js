const { poolPromise } = require('../backend/config/db');

async function run() {
  const pool = await poolPromise;
  
  const orders = await pool.request().query(`
    SELECT OrderId, OrderNumber, Tableno, TotalAmount, CAST(OrderDateTime AS VARCHAR(19)) as ODate
    FROM RestaurantOrderCur 
    WHERE CAST(OrderDateTime AS date) = '2026-10-15'
    ORDER BY OrderNumber ASC
  `);
  console.log('=== ALL ORDERS IN RestaurantOrderCur ON 2026-10-15 ===');
  console.table(orders.recordset);

  process.exit(0);
}

run().catch(console.error);
