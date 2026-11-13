const { processPrintQueue } = require('../backend/services/printQueueWorker');
const { poolPromise } = require('../backend/config/db');

(async () => {
  try {
    const pool = await poolPromise;
    console.log('--- Before Worker Run ---');
    const beforeJobs = await pool.request().query("SELECT JobId, Status, PrinterIp, ErrorMessage FROM PrintJobQueue WHERE Status = 'PENDING'");
    console.log('Pending Jobs before:', beforeJobs.recordset.length);

    console.log('\n--- Executing processPrintQueue ---');
    await processPrintQueue();

    console.log('\n--- After Worker Run ---');
    const afterJobs = await pool.request().query("SELECT JobId, Status, PrinterIp, ErrorMessage, CompletedOn FROM PrintJobQueue");
    console.log('All Job statuses:', afterJobs.recordset);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
