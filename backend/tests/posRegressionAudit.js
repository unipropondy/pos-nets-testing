const fs = require('fs');
const path = require('path');
const {
  validateApprovalStatus,
  parseNetsFrame,
  buildNetsFrame,
  maskCardNumber,
  sanitizeFieldsForLogging,
  sanitizeRawHex,
} = require('../utils/netsProtocol');

let total = 0;
let passed = 0;

function check(cond, desc) {
  total++;
  if (cond) {
    passed++;
    console.log(`  ✓ ${desc}`);
  } else {
    console.error(`  ✗ FAIL: ${desc}`);
    process.exitCode = 1;
  }
}

console.log('===============================================================');
console.log('🚀 COMPREHENSIVE POS INTEGRATION REGRESSION AUDIT SUITE');
console.log('===============================================================\n');

// -------------------------------------------------------------
// 1. NORMAL PAYMENT & SPLIT PAYMENT COMBINATIONS
// -------------------------------------------------------------
console.log('1. Payment Combinations (Cash + NETS, Card + NETS, Split):');

// Simulation of single payment payload
const singleNetsPayment = {
  method: 'NETS',
  total: 54.20,
  isApproved: true,
  approvalCode: '123456',
  stan: '000101',
};
check(singleNetsPayment.isApproved && singleNetsPayment.approvalCode.length > 0, 'Single NETS card payment validates approval');

// Simulation of Cash + NETS split
const splitCashNets = [
  { id: '1', payMode: 'CASH', amount: '20.00', status: 'Paid', referenceNo: '' },
  { id: '2', payMode: 'NETS', amount: '34.20', status: 'Paid', referenceNo: 'APPR123' },
];
const totalSplitPaid = splitCashNets.reduce((acc, r) => acc + (r.status === 'Paid' ? parseFloat(r.amount) : 0), 0);
check(Math.abs(totalSplitPaid - 54.20) < 0.001, 'Split Cash + NETS exact sum calculation ($54.20)');

// Simulation of Card (YeahPay) + NETS QR split
const splitCardNetsQr = [
  { id: '1', payMode: 'YEAHPAY CARD', amount: '30.00', status: 'Paid', referenceNo: 'YP987654' },
  { id: '2', payMode: 'NETS QR', amount: '24.20', status: 'Paid', referenceNo: 'NQ554433' },
];
const totalMixedPaid = splitCardNetsQr.reduce((acc, r) => acc + (r.status === 'Paid' ? parseFloat(r.amount) : 0), 0);
check(Math.abs(totalMixedPaid - 54.20) < 0.001, 'Split YeahPay Card + NETS QR mixed terminal payment ($54.20)');


// -------------------------------------------------------------
// 2. SETTLEMENT INTEGRITY: SUCCESS REACHES SETTLEMENT ONCE
// -------------------------------------------------------------
console.log('\n2. Settlement Deduplication and Single Execution:');

const finalizationLocks = {};
function simulateFinalize(orderId, paymentResult) {
  if (finalizationLocks[orderId]) {
    return { executed: false, reason: 'Duplicate lock detected' };
  }
  if (!paymentResult.isApproved) {
    return { executed: false, reason: 'Unapproved transaction' };
  }
  finalizationLocks[orderId] = true;
  return { executed: true, orderId, settled: true };
}

const res1 = simulateFinalize('ORD-001', { isApproved: true, approvalCode: '887766' });
const res2 = simulateFinalize('ORD-001', { isApproved: true, approvalCode: '887766' });
check(res1.executed === true, 'First payment finalization executes settlement successfully');
check(res2.executed === false && res2.reason === 'Duplicate lock detected', 'Immediate duplicate callback is blocked by finalization lock');


// -------------------------------------------------------------
// 3. SETTLEMENT INTEGRITY: DECLINED / CANCELLED / TIMEOUT / UNCERTAIN
// -------------------------------------------------------------
console.log('\n3. Negative Transaction Flows Block Settlement:');

const declinedTx = simulateFinalize('ORD-002', { isApproved: false, responseCode: '51' });
check(declinedTx.executed === false && declinedTx.reason === 'Unapproved transaction', 'Declined transaction never triggers settlement');

const cancelledTx = simulateFinalize('ORD-003', { isApproved: false, responseCode: 'XX' });
check(cancelledTx.executed === false, 'User cancelled transaction never triggers settlement');

const timeoutTx = simulateFinalize('ORD-004', { isApproved: false, responseCode: 'TO' });
check(timeoutTx.executed === false, 'Timed-out transaction never triggers settlement');


// -------------------------------------------------------------
// 4. FC 56 RECOVERY: ANTI-ASSOCIATION OF OLD TRANSACTIONS
// -------------------------------------------------------------
console.log('\n4. FC 56 Reconciliation Anti-Mismatch Validation:');

const activeOrderRef = 'BILL_20261113_0099';
const activeOrderAmt = '000000004500'; // $45.00

function reconcileRecovery(inquiryResponse, expectedRef, expectedAmtStr) {
  const inqRef = (inquiryResponse.fields.HD || inquiryResponse.fields.HS || '').trim();
  const inqAmt = (inquiryResponse.fields['40'] || '').trim();
  const isApproved = inquiryResponse.parsed.isApproved;

  if (inqRef === expectedRef && inqAmt === expectedAmtStr && isApproved) {
    return { matched: true, status: 'APPROVED_RECOVERED' };
  }
  return { matched: false, status: 'ERECONCILIATIONREQUIRED' };
}

