/**
 * Verification Test: NETS POS-014 Direct FC56 Reconciliation on Cashier Second Pay Click
 *
 * Requirements:
 * 1. Cashier second Pay click detects unresolved ECN 000000017634 (Ref 1795525055328, Amt $1.00).
 * 2. Does NOT send repeating FC30 purchase requests that leave the terminal idle.
 * 3. Immediately dispatches FC 56 Last Approved Transaction Inquiry reusing original ECN.
 * 4. Terminal returns approval: validated against original ECN, ECR reference, and amount.
 * 5. Saves original POS bill exactly once and clears UNRESOLVED state.
 * 6. If terminal is unreachable or unapproved, preserves UNRESOLVED and blocks new charges.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const UNRESOLVED_TEST_PATH = path.join(__dirname, '../config/test_nets_unresolved_fc56.json');
const AUDIT_TEST_PATH = path.join(__dirname, '../config/test_nets_audit_fc56.json');
process.env.NETS_UNRESOLVED_FILE_PATH = UNRESOLVED_TEST_PATH;
process.env.NETS_AUDIT_FILE_PATH = AUDIT_TEST_PATH;
process.env.NODE_ENV = 'test';

const { NetsService } = require('../services/nets.service');

function cleanup() {
  if (fs.existsSync(UNRESOLVED_TEST_PATH)) {
    try { fs.unlinkSync(UNRESOLVED_TEST_PATH); } catch (_) {}
  }
  if (fs.existsSync(AUDIT_TEST_PATH)) {
    try { fs.unlinkSync(AUDIT_TEST_PATH); } catch (_) {}
  }
}

async function runFc56RecoveryTest() {
  console.log('================================================================');
  console.log('🧪 TESTING POS-014 CASHIER SECOND PAY FC56 INQUIRY RECONCILIATION');
  console.log('================================================================\n');

  cleanup();

  try {
    const service = new NetsService();
    service.checkTerminalAvailabilityBeforePurchase = async () => true;

    // Seed unresolved transaction ECN 000000017634
    const originalEcn = '000000017634';
    const originalRef = '1795525055328';
    const originalAmount = 1;

    service.saveUnresolvedTransaction({
      ecn: originalEcn,
      originalEcn: originalEcn,
      ecrRef: originalRef,
      amount: originalAmount,
      amountStr: '000000000100',
      flowName: 'NETS Card',
      txnType: '01',
      status: 'UNRESOLVED',
      startedAt: new Date().toISOString(),
    });

    const dispatchedFrames = [];

    // Mock sendPacket: captures inquiry frame and returns matching approved FC56 response
    service.sendPacket = async function (frame, timeoutMs, onProgress, meta) {
      const ecn = frame.slice(2, 14).toString('ascii');
      const fc = frame.slice(14, 16).toString('ascii');
      dispatchedFrames.push({ ecn, fc, length: frame.length, timeoutMs });

      console.log(`[Mock Terminal] Received ${fc} request (ECN=${ecn}, length=${frame.length} bytes, timeout=${timeoutMs}ms)`);

      if (fc === '56') {
        // Return matching FC 56 Last Approved Transaction response
        return {
          parsed: {
            ecn,
            functionCode: '56',
            responseCode: '00',
            responseDescription: 'Approved',
            isApproved: true,
            approvalCode: 'AUTH_17634',
            fields: {
              '01': 'AUTH_17634',
              'HD': originalRef,
              'HS': originalRef,
              '40': '000000000100',
              '65': '000001',
              'D3': 'RRN17634',
              '16': 'TERM001',
              'D1': 'MERCH001',
            },
          },
          rawHex: '0019',
        };
      }

      throw new Error(`Unexpected function code ${fc} during reconciliation`);
    };

    console.log('Cashier performs second manual Pay click...');
    const result = await service.purchaseCard({
      amount: 1,
      ecrRef: originalRef,
      isCashierInitiated: true,
      cashierActionToken: 'TOKEN_SECOND_PAY_17634',
      requestId: 'REQ_SECOND_PAY_17634',
      triggerSource: 'CASHIER_SECOND_PAY',
    });

    // Validations
    console.log('\nValidating reconciliation execution:');
    assert.strictEqual(dispatchedFrames.length, 1, 'Must dispatch exactly 1 inquiry frame');
    assert.strictEqual(dispatchedFrames[0].fc, '56', 'Dispatched frame must be FC 56 (Last Approved Inquiry)');
    assert.strictEqual(dispatchedFrames[0].ecn, originalEcn, 'Must reuse original ECN 000000017634');

    assert.strictEqual(result.isApproved, true, 'Reconciliation must confirm approval');
    assert.strictEqual(result.approvalCode, 'AUTH_17634', 'Approval code must match terminal slip');
    assert.strictEqual(result.ecrRef, originalRef, 'Must match original ECR reference');
    assert.strictEqual(result.amount, 1, 'Must match original amount');

    // Verify unresolved transaction is safely cleared
    const remainingUnres = service.loadUnresolvedTransactions();
    assert.strictEqual(remainingUnres.length, 0, 'Unresolved record must be cleared upon successful reconciliation');

    console.log('✅ Dispatched frame: FC=' + dispatchedFrames[0].fc + ', ECN=' + dispatchedFrames[0].ecn);
    console.log('✅ Approval confirmed: Code=' + result.approvalCode + ', ECRRef=' + result.ecrRef);
    console.log('✅ Unresolved record cleared safely from persistence.');
    console.log('\n================================================================');
    console.log('🎉 POS-014 FC56 RECONCILIATION VERIFICATION PASSED SUCCESSFULLY!');
    console.log('================================================================');
  } finally {
    cleanup();
  }
}

runFc56RecoveryTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
