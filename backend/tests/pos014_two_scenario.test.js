/**
 * Verification Test: Two-Scenario Payment Handling with Strict Manual Recovery (POS-014)
 *
 * SCENARIO A: Terminal Remains Connected, Customer Payment Is Delayed
 * 1. Cashier clicks Pay once.
 * 2. Backend sends original FC30 request.
 * 3. Keeps request active for configured 120,000ms financial timeout.
 * 4. Customer takes time (PIN/card tap); backend continues waiting without starting recovery.
 * 5. Delayed valid approval response arrives within 120s.
 * 6. Backend processes approval normally and closes POS bill.
 * 7. No recovery frame (FC30 or FC56) is sent.
 *
 * SCENARIO B: Terminal Disconnects and Reconnects During Payment
 * 1. Cashier clicks Pay once -> original FC30 sent.
 * 2. Terminal disconnects mid-flight (LAN drop / socket reset).
 * 3. LAN reconnect must NOT trigger automatic recovery.
 * 4. Backend preserves original transaction identity and waits out the 120s timeout.
 * 5. If no response arrives before 120s, marks UNRESOLVED and returns ERECONCILIATIONREQUIRED (409 Conflict).
 * 6. Second cashier Pay click:
 *    - Detects unresolved transaction (ECN 17624, Ref 1795516210049, Amt $1.00).
 *    - Dispatches recovery tagged with Source=CASHIER_SECOND_PAY.
 *    - Checks approval via same-ECN FC30 retry or FC56 inquiry.
 *    - Completes original POS bill exactly once when terminal confirms approval.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const UNRESOLVED_TEST_PATH = path.join(__dirname, '../config/test_nets_unresolved_twoscenario.json');
const AUDIT_TEST_PATH = path.join(__dirname, '../config/test_nets_audit_twoscenario.json');
process.env.NETS_UNRESOLVED_FILE_PATH = UNRESOLVED_TEST_PATH;
process.env.NETS_AUDIT_FILE_PATH = AUDIT_TEST_PATH;
process.env.NODE_ENV = 'test';

const { NetsService } = require('../services/nets.service');

function cleanupFiles() {
  if (fs.existsSync(UNRESOLVED_TEST_PATH)) {
    try { fs.unlinkSync(UNRESOLVED_TEST_PATH); } catch (e) {}
  }
  if (fs.existsSync(AUDIT_TEST_PATH)) {
    try { fs.unlinkSync(AUDIT_TEST_PATH); } catch (e) {}
  }
}

async function runTwoScenarioTests() {
  console.log('===============================================================');
  console.log('🧪 NETS POS-014 TWO-SCENARIO VERIFICATION TEST SUITE');
  console.log('===============================================================\n');

  cleanupFiles();

  try {
    // -------------------------------------------------------------------------
    // TEST SCENARIO A: Terminal Connected, Customer Delayed Payment (Valid Approval)
    // -------------------------------------------------------------------------
    console.log('Test Scenario A: Customer delayed payment within 120s timeout window...');
    const serviceA = new NetsService();
    serviceA.checkTerminalAvailabilityBeforePurchase = async () => {};
    let ecnSeqA = 17623;
    serviceA.getNextEcnAsync = async () => String(++ecnSeqA).padStart(12, '0');

    const dispatchedPacketsA = [];

    // Mock terminal behavior: customer takes time before tapping card / entering PIN
    serviceA.sendPacket = async function (frame, timeoutMs, onProgress, meta) {
      const fc = frame.slice(14, 16).toString('ascii');
      dispatchedPacketsA.push({ fc, timeoutMs, meta });

      assert.strictEqual(timeoutMs >= 120000, true, 'Original FC30 must enforce >= 120,000ms financial timeout');

      // Simulate customer thinking / PIN entry delay
      await new Promise(r => setTimeout(r, 100));

      // Return valid approval from terminal (RC=00)
      return {
        socketId: 'SOCK_DELAYED_APPROVAL',
        rawHex: '003000',
        parsed: {
          responseCode: '00',
          responseDescription: 'Approved',
          approvalCode: 'AUTH_SCENARIO_A',
          isApproved: true,
          fields: {
            '01': 'AUTH_SCENARIO_A',
            '65': '000123',
            'D3': 'RRN_SCENARIO_A',
          },
        },
      };
    };

    const resA = await serviceA.purchaseCard({
      amount: 10.00,
      ecrRef: 'REF_SCENARIO_A',
      isCashierInitiated: true,
      requestId: 'REQ_SCENARIO_A_1',
      triggerSource: 'CASHIER_CLICK',
    });

    assert.strictEqual(resA.isApproved, true, 'Delayed payment within 120s must be approved');
    assert.strictEqual(resA.approvalCode, 'AUTH_SCENARIO_A');
    assert.strictEqual(dispatchedPacketsA.length, 1, 'Exactly one FC30 sent, no duplicate frames');
    assert.strictEqual(dispatchedPacketsA[0].fc, '30');

    const unresA = serviceA.loadUnresolvedTransactions();
    assert.strictEqual(unresA.length, 0, 'No unresolved record created for approved transaction');
    console.log('  ✓ Scenario A passed: Delayed customer payment accepted normally, 0 recovery frames sent.\n');

    // -------------------------------------------------------------------------
    // TEST SCENARIO B: LAN Disconnect & Reconnect -> Timeout -> Second Pay Click Recovery
    // -------------------------------------------------------------------------
    console.log('Test Scenario B: Terminal disconnects in-flight -> 120s timeout -> Cashier Second Pay Click Recovery...');
    const serviceB = new NetsService();
    serviceB.checkTerminalAvailabilityBeforePurchase = async () => {};
    let ecnSeqB = 17624;
    serviceB.getNextEcnAsync = async () => String(ecnSeqB).padStart(12, '0');

    // Part 1: First Pay click disconnects mid-flight
    const dispatchedPacketsB = [];
    serviceB.sendPacket = async function (frame, timeoutMs, onProgress, meta) {
      const fc = frame.slice(14, 16).toString('ascii');
      dispatchedPacketsB.push({ fc, timeoutMs, meta });

      // Immediate socket disconnect while request in-flight
      const resetErr = new Error('ECONNRESET: LAN cable unplugged');
      resetErr.code = 'ECONNRESET';
      resetErr.requestDispatched = true;
      throw resetErr;
    };

    // Fast target timeout for unit test execution speed
    serviceB.config.financialTimeoutMs = 50;

    let scenarioBError = null;
    try {
      await serviceB.purchaseCard({
        amount: 1.00,
        ecrRef: '1795516210049',
        isCashierInitiated: true,
        requestId: 'REQ_SCENARIO_B_1',
        triggerSource: 'CASHIER_CLICK',
      });
    } catch (err) {
      scenarioBError = err;
    }

    assert.strictEqual(scenarioBError !== null, true, 'First purchase must fail/time out');
    assert.strictEqual(scenarioBError.code, 'ERECONCILIATIONREQUIRED');
    assert.strictEqual(dispatchedPacketsB.length, 1, 'Only original FC30 sent; NO automatic recovery on disconnect/timeout');

    // Verify unresolved record persisted
    const unresB = serviceB.loadUnresolvedTransactions();
    assert.strictEqual(unresB.length, 1, 'Unresolved record must be persisted after timeout');
    assert.strictEqual(unresB[0].ecrRef, '1795516210049');
    assert.strictEqual(unresB[0].status, 'UNRESOLVED');
    console.log('  ✓ Scenario B (Part 1): In-flight disconnect waited out deadline, marked UNRESOLVED without auto-retry.');

    // Part 2: LAN reconnect simulation
    // LAN reconnect probe must NOT send any application frames
    const probeRes = await serviceB.probeTerminalTcpConnection();
    assert.strictEqual(probeRes, true);
    assert.strictEqual(dispatchedPacketsB.length, 1, 'LAN reconnect probe must not dispatch recovery frames');
    console.log('  ✓ Scenario B (Part 2): LAN reconnection triggered zero recovery frames.');

    // Part 3: Cashier Second Pay Click triggers reconciliation
    // Cashier clicks Pay again on the POS screen.
    // Terminal confirms previous transaction was approved on the terminal!
    const recoveryPackets = [];
    serviceB.config.financialTimeoutMs = 120000;
    serviceB.config.recoveryInitialDelayMs = 0; // Immediate for test

    serviceB.sendPacket = async function (frame, timeoutMs, onProgress, meta) {
      const fc = frame.slice(14, 16).toString('ascii');
      recoveryPackets.push({ fc, timeoutMs, meta, hex: frame.toString('hex').toUpperCase() });

      // First recovery attempt: same-ECN FC30 returns approved
      return {
        socketId: 'SOCK_RECOVERY_APPROVED',
        rawHex: '003000',
        parsed: {
          responseCode: '00',
          responseDescription: 'Approved',
          approvalCode: 'AUTH_RECOVERED_17624',
          isApproved: true,
          fields: {
            '01': 'AUTH_RECOVERED_17624',
            '65': '000999',
            'D3': 'RRN_RECOVERED_17624',
          },
        },
      };
    };

    const secondPayResult = await serviceB.purchaseCard({
      amount: 1.00,
      ecrRef: '1795516210049',
      isCashierInitiated: true,
      cashierActionToken: 'TOKEN_SECOND_PAY_17624',
      requestId: 'REQ_SCENARIO_B_2',
      triggerSource: 'CASHIER_CLICK',
    });

    assert.strictEqual(secondPayResult.isApproved, true, 'Second cashier click must retrieve approved transaction');
    assert.strictEqual(secondPayResult.approvalCode, 'AUTH_RECOVERED_17624');
    assert.strictEqual(secondPayResult.recovered, true, 'Result marked as recovered');
    assert.strictEqual(recoveryPackets.length, 1, 'Recovery FC30 sent once and approved');
    assert.strictEqual(recoveryPackets[0].fc, '30');

    // Verify unresolved record was safely cleaned upon confirmed approval
    const unresAfterB = serviceB.loadUnresolvedTransactions();
    assert.strictEqual(unresAfterB.length, 0, 'Unresolved record cleared upon conclusive recovery approval');
    console.log('  ✓ Scenario B (Part 3): Second Cashier Pay click retrieved approval, cleared unresolved state, prevented double charge.\n');

    console.log('===============================================================');
    console.log('🎉 BOTH SCENARIO A AND SCENARIO B FULLY VERIFIED AND PASSED!');
    console.log('===============================================================');

  } finally {
    cleanupFiles();
  }
}

runTwoScenarioTests().catch(err => {
  console.error('Test Suite Failed:', err);
  cleanupFiles();
  process.exit(1);
});
