/**
 * Test Suite: POS-014 - Exception Case: LAN - Transaction Approved (Same ECN Recovery)
 *
 * Test Specification Workflow:
 * 1. POS initiates a NETS CARD transaction with an initial ECN (e.g. 000000016723).
 * 2. Terminal prompts for payment.
 * 3. LAN disconnected on POS side (simulated socket error / ECONNRESET / EUNCERTAIN).
 * 4. Customer presents card and completes payment successfully on the terminal.
 *    Terminal approves the payment and prints receipt.
 * 5. Wait 5s and reconnect POS LAN cable.
 * 6. After timeout, POS must recover the original transaction by:
 *    a) Resending the SAME original purchase request with the SAME ECN (as specified in POS-014), OR
 *    b) Querying FC 56 (Get Last Approved Transaction).
 * 7. Terminal returns the original approved result.
 * 8. POS records transaction as APPROVED, preserves original audit fields, and clears unresolved lock.
 * 9. Neither same-ECN recovery nor subsequent new transactions are blocked.
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
  console.log('=== STARTING POS-014 LAN APPROVED SAME-ECN RECOVERY TESTS ===\n');

  // ---------------------------------------------------------------------------
  // Test 1: Same ECN retry does NOT advance atomic ECN sequence
  // ---------------------------------------------------------------------------
  await runAsyncTest('POS-014: Same ECN retry preserves original ECN and does not increment ECN counter', async () => {
    cleanupTestState();
    const service = new NetsService();
    let currentEcnNum = 16720;
    service.getNextEcnAsync = async () => String(++currentEcnNum).padStart(12, '0');
    service.checkTerminalAvailabilityBeforePurchase = async () => {};

    let dispatchedEcn = null;
    service.sendPacket = async (buf) => {
      // Decode frame to check ECN in header
      const parsed = netsProtocol.parseNetsFrame(buf);
      dispatchedEcn = parsed.ecn;

      const frame = netsProtocol.buildNetsFrame({
        ecn: parsed.ecn,
        functionCode: '30',
        versionCode: '01',
        responseCode: '00',
        fields: [
          { code: '01', value: 'APPR14' },
          { code: 'HC', value: '00' },
          { code: 'HD', value: '1795425252620' },
          { code: '40', value: '000000000500' },
        ],
      });
      return { parsed: netsProtocol.parseNetsFrame(frame), rawHex: frame.toString('hex') };
    };

    const originalEcn = '000000016723';
    const res = await service.purchaseCard({
      amount: 5.0,
      ecrRef: '1795425252620',
      retrySameEcn: originalEcn,
    });

    assert.strictEqual(res.isApproved, true);
    assert.strictEqual(res.ecn, originalEcn, 'Returned ECN must match original retrySameEcn');
    assert.strictEqual(dispatchedEcn, originalEcn, 'Dispatched frame ECN must match original retrySameEcn');
    assert.strictEqual(currentEcnNum, 16720, 'ECN counter must NOT have been incremented');
  });

  // ---------------------------------------------------------------------------
  // Test 2: Full POS-014 cycle: Disconnect -> Unresolved created -> Same ECN retry approved -> Unresolved cleared
  // ---------------------------------------------------------------------------
  await runAsyncTest('POS-014: Disconnect creates unresolved, same-ECN retry returns approved and clears unresolved record', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.config.financialTimeoutMs = 50; // Fast timeout for test
    let ecnCounter = 7000;
    service.getNextEcnAsync = async () => String(++ecnCounter).padStart(12, '0');
    service.config.recoveryInitialDelayMs = 20;
    service.config.recoveryRetryDelayMs = 10;
    service.config.recoveryMaxRetries = 1;
    service.checkTerminalAvailabilityBeforePurchase = async () => {};

    const originalEcn = '000000016723';
    const testRef = '1795425252623';
    const testAmount = 8.5;

    // Step A: First purchase encounters socket error after dispatch
    // In POS-014 test, LAN is disconnected, so terminal recovers or fails inquiry if LAN not yet back
    service.sendPacket = async (buf) => {
      const parsed = netsProtocol.parseNetsFrame(buf);
      if (parsed.functionCode === '30') {
        const sockErr = new Error('read ECONNRESET - LAN cable disconnected');
        sockErr.code = 'ECONNRESET';
        sockErr.requestDispatched = true;
        throw sockErr;
      }
      if (parsed.functionCode === '56') {
        // While LAN is still disconnected, FC 56 also fails
        const inqErr = new Error('connect ETIMEDOUT - LAN disconnected');
        inqErr.code = 'ETIMEDOUT';
        throw inqErr;
      }
      throw new Error('Unexpected function code');
    };

    let caughtErr = null;
    try {
      await service.purchaseCard({
        amount: testAmount,
        ecrRef: testRef,
        retrySameEcn: originalEcn,
      });
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr, 'First attempt must fail due to LAN disconnect');
    assert.strictEqual(caughtErr.code, 'ERECONCILIATIONREQUIRED');

    // Verify unresolved record was created on disk
    const unresBefore = service.loadUnresolvedTransactions();
    assert.strictEqual(unresBefore.length, 1);
    assert.strictEqual(unresBefore[0].ecn, originalEcn);

    // Step B: LAN is reconnected. Cashier/system retries using the SAME original ECN (POS-014 strategy)
    // Terminal now returns the approved result for that ECN
    service.sendPacket = async (buf) => {
      const parsed = netsProtocol.parseNetsFrame(buf);
      assert.strictEqual(parsed.ecn, originalEcn, 'Retry frame must use the same original ECN');
      assert.strictEqual(parsed.functionCode, '30');

      const approvedFrame = netsProtocol.buildNetsFrame({
        ecn: originalEcn,
        functionCode: '30',
        versionCode: '01',
        responseCode: '00',
        fields: [
          { code: '01', value: 'APPR99' },
          { code: 'HC', value: '00' },
          { code: 'HD', value: testRef },
          { code: '40', value: '000000000850' },
          { code: '65', value: '123456' },
          { code: 'D3', value: 'RRN987654' },
          { code: 'RP', value: 'NETS APPROVAL RECEIPT DATA' },
        ],
      });
      return { parsed: netsProtocol.parseNetsFrame(approvedFrame), rawHex: approvedFrame.toString('hex') };
    };

    const recoveryRes = await service.purchaseCard({
      amount: testAmount,
      ecrRef: testRef,
      retrySameEcn: originalEcn,
    });

    assert.strictEqual(recoveryRes.isApproved, true);
    assert.strictEqual(recoveryRes.responseCode, '00');
    assert.strictEqual(recoveryRes.approvalCode, 'APPR99');
    assert.strictEqual(recoveryRes.ecn, originalEcn);

    // Verify that the matching unresolved record was automatically cleared upon approval
    const unresAfter = service.loadUnresolvedTransactions();
    assert.strictEqual(unresAfter.length, 0, 'Matching unresolved record must be cleared after approval');
  });

  // ---------------------------------------------------------------------------
  // Test 3: POS-014 alternative recovery via FC 56 (Last Approved Transaction)
  // ---------------------------------------------------------------------------
  await runAsyncTest('POS-014: FC 56 recovery matches customer approval, returns approved, and clears unresolved entry', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.config.financialTimeoutMs = 50; // Fast timeout for test
    // Test FC 56 strategy specifically
    service.config.autoRetryWithSameEcn = false;
    service.config.lastApprovedQueryOnTimeout = true;
    let ecnCounter = 8000;
    service.getNextEcnAsync = async () => String(++ecnCounter).padStart(12, '0');
    service.config.recoveryInitialDelayMs = 10;
    service.config.recoveryRetryDelayMs = 10;
    service.config.recoveryMaxRetries = 1;
    service.checkTerminalAvailabilityBeforePurchase = async () => {};

    const originalEcn = '000000016724';
    const testRef = '1795425252624';
    const testAmount = 15.0;

    // Simulate LAN disconnect during FC 30, but by the time recovery runs (5s wait), LAN is back
    // and terminal returns the approved transaction via FC 56
    service.sendPacket = async (buf) => {
      const parsed = netsProtocol.parseNetsFrame(buf);
      if (parsed.functionCode === '30') {
        const sockErr = new Error('read ECONNRESET');
        sockErr.code = 'ECONNRESET';
        sockErr.requestDispatched = true;
        throw sockErr;
      }
      if (parsed.functionCode === '56') {
        const approvedInquiry = netsProtocol.buildNetsFrame({
          ecn: parsed.ecn,
          functionCode: '56',
          versionCode: '01',
          responseCode: '00',
          fields: [
            { code: '01', value: 'AUTH88' },
            { code: 'HD', value: testRef },
            { code: '40', value: '000000001500' },
            { code: '65', value: '778899' },
            { code: 'D3', value: 'RRN112233' },
          ],
        });
        return { parsed: netsProtocol.parseNetsFrame(approvedInquiry), rawHex: approvedInquiry.toString('hex') };
      }
      throw new Error(`Unexpected function code ${parsed.functionCode}`);
    };

    // With timeout-driven automatic recovery, the first purchase call waits for the timeout
    // and automatically executes the FC 56 recovery, returning the approved result!
    const res = await service.purchaseCard({
      amount: testAmount,
      ecrRef: testRef,
      retrySameEcn: originalEcn,
    });

    assert.strictEqual(res.isApproved, true);
    assert.strictEqual(res.recovered, true);
    assert.strictEqual(res.ecn, originalEcn);
    assert.strictEqual(res.approvalCode, 'AUTH88');

    // Unresolved record should be cleared
    const unres = service.loadUnresolvedTransactions();
    assert.strictEqual(unres.length, 0);
  });

  // ---------------------------------------------------------------------------
  // Test 4: Same ECN retry for Credit Card (FC I0)
  // ---------------------------------------------------------------------------
  await runAsyncTest('POS-014: Same ECN retry works identically for Credit Card (FC I0)', async () => {
    cleanupTestState();
    const service = new NetsService();
    service.checkTerminalAvailabilityBeforePurchase = async () => {};

    let dispatchedFrame = null;
    service.sendPacket = async (buf) => {
      dispatchedFrame = netsProtocol.parseNetsFrame(buf);
      const approvedFrame = netsProtocol.buildNetsFrame({
        ecn: dispatchedFrame.ecn,
        functionCode: 'I0',
        versionCode: '01',
        responseCode: '00',
        fields: [
          { code: '01', value: 'CCAPPR' },
          { code: 'HC', value: '00' },
          { code: 'HD', value: '1795425252625' },
          { code: '40', value: '000000002000' },
        ],
      });
      return { parsed: netsProtocol.parseNetsFrame(approvedFrame), rawHex: approvedFrame.toString('hex') };
    };

    const ccEcn = '000000016725';
    const res = await service.purchaseCreditCard({
      amount: 20.0,
      ecrRef: '1795425252625',
      retrySameEcn: ccEcn,
    });

    assert.strictEqual(res.isApproved, true);
    assert.strictEqual(res.ecn, ccEcn);
    assert.strictEqual(dispatchedFrame.ecn, ccEcn);
    assert.strictEqual(dispatchedFrame.functionCode, 'I0');
  });

  // ---------------------------------------------------------------------------
  // Test 5: Same ECN retry does not block subsequent independent purchases
  // ---------------------------------------------------------------------------
  await runAsyncTest('POS-014: Approved same-ECN recovery immediately unblocks subsequent new purchases', async () => {
    cleanupTestState();
    const service = new NetsService();
    let currentEcn = 16723;
    service.getNextEcnAsync = async () => String(++currentEcn).padStart(12, '0');
    service.checkTerminalAvailabilityBeforePurchase = async () => {};

    // Simulate an existing unresolved transaction on disk
    service.saveUnresolvedTransaction({
      ecn: '000000016723',
      ecrRef: '1795425252623',
      amount: 5.0,
      amountStr: '000000000500',
      status: 'UNRESOLVED',
    });

    assert.strictEqual(service.loadUnresolvedTransactions().length, 1);

    // Mock terminal to respond to same-ECN retry with approval
    service.sendPacket = async (buf) => {
      const parsed = netsProtocol.parseNetsFrame(buf);
      const frame = netsProtocol.buildNetsFrame({
        ecn: parsed.ecn,
        functionCode: parsed.functionCode,
        versionCode: '01',
        responseCode: '00',
        fields: [
          { code: '01', value: 'APPR_OK' },
          { code: 'HC', value: '00' },
          { code: 'HD', value: parsed.fields['HD'] || 'REF' },
          { code: '40', value: parsed.fields['40'] || '000000000500' },
        ],
      });
      return { parsed: netsProtocol.parseNetsFrame(frame), rawHex: frame.toString('hex') };
    };

    // 1. Recover the unresolved transaction with same ECN
    const recovered = await service.purchaseCard({
      amount: 5.0,
      ecrRef: '1795425252623',
      retrySameEcn: '000000016723',
    });
    assert.strictEqual(recovered.isApproved, true);
    assert.strictEqual(service.loadUnresolvedTransactions().length, 0, 'Unresolved list should now be empty');

    // 2. Immediately initiate a brand-new payment with fresh ECN
    const newTxn = await service.purchaseCard({
      amount: 12.0,
      ecrRef: '1795425252630',
    });
    assert.strictEqual(newTxn.isApproved, true);
    assert.strictEqual(newTxn.ecn, '000000016724', 'Next purchase must advance monotonically from 16723 to 16724');
  });

  cleanupTestState();
  console.log('\n=== ALL POS-014 SAME-ECN RECOVERY TESTS PASSED (5/5) ===');
  process.exit(0);
})();
