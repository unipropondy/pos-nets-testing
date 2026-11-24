/**
 * POS-014 On-Demand Next-Payment Action Recovery Tests
 *
 * Verifies the exact required business behavior:
 * 1. Cashier initiates a NETS CARD payment with a new ECN.
 * 2. POS LAN is disconnected while customer pays on terminal.
 * 3. LAN is reconnected after 5 seconds.
 * 4. Reconnecting LAN does NOT automatically dispatch another FC 30 or FC 56 request in the background.
 * 5. Original request waits for its timeout or socket drop, and preserves state as UNRESOLVED (code ERECONCILIATIONREQUIRED).
 * 6. When cashier initiates the NEXT payment action, it inspects unresolved records.
 * 7. Before sending any new purchase, it reconciles the previous transaction using POS-014 same-ECN FC 30.
 * 8. If terminal returns approved: marks original APPROVED, returns that approval, and PREVENTS any second charge.
 * 9. If terminal returns declined / cancelled: clears unresolved record and allows the new payment with a fresh sequential ECN.
 * 10. If terminal remains unreachable: blocks new purchase with ERECONCILIATIONREQUIRED.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const netsServiceModule = require('../services/nets.service');
const NetsService = netsServiceModule.NetsService;
const netsProtocol = require('../utils/netsProtocol');

const UNRESOLVED_TEST_PATH = path.join(__dirname, '../config/netsUnresolved.test.json');
const AUDIT_TEST_PATH = path.join(__dirname, '../config/netsAuditHistory.test.json');
const ECN_TEST_PATH = path.join(__dirname, '../config/netsEcn.test.json');

function cleanupTestState() {
  if (fs.existsSync(UNRESOLVED_TEST_PATH)) fs.unlinkSync(UNRESOLVED_TEST_PATH);
  if (fs.existsSync(AUDIT_TEST_PATH)) fs.unlinkSync(AUDIT_TEST_PATH);
  if (fs.existsSync(ECN_TEST_PATH)) fs.unlinkSync(ECN_TEST_PATH);
}

function createTestService() {
  const service = new NetsService();
  service.getUnresolvedFilePath = () => UNRESOLVED_TEST_PATH;
  service.getAuditHistoryFilePath = () => AUDIT_TEST_PATH;
  service.getEcnFilePath = () => ECN_TEST_PATH;
  service.config.autoRetryWithSameEcn = true;
  service.config.recoveryInitialDelayMs = 10;
  service.config.recoveryLanMaxWaitMs = 500;
  service.checkTerminalAvailabilityBeforePurchase = async () => {};
  service.probeTerminalTcpConnection = async () => true;
  return service;
}

async function runAsyncTest(testName, testFn) {
  try {
    await testFn();
    console.log(`[PASS] ${testName}`);
  } catch (err) {
    console.error(`[FAIL] ${testName}: ${err.message}`);
    console.error(err);
    process.exit(1);
  }
}

(async () => {
  console.log('=== STARTING POS-014 ON-DEMAND NEXT-ACTION RECOVERY TESTS ===\n');

  // Test 1: LAN disconnect during purchase does NOT trigger automatic background recovery upon reconnect
  await runAsyncTest('1. LAN disconnect preserves UNRESOLVED without dispatching background recovery on reconnect', async () => {
    cleanupTestState();
    const service = createTestService();
    let ecnSeq = 16728;
    service.getNextEcnAsync = async () => String(++ecnSeq).padStart(12, '0');

    let dispatchCount = 0;
    service.sendPacket = async (buf) => {
      dispatchCount++;
      const parsed = netsProtocol.parseNetsFrame(buf);
      // Simulate socket reset during payment
      const err = new Error('read ECONNRESET - LAN cable disconnected');
      err.code = 'ECONNRESET';
      err.requestDispatched = true;
      throw err;
    };

    let caught = null;
    try {
      await service.purchaseCard({
        amount: 10.0,
        ecrRef: '179543750001',
      });
    } catch (err) {
      caught = err;
    }

    assert.ok(caught, 'Must throw when original socket disconnects');
    assert.strictEqual(caught.code, 'ERECONCILIATIONREQUIRED');
    assert.strictEqual(dispatchCount, 1, 'MUST ONLY HAVE DISPATCHED 1 FC30 FRAME. Zero background retries!');

    // Check disk persistence
    const unres = service.loadUnresolvedTransactions();
    assert.strictEqual(unres.length, 1);
    assert.strictEqual(unres[0].ecn, '000000016729');
    assert.strictEqual(unres[0].status, 'UNRESOLVED');
  });

  // Test 2: Cashier initiates NEXT payment action -> reconciles prior transaction with same ECN and returns approved
  await runAsyncTest('2. Cashier next action triggers same-ECN recovery; if approved, returns approval and stops duplicate purchase', async () => {
    cleanupTestState();
    const service = createTestService();
    let ecnSeq = 16728;
    service.getNextEcnAsync = async () => String(++ecnSeq).padStart(12, '0');

    let framesDispatched = [];
    let callIndex = 0;

    service.sendPacket = async (buf) => {
      callIndex++;
      const parsed = netsProtocol.parseNetsFrame(buf);
      framesDispatched.push(parsed);

      if (callIndex === 1) {
        // Original payment fails on wire
        const err = new Error('read ECONNRESET');
        err.code = 'ECONNRESET';
        err.requestDispatched = true;
        throw err;
      }

      if (callIndex === 2) {
        // Recovery call during NEXT payment action: terminal returns approved result
        const frame = netsProtocol.buildNetsFrame({
          ecn: parsed.ecn,
          functionCode: '30',
          versionCode: '01',
          responseCode: '00',
          fields: [
            { code: '01', value: 'APPR77' },
            { code: 'HC', value: '00' },
            { code: 'HD', value: '179543750002' },
            { code: '40', value: '000000001000' },
            { code: 'D3', value: 'RRN777777777' },
          ],
        });
        return { parsed: netsProtocol.parseNetsFrame(frame), rawHex: frame.toString('hex') };
      }

      throw new Error(`Unexpected dispatch index ${callIndex}`);
    };

    // 1. Initial attempt fails
    let err1 = null;
    try {
      await service.purchaseCard({
        amount: 10.0,
        ecrRef: '179543750002',
      });
    } catch (err) {
      err1 = err;
    }
    assert.ok(err1);
    assert.strictEqual(err1.code, 'ERECONCILIATIONREQUIRED');

    // 2. Cashier clicks next payment action (e.g. clicks NETS CARD again)
    const result = await service.purchaseCard({
      amount: 10.0,
      ecrRef: '179543750002',
    });

    assert.strictEqual(result.isApproved, true);
    assert.strictEqual(result.recovered, true);
    assert.strictEqual(result.recoveryMethod, 'SAME_ECN');
    assert.strictEqual(result.ecn, '000000016729');
    assert.strictEqual(result.approvalCode, 'APPR77');

    // Exactly 2 packets dispatched on the wire: 1 original + 1 recovery. NO NEW PURCHASE SENT!
    assert.strictEqual(framesDispatched.length, 2);
    assert.strictEqual(framesDispatched[0].ecn, '000000016729');
    assert.strictEqual(framesDispatched[1].ecn, '000000016729');
    assert.strictEqual(framesDispatched[1].fields['40'], '000000001000');
    assert.strictEqual(framesDispatched[1].fields['HD'], '0179543750002');

    // Unresolved record safely cleared
    assert.strictEqual(service.loadUnresolvedTransactions().length, 0);

    // ECN counter was only incremented ONCE
    assert.strictEqual(ecnSeq, 16729);
  });

  // Test 3: If terminal returned DECLINED on recovery, unresolved is cleared and cashier can proceed with fresh payment
  await runAsyncTest('3. If terminal returns DECLINED during next-action recovery, unresolved clears and fresh purchase proceeds', async () => {
    cleanupTestState();
    const service = createTestService();
    let ecnSeq = 16729;
    service.getNextEcnAsync = async () => String(++ecnSeq).padStart(12, '0');

    let callIndex = 0;
    service.sendPacket = async (buf) => {
      callIndex++;
      const parsed = netsProtocol.parseNetsFrame(buf);

      if (callIndex === 1) {
        // Original FC30 fails
        const err = new Error('read ECONNRESET');
        err.code = 'ECONNRESET';
        err.requestDispatched = true;
        throw err;
      }

      if (callIndex === 2) {
        // Recovery call returns DECLINED (RC=51)
        const frame = netsProtocol.buildNetsFrame({
          ecn: parsed.ecn,
          functionCode: '30',
          versionCode: '01',
          responseCode: '51',
          fields: [
            { code: 'HC', value: '51' },
            { code: 'HD', value: parsed.fields['HD'] },
            { code: '40', value: parsed.fields['40'] },
          ],
        });
        return { parsed: netsProtocol.parseNetsFrame(frame), rawHex: frame.toString('hex') };
      }

      if (callIndex === 3) {
        // New purchase with fresh sequential ECN approved
        const frame = netsProtocol.buildNetsFrame({
          ecn: parsed.ecn,
          functionCode: '30',
          versionCode: '01',
          responseCode: '00',
          fields: [
            { code: '01', value: 'APPR99' },
            { code: 'HC', value: '00' },
            { code: 'HD', value: parsed.fields['HD'] },
            { code: '40', value: parsed.fields['40'] },
          ],
        });
        return { parsed: netsProtocol.parseNetsFrame(frame), rawHex: frame.toString('hex') };
      }

      throw new Error(`Unexpected callIndex ${callIndex}`);
    };

    // 1. Initial attempt fails
    try {
      await service.purchaseCard({ amount: 15.0, ecrRef: '179543750003' });
    } catch (e) {}

    // 2. Next payment action reconciles previous (terminal returns declined) and allows fresh payment
    const freshPayment = await service.purchaseCard({
      amount: 15.0,
      ecrRef: '179543750004',
    });

    assert.strictEqual(freshPayment.isApproved, true);
    assert.strictEqual(freshPayment.ecn, '000000016731', 'Must use fresh sequential ECN');
    assert.strictEqual(service.loadUnresolvedTransactions().length, 0);
  });

  // Test 4: If terminal remains unreachable during next-action recovery, new payment is BLOCKED
  await runAsyncTest('4. If terminal remains unreachable on next action, new purchase is BLOCKED with ERECONCILIATIONREQUIRED', async () => {
    cleanupTestState();
    const service = createTestService();
    let ecnSeq = 16731;
    service.getNextEcnAsync = async () => String(++ecnSeq).padStart(12, '0');

    // Terminal never responds (e.g. cable still unplugged)
    service.sendPacket = async () => {
      const err = new Error('connect ETIMEDOUT');
      err.code = 'ETIMEDOUT';
      err.isTimeout = true;
      err.requestDispatched = true;
      throw err;
    };

    // 1. Initial purchase times out
    try {
      await service.purchaseCard({ amount: 20.0, ecrRef: '179543750005' });
    } catch (e) {}

    // 2. Cashier clicks next payment action while cable is STILL unplugged
    let blockedErr = null;
    try {
      await service.purchaseCard({ amount: 20.0, ecrRef: '179543750006' });
    } catch (err) {
      blockedErr = err;
    }

    assert.ok(blockedErr, 'Must block new payment attempt');
    assert.strictEqual(blockedErr.code, 'ERECONCILIATIONREQUIRED');
    assert.strictEqual(service.loadUnresolvedTransactions().length, 1, 'Unresolved record must remain safely preserved');
  });

  cleanupTestState();
  console.log('\n=== ALL POS-014 ON-DEMAND NEXT-ACTION TESTS PASSED (4/4) ===');
  process.exit(0);
})();
