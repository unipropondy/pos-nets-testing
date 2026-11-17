const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');

async function runMultiProcessTest() {
  console.log('--- STARTING 1,000 MULTI-PROCESS CONCURRENT ECN TEST (SQL ATOMIC SEQUENCE) ---');
  
  const workerPath = path.join(__dirname, 'ecn_worker.js');
  fs.writeFileSync(workerPath, `
    const netsService = require('../services/nets.service');
    const count = parseInt(process.argv[2] || '250', 10);
    async function run() {
      const ecns = [];
      for (let i = 0; i < count; i++) {
        const ecn = await netsService.getNextEcnAsync();
        ecns.push(ecn);
      }
      process.send(ecns);
      process.exit(0);
    }
    run().catch(e => {
      console.error('Worker error:', e);
      process.exit(1);
    });
  `);

  const numProcesses = 4;
  const requestsPerProcess = 250;
  const promises = [];

  for (let i = 0; i < numProcesses; i++) {
    promises.push(new Promise((resolve, reject) => {
      const child = fork(workerPath, [requestsPerProcess.toString()]);
      child.on('message', (msg) => {
        resolve(msg);
      });
      child.on('error', reject);
    }));
  }

  const results = await Promise.all(promises);
  if (fs.existsSync(workerPath)) fs.unlinkSync(workerPath);

  const flatResults = results.flat();
  const uniqueSet = new Set(flatResults);

  console.log('Total Requests Spawned:', flatResults.length);
  console.log('Unique ECNs Generated:', uniqueSet.size);
  
  // Check format: exactly 12 digits numeric string
  const allFormatted = flatResults.every(e => typeof e === 'string' && /^\d{12}$/.test(e));
  console.log('All ECNs match 12-digit format:', allFormatted);

  if (flatResults.length === uniqueSet.size) {
    console.log('RESULT: PASSED. Zero collisions across concurrent processes!');
    process.exit(0);
  } else {
    console.log('COLLISION DETECTED:', flatResults.length - uniqueSet.size, 'duplicates found.');
    process.exit(1);
  }
}

runMultiProcessTest().catch(err => {
  console.error(err);
  process.exit(1);
});
