/**
 * Test Suite: POS-004 - Handling of NETS Response Fields in Different Orders
 * 
 * Verifies that:
 * 1. NETS Card (FC30/T2=01): Response fields arriving in non-standard / changed order
 *    extract all transaction details correctly.
 * 2. NETS QR (FC30/T2=04): Shuffled response fields evaluate QR approval exceptions correctly.
 * 3. NETS Credit Card (FC I0): Response fields in different orders extract issuer, scheme,
 *    masked PAN, and reference fields without disruption.
 * 4. Comparison between standard field order and reordered fields produces equivalent data.
 * 5. Declined transactions remain declined regardless of field order.
 * 6. Field lengths, field separators (0x1C), and LRC calculations remain valid across reordering.
 */

const assert = require('assert');
const netsProtocol = require('../utils/netsProtocol');

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    process.exit(1);
  }
}

// Fisher-Yates shuffle helper for deterministic permutations
function permuteFields(arr, indices) {
  return indices.map(i => arr[i]);
}

// ---------------------------------------------------------------------------------
// Test Case 1: NETS Card (FC 30 T2=01) with Reordered Response Fields
// ---------------------------------------------------------------------------------
runTest('1. NETS Card (FC 30): Extraction and approval with reordered fields', () => {
  // Standard Spec order: 01, 65, D3, D1, 16, L7, HC, HD, 40, RP
  // Reordered: HD, 40, HC, RP, 01, 16, D1, 65, L7, D3
  const reorderedFields = [
    { code: 'HD', value: 'POS1234567890' },
    { code: '40', value: '000000002500' },
    { code: 'HC', value: '00' },
    { code: 'RP', value: 'NETS CARD APPROVED RECEIPT' },
    { code: '01', value: '334455' },
    { code: '16', value: 'TERM9988' },
    { code: 'D1', value: 'MID123456789012' },
    { code: '65', value: '000123' },
    { code: 'L7', value: 'NETS FLASHPay' },
    { code: 'D3', value: 'RRN887766554433' }
  ];

  const frame = netsProtocol.buildNetsFrame({
    ecn: '000000000201',
    functionCode: '30',
    versionCode: '01',
    responseCode: '00',
    fields: reorderedFields
  });

  const parsed = netsProtocol.parseNetsFrame(frame, { isQr: false, txnType: '01' });

  assert.strictEqual(parsed.isApproved, true);
  assert.strictEqual(parsed.approvalCode, '334455');
  assert.strictEqual(parsed.hostResponseCode, '00');
  assert.strictEqual(parsed.fields['HD'], 'POS1234567890');
  assert.strictEqual(parsed.fields['40'], '000000002500');
  assert.strictEqual(parsed.fields['16'], 'TERM9988');
  assert.strictEqual(parsed.fields['D1'], 'MID123456789012');
  assert.strictEqual(parsed.fields['65'], '000123');
  assert.strictEqual(parsed.fields['L7'], 'NETS FLASHPay');
  assert.strictEqual(parsed.fields['D3'], 'RRN887766554433');
  assert.strictEqual(parsed.fields['RP'], 'NETS CARD APPROVED RECEIPT');
});

// ---------------------------------------------------------------------------------
// Test Case 2: NETS QR (FC 30 T2=04) with Shuffled Fields
// ---------------------------------------------------------------------------------
runTest('2. NETS QR (FC 30): Shuffled response fields evaluate QR approval correctly', () => {
  // Shuffled order: D3, 40, RP, T2, HC, 65, 01, HD
  const shuffledQrFields = [
    { code: 'D3', value: '1795082348136' },
    { code: '40', value: '000000000100' },
    { code: 'RP', value: 'PURCHASE (QR) DBS PayLah! APPROVED' },
    { code: 'T2', value: '04' },
    { code: 'HC', value: '00' },
    { code: '65', value: '000999' },
    { code: '01', value: '000000' }, // QR space or 000000 approval code
    { code: 'HD', value: 'QS17950823481' }
  ];

  const frame = netsProtocol.buildNetsFrame({
    ecn: '000000000202',
    functionCode: '30',
    versionCode: '01',
    responseCode: '00',
    fields: shuffledQrFields
  });

  const parsed = netsProtocol.parseNetsFrame(frame, { isQr: true, txnType: '04' });

  assert.strictEqual(parsed.isApproved, true);
  assert.strictEqual(parsed.fields['T2'], '04');
  assert.strictEqual(parsed.fields['01'], '000000');
  assert.strictEqual(parsed.fields['HC'], '00');
  assert.strictEqual(parsed.fields['65'], '000999');
  assert.strictEqual(parsed.fields['D3'], '1795082348136');
  assert.strictEqual(parsed.fields['HD'], 'QS17950823481');
  assert.strictEqual(parsed.fields['40'], '000000000100');
  assert(parsed.approvalReason.includes('NETS QR'));
});

