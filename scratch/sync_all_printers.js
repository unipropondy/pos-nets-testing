const { poolPromise, getRemotePool, connectRemote, isRemoteOnline } = require('../backend/config/db');

(async () => {
  try {
    const local = await poolPromise;
    console.log('--- UPDATING LOCAL DB ---');
    const uLocal = await local.request().query(`
      UPDATE PrintMaster 
      SET PrinterPath = '192.168.0.199', PrinterIP = '192.168.0.199' 
      WHERE PrinterPath IS NULL OR PrinterPath = '' OR PrinterIP IS NULL OR PrinterIP = ''
    `);
    console.log('Local PrintMaster rows updated with default printer IP:', uLocal.rowsAffected[0]);

    const uLocalCompany = await local.request().query(`
      UPDATE CompanySettings 
      SET PrinterIP = '192.168.0.199' 
      WHERE PrinterIP IS NULL OR PrinterIP = ''
    `);
    console.log('Local CompanySettings rows updated:', uLocalCompany.rowsAffected[0]);

    console.log('--- UPDATING REMOTE DB ---');
    let rPool = getRemotePool();
    if (!isRemoteOnline()) rPool = await connectRemote();
    if (rPool && rPool.connected) {
      const uRemote = await rPool.request().query(`
        UPDATE PrintMaster 
        SET PrinterPath = '192.168.0.199', PrinterIP = '192.168.0.199' 
        WHERE PrinterPath IS NULL OR PrinterPath = '' OR PrinterIP IS NULL OR PrinterIP = ''
      `);
      console.log('Remote PrintMaster rows updated with default printer IP:', uRemote.rowsAffected[0]);

      const uRemoteCompany = await rPool.request().query(`
        UPDATE CompanySettings 
        SET PrinterIP = '192.168.0.199' 
        WHERE PrinterIP IS NULL OR PrinterIP = ''
      `);
      console.log('Remote CompanySettings rows updated:', uRemoteCompany.rowsAffected[0]);
    } else {
      console.log('Remote DB not connected');
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
