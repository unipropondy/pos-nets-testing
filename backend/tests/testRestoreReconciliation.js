const { poolPromise } = require('../config/db');
const { initDB } = require('../config/init');
const netsService = require('../services/nets.service');

async function testRestoreReconciliation() {
  console.log('=== TESTING SQL BACKUP/RESTORE RECONCILIATION SAFETY ===');
  const pool = await poolPromise;

  // 1. Simulate an older restored database where current_value was 5000 and counter was 5000
  console.log('Simulating older restored database state: setting Sequence & Counter to 5000...');
  await pool.request().query(`
    ALTER SEQUENCE dbo.NetsEcnSequence RESTART WITH 5000;
    UPDATE dbo.NetsEcnCounter SET CurrentEcn = 5000 WHERE Id = 1;
  `);

  // 2. Simulate disk high-water mark reflecting recent live terminal transactions up to 9500
  const fs = require('fs');
  const path = require('path');
  const diskPath = path.join(__dirname, '../config/netsEcn.json');
  fs.writeFileSync(diskPath, JSON.stringify({ ecn: 9500, updatedAt: new Date().toISOString() }, null, 2));
  console.log('Simulated disk high-water mark set to: 9500');

  // 3. Trigger initDB (which runs on every backend boot / startup)
  console.log('Running backend database initialization (initDB)...');
  await initDB(pool);

  // 4. Verify Sequence & Table have been advanced strictly forward to at least 9500
  const seqRes = await pool.request().query("SELECT current_value FROM sys.sequences WHERE name = 'NetsEcnSequence'");
  const tblRes = await pool.request().query("SELECT CurrentEcn FROM dbo.NetsEcnCounter WHERE Id = 1");
  const seqVal = parseInt(seqRes.recordset[0].current_value, 10);
  const tblVal = parseInt(tblRes.recordset[0].CurrentEcn, 10);
  console.log(`After initDB: Sequence current_value = ${seqVal}, Counter CurrentEcn = ${tblVal}`);

  // 5. Generate next 100 ECNs and verify no duplicate / no reuse of numbers <= 9500
  console.log('Generating next 100 ECNs via getNextEcnAsync()...');
  const ecns = [];
  for (let i = 0; i < 100; i++) {
    const e = await netsService.getNextEcnAsync();
    ecns.push(parseInt(e, 10));
  }

  const allStrictlyGreaterThanPrior = ecns.every(n => n > 9500);
  const uniqueCount = new Set(ecns).size;
  const isStrictMonotonic = ecns.every((n, idx) => idx === 0 || n === ecns[idx - 1] + 1);

  console.log(`First generated ECN: ${ecns[0]}`);
  console.log(`Last generated ECN:  ${ecns[ecns.length - 1]}`);
  console.log(`All ECNs strictly > 9500: ${allStrictlyGreaterThanPrior}`);
  console.log(`Unique count (out of 100): ${uniqueCount}`);
  console.log(`Strictly monotonic sequential: ${isStrictMonotonic}`);

  if (allStrictlyGreaterThanPrior && uniqueCount === 100 && isStrictMonotonic) {
    console.log('✅ PASS: Backup/Restore Reconciliation safely protected sequence from rewinding or duplicate issuance!');
    process.exit(0);
  } else {
    console.error('❌ FAIL: Backup/Restore reconciliation failed. Reused old numbers or found duplicates.');
    process.exit(1);
  }
}

testRestoreReconciliation().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

