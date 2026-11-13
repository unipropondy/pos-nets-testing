const { poolPromise } = require('./config/db');
(async () => {
  try {
    const pool = await poolPromise;
    const res = await pool.request().query("SELECT DISTINCT OrderNumber, Tableno, isOrderClosed, CreatedOn FROM RestaurantOrderCur WHERE OrderNumber LIKE '20261015%' ORDER BY OrderNumber ASC");
    console.log('Today orders in RestaurantOrderCur:', res.recordset);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
})();