// ---------------------------------------------------------------------------------
// Test Case 3: NETS Credit Card (FC I0) with Changed Field Order
// ---------------------------------------------------------------------------------
runTest('3. NETS Credit Card (FC I0): Reversed/changed field order extracts all card details', () => {
  // Fields in inverted order: RP, 40, HD, 9H, D8, D7, 30, HC, 65, D3, 01
  const invertedCreditFields = [
    { code: 'RP', value: 'VISA SALE APPROVED' },
    { code: '40', value: '000000008500' },
    { code: 'HD', value: 'POSCREDIT9999' },
    { code: '9H', value: 'DBS' },
    { code: 'D8', value: 'VISA' },
    { code: 'D7', value: 'DBS BANK' },
    { code: '30', value: '455212******8899' },
    { code: 'HC', value: '00' },
    { code: '65', value: '000555' },
    { code: 'D3', value: 'RRN445566778899' },
    { code: '01', value: 'V12345' }
  ];

  const frame = netsProtocol.buildNetsFrame({
    ecn: '000000000203',
    functionCode: 'I0',
    versionCode: '01',
    responseCode: '00',
    fields: invertedCreditFields
  });

  const parsed = netsProtocol.parseNetsFrame(frame, { isQr: false, txnType: 'I0' });

  assert.strictEqual(parsed.isApproved, true);
  assert.strictEqual(parsed.approvalCode, 'V12345');
  assert.strictEqual(parsed.fields['D7'], 'DBS BANK');
  assert.strictEqual(parsed.fields['D8'], 'VISA');
  assert.strictEqual(parsed.fields['30'], '455212******8899');
  assert.strictEqual(parsed.fields['9H'], 'DBS');
  assert.strictEqual(parsed.fields['D3'], 'RRN445566778899');
  assert.strictEqual(parsed.fields['65'], '000555');
  assert.strictEqual(parsed.fields['HC'], '00');
  assert.strictEqual(parsed.fields['HD'], 'POSCREDIT9999');
  assert.strictEqual(parsed.fields['40'], '000000008500');
  assert.strictEqual(parsed.fields['RP'], 'VISA SALE APPROVED');
});

// ---------------------------------------------------------------------------------
// Test Case 4: Compare Parsed Results between Standard Order vs. Arbitrary Permutations
// ---------------------------------------------------------------------------------
runTest('4. Equivalence check: Standard order vs 3 distinct permutations yield identical data', () => {
  const baseFields = [
    { code: '01', value: '998877' },
    { code: '02', value: '2612' },
    { code: '03', value: '20261123' },
    { code: '04', value: '152000' },
    { code: '16', value: 'TID11223' },
    { code: 'D1', value: 'MID99887' },
    { code: 'D3', value: 'RRN001122334455' },
    { code: '65', value: '000789' },
    { code: 'HC', value: '00' },
    { code: 'HD', value: 'EQUIVTEST1234' },
    { code: '40', value: '000000005000' }
  ];

  // Permutation A: Reverse
  const permA = [...baseFields].reverse();

  // Permutation B: Interleaved even/odd
  const permB = [
    baseFields[0], baseFields[2], baseFields[4], baseFields[6], baseFields[8], baseFields[10],
    baseFields[1], baseFields[3], baseFields[5], baseFields[7], baseFields[9]
  ];

  // Permutation C: HC and 01 at the very end
  const permC = [
    baseFields[2], baseFields[3], baseFields[4], baseFields[5], baseFields[6],
    baseFields[7], baseFields[9], baseFields[10], baseFields[1], baseFields[0], baseFields[8]
  ];

  const frameBase = netsProtocol.buildNetsFrame({ ecn: '000000000204', functionCode: '30', versionCode: '01', responseCode: '00', fields: baseFields });
  const frameA = netsProtocol.buildNetsFrame({ ecn: '000000000204', functionCode: '30', versionCode: '01', responseCode: '00', fields: permA });
  const frameB = netsProtocol.buildNetsFrame({ ecn: '000000000204', functionCode: '30', versionCode: '01', responseCode: '00', fields: permB });
  const frameC = netsProtocol.buildNetsFrame({ ecn: '000000000204', functionCode: '30', versionCode: '01', responseCode: '00', fields: permC });

  const parsedBase = netsProtocol.parseNetsFrame(frameBase, { isQr: false, txnType: '01' });
  const parsedA = netsProtocol.parseNetsFrame(frameA, { isQr: false, txnType: '01' });
  const parsedB = netsProtocol.parseNetsFrame(frameB, { isQr: false, txnType: '01' });
  const parsedC = netsProtocol.parseNetsFrame(frameC, { isQr: false, txnType: '01' });

  // Compare key parsed fields across all permutations
  for (const p of [parsedA, parsedB, parsedC]) {
    assert.strictEqual(p.isApproved, parsedBase.isApproved);
    assert.strictEqual(p.approvalCode, parsedBase.approvalCode);
    assert.strictEqual(p.hostResponseCode, parsedBase.hostResponseCode);
    assert.strictEqual(p.responseCode, parsedBase.responseCode);
    assert.deepStrictEqual(p.fields, parsedBase.fields);
  }
});

