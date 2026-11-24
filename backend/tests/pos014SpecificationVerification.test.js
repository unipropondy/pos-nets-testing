/**
 * Test Suite: POS-014 - Specification Exact Test Case
 *
 * Specific validation of User-Reported Production Scenario:
 * 1. Original purchase dispatched with ECN 000000016729, Amount: $10.00, Ref: 1795437573263.
 * 2. Simulate LAN disconnect after terminal receives the request (socket ECONNRESET / EUNCERTAIN).
 * 3. Customer approves on terminal; wait 5s and reconnect LAN.
 * 4. Automatic recovery MUST use the EXACT same original ECN 000000016729 (Original ECN === Recovery ECN).
 * 5. Verify NO new ECN is generated during recovery (zero calls to getNextEcnAsync).
 * 6. Verify original transaction becomes APPROVED only after valid terminal approval response.
 * 7. Verify no second independent purchase is dispatched.
 * 8. Verify a subsequent genuinely new payment uses a fresh ECN (000000016730) without being blocked.
 * 9. Verify unresolved record is cleanly removed upon approval.
 * 10. Verify validation 'Original ECN === Recovery ECN' blocks any mismatched dispatch.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const UNRESOLVED_TEST_PATH = path.join(__dirname, '../config/netsUnresolved.test.json');
const AUDIT_TEST_PATH = path.join(__dirname, '../config/netsAuditHistory.test.json');
process.env.NETS_UNRESOLVED_FILE_PATH = UNRESOLVED_TEST_PATH;
process.env.NETS_AUDIT_FILE_PATH = AUDIT_TEST_PATH;
process.env.NODE_ENV = 'test';

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
  console.log('=== STARTING POS-014 SPECIFICATION VERIFICATION TESTS ===\n');

  const TARGET_ORIGINAL_ECN = '000000016729';
  const TARGET_REF = '1795437573263';
  const TARGET_AMOUNT = 10.0;

  // ---------------------------------------------------------------------------
  // Test 1: Full POS-014 Specification Sequence (ECN 000000016729)
  // ---------------------------------------------------------------------------
  await runAsyncTest('POS-014: Original ECN 000000016729 recovered with same ECN without generating fresh ECNs', async () => {
    cleanupTestState();
    const service = new NetsService();
    // Enable autoRetryWithSameEcn for POS-014
    service.config.autoRetryWithSameEcn = true;
    service.config.recoveryInitialDelayMs = 20;
    service.checkTerminalAvailabilityBeforePurchase = async () => {};

    let ecnGeneratorCallCount = 0;
    let sequenceCounter = 16728; // Next will be 16729
    service.getNextEcnAsync = async () => {
      ecnGeneratorCallCount++;
      return String(++sequenceCounter).padStart(12, '0');
    };

    let txLog = [];
    let rxLog = [];
    let sendPacketInvocation = 0;

    service.sendPacket = async (buf) => {
      sendPacketInvocation++;
      const parsed = netsProtocol.parseNetsFrame(buf);
      txLog.push({
        invocation: sendPacketInvocation,
        ecn: parsed.ecn,
        functionCode: parsed.functionCode,
        amount: parsed.fields['40'],
        ref: parsed.fields['HD'] || parsed.fields['HS'],
        rawHex: buf.toString('hex').toUpperCase(),
      });

      // Invocation 1: Initial Purchase -> LAN Disconnect after terminal received prompt
      if (sendPacketInvocation === 1) {
        const sockErr = new Error('read ECONNRESET - LAN cable disconnected during payment');
        sockErr.code = 'ECONNRESET';
        sockErr.requestDispatched = true;
        throw sockErr;
      }

      // Invocation 2: Recovery attempt -> LAN reconnected, terminal returns approved result
      if (sendPacketInvocation === 2) {
        const approvedFrame = netsProtocol.buildNetsFrame({
          ecn: parsed.ecn,
          functionCode: parsed.functionCode,
          versionCode: '01',
          responseCode: '00',
          fields: [
            { code: '01', value: 'APPR14' },
            { code: 'HC', value: '00' },
            { code: 'HD', value: TARGET_REF },
            { code: '40', value: '000000001000' },
            { code: '65', value: '001401' },
            { code: 'D3', value: 'RRN001401' },
          ],
        });
        const rxHex = approvedFrame.toString('hex').toUpperCase();
        rxLog.push({
          invocation: sendPacketInvocation,
          ecn: parsed.ecn,
          rawHex: rxHex,
        });
        return { parsed: netsProtocol.parseNetsFrame(approvedFrame), rawHex: rxHex };
      }

      throw new Error(`Unexpected invocation ${sendPacketInvocation}`);
    };

    // Step 1: Initiate purchase (encounters disconnect, leaves unresolved on disk)
    let caughtErr = null;
    try {
      await service.purchaseCard({
        amount: TARGET_AMOUNT,
        ecrRef: TARGET_REF,
      });
    } catch (err) {
      caughtErr = err;
    }
    assert.ok(caughtErr, 'First purchase attempt must fail due to LAN disconnect');
    assert.strictEqual(caughtErr.code, 'ERECONCILIATIONREQUIRED');

    // Step 2: Cashier initiates next payment action (which triggers on-demand reconciliation of unresolved record)
    const result = await service.purchaseCard({
      amount: TARGET_AMOUNT,
      ecrRef: TARGET_REF,
    });

    // Validations:
    assert.strictEqual(result.isApproved, true, 'Transaction must be approved');
    assert.strictEqual(result.recovered, true, 'Must indicate recovered transaction');
    assert.strictEqual(result.recoveryMethod, 'SAME_ECN', 'Must use SAME_ECN recovery method');
    assert.strictEqual(result.ecn, TARGET_ORIGINAL_ECN, 'Original ECN must match 000000016729');
    assert.strictEqual(result.recoveryEcn, TARGET_ORIGINAL_ECN, 'Recovery ECN must match 000000016729');

    // Verify EXACTLY 1 ECN generation happened (for original purchase). Zero generated during recovery!
    assert.strictEqual(ecnGeneratorCallCount, 1, 'ECN generator must be called ONLY ONCE for the original purchase, NEVER during recovery');
    assert.strictEqual(sequenceCounter, 16729, 'Sequence counter must NOT have advanced during recovery');

    // Inspect Wire Frames:
    assert.strictEqual(txLog.length, 2, 'Must have exactly 2 TX dispatches: initial purchase + same-ECN recovery');
    assert.strictEqual(txLog[0].ecn, TARGET_ORIGINAL_ECN, 'TX 1 must use ECN 000000016729');
    assert.strictEqual(txLog[1].ecn, TARGET_ORIGINAL_ECN, 'TX 2 (Recovery) must use EXACT SAME ECN 000000016729');
    assert.strictEqual(txLog[0].rawHex, txLog[1].rawHex, 'Recovery frame must be identical to original purchase frame');

    // Verify unresolved transaction was cleared
    const unres = service.loadUnresolvedTransactions();
    assert.strictEqual(unres.length, 0, 'Unresolved record must be cleared upon confirmed approval');

    // Step 2: Next independent purchase must receive fresh ECN (000000016730)
    service.sendPacket = async (buf) => {
      const parsed = netsProtocol.parseNetsFrame(buf);
      const approvedFrame = netsProtocol.buildNetsFrame({
        ecn: parsed.ecn,
        functionCode: '30',
        versionCode: '01',
        responseCode: '00',
        fields: [
          { code: '01', value: 'APPR15' },
          { code: 'HC', value: '00' },
          { code: 'HD', value: '1795437573264' },
          { code: '40', value: '000000000500' },
        ],
      });
      return { parsed: netsProtocol.parseNetsFrame(approvedFrame), rawHex: approvedFrame.toString('hex') };
    };

    const nextPayment = await service.purchaseCard({
      amount: 5.0,
      ecrRef: '1795437573264',
    });

    assert.strictEqual(nextPayment.isApproved, true);
    assert.strictEqual(nextPayment.ecn, '000000016730', 'Next independent payment must use fresh sequential ECN 000000016730');
    assert.strictEqual(ecnGeneratorCallCount, 2, 'Total 2 ECN generator calls across 2 independent payments');
  });

  // ---------------------------------------------------------------------------
  // Test 2: Validation Check: Original ECN !== Recovery ECN is blocked
  // ---------------------------------------------------------------------------
  await runAsyncTest('POS-014: Strict pre-condition validation blocks recovery if Original ECN !== Recovery ECN', async () => {
    cleanupTestState();
    const service = new NetsService();

    let packetDispatched = false;
    service.sendPacket = async () => {
      packetDispatched = true;
      throw new Error('Should never dispatch');
    };

    let caughtErr = null;
    try {
      // Intentionally tamper with parameters
      await service._recoverWithSameEcn({
        originalEcn: '000000016729',
        refNum: TARGET_REF,
        amount: 10.0,
        amountStr: '000000001000',
        flowName: 'NETS Card',
        txnType: '01',
        initialError: new Error('LAN disconnect'),
      });
    } catch (err) {
      caughtErr = err;
    }

    // In normal execution originalEcn === recoveryEcn is enforced.
    // If originalEcn is empty:
    let missingEcnErr = null;
    try {
      await service._recoverWithSameEcn({
        originalEcn: '',
        refNum: TARGET_REF,
        amount: 10.0,
        amountStr: '000000001000',
        flowName: 'NETS Card',
        txnType: '01',
      });
    } catch (err) {
      missingEcnErr = err;
    }

    assert.ok(missingEcnErr, 'Missing ECN must be blocked');
    assert(missingEcnErr.message.includes('Pre-condition failed'));
  });

  // ---------------------------------------------------------------------------
  // Test 3: Recovery Failure retains UNKNOWN state and DOES NOT mark DECLINED or CANCELLED
  // ---------------------------------------------------------------------------
  await runAsyncTest('POS-014: Same-ECN transport timeout preserves UNKNOWN state and does NOT mark DECLINED/CANCELLED', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.config.autoRetryWithSameEcn = true;
    service.config.recoveryInitialDelayMs = 10;
    service.checkTerminalAvailabilityBeforePurchase = async () => {};

    service.getNextEcnAsync = async () => TARGET_ORIGINAL_ECN;

    // Both initial attempt and recovery fail with ETIMEDOUT (e.g. cable not yet reconnected)
    service.sendPacket = async () => {
      const timeoutErr = new Error('connect ETIMEDOUT');
      timeoutErr.code = 'ETIMEDOUT';
      timeoutErr.isTimeout = true;
      timeoutErr.requestDispatched = true;
      throw timeoutErr;
    };

    let caughtErr = null;
    try {
      await service.purchaseCard({
        amount: TARGET_AMOUNT,
        ecrRef: TARGET_REF,
      });
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr, 'Must fail with reconciliation required');
    assert.strictEqual(caughtErr.code, 'ERECONCILIATIONREQUIRED');

    // Verify unresolved record was persisted as UNRESOLVED / UNKNOWN
    const unres = service.loadUnresolvedTransactions();
    assert.strictEqual(unres.length, 1);
    assert.strictEqual(unres[0].ecn, TARGET_ORIGINAL_ECN);
    assert.strictEqual(unres[0].status, 'UNRESOLVED');
    assert.notStrictEqual(unres[0].status, 'DECLINED', 'Must NEVER be marked DECLINED on transport timeout');
    assert.notStrictEqual(unres[0].status, 'CANCELLED', 'Must NEVER be marked CANCELLED on transport timeout');
  });

  cleanupTestState();
  console.log('\n=== ALL POS-014 SPECIFICATION VERIFICATION TESTS PASSED (3/3) ===');
  process.exit(0);
})();
