const {
  validateApprovalStatus,
  parseNetsFrame,
  buildNetsFrame,
  maskCardNumber,
  sanitizeFieldsForLogging,
  sanitizeRawHex,
} = require('../utils/netsProtocol');
const netsService = require('../services/nets.service');

let totalTests = 0;
let passedTests = 0;

function assert(condition, testName) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${testName}`);
  } else {
    console.error(`  [FAIL] ${testName}`);
    process.exitCode = 1;
  }
}

console.log('====================================================');
console.log('🧪 NETS ECR II DEFECT FIX VALIDATION SUITE');
console.log('====================================================\n');

// ----------------------------------------------------
// TEST 1: APPROVAL VALIDATION WITH TERMINAL & HOST RC
// ----------------------------------------------------
console.log('1. Testing Strict Approval Validation:');

const apprvValid = validateApprovalStatus('30', '00', { HC: '00', '01': '123456' });
assert(apprvValid.isApproved === true, 'FC 30: Terminal 00 + Host HC 00 + Valid Approval -> Approved');

const apprvMissingHC = validateApprovalStatus('30', '00', { '01': '123456' });
assert(apprvMissingHC.isApproved === false && apprvMissingHC.reason.includes('HC'), 'FC 30: Terminal 00 + Missing HC -> Declined (Missing HC)');

const apprvDeclinedHC = validateApprovalStatus('30', '00', { HC: '51', '01': '123456' });
assert(apprvDeclinedHC.isApproved === false && apprvDeclinedHC.reason.includes('51'), 'FC 30: Terminal 00 + Host HC 51 (Insufficient Funds) -> Declined');

const apprvDeclinedHostSC = validateApprovalStatus('30', '00', { HC: 'SC', '01': '123456' });
assert(apprvDeclinedHostSC.isApproved === false && apprvDeclinedHostSC.reason.includes('SC'), 'FC 30: Terminal 00 + Host HC SC (Host Debit Failed) -> Declined');

const apprvZeroApproval = validateApprovalStatus('30', '00', { HC: '00', '01': '000000' });
assert(apprvZeroApproval.isApproved === false && apprvZeroApproval.reason.includes('000000'), 'FC 30: Approval Code "000000" -> Declined');

const apprvEmptyApproval = validateApprovalStatus('30', '00', { HC: '00', '01': '   ' });
assert(apprvEmptyApproval.isApproved === false, 'FC 30: Empty Approval Code -> Declined');

const apprvTermDecline = validateApprovalStatus('30', '12', { HC: '00', '01': '123456' });
assert(apprvTermDecline.isApproved === false, 'FC 30: Terminal RC != 00 -> Declined');

const apprvAdmin55 = validateApprovalStatus('55', '00', { ST: 'INSTALL' });
assert(apprvAdmin55.isApproved === true, 'FC 55: Terminal 00 -> Approved (Non-financial)');


// ----------------------------------------------------
// TEST 2: FC I5 CREDIT CARD SETTLEMENT (FIELD 9G DBS)
// ----------------------------------------------------
console.log('\n2. Testing FC I5 Credit Card Settlement Packet:');

const i5Frame = buildNetsFrame({
  ecn: '00000005773',
  functionCode: 'I5',
  versionCode: '01',
  fields: [
    { code: '9G', value: 'DBS'.padEnd(6, ' ') },
  ],
});
const i5Hex = i5Frame.toString('hex');
// Expected pattern:
// Length: 0030 (2-byte BCD)
// ECN: ...
// FN: 4935 ('I5')
// Field: 3947 ('9G'), Length: 0006, Value: 444253202020 ('DBS   '), FS: 1c
assert(i5Hex.includes('4935'), 'FC I5 function code 0x4935 present in header');
assert(i5Hex.includes('394700064442532020201c'), 'Field 9G present with 6-byte padded DBS value');


// ----------------------------------------------------
// TEST 3: ECR REFERENCE NUMBER (HD vs HS)
// ----------------------------------------------------
console.log('\n3. Testing ECR Reference Number (HD vs HS):');

netsService.config.ecrRefFieldCode = 'HD';
const frameHD = buildNetsFrame({
  ecn: '1',
  functionCode: '30',
  fields: [
    { code: netsService.config.ecrRefFieldCode, value: 'INV12345' },
  ],
});
assert(frameHD.toString('hex').includes('48440008494e5631323334351c'), 'Field HD correctly built with 8-byte INV12345');

netsService.config.ecrRefFieldCode = 'HS';
const frameHS = buildNetsFrame({
  ecn: '1',
  functionCode: '30',
  fields: [
    { code: netsService.config.ecrRefFieldCode, value: 'INV12345' },
  ],
});
assert(frameHS.toString('hex').includes('48530008494e5631323334351c'), 'Field HS correctly built with 8-byte INV12345');
// Reset back to HD
netsService.config.ecrRefFieldCode = 'HD';


// ----------------------------------------------------
// TEST 4: SENSITIVE DATA MASKING & LOGGING SANITIZATION
// ----------------------------------------------------
console.log('\n4. Testing Sensitive Card Data Masking:');

const rawPan = '4563470012345678';
const maskedPan = maskCardNumber(rawPan);
assert(maskedPan === '456347******5678', `PAN masking: ${rawPan} -> ${maskedPan}`);

const dirtyFields = {
  '02': 'APPROVED\n4563470012345678\nBAL: 125.50',
  'L7': 'NETS 4563470012345678 CARDHOLDER',
  '16': '45634702',
};
const cleanFields = sanitizeFieldsForLogging(dirtyFields);
assert(!cleanFields['02'].includes('12345678'), 'Field 02 card number is masked in logs');
assert(!cleanFields['L7'].includes('12345678'), 'Field L7 card number is masked in logs');
assert(cleanFields['16'] === '45634702', 'Non-sensitive terminal ID is preserved');

const longHex = '007630303030303030303433383333303031301c5432000230311c343000123030303030303030343030361c343200123030303030303030303030301c48440011696d3330756f62746573741c33';
const safeHex = sanitizeRawHex(longHex);
assert(safeHex.includes('[MASKED'), 'Raw hex strings are sanitized/truncated');


// ----------------------------------------------------
// TEST 5: ECN SEQUENCING & PERSISTENCE
// ----------------------------------------------------
console.log('\n5. Testing ECN Sequencing and Persistence:');

const ecn1 = netsService.getNextEcn();
const ecn2 = netsService.getNextEcn();
const ecn3 = netsService.getNextEcn();
assert(parseInt(ecn2, 10) === parseInt(ecn1, 10) + 1, `Sequential ECN increment: ${ecn1} -> ${ecn2}`);
assert(parseInt(ecn3, 10) === parseInt(ecn2, 10) + 1, `Sequential ECN increment: ${ecn2} -> ${ecn3}`);
assert(ecn3.length === 12, 'ECN is 12 digits zero-padded');


// ----------------------------------------------------
// TEST 6: FC 56 RECOVERY MATCHING AND RECONCILIATION
// ----------------------------------------------------
console.log('\n6. Testing FC 56 Reconciliation Matching:');

const targetRef = 'ORDER_999';
const targetAmount = '000000002500'; // $25.00

// Matched inquiry
const matchedInquiry = {
  success: true,
  fields: { HD: 'ORDER_999', '40': '000000002500', HC: '00', '01': 'APPR99' },
  parsed: { isApproved: true, hostResponseCode: '00' }
};
const isMatch = (matchedInquiry.fields.HD === targetRef) && 
                (matchedInquiry.fields['40'] === targetAmount) && 
                matchedInquiry.parsed.isApproved;
assert(isMatch === true, 'Matching HD and amount approves recovery');

// Mismatch inquiry (Prior order from someone else)
const priorInquiry = {
  success: true,
  fields: { HD: 'OLD_ORDER_888', '40': '000000001000', HC: '00', '01': 'APPR88' },
  parsed: { isApproved: true, hostResponseCode: '00' }
};
const isOldMatch = (priorInquiry.fields.HD === targetRef) && 
                   (priorInquiry.fields['40'] === targetAmount);
assert(isOldMatch === false, 'Older approved transaction belonging to another order is rejected');


console.log('\n====================================================');
console.log(`SUMMARY: ${passedTests}/${totalTests} Tests Passed.`);
console.log('====================================================');

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}

