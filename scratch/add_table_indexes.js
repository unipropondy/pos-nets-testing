const path = require('path');
const db = require(path.join(__dirname, '../backend/config/db'));
const fs = require('fs');

async function run() {
  const pool = await db.poolPromise;
  console.log('1. Checking and creating index in database...');
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TableMaster_DiningSection' AND object_id = OBJECT_ID('TableMaster'))
    BEGIN
      CREATE NONCLUSTERED INDEX IX_TableMaster_DiningSection ON [dbo].[TableMaster] (DiningSection);
      PRINT 'Created IX_TableMaster_DiningSection';
    END
  `);
  console.log('✅ Index in database verified.');

  console.log('2. Updating backend/config/init.js...');
  const initPath = path.join(__dirname, '../backend/config/init.js');
  const init = fs.readFileSync(initPath, 'utf8');
  const lines = init.split(/\r?\n/);
  const idx = lines.findIndex(l => l.includes('IX_TableMaster_TableNumber'));
  if (idx !== -1 && !init.includes('IX_TableMaster_DiningSection')) {
    lines.splice(idx + 1, 0, "    await runQuery(\"Index - TableMaster DiningSection\", \"IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TableMaster_DiningSection') CREATE INDEX IX_TableMaster_DiningSection ON [dbo].[TableMaster] (DiningSection)\");");
    fs.writeFileSync(initPath, lines.join('\r\n'), 'utf8');
    console.log('✅ Added IX_TableMaster_DiningSection to backend/config/init.js');
  } else {
    console.log('ℹ️ Line already present or not found.');
  }

  process.exit(0);
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
