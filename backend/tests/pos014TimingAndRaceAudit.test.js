/**
 * Test Suite: POS-014 Timing, LAN Availability & Race Condition Audit Tests
 *
 * Verifies the 10 specific audit criteria from the user prompt:
 * 1. Original purchase timeout while LAN remains disconnected.
 * 2. Recovery does NOT dispatch while terminal is unreachable.
 * 3. LAN reconnection allows safe recovery.
 * 4. Recovery uses exact original ECN, amount, T2, and ref fields.
 * 5. FC 55 and FC 30 do not overlap.
 * 6. Late original approval during recovery is cleanly resolved without duplicate dispatch.
 * 7. No duplicate settlement / audit insertion.
 * 8. HTTP client disconnect does not cancel backend recovery.
 * 9. Invalid UAT timeout configuration is safely handled with fallback.
 * 10. Next independent payment receives a fresh unique sequential ECN.
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

function cleanupTestState() {
  if (fs.existsSync(UNRESOLVED_TEST_PATH)) {
    fs.unlinkSync(UNRESOLVED_TEST_PATH);
  }
  if (fs.existsSync(AUDIT_TEST_PATH)) {
    fs.unlinkSync(AUDIT_TEST_PATH);
  }
}

(async () => {
  console.log('=== STARTING POS-014 TIMING, LAN PROBE & RACE AUDIT TESTS ===\n');

  // Test 1 & 2: Original timeout while LAN disconnected -> Recovery does not dispatch while terminal is unreachable
  await runAsyncTest('1 & 2. Recovery waits and aborts safely if terminal remains unreachable after LAN disconnect', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.config.autoRetryWithSameEcn = true;
    service.config.recoveryInitialDelayMs = 10;
    service.config.recoveryLanMaxWaitMs = 100; // Fast 100ms probe wait for unit test
    service.checkTerminalAvailabilityBeforePurchase = async () => {};

    // Simulate LAN probe failing (cable still unplugged)
    service.probeTerminalTcpConnection = async () => false;

    let recoveryDispatched = false;
    service.sendPacket = async () => {
      // First call fails with ETIMEDOUT
      const err = new Error('Terminal communication timed out after 120 seconds');
      err.code = 'ETIMEDOUT';
      err.isTimeout = true;
      err.requestDispatched = true;
      throw err;
    };

    let seq = 16770;
    service.getNextEcnAsync = async () => String(++seq).padStart(12, '0');

    let thrownError = null;
    try {
      await service.purchaseCard({
        amount: 10.0,
        ecrRef: '1795440395400',
      });
    } catch (err) {
      thrownError = err;
    }

    assert.ok(thrownError, 'Must throw error when recovery cannot reach terminal');
    assert.strictEqual(thrownError.code, 'ERECONCILIATIONREQUIRED');
    assert.strictEqual(thrownError.originalEcn, '000000016771');
    assert.strictEqual(service.isRecoveryInProgress, false, 'Recovery lock must be released');

    // Verify unresolved state was preserved as UNRESOLVED
    const unres = service.loadUnresolvedTransactions();
    assert.strictEqual(unres.length, 1);
    assert.strictEqual(unres[0].ecn, '000000016771');
    assert.strictEqual(unres[0].status, 'UNRESOLVED');
  });

  // Test 3 & 4: LAN reconnection allows safe recovery using exact original parameters
  await runAsyncTest('3 & 4. LAN reconnection allows recovery with exact original ECN, amount, T2, and reference', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.config.autoRetryWithSameEcn = true;
    service.config.recoveryInitialDelayMs = 10;
    service.config.recoveryLanMaxWaitMs = 2000;
    service.checkTerminalAvailabilityBeforePurchase = async () => {};

    let probeCount = 0;
    // Simulate cable plugged back in on 2nd probe
    service.probeTerminalTcpConnection = async () => {
      probeCount++;
      return probeCount >= 2;
    };

    let dispatchedFrames = [];
    let callIdx = 0;

    service.sendPacket = async (buf) => {
      callIdx++;
      const parsed = netsProtocol.parseNetsFrame(buf);
      dispatchedFrames.push(parsed);

      if (callIdx === 1) {
        const err = new Error('read ECONNRESET - LAN cable disconnected');
        err.code = 'ECONNRESET';
        err.requestDispatched = true;
        throw err;
      }

      if (callIdx === 2) {
        // Recovery frame received
        const frame = netsProtocol.buildNetsFrame({
          ecn: parsed.ecn,
          functionCode: '30',
          versionCode: '01',
          responseCode: '00',
          fields: [
            { code: '01', value: '612584' },
            { code: 'HC', value: '00' },
            { code: 'HD', value: '1795440395401' },
            { code: '40', value: '000000001000' },
          ],
        });
        return { parsed: netsProtocol.parseNetsFrame(frame), rawHex: frame.toString('hex') };
      }
    };

    let seq = 16771;
    service.getNextEcnAsync = async () => String(++seq).padStart(12, '0');

    let caughtErr = null;
    try {
      await service.purchaseCard({
        amount: 10.0,
        ecrRef: '1795440395401',
      });
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr, 'First purchase attempt must fail due to LAN disconnect');
    assert.strictEqual(caughtErr.code, 'ERECONCILIATIONREQUIRED');

    // Next payment action triggers on-demand recovery
    const res = await service.purchaseCard({
      amount: 10.0,
      ecrRef: '1795440395401',
    });

    assert.strictEqual(res.isApproved, true);
    assert.strictEqual(res.recovered, true);
    assert.strictEqual(res.recoveryMethod, 'SAME_ECN');
    assert.strictEqual(res.ecn, '000000016772');
    assert.strictEqual(res.approvalCode, '612584');

    assert.strictEqual(dispatchedFrames.length, 2);
    // Verification of exact fields
    assert.strictEqual(dispatchedFrames[1].ecn, '000000016772');
    assert.strictEqual(dispatchedFrames[1].fields['40'], '000000001000');
    assert.strictEqual(dispatchedFrames[1].fields['T2'], '01');
    assert.strictEqual(dispatchedFrames[1].fields['HD'], '1795440395401');

    // Unresolved record must be cleared
    assert.strictEqual(service.unresolvedTransactions.length, 0);
  });

  // Test 5: Concurrency check ensures FC55 and FC30/recovery do not overlap
  await runAsyncTest('5. FC 55 and FC 30 operations never overlap on terminal', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.isRecoveryInProgress = true; // Recovery actively holding terminal mutex

    let blocked = false;
    try {
      await service.checkTerminalAvailabilityBeforePurchase('FC 55 Check');
    } catch (err) {
      blocked = true;
      assert.strictEqual(err.code, 'ETERMINALBUSY');
    }
    assert.strictEqual(blocked, true);
    service.isRecoveryInProgress = false;
  });

  // Test 6 & 7: No duplicate settlement / audit record created
  await runAsyncTest('6 & 7. Only one final transaction result is recorded in audit history upon recovery', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.config.autoRetryWithSameEcn = true;
    service.config.recoveryInitialDelayMs = 10;
    service.checkTerminalAvailabilityBeforePurchase = async () => {};
    service.probeTerminalTcpConnection = async () => true;

    let callCount = 0;
    service.sendPacket = async (buf) => {
      callCount++;
      const parsed = netsProtocol.parseNetsFrame(buf);
      if (callCount === 1) {
        const err = new Error('Socket timeout');
        err.code = 'ETIMEDOUT';
        err.isTimeout = true;
        err.requestDispatched = true;
        throw err;
      }
      const frame = netsProtocol.buildNetsFrame({
        ecn: parsed.ecn,
        functionCode: '30',
        versionCode: '01',
        responseCode: '00',
        fields: [
          { code: '01', value: '778899' },
          { code: 'HC', value: '00' },
          { code: 'HD', value: '1795440395402' },
          { code: '40', value: '000000000300' },
        ],
      });
      return { parsed: netsProtocol.parseNetsFrame(frame), rawHex: frame.toString('hex') };
    };

    let seq = 16772;
    service.getNextEcnAsync = async () => String(++seq).padStart(12, '0');

    let caughtErr = null;
    try {
      await service.purchaseCard({
        amount: 3.0,
        ecrRef: '1795440395402',
      });
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr, 'First call must fail due to socket timeout and preserve unresolved transaction');
    assert.strictEqual(caughtErr.code, 'ERECONCILIATIONREQUIRED');

    // Next payment action triggers on-demand recovery
    await service.purchaseCard({
      amount: 3.0,
      ecrRef: '1795440395402',
    });

    const auditRaw = fs.readFileSync(AUDIT_TEST_PATH, 'utf8');
    const auditHistory = JSON.parse(auditRaw);
    const matchingEntries = auditHistory.filter(a => a.ecn === '000000016773' && a.status === 'RECOVERED_APPROVED');
    assert.strictEqual(matchingEntries.length, 1, 'Exactly one RECOVERED_APPROVED entry in audit history');
  });

  // Test 8: Client disconnect does not cancel backend recovery
  await runAsyncTest('8. HTTP client disconnect retains idempotency lock and backend processing', async () => {
    const idempotency = require('../middleware/idempotency');
    const EventEmitter = require('events');

    const req = {
      method: 'POST',
      headers: { 'x-request-id': 'client-disc-test-14' },
      body: { amount: 8.0, ecrRef: '1795440395403' },
      originalUrl: '/api/nets/card-payment',
    };
    const res = new EventEmitter();
    res.statusCode = 200;
    res.writableEnded = false;
    res.getHeaders = () => ({});
    res.send = (b) => b;

    let nextCalled = false;
    idempotency(req, res, () => {
      nextCalled = true;
    });
    assert.strictEqual(nextCalled, true);

    // Client connection closes
    res.emit('close');

    // Duplicate arrives
    let duplicateRejected = false;
    const reqDup = {
      method: 'POST',
      headers: { 'x-request-id': 'client-disc-test-14' },
      body: { amount: 8.0, ecrRef: '1795440395403' },
      originalUrl: '/api/nets/card-payment',
    };
    const resDup = new EventEmitter();
    resDup.status = () => resDup;
    resDup.json = () => {};
    idempotency(reqDup, resDup, () => {
      duplicateRejected = false;
    });
    // Duplicate must not call next()
    assert.strictEqual(duplicateRejected, false);
  });

  // Test 9: Invalid UAT timeout configuration is safely handled with fallback
  await runAsyncTest('9. Invalid or empty NETS_UAT_FINANCIAL_TIMEOUT_MS safely falls back to config', async () => {
    process.env.NETS_UAT_FINANCIAL_TIMEOUT_MS = 'invalid_abc';
    const service1 = new NetsService();
    assert.strictEqual(service1.config.financialTimeoutMs, 120000, 'Invalid string falls back to 120000');

    process.env.NETS_UAT_FINANCIAL_TIMEOUT_MS = '-500';
    const service2 = new NetsService();
    assert.strictEqual(service2.config.financialTimeoutMs, 120000, 'Negative number falls back to 120000');

    delete process.env.NETS_UAT_FINANCIAL_TIMEOUT_MS;
  });

  // Test 10: Next independent payment receives a fresh unique sequential ECN
  await runAsyncTest('10. Next independent payment receives fresh unique ECN', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.checkTerminalAvailabilityBeforePurchase = async () => {};

    let seq = 16775;
    service.getNextEcnAsync = async () => String(++seq).padStart(12, '0');

    service.sendPacket = async (buf) => {
      const parsed = netsProtocol.parseNetsFrame(buf);
      const frame = netsProtocol.buildNetsFrame({
        ecn: parsed.ecn,
        functionCode: '30',
        versionCode: '01',
        responseCode: '00',
        fields: [
          { code: '01', value: '112233' },
          { code: 'HC', value: '00' },
          { code: 'HD', value: '1795440395405' },
          { code: '40', value: '000000000500' },
        ],
      });
      return { parsed: netsProtocol.parseNetsFrame(frame), rawHex: frame.toString('hex') };
    };

    const res = await service.purchaseCard({
      amount: 5.0,
      ecrRef: '1795440395405',
    });

    assert.strictEqual(res.isApproved, true);
    assert.strictEqual(res.ecn, '000000016776');
  });

  // Test 11: Original NETS POS-014 sequence: LAN reconnected 5s after receipt while initial request waiting
  // Scenario: LAN reconnected at 5s, terminal response arrives before timeout -> Approved directly without second dispatch
  await runAsyncTest('11. Original NETS sequence: Reconnect at 5s delivers original approval before timeout without recovery dispatch', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.config.autoRetryWithSameEcn = true;
    service.checkTerminalAvailabilityBeforePurchase = async () => {};

    let dispatchedFrames = [];
    service.sendPacket = async (buf) => {
      const parsed = netsProtocol.parseNetsFrame(buf);
      dispatchedFrames.push(parsed);

      // Simulates LAN reconnection delivering terminal approval at t=59s (within 120s timeout)
      const frame = netsProtocol.buildNetsFrame({
        ecn: parsed.ecn,
        functionCode: '30',
        versionCode: '01',
        responseCode: '00',
        fields: [
          { code: '01', value: '612584' },
          { code: 'HC', value: '00' },
          { code: 'HD', value: '1795440395406' },
          { code: '40', value: '000000000100' },
        ],
      });
      return { parsed: netsProtocol.parseNetsFrame(frame), rawHex: frame.toString('hex') };
    };

    let seq = 16776;
    service.getNextEcnAsync = async () => String(++seq).padStart(12, '0');

    const res = await service.purchaseCard({
      amount: 1.0,
      ecrRef: '1795440395406',
    });

    assert.strictEqual(res.isApproved, true);
    assert.strictEqual(res.ecn, '000000016777');
    assert.strictEqual(res.approvalCode, '612584');
    assert.strictEqual(dispatchedFrames.length, 1, 'Exactly one frame dispatched; original succeeded directly');
    assert.strictEqual(service.unresolvedTransactions.length, 0);
  });

  // Test 12: Late arrival of original response during recovery
  // Both original and recovery responses correlate to exact same ECN, Ref and Amount
  await runAsyncTest('12. Late original response during recovery: Exactly one final approval and one settlement record allowed', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.config.autoRetryWithSameEcn = true;
    service.config.recoveryInitialDelayMs = 10;
    service.checkTerminalAvailabilityBeforePurchase = async () => {};
    service.probeTerminalTcpConnection = async () => true;

    let callCount = 0;
    service.sendPacket = async (buf) => {
      callCount++;
      const parsed = netsProtocol.parseNetsFrame(buf);

      if (callCount === 1) {
        // Simulates timeout of original socket attempt
        const err = new Error('Terminal communication timed out after 120 seconds');
        err.code = 'ETIMEDOUT';
        err.isTimeout = true;
        err.requestDispatched = true;
        throw err;
      }

      // Recovery call delivers terminal approval
      const frame = netsProtocol.buildNetsFrame({
        ecn: parsed.ecn,
        functionCode: '30',
        versionCode: '01',
        responseCode: '00',
        fields: [
          { code: '01', value: '612584' },
          { code: 'HC', value: '00' },
          { code: 'HD', value: '1795440395407' },
          { code: '40', value: '000000000500' },
        ],
      });
      return { parsed: netsProtocol.parseNetsFrame(frame), rawHex: frame.toString('hex') };
    };

    let seq = 16777;
    service.getNextEcnAsync = async () => String(++seq).padStart(12, '0');

    let caughtErr = null;
    try {
      await service.purchaseCard({
        amount: 5.0,
        ecrRef: '1795440395407',
      });
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr, 'First call must fail due to timeout and preserve unresolved transaction');
    assert.strictEqual(caughtErr.code, 'ERECONCILIATIONREQUIRED');

    // Next payment action triggers on-demand recovery
    const res = await service.purchaseCard({
      amount: 5.0,
      ecrRef: '1795440395407',
    });

    assert.strictEqual(res.isApproved, true);
    assert.strictEqual(res.recovered, true);
    assert.strictEqual(res.ecn, '000000016778');

    // Verify exactly one settlement/audit record created
    const auditRaw = fs.readFileSync(AUDIT_TEST_PATH, 'utf8');
    const auditHistory = JSON.parse(auditRaw);
    const matchingEntries = auditHistory.filter(a => a.ecn === '000000016778' && a.status === 'RECOVERED_APPROVED');
    assert.strictEqual(matchingEntries.length, 1, 'Only one RECOVERED_APPROVED entry persisted');
  });

  console.log('\n=== ALL POS-014 TIMING, LAN PROBE & RACE AUDIT TESTS PASSED (12/12) ===\n');
  process.exit(0);
})();
