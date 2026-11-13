const path = require('path');
const { poolPromise, sql } = require(path.join(__dirname, '../backend/config/db'));

async function run() {
  try {
    const pool = await poolPromise;
    const res = await pool.request().query(`
      SELECT OrderNumber, Tableno, isOrderClosed, TotalAmount, CreatedOn, ModifiedOn
      FROM RestaurantOrderCur
      ORDER BY ModifiedOn DESC
    `);
    console.table(res.recordset);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
