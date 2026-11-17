const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');

async function runMultiProcessStartupTest() {
  console.log('================================================================');
  console.log('🚀 MULTI-PROCESS STARTUP & CONCURRENT INITIALIZATION AUDIT');
  console.log('================================================================');
  
  const workerPath = path.join(__dirname, '_startup_worker.js');
  fs.writeFileSync(workerPath, `
    const { poolPromise } = require('../config/db');
    const { initDB } = require('../config/init');
    const netsService = require('../services/nets.service');
    const count = parseInt(process.argv[2] || '250', 10);

    async function run() {
      // Step 1: Simultaneously initialize database (simulating 4 servers starting at the same time)
      const pool = await poolPromise;
      await initDB(pool);

      // Step 2: Concurrently generate ECNs
      const ecns = [];
      for (let i = 0; i < count; i++) {
        const ecn = await netsService.getNextEcnAsync();
        ecns.push(ecn);
      }

      process.send({ ecns });
      process.exit(0);
    }

    run().catch(err => {
      process.send({ error: err.message });
      process.exit(1);
    });
  `);

  const numProcesses = 4;
  const requestsPerProcess = 250;
  const promises = [];

  console.log(`Spawning ${numProcesses} backend processes concurrently to run DB init & ECN generation...`);
  for (let i = 0; i < numProcesses; i++) {
    promises.push(new Promise((resolve, reject) => {
      const child = fork(workerPath, [requestsPerProcess.toString()]);
      child.on('message', (msg) => {
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.ecns);
      });
      child.on('error', reject);
    }));
  }

  const results = await Promise.all(promises);
  if (fs.existsSync(workerPath)) fs.unlinkSync(workerPath);

  const flatResults = results.flat();
  const uniqueSet = new Set(flatResults);

  console.log('----------------------------------------------------------------');
  console.log(`Total Requests Generated Across 4 Processes: ${flatResults.length}`);
  console.log(`Unique ECNs Generated Across 4 Processes:   ${uniqueSet.size}`);
  
  const allFormatted = flatResults.every(e => typeof e === 'string' && /^\d{12}$/.test(e));
  console.log(`All ECNs match 12-digit standard format:   ${allFormatted}`);

  // Check strict sequence ordering across whole batch
  const numericList = flatResults.map(Number).sort((a, b) => a - b);
  const minVal = numericList[0];
  const maxVal = numericList[numericList.length - 1];
  console.log(`Sequence span: from ${minVal} to ${maxVal}`);
  console.log(`Total span diff + 1: ${maxVal - minVal + 1} (Expected: ${flatResults.length})`);

  if (flatResults.length === uniqueSet.size && (maxVal - minVal + 1) === flatResults.length) {
    console.log('✅ PASS: Exactly 1,000 unique sequential ECNs with 0 collisions and 0 lost increments!');
    process.exit(0);
  } else {
    console.error('❌ FAIL: Duplicate ECNs or gaps detected during concurrent startup.');
    process.exit(1);
  }
}

runMultiProcessStartupTest().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});

