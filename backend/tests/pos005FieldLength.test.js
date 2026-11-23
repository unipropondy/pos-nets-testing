/**
 * Test Suite: POS-005 - Handling of Field Data Longer Than Defined Specification Length
 * 
 * Verifies that:
 * 1. Normal field lengths (e.g. Field 01: 6, Field 40: 12, Field 65: 6) parse correctly.
 * 2. Field data containing more bytes than the documented spec length is safely consumed
 *    using the actual BCD-encoded length without crashing or corrupting subsequent offsets.
 * 3. Subsequent fields remain completely intact and correctly extracted after a longer field.
 * 4. Actual encoded BCD length header is strictly followed for field boundary delineation.
 * 5. Malformed or truncated fields (length claims more bytes than available before frame end)
 *    are rejected with clear errors.
 * 6. Missing or invalid FS (0x1C) delimiters trigger validation errors rather than out-of-bounds reads.
 * 7. Approval and decline validation are not compromised by longer-than-spec field values.
 * 8. NETS Card (FC30), NETS QR (FC30), and NETS Credit Card (FC I0) transactions parse normally.
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

// ---------------------------------------------------------------------------------
// Scenario 1: Verify Normal Documented Field Lengths
// ---------------------------------------------------------------------------------
runTest('1. Normal spec field lengths parse accurately', () => {
  // Documented Spec Lengths:
  // 01: Approval Code (6 chars)
  // 65: STAN (6 chars)
  // D3: RRN (12 chars)
  // 40: Amount (12 chars zero-padded)
  // 16: Terminal ID (8 chars)
  // D1: Merchant ID (15 chars)
  const fields = [
    { code: '01', value: '123456' },
    { code: '65', value: '000001' },
    { code: 'D3', value: '179508234813' },
    { code: '40', value: '000000001000' },
    { code: '16', value: '12345678' },
    { code: 'D1', value: '000000000012345' },
    { code: 'HC', value: '00' }
  ];

  const frame = netsProtocol.buildNetsFrame({
    ecn: '000000000301',
    functionCode: '30',
    versionCode: '01',
    responseCode: '00',
    fields
  });

  const parsed = netsProtocol.parseNetsFrame(frame, { isQr: false, txnType: '01' });

  assert.strictEqual(parsed.isApproved, true);
  assert.strictEqual(parsed.fields['01'], '123456');
  assert.strictEqual(parsed.fields['65'], '000001');
  assert.strictEqual(parsed.fields['D3'], '179508234813');
  assert.strictEqual(parsed.fields['40'], '000000001000');
  assert.strictEqual(parsed.fields['16'], '12345678');
  assert.strictEqual(parsed.fields['D1'], '000000000012345');
});

// ---------------------------------------------------------------------------------
// Scenario 2: Longer-Than-Documented Field Handled Safely
// ---------------------------------------------------------------------------------
runTest('2. Field containing more bytes than spec length is safely consumed without crash', () => {
  // Field D8 (Card Scheme) is documented as 4 chars (e.g. 'VISA', 'AMEX')
  // We send a 32-character extended scheme string
  const longScheme = 'VISA_INTERNATIONAL_EXTENDED_EMV_TAG_DATA_EXTRA';
  // Field L7 (Card Label) is typically 16 chars; we send 48 chars
  const longLabel = 'DBS_CORPORATE_PLATINUM_REWARDS_CARD_VERY_LONG_NAME';

  const fields = [
    { code: '01', value: '998877' },
    { code: 'D8', value: longScheme },
    { code: 'L7', value: longLabel },
    { code: 'HC', value: '00' }
  ];

  const frame = netsProtocol.buildNetsFrame({
    ecn: '000000000302',
    functionCode: 'I0',
    versionCode: '01',
    responseCode: '00',
    fields
  });

  const parsed = netsProtocol.parseNetsFrame(frame, { isQr: false, txnType: 'I0' });

  assert.strictEqual(parsed.isApproved, true);
  assert.strictEqual(parsed.fields['D8'], longScheme);
  assert.strictEqual(parsed.fields['L7'], longLabel);
});

// ---------------------------------------------------------------------------------
// Scenario 3: Subsequent Fields Extracted Correctly After an Oversized Field
// ---------------------------------------------------------------------------------
runTest('3. Subsequent fields extracted accurately after an oversized field', () => {
  // Field 02 (Card Issuer Response Text) documented ~20 chars; we send 120 bytes of diagnostics
  const oversizedField02 = 'AUTH_DATA_EXTENDED_DIAGNOSTIC_LOGGING_STRING_WITH_EXTRA_ASCII_INFORMATION_FROM_TERMINAL_AND_CARD_ISSUER_NETWORK_GATEWAY';

  const fields = [
    { code: '02', value: oversizedField02 },       // Oversized field in front
    { code: '01', value: '445566' },               // Known critical field
    { code: '65', value: '000999' },               // STAN
    { code: 'D3', value: 'RRN_AFTER_LONG_FIELD' }, // RRN
    { code: 'HC', value: '00' },                   // Host Code
    { code: 'HD', value: 'POSREF1234567' },        // ECR Ref
    { code: '40', value: '000000005000' }          // Amount
  ];

  const frame = netsProtocol.buildNetsFrame({
    ecn: '000000000303',
    functionCode: '30',
    versionCode: '01',
    responseCode: '00',
    fields
  });

  const parsed = netsProtocol.parseNetsFrame(frame, { isQr: false, txnType: '01' });

  assert.strictEqual(parsed.isApproved, true);
  assert.strictEqual(parsed.fields['02'], oversizedField02);
  // Subsequent fields must not have their offsets corrupted
  assert.strictEqual(parsed.fields['01'], '445566');
  assert.strictEqual(parsed.fields['65'], '000999');
  assert.strictEqual(parsed.fields['D3'], 'RRN_AFTER_LONG_FIELD');
  assert.strictEqual(parsed.fields['HC'], '00');
  assert.strictEqual(parsed.fields['HD'], 'POSREF1234567');
  assert.strictEqual(parsed.fields['40'], '000000005000');
});

// ---------------------------------------------------------------------------------
// Scenario 4: Encoded BCD Length Delineates Exact Field Boundaries
// ---------------------------------------------------------------------------------
runTest('4. BCD length header accurately dictates boundary even with embedded spaces/numbers', () => {
  // Value contains spaces, punctuation, numbers, and hex-like patterns
  const complexValue = '  ABC 123 !@# $ % ^ & * ( ) _ + -- 000000 0x1C_NOT_A_REAL_FS  ';
  const fields = [
    { code: 'HD', value: complexValue },
    { code: '01', value: '778899' },
    { code: 'HC', value: '00' }
  ];

  const frame = netsProtocol.buildNetsFrame({
    ecn: '000000000304',
    functionCode: '30',
    versionCode: '01',
    responseCode: '00',
    fields
  });

  const parsed = netsProtocol.parseNetsFrame(frame, { isQr: false, txnType: '01' });

  assert.strictEqual(parsed.fields['HD'], complexValue);
  assert.strictEqual(parsed.fields['01'], '778899');
  assert.strictEqual(parsed.fields['HC'], '00');
});

// ---------------------------------------------------------------------------------
// Scenario 5: Malformed or Truncated Field Rejected Safely
// ---------------------------------------------------------------------------------
runTest('5. Malformed/truncated field whose BCD length overflows frame is rejected with Error', () => {
  // Construct a valid frame first
  const fields = [
    { code: '01', value: '123456' },
    { code: 'HC', value: '00' }
  ];
  const validFrame = netsProtocol.buildNetsFrame({
    ecn: '000000000305',
    functionCode: '30',
    versionCode: '01',
    responseCode: '00',
    fields
  });

  // Tamper: Modify BCD length of Field 01 to claim 0099 bytes (which overflows the buffer)
  // Field 01 header starts after 2-byte BCD len + 18-byte message header = offset 20
  // Field Code '01' is at offset 20, 21. BCD length is at offset 22, 23.
  const tamperedFrame = Buffer.from(validFrame);
  tamperedFrame[22] = 0x00;
  tamperedFrame[23] = 0x99; // BCD 99

  // Also update LRC to isolate the field length check
  const newLrc = netsProtocol.calculateLrc(tamperedFrame.slice(2, tamperedFrame.length - 1));
  tamperedFrame[tamperedFrame.length - 1] = newLrc;

  assert.throws(() => {
    netsProtocol.parseNetsFrame(tamperedFrame, { strictLength: false });
  }, /overflows remaining message body/);
});

// ---------------------------------------------------------------------------------
// Scenario 6: Missing or Corrupted FS Delimiter Rejected Safely
// ---------------------------------------------------------------------------------
runTest('6. Missing or corrupted FS delimiter triggers error instead of out-of-bounds read', () => {
  const fields = [
    { code: '01', value: '123456' },
    { code: 'HC', value: '00' }
  ];
  const validFrame = netsProtocol.buildNetsFrame({
    ecn: '000000000306',
    functionCode: '30',
    versionCode: '01',
    responseCode: '00',
    fields
  });

  // Replace Field 01 terminating FS (offset 30) with non-FS byte (0x58 = 'X')
  const tamperedFrame = Buffer.from(validFrame);
  const fsOffset = 20 + 2 + 2 + 6; // header(20) + code(2) + len(2) + data(6) = offset 30
  assert.strictEqual(tamperedFrame[fsOffset], 0x1C); // Sanity check: must be 0x1C
  tamperedFrame[fsOffset] = 0x58; // Replace with 'X'

  const newLrc = netsProtocol.calculateLrc(tamperedFrame.slice(2, tamperedFrame.length - 1));
  tamperedFrame[tamperedFrame.length - 1] = newLrc;

  assert.throws(() => {
    netsProtocol.parseNetsFrame(tamperedFrame, { strictLength: false });
  }, /missing FS \(0x1C\) delimiter/);
});

// ---------------------------------------------------------------------------------
// Scenario 7: Approval and Decline Logic Strictly Maintained
// ---------------------------------------------------------------------------------
runTest('7. Longer-than-spec field values do not bypass strict approval validation', () => {
  // Case A: Long field with non-zero approval code in NETS Card -> Approved
  const fieldsApproved = [
    { code: '01', value: 'APPR99' },
    { code: 'HC', value: '00' },
    { code: 'RP', value: 'VERY_LONG_RECEIPT_'.repeat(20) } // 360 bytes receipt text
  ];
  const frameA = netsProtocol.buildNetsFrame({ ecn: '000000000307', functionCode: '30', versionCode: '01', responseCode: '00', fields: fieldsApproved });
  const parsedA = netsProtocol.parseNetsFrame(frameA, { isQr: false, txnType: '01' });
  assert.strictEqual(parsedA.isApproved, true);

  // Case B: Long field with declined host code (HC='51') -> Strictly Declined
  const fieldsDeclined = [
    { code: '01', value: 'APPR99' },
    { code: 'HC', value: '51' },
    { code: 'RP', value: 'VERY_LONG_RECEIPT_'.repeat(20) }
  ];
  const frameB = netsProtocol.buildNetsFrame({ ecn: '000000000307', functionCode: '30', versionCode: '01', responseCode: '51', fields: fieldsDeclined });
  const parsedB = netsProtocol.parseNetsFrame(frameB, { isQr: false, txnType: '01' });
  assert.strictEqual(parsedB.isApproved, false);

  // Case C: Long field with missing approval code in Card transaction -> Strictly Declined
  const fieldsMissingAppr = [
    { code: '01', value: '' },
    { code: 'HC', value: '00' },
    { code: 'RP', value: 'VERY_LONG_RECEIPT_'.repeat(20) }
  ];
  const frameC = netsProtocol.buildNetsFrame({ ecn: '000000000307', functionCode: '30', versionCode: '01', responseCode: '00', fields: fieldsMissingAppr });
  const parsedC = netsProtocol.parseNetsFrame(frameC, { isQr: false, txnType: '01' });
  assert.strictEqual(parsedC.isApproved, false);
});

// ---------------------------------------------------------------------------------
// Scenario 8: NETS Card, QR and Credit Card Workflows Unaffected
// ---------------------------------------------------------------------------------
runTest('8. NETS Card, QR, and Credit Card workflows handle long fields without regressions', () => {
  // NETS Card (FC 30 T2=01)
  const cardFields = [
    { code: 'T2', value: '01' },
    { code: '01', value: '112233' },
    { code: '65', value: '000012' },
    { code: 'HD', value: 'P179515584642_EXTENDED_REF_DATA' }, // Spec is 13; here 31 chars
    { code: 'HC', value: '00' }
  ];
  const frameCard = netsProtocol.buildNetsFrame({ ecn: '000000000308', functionCode: '30', versionCode: '01', responseCode: '00', fields: cardFields });
  const parsedCard = netsProtocol.parseNetsFrame(frameCard, { isQr: false, txnType: '01' });
  assert.strictEqual(parsedCard.isApproved, true);
  assert.strictEqual(parsedCard.fields['HD'], 'P179515584642_EXTENDED_REF_DATA');

  // NETS QR (FC 30 T2=04)
  const qrFields = [
    { code: 'T2', value: '04' },
    { code: '01', value: '000000' },
    { code: 'D3', value: '1795082348136_EXTENDED_TRANSACTION_IDENTIFIER' }, // Spec is 12; here 45 chars
    { code: 'HC', value: '00' }
  ];
  const frameQr = netsProtocol.buildNetsFrame({ ecn: '000000000308', functionCode: '30', versionCode: '01', responseCode: '00', fields: qrFields });
  const parsedQr = netsProtocol.parseNetsFrame(frameQr, { isQr: true, txnType: '04' });
  assert.strictEqual(parsedQr.isApproved, true);
  assert.strictEqual(parsedQr.fields['D3'], '1795082348136_EXTENDED_TRANSACTION_IDENTIFIER');

  // NETS Credit Card (FC I0)
  const ccFields = [
    { code: '01', value: 'CREDIT88' },
    { code: '30', value: '411111******1111' },
    { code: 'D7', value: 'DBS_BANK_SINGAPORE_HEADQUARTERS' }, // Spec is ~6; here 31 chars
    { code: 'D8', value: 'VISA_PLATINUM_REWARDS' },           // Spec is ~4; here 21 chars
    { code: 'HC', value: '00' }
  ];
  const frameCc = netsProtocol.buildNetsFrame({ ecn: '000000000308', functionCode: 'I0', versionCode: '01', responseCode: '00', fields: ccFields });
  const parsedCc = netsProtocol.parseNetsFrame(frameCc, { isQr: false, txnType: 'I0' });
  assert.strictEqual(parsedCc.isApproved, true);
  assert.strictEqual(parsedCc.fields['D7'], 'DBS_BANK_SINGAPORE_HEADQUARTERS');
  assert.strictEqual(parsedCc.fields['D8'], 'VISA_PLATINUM_REWARDS');
});

console.log('\nAll POS-005 test cases passed successfully!');
