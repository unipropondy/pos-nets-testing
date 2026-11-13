const { poolPromise } = require('../backend/config/db');

async function run() {
  const pool = await poolPromise;
  
  const tables = await pool.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%Order%' OR TABLE_NAME LIKE '%Table%'");
  console.log('=== TABLES WITH ORDER OR TABLE ===');
  console.table(tables.recordset);

  const tCols = await pool.request().query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'TableMaster'");
  console.log('=== COLUMNS OF TableMaster ===');
  console.table(tCols.recordset);

  process.exit(0);
}

run().catch(console.error);
