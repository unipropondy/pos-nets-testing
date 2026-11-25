/**
 * Comprehensive Unit Test Suite:
 * 1. Official NETS ECR II FC56 (Last Approved Transaction Inquiry) Nested TD Frame Decoding
 * 2. Ambiguous/Unparseable Response Protection (Issue 1 fix verification)
 * 3. Cashier Second Pay FC56 Reconciliation with Conclusive Match
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { parseNetsFrame, buildNetsFrame } = require('../utils/netsProtocol');
const { NetsService } = require('../services/nets.service');

const UNRESOLVED_TEST_PATH = path.join(__dirname, '../config/test_nets_unres_fc56_parser.json');
const AUDIT_TEST_PATH = path.join(__dirname, '../config/test_nets_audit_fc56_parser.json');
process.env.NETS_UNRESOLVED_FILE_PATH = UNRESOLVED_TEST_PATH;
process.env.NETS_AUDIT_FILE_PATH = AUDIT_TEST_PATH;
process.env.NODE_ENV = 'test';

function cleanup() {
  if (fs.existsSync(UNRESOLVED_TEST_PATH)) {
    try { fs.unlinkSync(UNRESOLVED_TEST_PATH); } catch (_) {}
  }
  if (fs.existsSync(AUDIT_TEST_PATH)) {
    try { fs.unlinkSync(AUDIT_TEST_PATH); } catch (_) {}
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 TESTING FC56 NESTED TD PARSING & RECONCILIATION SAFETY');
  console.log('================================================================\n');

  cleanup();

  try {
    // -------------------------------------------------------------
    // TEST 1: Parse actual 886-byte terminal FC56 response captured at 05:21:04
    // -------------------------------------------------------------
    console.log('Test 1: Parsing actual 886-byte terminal FC56 captured response...');
    const auditData = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/netsAuditHistory.json'), 'utf8'));
    const rec0 = auditData.find(r => r.rawHex && r.rawHex.length > 1000);
    assert(rec0, 'Must have captured audit record with rawHex');

    const rawBuf = Buffer.from(rec0.rawHex, 'hex');
    const parsed = parseNetsFrame(rawBuf);

    assert.strictEqual(parsed.functionCode, '56', 'Top-level function code must be 56');
    assert.strictEqual(parsed.responseCode, '00', 'Top-level response code must be 00');
    assert(parsed.nestedTransaction, 'Must have parsed nestedTransaction inside TD');
    assert.strictEqual(parsed.nestedTransaction.ecn, '000000017634', 'Nested transaction ECN must match 000000017634');
    assert.strictEqual(parsed.nestedTransaction.functionCode, '30', 'Nested transaction function code must be 30');
    assert.strictEqual(parsed.nestedTransaction.responseCode, '00', 'Nested transaction response code must be 00');
    assert.strictEqual(parsed.nestedTransaction.isApproved, true, 'Nested transaction must be approved');

    // Check merged fields on parsed.fields
    assert.strictEqual(parsed.fields['HD'], '1795525055328', 'Field HD must be extracted from TD');
    assert.strictEqual(parsed.fields['40'], '000000000100', 'Field 40 must be extracted from TD');
    assert.strictEqual(parsed.fields['01'], '000011', 'Field 01 must be extracted from TD');
    assert.strictEqual(parsed.fields['HC'], '00', 'Field HC must be extracted from TD');
    assert.strictEqual(parsed.approvalCode, '000011', 'Approval code must be extracted as 000011');
    assert.strictEqual(parsed.isApproved, true, 'Overall FC56 parsed status must be approved');
    console.log('✅ Test 1 Passed: 886-byte FC56 response correctly decoded nested fields (HD, 40, 01, HC).');

    // -------------------------------------------------------------
    // TEST 2: Ambiguous/Missing Fields Protection (Safety Guard)
    // When terminal returns FC56 with missing inqRef / inqAmt, service MUST NOT
    // treat as confirmed decline or clear unresolved records!
    // -------------------------------------------------------------
    console.log('\nTest 2: Verifying ambiguous/unparseable FC56 response protection...');
    const service = new NetsService();
    service.checkTerminalAvailabilityBeforePurchase = async () => true;

    const testEcn = '000000017645';
    const testRef = '1795584062530';
    const testAmt = 1;

    service.saveUnresolvedTransaction({
      ecn: testEcn,
      originalEcn: testEcn,
      ecrRef: testRef,
      amount: testAmt,
      amountStr: '000000000100',
      flowName: 'NETS Card',
      txnType: '01',
      status: 'UNRESOLVED',
      startedAt: new Date().toISOString(),
    });

    // Mock sendPacket to return FC56 with empty fields
    service.sendPacket = async function () {
      return {
        parsed: {
          ecn: testEcn,
          functionCode: '56',
          responseCode: '00',
          responseDescription: 'Approved',
          isApproved: true,
          approvalCode: '',
          fields: {}, // Missing HD, HS, 40
        },
        rawHex: '0019',
      };
    };

    let caughtError = null;
    try {
      await service.purchaseCard({
        amount: testAmt,
        ecrRef: testRef,
        isCashierInitiated: true,
        requestId: 'REQ_TEST_AMBIGUOUS',
        triggerSource: 'CASHIER_SECOND_PAY',
      });
    } catch (err) {
      caughtError = err;
    }

    assert(caughtError, 'Must throw error on ambiguous/unparseable FC56 response');
    assert.strictEqual(caughtError.code, 'ERECONCILIATIONREQUIRED', 'Error code must be ERECONCILIATIONREQUIRED');

    // Crucial: unresolved record MUST STILL EXIST!
    const unresAfterAmbig = service.loadUnresolvedTransactions();
    assert.strictEqual(unresAfterAmbig.length, 1, 'Unresolved record MUST NOT be cleared when FC56 fields are ambiguous/empty');
    assert.strictEqual(unresAfterAmbig[0].ecn, testEcn);
    console.log('✅ Test 2 Passed: Ambiguous FC56 retained UNRESOLVED state and threw ERECONCILIATIONREQUIRED.');

    // -------------------------------------------------------------
    // TEST 3: Matching Conclusive Approval
    // When FC56 returns matching nested HD & 40 with approval code,
    // transaction reconciles as APPROVED and clears unresolved record.
    // -------------------------------------------------------------
    console.log('\nTest 3: Verifying conclusive matching FC56 approval...');
    service.sendPacket = async function () {
      return {
        parsed,
        rawHex: rec0.rawHex,
      };
    };

    // Clear unresolved records before Test 3 to test clean single-record clearance
    service.saveUnresolvedTransactions([]);

    // Seed pending record to match rec0's HD and amount
    service.saveUnresolvedTransaction({
      ecn: '000000017634',
      originalEcn: '000000017634',
      ecrRef: '1795525055328',
      amount: 1,
      amountStr: '000000000100',
      flowName: 'NETS Card',
      txnType: '01',
      status: 'UNRESOLVED',
      startedAt: new Date().toISOString(),
    });

    const matchResult = await service.purchaseCard({
      amount: 1,
      ecrRef: '1795525055328',
      isCashierInitiated: true,
      requestId: 'REQ_TEST_MATCH',
      triggerSource: 'CASHIER_SECOND_PAY',
    });

    assert.strictEqual(matchResult.isApproved, true, 'Match result must be approved');
    assert.strictEqual(matchResult.approvalCode, '000011', 'Approval code must be 000011');
    assert.strictEqual(matchResult.ecrRef, '1795525055328', 'ECR reference must match');

    const unresAfterMatch = service.loadUnresolvedTransactions();
    assert.strictEqual(unresAfterMatch.length, 0, 'Unresolved record safely cleared on conclusive match');
    console.log('✅ Test 3 Passed: Conclusive matching FC56 approved transaction and cleared unresolved state.');

    console.log('\n================================================================');
    console.log('🎉 ALL FC56 PARSER AND RECONCILIATION TESTS PASSED!');
    console.log('================================================================');
  } finally {
    cleanup();
  }
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
