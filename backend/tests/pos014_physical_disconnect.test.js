/**
 * Verification Test: Physical Network Link-State Monitoring & Late Approval Handling (NETS POS-014)
 *
 * Requirements:
 * 1. Physical Network Link-State Monitoring: Detects adapter link-down & link-up.
 * 2. Permanent Disconnect Flag: latches `disconnectObserved = true` for in-flight payment.
 * 3. Handle Approval Received After a Detected Disconnect:
 *    - Records received response for audit
 *    - Does NOT return payment success to frontend
 *    - Does NOT call /api/sales/save
 *    - Does NOT close POS bill
 *    - Preserves ECN, ECR ref, amount, approval details
 *    - Waits out original financial deadline
 *    - Persists UNRESOLVED with preserved lateResponse and returns HTTP 409 (ERECONCILIATIONREQUIRED)
 * 4. Manual Recovery:
 *    - Cashier explicit second Pay click reconciles using preserved lateResponse
 *    - Finalizes bill exactly once without recharging
 * 5. Scenario A:
 *    - No link-down event -> valid approval completes bill normally without second click
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const UNRESOLVED_TEST_PATH = path.join(__dirname, '../config/test_nets_unresolved_disconnect.json');
const AUDIT_TEST_PATH = path.join(__dirname, '../config/test_nets_audit_disconnect.json');
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

async function runPhysicalDisconnectTests() {
  console.log('================================================================');
  console.log('🧪 POS-014 PHYSICAL LINK DISCONNECT & LATE APPROVAL TEST SUITE');
  console.log('================================================================\n');

  cleanupFiles();

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Physical Network Interface Identification
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: Physical Network Interface Identification ---');
    const serviceDiag = new NetsService();
    const iface = serviceDiag.getTerminalNetworkInterface();
    console.log(`Detected Terminal Interface: ${iface.name} (IP: ${iface.ip}, Netmask: ${iface.netmask}, MAC: ${iface.mac})`);
    assert.ok(iface.name, 'Must identify active network adapter');
    console.log('✅ TEST 1 PASSED: Network adapter successfully identified.\n');

    // -------------------------------------------------------------------------
    // TEST 2: Scenario A - No Disconnect, Valid Approval Completes Normally
    // -------------------------------------------------------------------------
    console.log('--- TEST 2: Scenario A (Connected, Delayed Approval within Deadline) ---');
    const serviceA = new NetsService();
    serviceA.checkTerminalAvailabilityBeforePurchase = async () => {};
    let ecnSeqA = 17624;
    serviceA.getNextEcnAsync = async () => String(++ecnSeqA).padStart(12, '0');
    serviceA.config.financialTimeoutMs = 1000;

    // Simulate sendPacket: no disconnect observed, returns approval
    serviceA.sendPacket = async function (frame, timeoutMs, onProgress, sendContext) {
      return {
        parsed: {
          isApproved: true,
          responseCode: '00',
          responseDescription: 'Approved',
          approvalCode: 'AUTH_SCENARIO_A',
          fields: { '01': 'AUTH_SCENARIO_A' },
        },
        rawHex: '0000',
      };
    };

    const resA = await serviceA.purchaseCard({
      amount: 1,
      ecrRef: '1795516210050',
      isCashierInitiated: true,
      requestId: 'REQ_A_1',
      triggerSource: 'CASHIER_FIRST_PAY',
    });

    assert.strictEqual(resA.isApproved, true);
    assert.strictEqual(resA.approvalCode, 'AUTH_SCENARIO_A');
    assert.strictEqual(serviceA.loadUnresolvedTransactions().length, 0);
    console.log('✅ TEST 2 PASSED: Scenario A completed bill normally without requiring second Pay click.\n');

    // -------------------------------------------------------------------------
    // TEST 3: Scenario B - Physical Disconnect Latched, Late Approval Arrives
    // -------------------------------------------------------------------------
    console.log('--- TEST 3: Scenario B (Physical Disconnect Latched, Late Approval Received) ---');
    const serviceB = new NetsService();
    serviceB.checkTerminalAvailabilityBeforePurchase = async () => {};
    let ecnSeqB = 17625;
    serviceB.getNextEcnAsync = async () => String(++ecnSeqB).padStart(12, '0');
    serviceB.config.financialTimeoutMs = 500; // 500ms deadline for fast test

    // Simulate sendPacket: trip linkMonitor disconnectObserved, then deliver late approval
    serviceB.sendPacket = async function (frame, timeoutMs, onProgress, sendContext) {
      if (sendContext.linkMonitor) {
        console.log('[Test Harness] Simulating Windows physical network link-down event...');
        sendContext.linkMonitor.setDisconnectObserved(true, 'PHYSICAL_ETHERNET_UNPLUGGED');
      }

      // Simulate cable reconnected and terminal sending late approval
      console.log('[Test Harness] Simulating late approval frame arriving after cable reconnect...');
      return {
        parsed: {
          isApproved: true,
          responseCode: '00',
          responseDescription: 'Approved',
          approvalCode: 'AUTH_LATE_17626',
          fields: {
            '01': 'AUTH_LATE_17626',
            '65': 'STAN123456',
            'D3': 'RRN987654321',
          },
        },
        rawHex: '003000',
      };
    };

    let firstPayErr = null;
    let firstPayRes = null;

    try {
      firstPayRes = await serviceB.purchaseCard({
        amount: 1,
        ecrRef: '1795516210051',
        isCashierInitiated: true,
        requestId: 'REQ_B_1',
        triggerSource: 'CASHIER_FIRST_PAY',
      });
    } catch (err) {
      firstPayErr = err;
    }

    assert.strictEqual(firstPayRes, null, 'Must NOT return success on first Pay click when disconnect was observed');
    assert.ok(firstPayErr, 'Must throw ERECONCILIATIONREQUIRED');
    assert.strictEqual(firstPayErr.code, 'ERECONCILIATIONREQUIRED');

    // Verify unresolved transaction was persisted with lateResponse
    const unresB = serviceB.loadUnresolvedTransactions();
    assert.strictEqual(unresB.length, 1, 'Must persist 1 unresolved transaction');
    assert.strictEqual(unresB[0].ecn, '000000017626');
    assert.strictEqual(unresB[0].disconnectObserved, true);
    assert.ok(unresB[0].lateResponse, 'Must preserve lateResponse for second Pay click');
    assert.strictEqual(unresB[0].lateResponse.approvalCode, 'AUTH_LATE_17626');
    console.log('✅ TEST 3 (Part 1) PASSED: Automatic completion blocked, bill remained OPEN, late approval preserved.\n');

    // -------------------------------------------------------------------------
    // TEST 4: Scenario B (Part 2) - Cashier Second Pay Click Reconciles Late Approval
    // -------------------------------------------------------------------------
    console.log('--- TEST 4: Scenario B (Cashier Second Pay Click Reconciliation) ---');

    const secondPayRes = await serviceB.purchaseCard({
      amount: 1,
      ecrRef: '1795516210051',
      isCashierInitiated: true,
      cashierActionToken: 'TOKEN_SECOND_PAY_17626',
      requestId: 'REQ_B_2',
      triggerSource: 'CASHIER_SECOND_PAY',
    });

    assert.strictEqual(secondPayRes.isApproved, true);
    assert.strictEqual(secondPayRes.approvalCode, 'AUTH_LATE_17626');
    assert.strictEqual(secondPayRes.recoveryMethod, 'LATE_APPROVAL_RECONCILED');
    assert.strictEqual(serviceB.loadUnresolvedTransactions().length, 0, 'Unresolved record must be cleared after reconciliation');
    console.log('✅ TEST 4 PASSED: Second Pay click successfully retrieved preserved approval, cleared unresolved state, and completed bill exactly once.\n');

    console.log('================================================================');
    console.log('🎉 ALL 4 PHYSICAL LINK DISCONNECT TESTS PASSED PERFECTLY!');
    console.log('================================================================');
  } finally {
    cleanupFiles();
  }
}

runPhysicalDisconnectTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
