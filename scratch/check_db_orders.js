const { poolPromise } = require('../backend/config/db');

(async () => {
  try {
    const pool = await poolPromise;
    const res = await pool.request().query(`
      SELECT TOP 10 OrderNumber, Tableno, TotalAmount, isOrderClosed, CreatedOn
      FROM RestaurantOrderCur
      WHERE (isOrderClosed = 0 OR isOrderClosed IS NULL)
      ORDER BY CreatedOn DESC
    `);
    console.table(res.recordset);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
})();
