const { poolPromise } = require('../backend/config/db');

async function run() {
  const pool = await poolPromise;
  
  const mismatch = await pool.request().query(`
    SELECT d.OrderDetailId, d.OrderId, d.OrderNumber as DetailOrderNo, h.OrderNumber as HeaderOrderNo, h.Tableno, d.DishName, d.StatusCode, CAST(d.CreatedOn AS VARCHAR(19)) as CDate
    FROM RestaurantOrderDetailCur d
    JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
    WHERE d.OrderNumber <> h.OrderNumber
  `);
  console.log('=== MISMATCHES BETWEEN DETAIL AND HEADER ORDER NUMBER ===');
  console.table(mismatch.recordset);

  process.exit(0);
}

run().catch(console.error);
