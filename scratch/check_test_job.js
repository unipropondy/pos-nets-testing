const { poolPromise } = require('../backend/config/db');

(async () => {
  try {
    const pool = await poolPromise;
    const res = await pool.request()
      .input('jobId', '9dbb757d-5907-473e-90d3-796c60f971b7')
      .query("SELECT JobId, Status, PrinterIp, ErrorMessage, CompletedOn FROM PrintJobQueue WHERE JobId = @jobId");
    console.log('Test Print Job Status:', res.recordset);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
