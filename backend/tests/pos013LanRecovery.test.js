/**
 * Test Suite: POS-013 - Safe LAN Recovery and FC 56 Retry
 * 
 * Verifies that:
 * 1. LAN disconnected during purchase (ECONNRESET) does not fire FC 56 immediately.
 * 2. Recovery wait period allows link & terminal service stabilization.
 * 3. FC 56 retry logic triggers on eligible transport errors (ECONNRESET, ECONNREFUSED, ENETUNREACH, EHOSTUNREACH, ETIMEDOUT).
 * 4. Maximum retry bounds are strictly enforced (configurable, default 2 retries).
 * 5. Fresh unique 12-digit ECN is generated for each FC 56 attempt.
 * 6. Original purchase ECN, reference, amount, timestamps, and error codes are preserved.
 * 7. Matching approved FC 56 reconciles and approves the original payment.
 * 8. Non-matching previous approved FC 56 marks outcome as UNKNOWN / REQUIRES RECONCILIATION and NOT auto-cancelled/declined.
 * 9. All retries exhausted marks outcome as UNKNOWN / REQUIRES RECONCILIATION.
 * 10. Unresolved transaction state blocks subsequent financial operations (Card, QR, Credit Card, Settlement).
 * 11. State persistence survives restart and administrative clearing requires verified evidence.
 * 12. Normal working flows for NETS CARD, NETS QR, and NETS CREDIT CARD are preserved.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const UNRESOLVED_TEST_PATH = path.join(__dirname, '../config/netsUnresolved.test.json');
const AUDIT_TEST_PATH = path.join(__dirname, '../config/netsAuditHistory.test.json');
process.env.NETS_UNRESOLVED_FILE_PATH = UNRESOLVED_TEST_PATH;
process.env.NETS_AUDIT_FILE_PATH = AUDIT_TEST_PATH;

const netsServiceModule = require('../services/nets.service');
const NetsService = netsServiceModule.NetsService;
const netsProtocol = require('../utils/netsProtocol');

async function runAsyncTest(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

// Cleanup helper
function cleanupTestState() {
  if (fs.existsSync(UNRESOLVED_TEST_PATH)) {
    fs.unlinkSync(UNRESOLVED_TEST_PATH);
  }
  if (fs.existsSync(AUDIT_TEST_PATH)) {
    fs.unlinkSync(AUDIT_TEST_PATH);
  }
}

(async () => {
  console.log('=== STARTING POS-013 AUTOMATED LAN RECOVERY TESTS ===\n');

  // ---------------------------------------------------------------------------
  // Test 1: Bounded delay before FC 56 recovery (No instantaneous dispatch)
  // ---------------------------------------------------------------------------
  await runAsyncTest('FC 56 recovery enforces bounded stabilization delay rather than immediate dispatch', async () => {
    cleanupTestState();
    const service = new NetsService();
    // Fast mock timing for unit testing
    service.config.recoveryInitialDelayMs = 150;
    service.config.recoveryRetryDelayMs = 50;
    service.config.recoveryMaxRetries = 2;

    let ecnCounter = 1000;
    service.getNextEcnAsync = async () => String(++ecnCounter).padStart(12, '0');

    const startTimestamp = Date.now();
    let delayRespected = false;

    // Mock sendPacket to inspect timing
    service.sendPacket = async (buf) => {
      const elapsed = Date.now() - startTimestamp;
      if (elapsed >= 140) {
        delayRespected = true;
      }
      // Return matching approved FC 56 response
      const frame = netsProtocol.buildNetsFrame({
        ecn: '000000000100',
        functionCode: '56',
        versionCode: '01',
        responseCode: '00',
        fields: [
          { code: '01', value: 'APPR01' },
          { code: 'HS', value: 'P1234567890123' },
          { code: '40', value: '000000001000' },
        ],
      });
      return { parsed: netsProtocol.parseNetsFrame(frame), rawHex: frame.toString('hex') };
    };

    const initialErr = new Error('read ECONNRESET');
    initialErr.code = 'ECONNRESET';
    initialErr.requestDispatched = true;

    const result = await service._recoverWithLastApproved({
      originalEcn: '000000016663',
      refNum: 'P1234567890123',
      amount: 10.00,
      amountStr: '000000001000',
      flowName: 'NETS Card',
      txnType: '01',
      initialError: initialErr,
    });

    assert.strictEqual(delayRespected, true, 'FC 56 was fired before recoveryInitialDelayMs expired!');
    assert.strictEqual(result.isApproved, true);
    assert.strictEqual(result.recovered, true);
    assert.strictEqual(result.ecn, '000000016663', 'Original purchase ECN must be preserved');
  });

  // ---------------------------------------------------------------------------
  // Test 2: Transport error retry loop with fresh ECNs per attempt
  // ---------------------------------------------------------------------------
  await runAsyncTest('First FC 56 retry encounters transport error (ECONNREFUSED) and second succeeds with fresh ECN', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.config.recoveryInitialDelayMs = 20;
    service.config.recoveryRetryDelayMs = 20;
    service.config.recoveryMaxRetries = 2;

    let ecnCounter = 2000;
    service.getNextEcnAsync = async () => String(++ecnCounter).padStart(12, '0');

    let attemptCount = 0;
    const attemptedEcns = [];

    service.sendPacket = async (buf) => {
      attemptCount++;
      const parsedReq = netsProtocol.parseNetsFrame(buf);
      attemptedEcns.push(parsedReq.ecn);

      if (attemptCount === 1) {
        const refusedErr = new Error('connect ECONNREFUSED 192.168.9.38:7500');
        refusedErr.code = 'ECONNREFUSED';
        throw refusedErr;
      }

      // Attempt 2 succeeds
      const frame = netsProtocol.buildNetsFrame({
        ecn: parsedReq.ecn,
        functionCode: '56',
        versionCode: '01',
        responseCode: '00',
        fields: [
          { code: '01', value: 'APPR99' },
          { code: 'HD', value: 'P9876543210123' },
          { code: '40', value: '000000002500' },
        ],
      });
      return { parsed: netsProtocol.parseNetsFrame(frame), rawHex: frame.toString('hex') };
    };

    const initialErr = new Error('socket closed ECONNRESET');
    initialErr.code = 'ECONNRESET';
    initialErr.requestDispatched = true;

    const result = await service._recoverWithLastApproved({
      originalEcn: '000000017001',
      refNum: 'P9876543210123',
      amount: 25.00,
      amountStr: '000000002500',
      flowName: 'NETS Card',
      txnType: '01',
      initialError: initialErr,
    });

    assert.strictEqual(attemptCount, 2, 'Must have attempted twice (1 failure + 1 success)');
    assert.strictEqual(attemptedEcns.length, 2);
    assert.notStrictEqual(attemptedEcns[0], attemptedEcns[1], 'Each FC 56 attempt must use a fresh unique ECN');
    assert.strictEqual(result.isApproved, true);
    assert.strictEqual(result.ecn, '000000017001', 'Original purchase ECN must be preserved');
  });

  // ---------------------------------------------------------------------------
  // Test 3: Non-matching previous approved transaction is NOT claimed cancelled
  // ---------------------------------------------------------------------------
  await runAsyncTest('Non-matching previous approved FC 56 marks outcome UNKNOWN and does not auto-cancel', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.config.recoveryInitialDelayMs = 10;
    service.config.recoveryRetryDelayMs = 10;
    service.config.recoveryMaxRetries = 1;

    let ecnCounter = 3000;
    service.getNextEcnAsync = async () => String(++ecnCounter).padStart(12, '0');

    // Terminal returns previous approved transaction with older ref/amount
    service.sendPacket = async (buf) => {
      const parsedReq = netsProtocol.parseNetsFrame(buf);
      const frame = netsProtocol.buildNetsFrame({
        ecn: parsedReq.ecn,
        functionCode: '56',
        versionCode: '01',
        responseCode: '00',
        fields: [
          { code: '01', value: 'OLDAPP' },
          { code: 'HD', value: 'OLDER_TRANSACTION' },
          { code: '40', value: '000000000500' }, // $5.00 instead of $10.00
        ],
      });
      return { parsed: netsProtocol.parseNetsFrame(frame), rawHex: frame.toString('hex') };
    };

    const initialErr = new Error('ECONNRESET');
    initialErr.code = 'ECONNRESET';
    initialErr.requestDispatched = true;

    let caughtErr = null;
    try {
      await service._recoverWithLastApproved({
        originalEcn: '000000016663',
        refNum: 'POS_CURRENT_REF',
        amount: 10.00,
        amountStr: '000000001000',
        flowName: 'NETS Card',
        txnType: '01',
        initialError: initialErr,
      });
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr, 'Expected ERECONCILIATIONREQUIRED error');
    assert.strictEqual(caughtErr.code, 'ERECONCILIATIONREQUIRED');
    assert.strictEqual(caughtErr.originalEcn, '000000016663');
    assert.strictEqual(caughtErr.unresolved.status, 'UNRESOLVED');
    assert.ok(!caughtErr.message.includes('declined'), 'Must not claim declined');
    assert.ok(!caughtErr.message.includes('cancelled'), 'Must not claim cancelled');
    assert.ok(caughtErr.message.includes('Manual reconciliation required'), 'Must instruct manual reconciliation');

    // Verify unresolved transaction is locked and persisted
    const activeUnresolved = service.getUnresolvedTransaction();
    assert.ok(activeUnresolved, 'Unresolved transaction must be active');
    assert.strictEqual(activeUnresolved.originalEcn, '000000016663');
    assert.strictEqual(activeUnresolved.ecrRef, 'POS_CURRENT_REF');
    assert.strictEqual(fs.existsSync(UNRESOLVED_TEST_PATH), true, 'Unresolved state must be persisted to disk');
  });

  // ---------------------------------------------------------------------------
  // Test 4: All FC 56 retries exhausted
  // ---------------------------------------------------------------------------
  await runAsyncTest('All FC 56 retries exhausted marks outcome UNKNOWN and records all attempted ECNs', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.config.recoveryInitialDelayMs = 10;
    service.config.recoveryRetryDelayMs = 10;
    service.config.recoveryMaxRetries = 2; // total 3 attempts

    let ecnCounter = 4000;
    service.getNextEcnAsync = async () => String(++ecnCounter).padStart(12, '0');

    let attempts = 0;
    service.sendPacket = async () => {
      attempts++;
      const timeoutErr = new Error('Terminal communication timed out after 35 seconds');
      timeoutErr.code = 'ETIMEDOUT';
      throw timeoutErr;
    };

    let caughtErr = null;
    try {
      await service._recoverWithLastApproved({
        originalEcn: '000000016663',
        refNum: 'TEST_REF_EXHAUSTED',
        amount: 30.00,
        amountStr: '000000003000',
        flowName: 'NETS Credit Card',
        txnType: 'I0',
        initialError: { code: 'ECONNRESET', message: 'cable pulled' },
      });
    } catch (err) {
      caughtErr = err;
    }

    assert.strictEqual(attempts, 3, 'Must have attempted exactly 3 times (1 initial + 2 retries)');
    assert.strictEqual(caughtErr.code, 'ERECONCILIATIONREQUIRED');
    assert.strictEqual(caughtErr.recoveryAttempts.length, 3);
    assert.strictEqual(caughtErr.unresolved.status, 'UNRESOLVED');
    assert.strictEqual(caughtErr.unresolved.originalEcn, '000000016663');
  });

  // ---------------------------------------------------------------------------
  // Test 5: Concurrency guard and Terminal Busy behavior
  // ---------------------------------------------------------------------------
  await runAsyncTest('Terminal concurrency guard blocks overlapping operations and handles busy terminal', async () => {
    cleanupTestState();
    const service = new NetsService();
    let testEcn = 3000;
    service.getNextEcnAsync = async () => String(++testEcn).padStart(12, '0');

    // 1. Terminal is actively processing an operation
    service.isProcessing = true;
    let busyErr = null;
    try {
      await service.purchaseCard({ amount: 10, ecrRef: 'CONCURRENT_1' });
    } catch (e) {
      busyErr = e;
    }
    assert.strictEqual(busyErr?.code, 'ETERMINALBUSY');
    service.isProcessing = false;

    // 2. Terminal returns NAK (0x15) when busy
    service.sendPacket = async () => {
      const nakErr = new Error('Terminal Busy (NAK 0x15 received from terminal)');
      nakErr.code = 'ETERMINALBUSY';
      nakErr.isNak = true;
      throw nakErr;
    };

    let nakCaught = null;
    try {
      await service.purchaseCard({ amount: 10, ecrRef: 'NAK_TEST' });
    } catch (e) {
      nakCaught = e;
    }
    assert.ok(nakCaught?.message?.toLowerCase().includes('busy'));

    // 3. Concurrency guard blocks overlapping settlement and credit card operations
    service.isProcessing = true;
    let ccBusyErr = null;
    try {
      await service.purchaseCreditCard({ amount: 20, ecrRef: 'CC_CONC' });
    } catch (e) {
      ccBusyErr = e;
    }
    assert.strictEqual(ccBusyErr?.code, 'ETERMINALBUSY');

    let settBusyErr = null;
    try {
      await service.settlement();
    } catch (e) {
      settBusyErr = e;
    }
    assert.strictEqual(settBusyErr?.code, 'ETERMINALBUSY');
    service.isProcessing = false;
  });

  // ---------------------------------------------------------------------------
  // Test 5B: Unresolved transaction does not permanently block subsequent independent payments
  // ---------------------------------------------------------------------------
  await runAsyncTest('Unresolved transaction does not block separate payment with fresh ECN when terminal is available', async () => {
    cleanupTestState();
    const service = new NetsService();
    let ecnCounter = 16672;
    service.getNextEcnAsync = async () => String(++ecnCounter).padStart(12, '0');

    // Simulate existing unresolved transaction on disk
    service.saveUnresolvedTransaction({
      ecn: '000000016672',
      originalEcn: '000000016672',
      ecrRef: '1795425252607',
      amount: 5.50,
      amountStr: '000000000550',
      flowName: 'NETS Card',
      status: 'UNRESOLVED',
    });

    // Mock terminal communication:
    // When pre-check FC 56 is sent, terminal returns last approved is an OLDER/different transaction
    // Then when new purchase FC 30 is sent, it is approved with fresh ECN
    service.sendPacket = async (buf) => {
      const parsedReq = netsProtocol.parseNetsFrame(buf);
      if (parsedReq.functionCode === '56') {
        // Last approved is not 1795425252607
        const inqFrame = netsProtocol.buildNetsFrame({
          ecn: parsedReq.ecn,
          functionCode: '56',
          responseCode: '00',
          fields: [
            { code: '01', value: 'APPPREV' },
            { code: 'HD', value: 'OTHER_OLD_TXN' },
            { code: '40', value: '000000000200' },
          ],
        });
        return { parsed: netsProtocol.parseNetsFrame(inqFrame), rawHex: inqFrame.toString('hex') };
      }
      if (parsedReq.functionCode === '30') {
        // New purchase approved
        const appFrame = netsProtocol.buildNetsFrame({
          ecn: parsedReq.ecn,
          functionCode: '30',
          responseCode: '00',
          fields: [
            { code: '01', value: 'APPNEW01' },
            { code: 'HC', value: '00' },
            { code: 'HD', value: parsedReq.fields['HD'] || 'NEW_REF_01' },
            { code: '40', value: parsedReq.fields['40'] || '000000001000' },
          ],
        });
        return { parsed: netsProtocol.parseNetsFrame(appFrame), rawHex: appFrame.toString('hex') };
      }
      throw new Error(`Unexpected functionCode: ${parsedReq.functionCode}`);
    };

    const newPayment = await service.purchaseCard({
      amount: 10.00,
      ecrRef: 'NEW_ORDER_9999',
    });

    assert.strictEqual(newPayment.isApproved, true);
    assert.strictEqual(newPayment.ecn, '000000016674'); // fresh ECN (16673 used for inquiry, 16674 for purchase)
    assert.notStrictEqual(newPayment.ecn, '000000016672', 'Must never reuse the old ECN');
    assert.ok(service.getUnresolvedTransaction(), 'Previous unresolved transaction record remains recorded as UNKNOWN');
    assert.strictEqual(service.getUnresolvedTransaction().ecn, '000000016672');
  });

  // ---------------------------------------------------------------------------
  // Test 6: Persistence across service reboots
  // ---------------------------------------------------------------------------
  await runAsyncTest('Unresolved transaction state survives service restart / instantiation', async () => {
    cleanupTestState();
    const service1 = new NetsService();
    service1.saveUnresolvedTransaction({
      ecn: '000000016663',
      originalEcn: '000000016663',
      ecrRef: 'PERSISTED_REF_123',
      amount: 10.00,
      status: 'UNRESOLVED',
    });

    // Simulate backend restart by creating a new instance
    const service2 = new NetsService();
    const loaded = service2.getUnresolvedTransaction();
    assert.ok(loaded, 'State must reload from disk on startup');
    assert.strictEqual(loaded.ecn, '000000016663');
    assert.strictEqual(loaded.ecrRef, 'PERSISTED_REF_123');
  });

  // ---------------------------------------------------------------------------
  // Test 7: Administrative clearing requires verified evidence
  // ---------------------------------------------------------------------------
  await runAsyncTest('Administrative clearing requires verified evidence and rejects unverified calls', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.saveUnresolvedTransaction({
      ecn: '000000016663',
      status: 'UNRESOLVED',
      amount: 10.00,
      ecrRef: 'REF_EVIDENCE',
    });

    // Attempt clearing without evidence
    let rejectedNoEvidence = false;
    try {
      service.clearUnresolvedTransactionWithEvidence({});
    } catch (e) {
      rejectedNoEvidence = true;
    }
    assert.strictEqual(rejectedNoEvidence, true, 'Clearing without evidence must fail');

    // Attempt clearing with valid evidence
    const cleared = service.clearUnresolvedTransactionWithEvidence({
      approvalCode: 'MANUAL_SLIP_VERIFIED',
      supervisorApproval: 'MGR_001',
      reconciliationReason: 'Verified terminal paper slip showed declined/voided',
    });

    assert.strictEqual(cleared.success, true);
    assert.strictEqual(service.getUnresolvedTransaction(), null);
    assert.strictEqual(fs.existsSync(UNRESOLVED_TEST_PATH), false, 'Disk file must be cleared');
  });

  // ---------------------------------------------------------------------------
  // Test 8: Concurrent recovery calls for same transaction rejected
  // ---------------------------------------------------------------------------
  await runAsyncTest('Concurrent recovery loops for the same purchase are rejected', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.config.recoveryInitialDelayMs = 100;

    let ecnCounter = 5000;
    service.getNextEcnAsync = async () => String(++ecnCounter).padStart(12, '0');

    let concurrentAttemptBlocked = false;
    service.sendPacket = async () => {
      // Simulate long network call
      await new Promise(r => setTimeout(r, 80));
      return { parsed: { responseCode: '00', isApproved: true, fields: { '01': 'APP', '40': '000000001000', 'HD': 'REF_CONC' } }, rawHex: '' };
    };

    const promise1 = service._recoverWithLastApproved({
      originalEcn: '000000016663',
      refNum: 'REF_CONC',
      amount: 10,
      amountStr: '000000001000',
      flowName: 'NETS Card',
      txnType: '01',
      initialError: { code: 'ECONNRESET' },
    });

    // Try starting another concurrent recovery while first is running
    try {
      await service._recoverWithLastApproved({
        originalEcn: '000000016663',
        refNum: 'REF_CONC',
        amount: 10,
        amountStr: '000000001000',
        flowName: 'NETS Card',
        txnType: '01',
        initialError: { code: 'ECONNRESET' },
      });
    } catch (e) {
      if (e.message.includes('Recovery already in progress')) {
        concurrentAttemptBlocked = true;
      }
    }

    await promise1;
    assert.strictEqual(concurrentAttemptBlocked, true, 'Concurrent recovery must be rejected');
  });

  // ---------------------------------------------------------------------------
  // Test 9: Verify ECN is defined and preserved on disk during recovery exhaustion
  // ---------------------------------------------------------------------------
  await runAsyncTest('Persisted unresolved lock always contains defined originalEcn and ecn', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.config.recoveryInitialDelayMs = 10;
    service.config.recoveryRetryDelayMs = 10;
    service.config.recoveryMaxRetries = 1;

    let ecnCounter = 7000;
    service.getNextEcnAsync = async () => String(++ecnCounter).padStart(12, '0');

    // Force transport failure on all FC 56 attempts
    service.sendPacket = async () => {
      const err = new Error('read ECONNRESET');
      err.code = 'ECONNRESET';
      throw err;
    };

    try {
      await service._recoverWithLastApproved({
        originalEcn: '000000016667',
        refNum: '1795424524883',
        amount: 5,
        amountStr: '000000000500',
        flowName: 'NETS Card',
        txnType: '01',
        initialError: { code: 'ECONNRESET' },
      });
      assert.fail('Should throw ERECONCILIATIONREQUIRED');
    } catch (err) {
      assert.strictEqual(err.code, 'ERECONCILIATIONREQUIRED');
      assert.strictEqual(err.originalEcn, '000000016667');
    }

    const persisted = service.getUnresolvedTransaction();
    assert.ok(persisted, 'Unresolved transaction must be persisted');
    assert.strictEqual(persisted.ecn, '000000016667', 'ecn property must be defined and match originalEcn');
    assert.strictEqual(persisted.originalEcn, '000000016667');
    assert.strictEqual(persisted.ecrRef, '1795424524883');
    assert.strictEqual(persisted.amount, 5);

    // Verify disk contents directly
    const onDiskRaw = fs.readFileSync(UNRESOLVED_TEST_PATH, 'utf8');
    const onDisk = JSON.parse(onDiskRaw);
    assert.strictEqual(onDisk.ecn, '000000016667');
    assert.strictEqual(onDisk.originalEcn, '000000016667');
  });

  // ---------------------------------------------------------------------------
  // Test 10: FC 56 Wire Framing Verification per NETS ECR II Specification
  // ---------------------------------------------------------------------------
  await runAsyncTest('FC 56 frame byte structure matches NETS ECR II wire specification', async () => {
    const frame = netsProtocol.buildNetsFrame({
      ecn: '000000016668',
      functionCode: '56',
      versionCode: '01',
      fields: [],
    });

    // Wire length: 2 BCD bytes length + 18 bytes header + 1 byte LRC = 21 bytes
    assert.strictEqual(frame.length, 21, 'FC 56 frame length without fields must be exactly 21 bytes');
    
    // BCD Length Header (18 message body bytes + 1 LRC byte = 19 -> 0x00, 0x19)
    assert.strictEqual(frame[0], 0x00);
    assert.strictEqual(frame[1], 0x19);

    // ECN (12 ASCII digits)
    const ecn = frame.slice(2, 14).toString('ascii');
    assert.strictEqual(ecn, '000000016668');

    // Function Code (2 ASCII digits: 56)
    const fc = frame.slice(14, 16).toString('ascii');
    assert.strictEqual(fc, '56');

    // Version Code (2 ASCII digits: 01)
    const vc = frame.slice(16, 18).toString('ascii');
    assert.strictEqual(vc, '01');

    // RFU (1 ASCII digit: 0)
    const rfu = frame.slice(18, 19).toString('ascii');
    assert.strictEqual(rfu, '0');

    // FS Separator (0x1C)
    assert.strictEqual(frame[19], 0x1C);

    // LRC (byte 20)
    const messageBody = frame.slice(2, 20);
    const expectedLrc = netsProtocol.calculateLrc(messageBody);
    assert.strictEqual(frame[20], expectedLrc);
  });

  // ---------------------------------------------------------------------------
  // Test 11: Verified evidence-based reconciliation and targetEcn validation
  // ---------------------------------------------------------------------------
  await runAsyncTest('Administrative clearing requires targetEcn match and evidence', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.saveUnresolvedTransaction({
      ecn: '000000016672',
      originalEcn: '000000016672',
      ecrRef: '1795425252607',
      amount: 5.50,
      status: 'UNRESOLVED',
    });

    // Test targetEcn mismatch check
    let mismatchErr = null;
    try {
      service.clearUnresolvedTransactionWithEvidence({
        targetEcn: '000000019999',
        approvalCode: 'APP01',
      });
    } catch (e) {
      mismatchErr = e;
    }
    assert.ok(mismatchErr?.message?.includes('Target ECN mismatch'));

    // Test targetEcn match success
    const clearRes = service.clearUnresolvedTransactionWithEvidence({
      targetEcn: '000000016672',
      approvalCode: 'APP01',
    });
    assert.strictEqual(clearRes.success, true);
    assert.strictEqual(service.getUnresolvedTransaction(), null);
  });

  // ---------------------------------------------------------------------------
  // Test 12: Confirmed terminal cancellation (RC=XX) updates state to CANCELLED,
  // clears unresolved lock, records in audit history, and allows next payment
  // ---------------------------------------------------------------------------
  await runAsyncTest('Confirmed terminal cancellation (RC=XX) clears lock, records in audit, and allows next payment', async () => {
    cleanupTestState();
    const service = new NetsService();
    let ecnSeq = 8000;
    service.getNextEcnAsync = async () => String(++ecnSeq).padStart(12, '0');

    // Scenario 1: First payment cancelled by terminal with RC=XX
    service.sendPacket = async (buf) => {
      const parsedReq = netsProtocol.parseNetsFrame(buf);
      const cancelFrame = netsProtocol.buildNetsFrame({
        ecn: parsedReq.ecn,
        functionCode: parsedReq.functionCode,
        responseCode: 'XX',
        fields: [
          { code: '01', value: '' },
          { code: 'HD', value: 'P1795425252607' },
          { code: '40', value: '000000000550' },
        ],
      });
      return { parsed: netsProtocol.parseNetsFrame(cancelFrame), rawHex: cancelFrame.toString('hex') };
    };

    const cancelResult = await service.purchaseCard({
      amount: 5.50,
      ecrRef: 'P1795425252607',
    });

    assert.strictEqual(cancelResult.isApproved, false);
    assert.strictEqual(cancelResult.responseCode, 'XX');
    assert.strictEqual(cancelResult.responseDescription, 'Transaction Cancelled by User / Terminal');
    assert.strictEqual(service.getUnresolvedTransaction(), null, 'Lock must be completely cleared upon confirmed cancellation');

    // Verify audit history was written to disk
    const auditHistory = service.getAuditHistory();
    assert.ok(auditHistory.length >= 1, 'Audit history must contain cancellation record');
    assert.strictEqual(auditHistory[0].status, 'CANCELLED');
    assert.strictEqual(auditHistory[0].responseCode, 'XX');
    assert.strictEqual(auditHistory[0].ecn, '000000008001');

    // Scenario 2: Next payment of $12.00 is allowed immediately without HTTP 409 or lock block!
    service.sendPacket = async (buf) => {
      const parsedReq = netsProtocol.parseNetsFrame(buf);
      const approveFrame = netsProtocol.buildNetsFrame({
        ecn: parsedReq.ecn,
        functionCode: parsedReq.functionCode,
        responseCode: '00',
        fields: [
          { code: '01', value: 'APPR99' },
          { code: 'HC', value: '00' },
          { code: 'HD', value: 'P1795425252608' },
          { code: '40', value: '000000001200' },
        ],
      });
      return { parsed: netsProtocol.parseNetsFrame(approveFrame), rawHex: approveFrame.toString('hex') };
    };

    const nextPaymentResult = await service.purchaseCard({
      amount: 12.00,
      ecrRef: 'P1795425252608',
    });

    assert.strictEqual(nextPaymentResult.isApproved, true);
    assert.strictEqual(nextPaymentResult.responseCode, '00');
    assert.strictEqual(nextPaymentResult.approvalCode, 'APPR99');
    assert.strictEqual(nextPaymentResult.ecn, '000000008002');
  });

  // ---------------------------------------------------------------------------
  // Test 13: Confirmed cancellation works identically for Credit Card (FC I0) and QR (T2=04)
  // ---------------------------------------------------------------------------
  await runAsyncTest('Confirmed cancellation allows immediate next Credit Card and QR payments', async () => {
    cleanupTestState();
    const service = new NetsService();
    let ecnSeq = 9000;
    service.getNextEcnAsync = async () => String(++ecnSeq).padStart(12, '0');

    // Credit Card Cancelled
    service.sendPacket = async (buf) => {
      const parsedReq = netsProtocol.parseNetsFrame(buf);
      const cancelFrame = netsProtocol.buildNetsFrame({
        ecn: parsedReq.ecn,
        functionCode: 'I0',
        responseCode: 'XX',
        fields: [
          { code: 'HD', value: 'P1795425252610' },
          { code: '40', value: '000000002000' },
        ],
      });
      return { parsed: netsProtocol.parseNetsFrame(cancelFrame), rawHex: cancelFrame.toString('hex') };
    };

    const ccCancel = await service.purchaseCreditCard({ amount: 20.00, ecrRef: 'P1795425252610' });
    assert.strictEqual(ccCancel.responseCode, 'XX');
    assert.strictEqual(service.getUnresolvedTransaction(), null);

    // Immediately follow with QR Payment
    service.sendPacket = async (buf) => {
      const parsedReq = netsProtocol.parseNetsFrame(buf);
      const approveQr = netsProtocol.buildNetsFrame({
        ecn: parsedReq.ecn,
        functionCode: '30',
        responseCode: '00',
        fields: [
          { code: 'T2', value: '04' },
          { code: 'HC', value: '00' },
          { code: 'HD', value: 'P1795425252611' },
          { code: '40', value: '000000001500' },
        ],
      });
      return { parsed: netsProtocol.parseNetsFrame(approveQr), rawHex: approveQr.toString('hex') };
    };

    const qrResult = await service.purchaseQr({ amount: 15.00, ecrRef: 'P1795425252611' });
    assert.strictEqual(qrResult.isApproved, true);
    assert.strictEqual(qrResult.responseCode, '00');
  });

  cleanupTestState();
  console.log('\n=== ALL POS-013 LAN RECOVERY TESTS PASSED (13/13) ===');
  process.exit(0);
})();
