const { poolPromise } = require('../backend/config/db');

(async () => {
  try {
    const local = await poolPromise;
    console.log('Connected to Local DB');

    const printMaster = await local.request().query('SELECT * FROM PrintMaster');
    console.log('Local PrintMaster rows:', printMaster.recordset.length);
    console.log(printMaster.recordset);

    const jobQueue = await local.request().query('SELECT TOP 5 * FROM PrintJobQueue');
    console.log('Local PrintJobQueue sample rows:', jobQueue.recordset);

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
