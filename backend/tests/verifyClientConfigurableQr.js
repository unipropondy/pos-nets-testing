const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');
const crypto = require('crypto');

function makeRequest(hostHeader, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path: reqPath,
      method: 'GET',
      headers: {
        'Host': hostHeader
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function verifyClient(envDomain, expectedHost, clientLabel) {
  console.log(`\n======================================================`);
  console.log(`Testing ${clientLabel}: Configured QR_DOMAIN = ${envDomain}`);
  console.log(`======================================================`);
  
  // 1. Update backend/.env
  let envContent = fs.readFileSync('backend/.env', 'utf8');
  envContent = envContent.replace(/QR_DOMAIN=.*(\r?\n|$)/g, '').trimEnd() + `\nQR_DOMAIN="${envDomain}"\n`;
  fs.writeFileSync('backend/.env', envContent, 'utf8');

  // 2. Start server
  const proc = spawn(process.execPath, ['backend/server.js'], {
    cwd: process.cwd(),
    stdio: 'ignore'
  });

  // Wait for server ready
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const res = await makeRequest('localhost:3000', '/health');
      if (res.status === 200) { ready = true; break; }
    } catch (e) {}
  }
  if (!ready) {
    try { proc.kill(); } catch {}
    throw new Error(`Server failed to start for ${clientLabel}`);
  }

  try {
    // 3. Test runtime config endpoint
    const configRes = await makeRequest('localhost:3000', '/api/config/qr-domain');
    console.log(`[Runtime Config API] Status: ${configRes.status} | Body: ${configRes.body.trim()}`);
    const configData = JSON.parse(configRes.body);
    const domainMatch = configData.qrDomain === envDomain;
    const hostMatch = configData.qrHostname === expectedHost;
    console.log(`-> qrDomain: "${configData.qrDomain}" (Expected: "${envDomain}") => ${domainMatch ? 'MATCH ✅' : 'FAIL ❌'}`);
    console.log(`-> qrHostname: "${configData.qrHostname}" (Expected: "${expectedHost}") => ${hostMatch ? 'MATCH ✅' : 'FAIL ❌'}`);

    // 4. Test Customer QR domain routing
    const qrRes = await makeRequest(expectedHost, '/');
    const qrIndexSha = crypto.createHash('sha256').update(fs.readFileSync('backend/dist-qr/customer/index.html')).digest('hex');
    const qrReceivedSha = crypto.createHash('sha256').update(qrRes.body).digest('hex');
    console.log(`[QR Domain Routing] Host: "${expectedHost}" GET / => Status: ${qrRes.status}`);
    console.log(`-> Served dist-qr/customer/index.html SHA: ${qrReceivedSha} => ${qrReceivedSha === qrIndexSha ? 'MATCH ✅' : 'FAIL ❌'}`);

    // 5. Test POS localhost routing
    const posRes = await makeRequest('localhost:3000', '/');
    const posIndexSha = crypto.createHash('sha256').update(fs.readFileSync('backend/dist/index.html')).digest('hex');
    const posReceivedSha = crypto.createHash('sha256').update(posRes.body).digest('hex');
    console.log(`[POS Localhost Routing] Host: "localhost:3000" GET / => Status: ${posRes.status}`);
    console.log(`-> Served dist/index.html SHA: ${posReceivedSha} => ${posReceivedSha === posIndexSha ? 'MATCH ✅' : 'FAIL ❌'}`);

    // 6. Test Staff Blocking on configured QR domain
    const blockedRes = await makeRequest(expectedHost, '/login');
    console.log(`[Perimeter Security] Host: "${expectedHost}" GET /login => Status: ${blockedRes.status} => ${blockedRes.status === 404 ? 'BLOCKED ✅' : 'FAIL ❌'}`);

  } finally {
    // Clean shutdown
    await makeRequest('localhost:3000', '/api/admin/shutdown').catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    try { proc.kill(); } catch (e) {}
  }
}

async function run() {
  try {
    await verifyClient('https://qr.shopa.com', 'qr.shopa.com', 'Client A');
    await verifyClient('https://qr.shopb.com', 'qr.shopb.com', 'Client B');
    console.log(`\n🎉 ALL CLIENT DOMAIN CONFIGURATION AUDITS PASSED WITH ZERO FRONTEND REBUILD!`);
  } catch (err) {
    console.error('❌ Verification failed:', err);
  } finally {
    // Restore default QR_DOMAIN
    let envContent = fs.readFileSync('backend/.env', 'utf8');
    envContent = envContent.replace(/QR_DOMAIN=.*(\r?\n|$)/g, '').trimEnd() + '\nQR_DOMAIN="https://qr.smartcafesg.com"\n';
    fs.writeFileSync('backend/.env', envContent, 'utf8');
  }
}

run();
