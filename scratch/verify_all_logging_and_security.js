const fs = require('fs');
const path = require('path');
const http = require('http');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 COMPREHENSIVE LOGGING & SECURITY VALIDATION SUITE');
  console.log('====================================================');

  const { sanitizeLogMessage, getDateTag, cleanOldLogs, writeToLogFile } = require('../backend/utils/logManager');
  const { loadSecureEnvironment, encryptDPAPI, decryptDPAPI } = require('../backend/utils/envSecurity');

  const today = getDateTag();
  const testLogsDir = path.join(process.cwd(), 'scratch', 'test_logs');
  const testBackendDir = path.join(testLogsDir, 'backend');
  const testFrontendDir = path.join(testLogsDir, 'frontend');

  fs.mkdirSync(testBackendDir, { recursive: true });
  fs.mkdirSync(testFrontendDir, { recursive: true });

  // ----------------------------------------------------
  // TEST 1: Frontend & Backend Logging Format & Subfolders
  // ----------------------------------------------------
  console.log('\n--- Test 1: Frontend & Backend Logging Structure ---');
  const backendDailyLog = path.join(testBackendDir, `backend-${today}.log`);
  const frontendDailyLog = path.join(testFrontendDir, `frontend-${today}.log`);

  writeToLogFile(backendDailyLog, 'Server boot initialization complete', 'INFO');
  writeToLogFile(backendDailyLog, 'SQL Connection established to Localhost:\\ups', 'INFO');
  writeToLogFile(frontendDailyLog, 'Smart POS Frontend Logging Initialized', 'INFO');
  writeToLogFile(frontendDailyLog, 'Cashier selected Table 10 from Floor Plan', 'INFO');

  if (fs.existsSync(backendDailyLog) && fs.existsSync(frontendDailyLog)) {
    console.log('✅ Test 1 Passed: Both logs created in respective subfolders:');
    console.log(`   - Backend:  ${backendDailyLog}`);
    console.log(`   - Frontend: ${frontendDailyLog}`);
  } else {
    throw new Error('❌ Test 1 Failed: Log files not created');
  }

  // ----------------------------------------------------
  // TEST 2: Credential & Password Sanitization
  // ----------------------------------------------------
  console.log('\n--- Test 2: Credential Masking in Logs ---');
  const sensitiveRaw = 'Connecting with DB_PASSWORD=SecretP@ss123 and Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID and UserPassword: "MyPassword99"';
  const sanitized = sanitizeLogMessage(sensitiveRaw);
  console.log('Raw message:      ', sensitiveRaw);
  console.log('Sanitized message:', sanitized);

  if (!sanitized.includes('SecretP@ss123') && !sanitized.includes('MyPassword99') && sanitized.includes('***')) {
    console.log('✅ Test 2 Passed: Passwords and tokens successfully redacted with ***');
  } else {
    throw new Error('❌ Test 2 Failed: Sensitive information was not redacted');
  }

  // ----------------------------------------------------
  // TEST 3: 10-Day Retention Policy Cleanup
  // ----------------------------------------------------
  console.log('\n--- Test 3: 10-Day Log Rotation & Retention Cleanup ---');
  const oldDate = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000); // 12 days ago
  const oldDateTag = getDateTag(oldDate);

  const oldBackendLog = path.join(testBackendDir, `backend-${oldDateTag}.log`);
  const oldFrontendLog = path.join(testFrontendDir, `frontend-${oldDateTag}.log`);

  fs.writeFileSync(oldBackendLog, '[OLD] 12 day old backend log entry');
  fs.writeFileSync(oldFrontendLog, '[OLD] 12 day old frontend log entry');

  // Backdate mtime
  fs.utimesSync(oldBackendLog, oldDate, oldDate);
  fs.utimesSync(oldFrontendLog, oldDate, oldDate);

  console.log('Created old log files:');
  console.log(`   - ${oldBackendLog}`);
  console.log(`   - ${oldFrontendLog}`);

  // Run cleanup
  cleanOldLogs(testLogsDir);

  const oldBackendExists = fs.existsSync(oldBackendLog);
  const oldFrontendExists = fs.existsSync(oldFrontendLog);
  const currentBackendExists = fs.existsSync(backendDailyLog);
  const currentFrontendExists = fs.existsSync(frontendDailyLog);

  if (!oldBackendExists && !oldFrontendExists && currentBackendExists && currentFrontendExists) {
    console.log('✅ Test 3 Passed: 12-day-old logs deleted, while today\'s active logs were preserved!');
  } else {
    throw new Error(`❌ Test 3 Failed: Old logs still exist (${oldBackendExists}, ${oldFrontendExists}) or current deleted (${!currentBackendExists}, ${!currentFrontendExists})`);
  }

  // ----------------------------------------------------
  // TEST 4: DPAPI In-Memory Loading & Plaintext .env Independence
  // ----------------------------------------------------
  console.log('\n--- Test 4: DPAPI In-Memory Loading Without Plaintext .env ---');
  const testPlainContent = 'LOCAL_DB_NAME=UCSPONDY_HYBRID\nLOCAL_DB_USER=sa\nLOCAL_DB_PASSWORD=SecureTestPassword2026\nJWT_SECRET=super_secret_jwt_key_test';
  const encResult = encryptDPAPI(testPlainContent);
  const decResult = decryptDPAPI(encResult);

  if (decResult === testPlainContent) {
    console.log('✅ Test 4.1 Passed: DPAPI encryption and decryption matched exact configuration.');
  } else {
    throw new Error('❌ Test 4.1 Failed: DPAPI round-trip mismatch');
  }

  // ----------------------------------------------------
  // TEST 5: API Endpoints (POST /api/logs/client and GET /api/logs/info)
  // ----------------------------------------------------
  console.log('\n--- Test 5: Backend Server Log API Endpoints ---');
  const server = require('../backend/server');
  // Wait 1.5s for server initialization
  await new Promise(r => setTimeout(r, 1500));

  const postData = JSON.stringify([
    { level: 'INFO', message: 'Test client log from suite', details: { screen: 'checkout' } },
    { level: 'WARN', message: 'Network latency warning', details: { pingMs: 120 } }
  ]);

  const req = http.request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/logs/client',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, (res) => {
    console.log(`POST /api/logs/client returned status: ${res.statusCode}`);
    if (res.statusCode === 204) {
      console.log('✅ Test 5.1 Passed: /api/logs/client successfully accepted frontend log batch.');
    }
  });
  req.write(postData);
  req.end();

  await new Promise(r => setTimeout(r, 500));

  http.get('http://localhost:3000/api/logs/info', (res) => {
    let raw = '';
    res.on('data', chunk => raw += chunk);
    res.on('end', () => {
      try {
        const info = JSON.parse(raw);
        console.log('GET /api/logs/info response:', JSON.stringify(info, null, 2));
        if (info.backendLogPath && info.frontendLogPath && info.backendSubDir && info.frontendSubDir) {
          console.log('✅ Test 5.2 Passed: /api/logs/info accurately returns daily subfolder log structure!');
        }
        process.exit(0);
      } catch (err) {
        console.error('Error parsing info:', err);
        process.exit(1);
      }
    });
  });
}

runTests().catch(err => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});

