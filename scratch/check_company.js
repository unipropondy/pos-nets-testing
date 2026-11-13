const { poolPromise } = require('../backend/config/db');

(async () => {
  try {
    const pool = await poolPromise;
    const cols = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'CompanySettings'");
    console.log('Columns:', cols.recordset.map(c => c.COLUMN_NAME));
    const row = await pool.request().query('SELECT TOP 1 * FROM CompanySettings');
    console.log('CompanySettings Row:');
    console.log({
      Id: row.recordset[0]?.Id,
      CompanyName: row.recordset[0]?.CompanyName,
      PrinterIP: row.recordset[0]?.PrinterIP,
      PrinterName: row.recordset[0]?.PrinterName,
      PrinterPort: row.recordset[0]?.PrinterPort,
      PrintType: row.recordset[0]?.PrintType,
    });
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
