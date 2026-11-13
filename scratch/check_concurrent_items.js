const { poolPromise } = require('../backend/config/db');

async function run() {
  const pool = await poolPromise;
  
  const items = await pool.request().query(`
    SELECT OrderNumber, DishName, Quantity, PricePerUnit, TotalDetailLineAmount, CAST(CreatedOn AS VARCHAR(19)) as CDate
    FROM RestaurantOrderDetailCur 
    WHERE OrderNumber IN ('20261015-0017', '20261015-0018', '20261015-0019', '20261015-0020')
    ORDER BY OrderNumber ASC, CreatedOn ASC
  `);
  console.log('=== ITEMS FOR 0017, 0018, 0019, 0020 ===');
  console.table(items.recordset);

  process.exit(0);
}

run().catch(console.error);
