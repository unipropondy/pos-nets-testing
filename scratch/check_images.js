const { poolPromise, remotePoolPromise } = require('../backend/config/db');

(async () => {
  try {
    const local = await poolPromise;
    console.log('Connected to Local DB');
    const localSettings = await local.request().query('SELECT * FROM CompanySettings');
    console.log('Local CompanySettings:', localSettings.recordset);

    const remote = await remotePoolPromise;
    console.log('Connected to Remote DB');
    const remoteSettings = await remote.request().query('SELECT * FROM CompanySettings');
    console.log('Remote CompanySettings:', remoteSettings.recordset);

    const localImages = await local.request().query('SELECT Imageid, ImageName, DATALENGTH(ImageData) as len FROM ImageList');
    console.log('Local ImageList:', localImages.recordset);

    const remoteImages = await remote.request().query('SELECT Imageid, ImageName, DATALENGTH(ImageData) as len FROM ImageList');
    console.log('Remote ImageList:', remoteImages.recordset);

    process.exit(0);
  } catch(e) {
    console.error('Error:', e);
    process.exit(1);
  }
})();
