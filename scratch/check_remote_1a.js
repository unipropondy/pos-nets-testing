const path = require('path');
const { poolPromise, remotePoolPromise, sql } = require(path.join(__dirname, '../backend/config/db'));

async function run() {
  try {
    const remotePool = await remotePoolPromise;
    const localPool = await poolPromise;

    console.log("=== REMOTE DB: TableMaster for 1A ===");
    const rTbl = await remotePool.request().query(`
      SELECT TableNumber, Status, CurrentOrderId, TotalAmount, ModifiedOn
      FROM TableMaster WHERE TableNumber = '1A'
    `);
    console.table(rTbl.recordset);

    console.log("=== REMOTE DB: RestaurantOrderCur for 20261015-0012 ===");
    const rOrder = await remotePool.request().query(`
      SELECT OrderId, OrderNumber, Tableno, isOrderClosed, TotalAmount, ModifiedOn
      FROM RestaurantOrderCur WHERE OrderNumber = '20261015-0012'
    `);
    console.table(rOrder.recordset);

    console.log("=== LOCAL DB: TableMaster for 1A ===");
    const lTbl = await localPool.request().query(`
      SELECT TableNumber, Status, CurrentOrderId, TotalAmount, ModifiedOn
      FROM TableMaster WHERE TableNumber = '1A'
    `);
    console.table(lTbl.recordset);

    console.log("=== LOCAL DB: RestaurantOrderCur for 20261015-0012 ===");
    const lOrder = await localPool.request().query(`
      SELECT OrderId, OrderNumber, Tableno, isOrderClosed, TotalAmount, ModifiedOn
      FROM RestaurantOrderCur WHERE OrderNumber = '20261015-0012'
    `);
    console.table(lOrder.recordset);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
