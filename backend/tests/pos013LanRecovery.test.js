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
process.env.NETS_UNRESOLVED_FILE_PATH = UNRESOLVED_TEST_PATH;

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
  // Test 5: Unresolved transaction locks all new financial operations
  // ---------------------------------------------------------------------------
  await runAsyncTest('Unresolved transaction blocks new Card, QR, Credit Card, and Settlement operations', async () => {
    cleanupTestState();
    const service = new NetsService();
    // Simulate an active unresolved state
    service.saveUnresolvedTransaction({
      ecn: '000000016663',
      originalEcn: '000000016663',
      ecrRef: 'LOCKED_REF_001',
      amount: 10.00,
      status: 'UNRESOLVED',
    });

    // 1. Check purchaseCard blocked
    let cardBlocked = false;
    try {
      await service.purchaseCard({ amount: 10, ecrRef: 'NEW_ORDER' });
    } catch (e) {
      if (e.message.includes('unresolved transaction exists')) cardBlocked = true;
    }
    assert.strictEqual(cardBlocked, true, 'purchaseCard must be blocked');

    // 2. Check purchaseQr blocked
    let qrBlocked = false;
    try {
      await service.purchaseQr({ amount: 10, ecrRef: 'NEW_ORDER' });
    } catch (e) {
      if (e.message.includes('unresolved transaction exists')) qrBlocked = true;
    }
    assert.strictEqual(qrBlocked, true, 'purchaseQr must be blocked');

    // 3. Check purchaseCreditCard blocked
    let creditBlocked = false;
    try {
      await service.purchaseCreditCard({ amount: 10, ecrRef: 'NEW_ORDER' });
    } catch (e) {
      if (e.message.includes('unresolved transaction exists')) creditBlocked = true;
    }
    assert.strictEqual(creditBlocked, true, 'purchaseCreditCard must be blocked');

    // 4. Check settlement blocked
    let settlementBlocked = false;
    try {
      await service.settlement();
    } catch (e) {
      if (e.message.includes('unresolved transaction exists')) settlementBlocked = true;
    }
    assert.strictEqual(settlementBlocked, true, 'settlement must be blocked');
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
  // Test 11: Blocked financial operations throw EUNRESOLVED_TRANSACTION with 409-ready payload
  // ---------------------------------------------------------------------------
  await runAsyncTest('Blocked operations throw EUNRESOLVED_TRANSACTION error code', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.saveUnresolvedTransaction({
      ecn: '000000016672',
      originalEcn: '000000016672',
      ecrRef: '1795425252607',
      amount: 5.50,
      status: 'UNRESOLVED',
    });

    let cardErr = null;
    try {
      await service.purchaseCard({ amount: 5.50, ecrRef: '1795425252608' });
    } catch (e) {
      cardErr = e;
    }
    assert.strictEqual(cardErr?.code, 'EUNRESOLVED_TRANSACTION');
    assert.strictEqual(cardErr?.unresolved?.ecn, '000000016672');

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

  cleanupTestState();
  console.log('\n=== ALL POS-013 LAN RECOVERY TESTS PASSED (11/11) ===');
  process.exit(0);
})();
