const net = require('net');
const assert = require('assert');
const { buildNetsFrame, parseNetsFrame, calculateLrc } = require('../utils/netsProtocol');
const netsService = require('../services/nets.service');

// Mock Terminal Server for simulating Ingenico DESK/5000 behavior
class MockTerminalServer {
  constructor(port = 3999) {
    this.port = port;
    this.server = null;
    this.handler = null;
    this.connections = [];
  }

  start() {
    return new Promise((resolve) => {
      this.server = net.createServer((socket) => {
        this.connections.push(socket);
        let buffer = Buffer.alloc(0);
        socket.on('data', (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          if (this.handler) {
            this.handler(socket, buffer, () => {
              buffer = Buffer.alloc(0);
            });
          }
        });
      });
      this.server.listen(this.port, '127.0.0.1', () => resolve());
    });
  }

  setHandler(fn) {
    this.handler = fn;
  }

  stop() {
    return new Promise((resolve) => {
      this.connections.forEach((s) => s.destroy());
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('🚀 NETS ECR2 Prime Robustness & Safety Test Suite');
  console.log('====================================================\n');

  const mockPort = 3999;
  const mockServer = new MockTerminalServer(mockPort);
  await mockServer.start();

  // Point netsService to our local mock terminal server
  const origIp = netsService.config.terminalIp;
  const origPort = netsService.config.terminalPort;
  const origFinancialTimeout = netsService.config.financialTimeoutMs;
  const origAdminTimeout = netsService.config.adminTimeoutMs;

  netsService.config.terminalIp = '127.0.0.1';
  netsService.config.terminalPort = mockPort;
  netsService.config.financialTimeoutMs = 1500;
  netsService.config.adminTimeoutMs = 1500;
  netsService.config.connectionTimeoutMs = 1000;

  // Stub getNextEcnAsync so unit/mock terminal tests run without requiring live SQL Server
  let mockEcnCounter = 9600;
  netsService.getNextEcnAsync = async () => {
    mockEcnCounter++;
    return String(mockEcnCounter).padStart(12, '0');
  };

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      netsService.isProcessing = false;
      await fn();
      console.log(`✅ [PASS] Scenario ${total}: ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] Scenario ${total}: ${name}`);
      console.error('   Error:', err.message);
      if (err.stack) console.error(err.stack);
    }
  }

  try {
    // ----------------------------------------------------
    // Scenario 1: Complete Valid Approved FC30 Purchase Response
    // ----------------------------------------------------
    await test('Complete Valid Approved FC30 Purchase Response', async () => {
      mockServer.setHandler((socket, buffer, clearBuf) => {
        // Build valid FC 30 Approved response
        const resFrame = buildNetsFrame({
          ecn: '000000009603',
          functionCode: '30',
          responseCode: '00',
          fields: [
            { code: '01', value: '123456' }, // Approval code
            { code: 'HC', value: '00' }, // Mandatory Host Response Code
            { code: '65', value: '000123' }, // STAN
            { code: 'D3', value: 'RRN987654321' }, // RRN
            { code: 'HS', value: 'POS_1794908065348' }, // ECR Ref
            { code: '40', value: '000000000500' }, // Amount $5.00
          ]
        });
        socket.write(resFrame);
        clearBuf();
      });

      const res = await netsService.purchase({
        amount: 5.0,
        ecrRef: 'POS_1794908065348'
      });

      assert.strictEqual(res.isApproved, true);
      assert.strictEqual(res.approvalCode, '123456');
      assert.strictEqual(res.responseCode, '00');
      assert.strictEqual(res.ecrRef, 'POS_1794908065348');
    });

    // ----------------------------------------------------
    // Scenario 2: Complete Declined FC30 Response
    // ----------------------------------------------------
    await test('Complete Declined FC30 Response', async () => {
      mockServer.setHandler((socket, buffer, clearBuf) => {
        const resFrame = buildNetsFrame({
          ecn: '000000009604',
          functionCode: '30',
          responseCode: '51', // Insufficient funds
          fields: [
            { code: 'HS', value: 'POS_DECLINE_001' },
            { code: '40', value: '000000000500' },
          ]
        });
        socket.write(resFrame);
        clearBuf();
      });

      const res = await netsService.purchase({
        amount: 5.0,
        ecrRef: 'POS_DECLINE_001'
      });

      assert.strictEqual(res.isApproved, false);
      assert.strictEqual(res.responseCode, '51');
    });

    // ----------------------------------------------------
    // Scenario 3: Invalid LRC Rejection
    // ----------------------------------------------------
    await test('Invalid LRC rejection throws strict validation error', async () => {
      const validFrame = buildNetsFrame({
        ecn: '000000009605',
        functionCode: '30',
        versionCode: '01',
        responseCode: '00',
        fields: [{ code: '01', value: '111111' }]
      });

      // Tamper LRC byte (last byte)
      const corruptedFrame = Buffer.from(validFrame);
      corruptedFrame[corruptedFrame.length - 1] ^= 0xFF;

      assert.throws(() => {
        parseNetsFrame(corruptedFrame);
      }, /Invalid NETS frame LRC checksum/i);
    });

    // ----------------------------------------------------
    // Scenario 4: Incorrect BCD Frame Length Rejection
    // ----------------------------------------------------
    await test('Incorrect BCD Frame Length Rejection', async () => {
      const validFrame = buildNetsFrame({
        ecn: '000000009606',
        functionCode: '30',
        versionCode: '01',
        responseCode: '00',
        fields: [{ code: '01', value: '222222' }]
      });

      // Corrupt BCD length header (first 2 bytes)
      const tamperedLenFrame = Buffer.from(validFrame);
      tamperedLenFrame[0] = 0x09;
      tamperedLenFrame[1] = 0x99; // 999 bytes declared!

      assert.throws(() => {
        parseNetsFrame(tamperedLenFrame);
      }, /Invalid NETS frame length/i);
    });

    // ----------------------------------------------------
    // Scenario 5: Partial Response Rejection on Socket Close
    // ----------------------------------------------------
    await test('Partial response rejection on socket close without full frame', async () => {
      mockServer.setHandler((socket, buffer, clearBuf) => {
        // Send only 10 bytes and abruptly close
        socket.write(Buffer.from([0x00, 0x1A, 0x02, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30]));
        setTimeout(() => socket.destroy(), 50);
        clearBuf();
      });

      // Disable FC56 recovery for this isolated socket test
      netsService.config.lastApprovedQueryOnTimeout = false;
      try {
        await netsService.purchase({
          amount: 5.0,
          ecrRef: 'POS_PARTIAL_CLOSE'
        });
        assert.fail('Should have failed due to premature socket close');
      } catch (err) {
        assert(err.isPrematureClose || err.code === 'EUNCERTAIN_SOCKET_CLOSED' || /closed prematurely/i.test(err.message) || /Buffer too short/i.test(err.message));
      } finally {
        netsService.config.lastApprovedQueryOnTimeout = true;
      }
    });

    // ----------------------------------------------------
    // Scenario 6: Abrupt Socket Reset After Dispatched Purchase -> Triggers FC56 Recovery
    // ----------------------------------------------------
    await test('Abrupt Socket Reset After Dispatched Purchase triggers FC56 Recovery', async () => {
      let callCount = 0;
      mockServer.setHandler((socket, buffer, clearBuf) => {
        callCount++;
        if (callCount === 1) {
          // Abruptly close socket without sending reply
          setTimeout(() => socket.destroy(), 50);
        } else {
          // FC56 Inquiry request received! Reply with Approved transaction
          const fc56Res = buildNetsFrame({
            ecn: '000000009607',
            functionCode: '56',
            responseCode: '00',
            fields: [
              { code: '01', value: 'RECOV1' },
              { code: 'HS', value: 'POS_RECOV_001' },
              { code: '40', value: '000000000500' },
              { code: '65', value: '999888' },
            ]
          });
          socket.write(fc56Res);
        }
        clearBuf();
      });

      const res = await netsService.purchase({
        amount: 5.0,
        ecrRef: 'POS_RECOV_001'
      });

      assert.strictEqual(res.isApproved, true);
      assert.strictEqual(res.recovered, true);
      assert.strictEqual(res.approvalCode, 'RECOV1');
      assert.strictEqual(res.ecrRef, 'POS_RECOV_001');
    });

    // ----------------------------------------------------
    // Scenario 7: Response Timeout After Dispatched Purchase -> Triggers FC56 Recovery
    // ----------------------------------------------------
    await test('Response Timeout After Dispatched Purchase triggers FC56 Recovery', async () => {
      let callCount = 0;
      mockServer.setHandler((socket, buffer, clearBuf) => {
        callCount++;
        if (callCount === 1) {
          // Do nothing, let it time out
        } else {
          // FC56 Inquiry request received!
          const fc56Res = buildNetsFrame({
            ecn: '000000009608',
            functionCode: '56',
            responseCode: '00',
            fields: [
              { code: '01', value: 'RECOV_TIMEOUT' },
              { code: 'HS', value: 'POS_TIMEOUT_002' },
              { code: '40', value: '000000000500' },
            ]
          });
          socket.write(fc56Res);
        }
        clearBuf();
      });

      const res = await netsService.purchase({
        amount: 5.0,
        ecrRef: 'POS_TIMEOUT_002'
      });

      assert.strictEqual(res.isApproved, true);
      assert.strictEqual(res.recovered, true);
      assert.strictEqual(res.approvalCode, 'RECOV_TIMEOUT');
    });

    // ----------------------------------------------------
    // Scenario 8: FC56 Reference or Amount Mismatch -> Fails Closed
    // ----------------------------------------------------
    await test('FC56 Inquiry Mismatch Fails Closed with ERECONCILIATIONREQUIRED', async () => {
      let callCount = 0;
      mockServer.setHandler((socket, buffer, clearBuf) => {
        callCount++;
        if (callCount === 1) {
          setTimeout(() => socket.destroy(), 50);
        } else {
          // Terminal reports a DIFFERENT transaction
          const fc56Res = buildNetsFrame({
            ecn: '000000009609',
            functionCode: '56',
            versionCode: '01',
            responseCode: '00',
            fields: [
              { code: '01', value: 'DIFF_TXN' },
              { code: 'HS', value: 'POS_SOME_OTHER_TXN' }, // Mismatched Ref!
              { code: '40', value: '000000001000' }, // $10.00 instead of $5.00!
            ]
          });
          socket.write(fc56Res);
        }
        clearBuf();
      });

      try {
        await netsService.purchase({
          amount: 5.0,
          ecrRef: 'POS_EXPECTED_TXN'
        });
        assert.fail('Should fail closed due to mismatch');
      } catch (err) {
        assert.strictEqual(err.code, 'ERECONCILIATIONREQUIRED');
        assert(/outcome uncertain/i.test(err.message));
      }
    });

    // ----------------------------------------------------
    // Scenario 9: Idempotency Middleware In-Flight Duplicate Waiting
    // ----------------------------------------------------
    await test('Idempotency middleware holds and resolves duplicate concurrent requests', async () => {
      const idempotency = require('../middleware/idempotency');
      
      const req1 = {
        method: 'POST',
        headers: { 'x-request-id': 'test-idemp-001' },
        body: { amount: 5.0, ecrRef: 'POS_IDEMP_1' },
        originalUrl: '/api/nets/payment'
      };
      
      let res1SendBody = null;
      const res1 = {
        statusCode: 200,
        getHeaders: () => ({ 'content-type': 'application/json' }),
        setHeader: () => {},
        status: (s) => { res1.statusCode = s; return res1; },
        send: (b) => { res1SendBody = b; return res1; }
      };

      // Start Request 1
      idempotency(req1, res1, () => {});

      // Simulate simultaneous duplicate Request 2 before Request 1 finishes
      const req2 = {
        method: 'POST',
        headers: { 'x-request-id': 'test-idemp-001' },
        body: { amount: 5.0, ecrRef: 'POS_IDEMP_1' },
        originalUrl: '/api/nets/payment'
      };

      let res2SendBody = null;
      const res2 = {
        statusCode: 200,
        getHeaders: () => ({ 'content-type': 'application/json' }),
        setHeader: () => {},
        status: (s) => { res2.statusCode = s; return res2; },
        send: (b) => { res2SendBody = b; return res2; }
      };

      let req2Finished = false;
      const req2Promise = new Promise((resolve) => {
        idempotency(req2, res2, () => {});
        // req2 will register a listener on 'done' and wait!
        const check = setInterval(() => {
          if (res2SendBody !== null) {
            clearInterval(check);
            req2Finished = true;
            resolve();
          }
        }, 10);
      });

      // Now Request 1 finishes
      res1.send(JSON.stringify({ success: true, approved: true, approvalCode: 'IDEMP_OK' }));

      await req2Promise;

      assert.strictEqual(req2Finished, true);
      assert.strictEqual(JSON.parse(res2SendBody).approvalCode, 'IDEMP_OK');
    });

    // ----------------------------------------------------
    // Scenario 10: ECR Ref Field Code Priority (HS sent by default)
    // ----------------------------------------------------
    await test('ECR Reference Field Code Priority defaults to HS for DBS UAT', async () => {
      let sentFrame = null;
      mockServer.setHandler((socket, buffer, clearBuf) => {
        sentFrame = buffer;
        const resFrame = buildNetsFrame({
          ecn: '000000009610',
          functionCode: '30',
          versionCode: '01',
          responseCode: '00',
          fields: [
            { code: '01', value: 'APP_HS' },
            { code: 'HS', value: 'POS_HS_TEST' },
            { code: '40', value: '000000000500' },
          ]
        });
        socket.write(resFrame);
        clearBuf();
      });

      await netsService.purchase({
        amount: 5.0,
        ecrRef: 'POS_HS_TEST'
      });

      assert(sentFrame !== null);
      const parsedSent = parseNetsFrame(sentFrame);
      assert.strictEqual(parsedSent.fields['HS'], 'POS_HS_TEST');
      assert.strictEqual(parsedSent.fields['HD'], undefined);
    });

    // ----------------------------------------------------
    // Scenario 11: End-to-End Incident Order 20261117-0020 Reconciliation Simulation
    // ----------------------------------------------------
    await test('Incident Order 20261117-0020 matches POS_1794908065348 and $5.00 via FC56', async () => {
      // Mock terminal responding to FC56 with the approved incident details
      mockServer.setHandler((socket, buffer, clearBuf) => {
        const fc56Res = buildNetsFrame({
          ecn: '000000009603',
          functionCode: '56',
          responseCode: '00',
          fields: [
            { code: '01', value: '996031' }, // Terminal approval code
            { code: 'HS', value: 'POS_1794908065348' },
            { code: '40', value: '000000000500' }, // $5.00
            { code: '65', value: '009603' }, // STAN
            { code: 'D3', value: 'RRN_INCIDENT' },
            { code: '16', value: '11900001' }, // Terminal ID
          ]
        });
        socket.write(fc56Res);
        clearBuf();
      });

      const inq = await netsService.getLastApprovedTransaction();
      assert.strictEqual(inq.success, true);
      assert.strictEqual(inq.parsed.isApproved, true);
      assert.strictEqual(inq.fields['HS'], 'POS_1794908065348');
      assert.strictEqual(inq.fields['40'], '000000000500');
    });

    // ----------------------------------------------------
    // Scenario 12: Terminal Busy NAK (0x15) does NOT recharge
    // ----------------------------------------------------
    await test('Terminal Busy NAK (0x15) is handled cleanly without recharging', async () => {
      mockServer.setHandler((socket, buffer, clearBuf) => {
        // Return 1-byte NAK
        socket.write(Buffer.from([0x15]));
        clearBuf();
      });

      try {
        await netsService.purchase({
          amount: 5.0,
          ecrRef: 'POS_BUSY_TEST'
        });
        assert.fail('Should throw terminal busy');
      } catch (err) {
        assert(err.isNak || /busy/i.test(err.message));
      }
    });

  } finally {
    await mockServer.stop();
    netsService.config.terminalIp = origIp;
    netsService.config.terminalPort = origPort;
    netsService.config.financialTimeoutMs = origFinancialTimeout;
    netsService.config.adminTimeoutMs = origAdminTimeout;
  }

  console.log('\n====================================================');
  console.log(`Results: ${passed}/${total} Scenarios Passed`);
  console.log('====================================================');

  process.exit(passed === total ? 0 : 1);
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
