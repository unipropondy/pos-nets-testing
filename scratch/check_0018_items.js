const { poolPromise } = require('../backend/config/db');

async function run() {
  const pool = await poolPromise;
  
  const items = await pool.request().query(`
    SELECT OrderDetailId, DishName, Quantity, PricePerUnit, TotalDetailLineAmount, StatusCode, CAST(OrderDateTime AS VARCHAR(19)) as ODate, CAST(CreatedOn AS VARCHAR(19)) as CDate
    FROM RestaurantOrderDetailCur 
    WHERE OrderNumber = '20261015-0018'
    ORDER BY CreatedOn ASC
  `);
  console.log('=== ALL ITEMS IN 20261015-0018 ===');
  console.table(items.recordset);

  process.exit(0);
}

run().catch(console.error);
