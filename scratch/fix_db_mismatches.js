const { poolPromise } = require('../backend/config/db');

async function run() {
  const pool = await poolPromise;
  
  console.log('Fixing mismatched OrderNumbers in RestaurantOrderDetailCur...');
  const res1 = await pool.request().query(`
    UPDATE d 
    SET d.OrderNumber = h.OrderNumber 
    FROM RestaurantOrderDetailCur d 
    JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId 
    WHERE d.OrderNumber <> h.OrderNumber
  `);
  console.log(`Updated ${res1.rowsAffected[0]} detail rows.`);

  console.log('Fixing TableMaster CurrentOrderId where mismatched with active open orders...');
  const res2 = await pool.request().query(`
    UPDATE tm 
    SET tm.CurrentOrderId = h.OrderNumber 
    FROM TableMaster tm 
    JOIN RestaurantOrderCur h ON RTRIM(LTRIM(tm.TableNumber)) = RTRIM(LTRIM(h.Tableno)) 
    WHERE tm.Status > 0 
      AND (h.isOrderClosed = 0 OR h.isOrderClosed IS NULL) 
      AND tm.CurrentOrderId <> h.OrderNumber
  `);
  console.log(`Updated ${res2.rowsAffected[0]} TableMaster rows.`);

  process.exit(0);
}

run().catch(console.error);