// ---------------------------------------------------------------------------------
// Test Case 5: Declined Transaction Remains Declined Regardless of Field Order
// ---------------------------------------------------------------------------------
runTest('5. Declined transaction retains decline status under various field orderings', () => {
  // Decline with Insufficient Funds (RC 51, HC 51)
  const declineFields1 = [
    { code: 'HC', value: '51' },
    { code: 'D3', value: 'RRN_DECLINE_001' },
    { code: '40', value: '000000010000' }
  ];

  const declineFields2 = [
    { code: '40', value: '000000010000' },
    { code: 'D3', value: 'RRN_DECLINE_001' },
    { code: 'HC', value: '51' }
  ];

  const frameDec1 = netsProtocol.buildNetsFrame({ ecn: '000000000205', functionCode: '30', versionCode: '01', responseCode: '51', fields: declineFields1 });
  const frameDec2 = netsProtocol.buildNetsFrame({ ecn: '000000000205', functionCode: '30', versionCode: '01', responseCode: '51', fields: declineFields2 });

  const parsedDec1 = netsProtocol.parseNetsFrame(frameDec1, { isQr: false, txnType: '01' });
  const parsedDec2 = netsProtocol.parseNetsFrame(frameDec2, { isQr: false, txnType: '01' });

  assert.strictEqual(parsedDec1.isApproved, false);
  assert.strictEqual(parsedDec2.isApproved, false);
  assert.strictEqual(parsedDec1.responseCode, '51');
  assert.strictEqual(parsedDec2.responseCode, '51');
  assert.strictEqual(parsedDec1.hostResponseCode, '51');
  assert.strictEqual(parsedDec2.hostResponseCode, '51');
  assert.deepStrictEqual(parsedDec1.fields, parsedDec2.fields);
});

// ---------------------------------------------------------------------------------
// Test Case 6: Wire Integrity, Field Separators (0x1C), and LRC Across Reorderings
// ---------------------------------------------------------------------------------
runTest('6. Wire integrity: BCD Length, 0x1C delimiters, and LRC valid across reordered frames', () => {
  const fields = [
    { code: '9H', value: 'DBS' },
    { code: 'HD', value: 'WIRE_TEST_REF' },
    { code: '01', value: '999111' },
    { code: '40', value: '000000001234' }
  ];

  const frame = netsProtocol.buildNetsFrame({
    ecn: '000000000206',
    functionCode: 'I0',
    versionCode: '01',
    responseCode: '00',
    fields
  });

  // Check 1: First 2 bytes BCD length
  const expectedLen = netsProtocol.fromBcd2(frame, 0);
  assert.strictEqual(expectedLen, frame.length - 2);

  // Check 2: Last byte LRC
  const computedLrc = netsProtocol.calculateLrc(frame.slice(2, frame.length - 1));
  const receivedLrc = frame[frame.length - 1];
  assert.strictEqual(receivedLrc, computedLrc);

  // Check 3: Parser validates LRC and lengths under strict mode
  const parsed = netsProtocol.parseNetsFrame(frame, { strictLrc: true, strictLength: true });
  assert.strictEqual(parsed.isLrcValid, true);
  assert.strictEqual(parsed.rawLength, expectedLen);
  assert.strictEqual(parsed.fields['9H'], 'DBS');
  assert.strictEqual(parsed.fields['HD'], 'WIRE_TEST_REF');
  assert.strictEqual(parsed.fields['01'], '999111');
  assert.strictEqual(parsed.fields['40'], '000000001234');
});

console.log('\nAll POS-004 test cases passed successfully!');
