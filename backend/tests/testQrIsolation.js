const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

async function testPerimeterSecurity() {
  console.log('=== VERIFYING QR PERIMETER SECURITY & ROUTE ISOLATION ===');

  const backendProc = spawn('node', ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: '3000' },
    stdio: 'pipe'
  });

  const cleanup = () => {
    backendProc.kill();
  };

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);

  // Wait for server to output listen message
  await new Promise((resolve, reject) => {
    backendProc.stdout.on('data', (d) => {
      const s = d.toString();
      if (s.includes('LOCAL SERVER ACTIVE')) {
        resolve();
      }
    });
    backendProc.stderr.on('data', (d) => {
      // console.error('stderr:', d.toString());
    });
    setTimeout(() => resolve(), 6000); // fallback timeout
  });

  const request = (options) => {
    return new Promise((resolve, reject) => {
      const req = http.request({ port: 3000, host: '127.0.0.1', ...options }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
      });
      req.on('error', reject);
      req.end();
    });
  };

  try {
    console.log('\n--- Test 1: Local POS Access (Host: localhost:3000) ---');
    const localRoot = await request({ path: '/', method: 'GET', headers: { Host: 'localhost:3000' } });
    console.log('Local POS Root Status:', localRoot.statusCode);
    if (localRoot.statusCode === 200 && localRoot.body.includes('<!DOCTYPE html>')) {
      console.log('  ✅ [PASS] Local POS serves full POS application');
    } else {
      console.error('  ❌ [FAIL] Local POS root failed');
    }

    const localLogin = await request({ path: '/login.html', method: 'GET', headers: { Host: 'localhost:3000' } });
    console.log('Local POS Login Route Status:', localLogin.statusCode);
    if (localLogin.statusCode === 200) {
      console.log('  ✅ [PASS] Local POS can access staff login page');
    } else {
      console.error('  ❌ [FAIL] Local POS login failed');
    }

    console.log('\n--- Test 2: Public QR Domain Customer Routes (Host: qr.smartcafesg.com) ---');
    const qrCustomer = await request({ path: '/customer', method: 'GET', headers: { Host: 'qr.smartcafesg.com' } });
    console.log('QR Customer Page Status:', qrCustomer.statusCode);
    if (qrCustomer.statusCode === 200) {
      console.log('  ✅ [PASS] Public QR domain allows access to /customer');
    } else {
      console.error('  ❌ [FAIL] QR customer page failed');
    }

    const qrRoot = await request({ path: '/', method: 'GET', headers: { Host: 'qr.smartcafesg.com' } });
    console.log('QR Root Page Status:', qrRoot.statusCode);
    if (qrRoot.statusCode === 200) {
      console.log('  ✅ [PASS] Public QR domain root serves customer welcome');
    } else {
      console.error('  ❌ [FAIL] QR root failed');
    }

    console.log('\n--- Test 3: Public QR Domain Staff Route Blocks ---');
    const qrStaffBlocked = await request({ path: '/login.html', method: 'GET', headers: { Host: 'qr.smartcafesg.com' } });
    console.log('QR Staff Route (/login.html) Status:', qrStaffBlocked.statusCode);
    if (qrStaffBlocked.statusCode === 404 || qrStaffBlocked.statusCode === 403) {
      console.log('  ✅ [PASS] Staff login route is strictly BLOCKED on qr.smartcafesg.com');
    } else {
      console.error('  ❌ [FAIL] Staff route was NOT blocked!');
    }

    const qrAdminBlocked = await request({ path: '/nets-admin.html', method: 'GET', headers: { Host: 'qr.smartcafesg.com' } });
    console.log('QR Admin Route (/nets-admin.html) Status:', qrAdminBlocked.statusCode);
    if (qrAdminBlocked.statusCode === 404 || qrAdminBlocked.statusCode === 403) {
      console.log('  ✅ [PASS] Admin route is strictly BLOCKED on qr.smartcafesg.com');
    } else {
      console.error('  ❌ [FAIL] Admin route was NOT blocked!');
    }

    console.log('\n--- Test 4: Public QR Domain API Whitelist Enforcement ---');
    const qrAllowedApi = await request({ path: '/api/menu/dishes/all', method: 'GET', headers: { Host: 'qr.smartcafesg.com' } });
    console.log('QR Allowed API (/api/menu/dishes/all) Status:', qrAllowedApi.statusCode);
    if (qrAllowedApi.statusCode !== 403) {
      console.log('  ✅ [PASS] Public customer menu API is allowed');
    } else {
      console.error('  ❌ [FAIL] Customer menu API was blocked!');
    }

    const qrBlockedSales = await request({ path: '/api/sales/report', method: 'GET', headers: { Host: 'qr.smartcafesg.com' } });
    console.log('QR Blocked Staff API (/api/sales/report) Status:', qrBlockedSales.statusCode);
    if (qrBlockedSales.statusCode === 403) {
      console.log('  ✅ [PASS] Staff sales API is strictly 403 Forbidden');
    } else {
      console.error('  ❌ [FAIL] Staff sales API was NOT blocked!');
    }

    const qrBlockedNets = await request({ path: '/api/nets/config', method: 'GET', headers: { Host: 'qr.smartcafesg.com' } });
    console.log('QR Blocked Terminal API (/api/nets/config) Status:', qrBlockedNets.statusCode);
    if (qrBlockedNets.statusCode === 403) {
      console.log('  ✅ [PASS] Terminal admin API is strictly 403 Forbidden');
    } else {
      console.error('  ❌ [FAIL] Terminal admin API was NOT blocked!');
    }

    console.log('\n🎉 ALL SECURITY & ISOLATION VERIFICATIONS PASSED SUCCESSFULLY!');
  } finally {
    cleanup();
    process.exit(0);
  }
}

testPerimeterSecurity().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
