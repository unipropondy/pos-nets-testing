const fs = require('fs');
const path = require('path');
const { remotePoolPromise, poolPromise } = require('../backend/config/db');

(async () => {
  try {
    const remote = await remotePoolPromise;
    const res = await remote.request().query('SELECT Imageid, ImageName, DATALENGTH(ImageData) as len FROM ImageList');
    console.log('Total remote images:', res.recordset.length);
    const matches = res.recordset.filter(r => /logo|brand|restaurant|icon|app|header/i.test(r.ImageName || ''));
    console.log('Matching logo candidates in remote ImageList:', matches);

    // Also check files on disk
    const dirs = [
      path.join(__dirname, '../backend/public'),
      path.join(__dirname, '../backend/public/uploads'),
      path.join(__dirname, '../frontend/assets'),
      path.join(__dirname, '../frontend/public')
    ];

    dirs.forEach(d => {
      if (fs.existsSync(d)) {
        console.log(`Files in ${d}:`, fs.readdirSync(d));
      } else {
        console.log(`Directory does not exist: ${d}`);
      }
    });

    process.exit(0);
  } catch(e) {
    console.error(e);
    process.exit(1);
  }
})();
