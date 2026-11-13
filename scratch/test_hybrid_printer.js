const http = require('http');

function postJson(urlPath, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': 'Bearer unipro-pos-bridge-token-2026',
        'x-store-id': 'STORE_001'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getJson(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3000${urlPath}`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    }).on('error', reject);
  });
}

(async () => {
  try {
    console.log('1. Testing GET /api/settings/kitchen-printers...');
    const printersRes = await getJson('/api/settings/kitchen-printers');
    console.log('Printers count:', printersRes.data?.length);
    const cashier = printersRes.data.find(p => p.PrinterType === 1);
    console.log('Cashier Printer:', { name: cashier?.PrinterName, ip: cashier?.PrinterIP, path: cashier?.PrinterPath });

    console.log('\n2. Testing POST /api/print-jobs (Default Receipt Printer without override)...');
    const job1 = await postJson('/api/print-jobs', {
      printerType: 1,
      content: '[C]================================\n[C]<font size="big"><B>TEST RECEIPT PRINT</B></font>\n[C]Hybrid Version Print Verified\n[C]================================\n\n'
    });
    console.log('Job 1 Response:', job1.data);

    console.log('\n3. Testing POST /api/print-jobs (Kitchen KOT Printer for KitchenTypeValue 2)...');
    const job2 = await postJson('/api/print-jobs', {
      printerType: 2,
      kitchenTypeValue: '2',
      content: '[C]================================\n[C]<font size="big"><B>TEST KOT - INDIAN KITCHEN</B></font>\n[C]1x Butter Naan\n[C]1x Paneer Butter Masala\n[C]================================\n\n'
    });
    console.log('Job 2 Response:', job2.data);

    console.log('\nWaiting 3 seconds for print queue worker to process jobs...');
    await new Promise(r => setTimeout(r, 3000));

    if (job1.data?.jobId) {
      const status1 = await getJson(`/api/print-jobs/status/${job1.data.jobId}`);
      console.log('Job 1 Final Status:', status1.data);
    }

    if (job2.data?.jobId) {
      const status2 = await getJson(`/api/print-jobs/status/${job2.data.jobId}`);
      console.log('Job 2 Final Status:', status2.data);
    }

    console.log('\n✅ ALL PRINT TESTS COMPLETED!');
    process.exit(0);
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
})();
