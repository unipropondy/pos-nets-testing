const { remotePoolPromise, poolPromise } = require('../backend/config/db');

(async () => {
  try {
    const remote = await remotePoolPromise;
    const remoteSettings = await remote.request().query('SELECT * FROM CompanySettings');
    console.log('Remote CompanySettings:', JSON.stringify(remoteSettings.recordset, null, 2));

    const local = await poolPromise;
    const localSettings = await local.request().query('SELECT * FROM CompanySettings');
    console.log('Local CompanySettings:', JSON.stringify(localSettings.recordset, null, 2));

    process.exit(0);
  } catch(e) {
    console.error('Error:', e);
    process.exit(1);
  }
})();
