const netsService = require('../services/nets.service');
const db = require('../config/db');

async function testFailClosed() {
  console.log('=== TESTING FAIL-CLOSED OFFLINE BEHAVIOR ===');
  
  // Mock DB offline by injecting disconnected pool getter & null poolPromise
  db.getPool = () => null;
  db.poolPromise = (async () => null)();

  try {
    await netsService.getNextEcnAsync();
    console.error('❌ FAIL: getNextEcnAsync did NOT fail closed when DB was offline!');
    process.exit(1);
  } catch (err) {
    if (err.code === 'ERR_NETS_ECN_DB_UNAVAILABLE') {
      console.log('✅ PASS: getNextEcnAsync safely failed closed with expected error:');
      console.log('  Code:', err.code);
      console.log('  Message:', err.message);
      process.exit(0);
    } else {
      console.error('❌ FAIL: Unexpected error code:', err);
      process.exit(1);
    }
  }
}

testFailClosed().catch(e => {
  console.error(e);
  process.exit(1);
});
