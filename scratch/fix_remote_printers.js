const { getRemotePool, connectRemote, isRemoteOnline } = require('../backend/config/db');

(async () => {
  try {
    let rPool = getRemotePool();
    if (!isRemoteOnline()) rPool = await connectRemote();
    if (!rPool) {
      console.error('Remote DB not connected');
      process.exit(1);
    }
    const u1 = await rPool.request().query(`
      UPDATE PrintMaster 
      SET PrinterPath = '192.168.0.199', PrinterIP = '192.168.0.199' 
      WHERE PrinterPath = '192.168.0.245' OR PrinterIP = '192.168.0.245'
    `);
    console.log('Updated Remote PrintMaster rows:', u1.rowsAffected[0]);

    const u2 = await rPool.request().query(`
      UPDATE CompanySettings 
      SET PrinterIP = '192.168.0.199' 
      WHERE PrinterIP = '192.168.0.245'
    `);
    console.log('Updated Remote CompanySettings rows:', u2.rowsAffected[0]);

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
