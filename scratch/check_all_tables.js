const { poolPromise } = require('../backend/config/db');

(async () => {
  try {
    const pool = await poolPromise;
    const res = await pool.request().query(`
      SELECT TableId, TableNumber, DiningSection, Status, CurrentOrderId, TotalAmount, ModifiedOn
      FROM TableMaster
      ORDER BY TRY_CAST(TableNumber AS INT), TableNumber
    `);
    console.table(res.recordset);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
})();
