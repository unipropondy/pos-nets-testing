const { poolPromise } = require("./config/db");

async function checkCols() {
  try {
    const pool = await poolPromise;
    const res = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'DailyOrderSequenceNumber'");
    console.log("DailyOrderSequenceNumber columns:", res.recordset.map(r => r.COLUMN_NAME));

    const sample = await pool.request().query("SELECT TOP 5 * FROM DailyOrderSequenceNumber");
    console.log("Sample rows:", sample.recordset);
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    process.exit(0);
  }
}

checkCols();