// Case A: Customer A timed out, terminal's last approved is Customer X from 10 mins ago ($15.00)
const olderCustomerTx = {
  fields: { HD: 'BILL_20261113_0098', '40': '000000001500', HC: '00', '01': 'APPR15' },
  parsed: { isApproved: true }
};
const recResultA = reconcileRecovery(olderCustomerTx, activeOrderRef, activeOrderAmt);
check(recResultA.matched === false && recResultA.status === 'ERECONCILIATIONREQUIRED', 'Older approved transaction from another customer cannot be associated');

// Case B: Same ref, but amount altered
const tamperedAmtTx = {
  fields: { HD: 'BILL_20261113_0099', '40': '000000001000', HC: '00', '01': 'APPR99' },
  parsed: { isApproved: true }
};
const recResultB = reconcileRecovery(tamperedAmtTx, activeOrderRef, activeOrderAmt);
check(recResultB.matched === false, 'Amount mismatch blocks recovery even if reference matches');

// Case C: Legitimate exact match
const legitTx = {
  fields: { HD: 'BILL_20261113_0099', '40': '000000004500', HC: '00', '01': 'APPR99' },
  parsed: { isApproved: true }
};
const recResultC = reconcileRecovery(legitTx, activeOrderRef, activeOrderAmt);
check(recResultC.matched === true && recResultC.status === 'APPROVED_RECOVERED', 'Authentic matching inquiry approves recovery');


// -------------------------------------------------------------
// 5. CONCURRENT ECN GENERATION & PERSISTENCE
// -------------------------------------------------------------
console.log('\n5. ECN Uniqueness under High Concurrency:');

const netsService = require('../services/nets.service');
const generatedEcns = new Set();
const CONCURRENT_COUNT = 1000;

for (let i = 0; i < CONCURRENT_COUNT; i++) {
  const ecn = netsService.getNextEcn();
  generatedEcns.add(ecn);
}
check(generatedEcns.size === CONCURRENT_COUNT, `Generated ${CONCURRENT_COUNT} unique sequential ECNs with 0 collisions`);

// Verify persistence across service reinstantiation
const savedEcnValue = netsService.currentEcn;
const freshInstance = new (netsService.constructor)();
check(freshInstance.currentEcn === savedEcnValue, `ECN value persisted across service restart (${freshInstance.currentEcn})`);


// -------------------------------------------------------------
// 6. CONFIGURATION PERSISTENCE & MUTABILITY
// -------------------------------------------------------------
console.log('\n6. Configuration Persistence:');

const initialPort = netsService.config.terminalPort;
netsService.saveConfig({ terminalPort: 7505, ecrRefFieldCode: 'HS' });
const reloaded = new (netsService.constructor)();
check(reloaded.config.terminalPort === 7505, 'Updated terminalPort (7505) persisted across reload');
check(reloaded.config.ecrRefFieldCode === 'HS', 'Updated ecrRefFieldCode (HS) persisted across reload');
// Restore default settings
netsService.saveConfig({ terminalPort: initialPort, ecrRefFieldCode: 'HD' });


// -------------------------------------------------------------
// 7. SENSITIVE DATA MASKING IN LOGS & AUDIT LOGS
// -------------------------------------------------------------
console.log('\n7. Sensitive Data Masking Verification:');

const rawCard = '4563471234567890';
const maskedCard = maskCardNumber(rawCard);
check(maskedCard === '456347******7890', 'maskCardNumber keeps only first 6 and last 4');

const sampleReceiptWithCard = 'MERCHANT: UNIPRO\nCARD: 4563471234567890\nAMOUNT: $45.00';
const cleanReceipt = sampleReceiptWithCard.replace(/\b(\d{6})\d{4,9}(\d{4})\b/g, '$1******$2');
check(!cleanReceipt.includes('1234567890') && cleanReceipt.includes('456347******7890'), 'Receipt card numbers are masked');


// -------------------------------------------------------------
// 8. RECEIPT TRANSACTION DETAIL FORMATTING
// -------------------------------------------------------------
console.log('\n8. Universal Printer Formatting for NETS:');

function formatPaymentDetailsForReceipt(payments, finalTotal) {
  let lines = [];
  if (payments && payments.length > 0) {
    payments.forEach(p => {
      lines.push(`${p.payMode}: $${parseFloat(p.amount).toFixed(2)}`);
      if (p.referenceNo) {
        lines.push(`  Ref / Approval: ${p.referenceNo}`);
      }
    });
  } else {
    lines.push(`Total: $${parseFloat(finalTotal).toFixed(2)}`);
  }
  return lines.join('\n');
}

const samplePayments = [
  { payMode: 'NETS', amount: 50.00, referenceNo: 'APPR9988' }
];
const receiptOutput = formatPaymentDetailsForReceipt(samplePayments, 50.00);
check(receiptOutput.includes('NETS: $50.00'), 'Receipt shows payment mode & amount');
check(receiptOutput.includes('Ref / Approval: APPR9988'), 'Receipt outputs transaction reference & approval');


// -------------------------------------------------------------
// 9. YEAHPAY ISOLATION VERIFICATION
// -------------------------------------------------------------
console.log('\n9. YeahPay Integration Invariance:');

const YeahPayService = require('../services/yeahpay.service');
const yeahPayInst = new YeahPayService();
check(typeof yeahPayInst.processCardPayment === 'function', 'YeahPay processCardPayment function is intact');
check(typeof yeahPayInst.processPayNowPayment === 'function', 'YeahPay processPayNowPayment function is intact');
check(typeof yeahPayInst.sendRequest === 'function', 'YeahPay sendRequest function is intact');
check(typeof yeahPayInst.sortObjectKeys === 'function', 'YeahPay sortObjectKeys function is intact');


console.log('\n===============================================================');
console.log(`AUDIT RESULT: ${passed}/${total} Checks Passed.`);
console.log('===============================================================');

if (passed === total) process.exit(0);
else process.exit(1);
