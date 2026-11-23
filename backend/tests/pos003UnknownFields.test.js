/**
 * Test Suite: POS-003 - Handling of Additional/Unknown Field Codes in NETS ECR II Frames
 * 
 * Verifies that:
 * 1. The response parser identifies known fields accurately.
 * 2. Additional/unknown field codes do not cause parsing exceptions or crashes.
 * 3. Extraction of subsequent valid fields continues without offset disruption or truncation.
 * 4. Field boundaries and BCD lengths are handled correctly.
 * 5. Approval validation (RC=00, HC=00, Field 01) remains strictly enforced.
 * 6. NETS Card (FC30/T2=01), NETS QR (FC30/T2=04), and NETS Credit Card (FC I0) workflows
 *    remain fully functional and isolated.
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
// Test 1: NETS Card (FC 30 T2=01) with an Unknown Field (ZZ) in the middle of the frame
// ---------------------------------------------------------------------------------
runTest('NETS Card (FC 30) with unknown field in middle of response', () => {
  const fields = [
    { code: '01', value: '789123' },              // Approval Code (Known)
    { code: 'ZZ', value: 'PROPRIETARY_EXTRA_DATA' }, // Unknown field code
    { code: '65', value: '000042' },              // STAN (Known)
    { code: 'D3', value: '1795082348136' },       // RRN (Known)
    { code: 'HC', value: '00' },                  // Host Response Code (Known)
    { code: 'HD', value: 'POS1234567890' },       // Enhanced ECR Ref (Known)
    { code: '40', value: '000000001500' },       // Amount $15.00 (Known)
    { code: 'RP', value: 'CARD PURCHASE APPROVED' } // Receipt text (Known)
  ];

  const frame = netsProtocol.buildNetsFrame({
    ecn: '000000000101',
    functionCode: '30',
    versionCode: '01',
    responseCode: '00',
    fields
  });

  const parsed = netsProtocol.parseNetsFrame(frame, { isQr: false, txnType: '01' });

  // 1. Transaction must be approved
  assert.strictEqual(parsed.isApproved, true);
  assert.strictEqual(parsed.responseCode, '00');
  assert.strictEqual(parsed.hostResponseCode, '00');
  assert.strictEqual(parsed.approvalCode, '789123');

  // 2. Unknown field was parsed and stored
  assert.strictEqual(parsed.fields['ZZ'], 'PROPRIETARY_EXTRA_DATA');

  // 3. Subsequent fields after unknown field are intact
  assert.strictEqual(parsed.fields['65'], '000042');
  assert.strictEqual(parsed.fields['D3'], '1795082348136');
  assert.strictEqual(parsed.fields['HC'], '00');
  assert.strictEqual(parsed.fields['HD'], 'POS1234567890');
  assert.strictEqual(parsed.fields['40'], '000000001500');
  assert.strictEqual(parsed.fields['RP'], 'CARD PURCHASE APPROVED');
});

// ---------------------------------------------------------------------------------
// Test 2: NETS QR (FC 30 T2=04) with multiple unknown fields at beginning, middle, and end
// ---------------------------------------------------------------------------------
runTest('NETS QR (FC 30) with unknown fields at beginning, middle, and end', () => {
  const fields = [
    { code: 'U1', value: 'INITIAL_UNKNOWN_TAG' },    // Unknown at start
    { code: 'T2', value: '04' },                    // QR Txn Type
    { code: '01', value: '000000' },                // QR zero approval code
    { code: 'U2', value: 'MIDDLE_UNKNOWN_TAG' },     // Unknown in middle
    { code: 'HC', value: '00' },                    // Host approval
    { code: '65', value: '000088' },                // STAN
    { code: 'D3', value: 'QR12345678901' },         // RRN
    { code: '40', value: '000000000200' },          // Amount $2.00
    { code: 'U3', value: 'TRAILING_UNKNOWN_TAG' }   // Unknown at end
  ];

  const frame = netsProtocol.buildNetsFrame({
    ecn: '000000000102',
    functionCode: '30',
    versionCode: '01',
    responseCode: '00',
    fields
  });

  const parsed = netsProtocol.parseNetsFrame(frame, { isQr: true, txnType: '04' });

  assert.strictEqual(parsed.isApproved, true);
  assert.strictEqual(parsed.fields['U1'], 'INITIAL_UNKNOWN_TAG');
  assert.strictEqual(parsed.fields['U2'], 'MIDDLE_UNKNOWN_TAG');
  assert.strictEqual(parsed.fields['U3'], 'TRAILING_UNKNOWN_TAG');
  assert.strictEqual(parsed.fields['T2'], '04');
  assert.strictEqual(parsed.fields['HC'], '00');
  assert.strictEqual(parsed.fields['65'], '000088');
  assert.strictEqual(parsed.fields['D3'], 'QR12345678901');
  assert.strictEqual(parsed.fields['40'], '000000000200');
});

// ---------------------------------------------------------------------------------
// Test 3: NETS Credit Card (FC I0) with unknown fields, verifying card issuer & scheme
// ---------------------------------------------------------------------------------
runTest('NETS Credit Card (FC I0) with unknown fields alongside Visa/Master/AMEX data', () => {
  const fields = [
    { code: '01', value: 'CC8899' },                // Credit Approval Code
    { code: '30', value: '411111******1111' },      // Masked PAN
    { code: 'D7', value: 'DBS' },                   // Issuer
    { code: 'D8', value: 'VISA' },                  // Card Scheme
    { code: '9H', value: 'DBS' },                   // Acquirer
    { code: '99', value: 'UNKNOWN_EMV_TAG_DATA' },  // Unknown field
    { code: 'HC', value: '00' },                    // Host code
    { code: 'D3', value: 'RRN9988776655' },         // RRN
    { code: 'HD', value: 'POSCREDIT1234' },         // Ref
    { code: '40', value: '000000010000' }           // Amount $100.00
  ];

  const frame = netsProtocol.buildNetsFrame({
    ecn: '000000000103',
    functionCode: 'I0',
    versionCode: '01',
    responseCode: '00',
    fields
  });

  const parsed = netsProtocol.parseNetsFrame(frame, { isQr: false, txnType: 'I0' });

  assert.strictEqual(parsed.isApproved, true);
  assert.strictEqual(parsed.approvalCode, 'CC8899');
  assert.strictEqual(parsed.fields['D7'], 'DBS');
  assert.strictEqual(parsed.fields['D8'], 'VISA');
  assert.strictEqual(parsed.fields['9H'], 'DBS');
  assert.strictEqual(parsed.fields['99'], 'UNKNOWN_EMV_TAG_DATA');
  assert.strictEqual(parsed.fields['HC'], '00');
  assert.strictEqual(parsed.fields['D3'], 'RRN9988776655');
  assert.strictEqual(parsed.fields['HD'], 'POSCREDIT1234');
  assert.strictEqual(parsed.fields['40'], '000000010000');
});

// ---------------------------------------------------------------------------------
// Test 4: Unknown field with empty data (length 0000)
// ---------------------------------------------------------------------------------
runTest('Unknown field with zero-length data (0000 BCD length)', () => {
  const fields = [
    { code: '01', value: '112233' },
    { code: 'E0', value: '' }, // Zero length unknown field
    { code: 'HC', value: '00' },
    { code: '65', value: '000001' }
  ];

  const frame = netsProtocol.buildNetsFrame({
    ecn: '000000000104',
    functionCode: '30',
    versionCode: '01',
    responseCode: '00',
    fields
  });

  const parsed = netsProtocol.parseNetsFrame(frame, { isQr: false, txnType: '01' });

  assert.strictEqual(parsed.isApproved, true);
  assert.strictEqual(parsed.fields['01'], '112233');
  assert.strictEqual(parsed.fields['E0'], '');
  assert.strictEqual(parsed.fields['HC'], '00');
  assert.strictEqual(parsed.fields['65'], '000001');
});

// ---------------------------------------------------------------------------------
// Test 5: Unknown field in a declined transaction does NOT falsely approve
// ---------------------------------------------------------------------------------
runTest('Decline status preserved even when response contains unknown fields', () => {
  const fields = [
    { code: 'ZZ', value: 'DECLINE_METADATA_UNKNOWN' },
    { code: 'HC', value: '51' } // Insufficient funds
  ];

  const frame = netsProtocol.buildNetsFrame({
    ecn: '000000000105',
    functionCode: '30',
    versionCode: '01',
    responseCode: '51',
    fields
  });

  const parsed = netsProtocol.parseNetsFrame(frame, { isQr: false, txnType: '01' });

  assert.strictEqual(parsed.isApproved, false);
  assert.strictEqual(parsed.responseCode, '51');
  assert.strictEqual(parsed.fields['ZZ'], 'DECLINE_METADATA_UNKNOWN');
  assert.strictEqual(parsed.fields['HC'], '51');
});

console.log('\nAll POS-003 test cases executed successfully!');
