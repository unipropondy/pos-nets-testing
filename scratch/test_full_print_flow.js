// Using built-in fetch in Node 24

(async () => {
  try {
    const jobPayload = {
      printerType: 1, // Cashier receipt printer
      targetPrinterIp: '192.168.0.244',
      content: '\n\n[C]<font size=\'big\'><B>TEST PRINT JOB</B></font>\n[C]Local Thermal Print Test\n[L]------------------------------------------------\n[L]<B>Item 1                      [1]   $5.00    $5.00</B>\n[L]------------------------------------------------\n[R]<font size=\'big\'><B>TOTAL: $5.00</B></font>\n\n\n\n'
    };

    console.log('Sending print job to http://localhost:3000/api/print-jobs...');
    const res = await fetch('http://localhost:3000/api/print-jobs', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer unipro-pos-bridge-token-2026',
        'x-store-id': 'STORE_001',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(jobPayload)
    });

    const json = await res.json();
    console.log('API Response:', json);

    // Now call processPrintQueue from printQueueWorker
    const { processPrintQueue } = require('../backend/services/printQueueWorker');
    console.log('\nRunning print worker...');
    await processPrintQueue();

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
