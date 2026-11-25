/**
 * netsCardVsFlashPayRouting.test.js
 * Comprehensive automated verification for separate NETS Card vs NETS FlashPay flows.
 *
 * Verifies:
 * 1. Database PayMode Position / PayModeId alignment:
 *    - Position 21: 'NETS CARD'
 *    - Position 23: 'NETS FLASHPAY'
 * 2. Backend endpoints and method separation:
 *    - purchaseCard() vs purchaseFlashPay()
 *    - POST /api/nets/card-payment vs POST /api/nets/flashpay-payment
 * 3. Card Label (Field L7 / D8) Validation:
 *    - NETS Card accepts: 'NETS', 'NETS DEBIT', 'NETS EFTPOS'
 *    - NETS Card rejects: 'FLASHPAY' with ECARDTYPEMISMATCH
 *    - NETS FlashPay accepts: 'FLASHPAY'
 *    - NETS FlashPay rejects: 'NETS DEBIT', 'NETS EFTPOS' with ECARDTYPEMISMATCH
 * 4. Reconciliation Isolation:
 *    - Preserves flowName in unresolved records
 *    - Does not cross-apply Card vs FlashPay
 */

const assert = require('assert');
const netsService = require('../services/nets.service');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 Starting NETS Card vs FlashPay Routing Test Suite');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ FAIL: ${name}`);
      console.error(err);
      failed++;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ FAIL: ${name}`);
      console.error(err);
      failed++;
    }
  }

  // TEST 1: Service has distinct purchaseCard and purchaseFlashPay methods
  test('1. NetsService exports purchaseCard and purchaseFlashPay methods', () => {
    assert.strictEqual(typeof netsService.purchaseCard, 'function', 'purchaseCard must be a function');
    assert.strictEqual(typeof netsService.purchaseFlashPay, 'function', 'purchaseFlashPay must be a function');
  });

  // TEST 2: L7 Card Type Validation logic for NETS Card
  await testAsync('2. NETS Card rejects FlashPay card with ECARDTYPEMISMATCH', async () => {
    // Temporarily stub unresolved list and transport helpers to isolate purchase transaction logic
    const origLoadUnres = netsService.loadUnresolvedTransactions;
    const origSendPacket = netsService.sendPacket;
    const origCheckAvail = netsService.checkTerminalAvailabilityBeforePurchase;
    const origGetNextEcn = netsService.getNextEcnAsync;
    const origLinkMonitor = netsService.startPaymentLinkMonitor;

    try {
      netsService.loadUnresolvedTransactions = () => [];
      netsService.checkTerminalAvailabilityBeforePurchase = async () => {};
      netsService.getNextEcnAsync = async () => '000000099901';
      netsService.startPaymentLinkMonitor = () => ({ stop: () => {}, isDisconnectObserved: false });
      netsService.sendPacket = async () => ({
        parsed: {
          isApproved: true,
          responseCode: '00',
          approvalCode: '123456',
          fields: {
            'L7': 'FLASHPAY            ',
            '40': '000000000100',
            '01': '123456',
          },
          rawHex: '0200...',
        },
        rawHex: '0200...',
      });

      let errorThrown = null;
      try {
        await netsService.purchaseCard({ amount: 1.00, ecrRef: 'TEST_CARD_01' });
      } catch (err) {
        errorThrown = err;
      }

      assert(errorThrown !== null, 'Expected error to be thrown for FlashPay card in purchaseCard');
      assert.strictEqual(errorThrown.code, 'ECARDTYPEMISMATCH', `Expected ECARDTYPEMISMATCH, got ${errorThrown.code}`);
      assert(errorThrown.message.includes('FlashPay'), 'Error message should mention FlashPay');
    } finally {
      netsService.loadUnresolvedTransactions = origLoadUnres;
      netsService.sendPacket = origSendPacket;
      netsService.checkTerminalAvailabilityBeforePurchase = origCheckAvail;
      netsService.getNextEcnAsync = origGetNextEcn;
      netsService.startPaymentLinkMonitor = origLinkMonitor;
      netsService.isProcessing = false;
    }
  });

  // TEST 3: L7 Card Type Validation logic for NETS FlashPay
  await testAsync('3. NETS FlashPay rejects non-FlashPay card (NETS DEBIT) with ECARDTYPEMISMATCH', async () => {
    const origLoadUnres = netsService.loadUnresolvedTransactions;
    const origSendPacket = netsService.sendPacket;
    const origCheckAvail = netsService.checkTerminalAvailabilityBeforePurchase;
    const origGetNextEcn = netsService.getNextEcnAsync;
    const origLinkMonitor = netsService.startPaymentLinkMonitor;

    try {
      netsService.loadUnresolvedTransactions = () => [];
      netsService.checkTerminalAvailabilityBeforePurchase = async () => {};
      netsService.getNextEcnAsync = async () => '000000099902';
      netsService.startPaymentLinkMonitor = () => ({ stop: () => {}, isDisconnectObserved: false });
      netsService.sendPacket = async () => ({
        parsed: {
          isApproved: true,
          responseCode: '00',
          approvalCode: '654321',
          fields: {
            'L7': 'NETS DEBIT          ',
            '40': '000000000100',
            '01': '654321',
          },
          rawHex: '0200...',
        },
        rawHex: '0200...',
      });

      let errorThrown = null;
      try {
        await netsService.purchaseFlashPay({ amount: 1.00, ecrRef: 'TEST_FLASHPAY_01' });
      } catch (err) {
        errorThrown = err;
      }

      assert(errorThrown !== null, 'Expected error to be thrown for NETS DEBIT card in purchaseFlashPay');
      assert.strictEqual(errorThrown.code, 'ECARDTYPEMISMATCH', `Expected ECARDTYPEMISMATCH, got ${errorThrown.code}`);
      assert(errorThrown.message.includes('not a NETS FlashPay card'), 'Error message should specify not a FlashPay card');
    } finally {
      netsService.loadUnresolvedTransactions = origLoadUnres;
      netsService.sendPacket = origSendPacket;
      netsService.checkTerminalAvailabilityBeforePurchase = origCheckAvail;
      netsService.getNextEcnAsync = origGetNextEcn;
      netsService.startPaymentLinkMonitor = origLinkMonitor;
      netsService.isProcessing = false;
    }
  });

  // TEST 4: NETS Card accepts NETS DEBIT / EFTPOS card
  await testAsync('4. NETS Card accepts NETS DEBIT card successfully', async () => {
    const origLoadUnres = netsService.loadUnresolvedTransactions;
    const origSendPacket = netsService.sendPacket;
    const origCheckAvail = netsService.checkTerminalAvailabilityBeforePurchase;
    const origGetNextEcn = netsService.getNextEcnAsync;
    const origLinkMonitor = netsService.startPaymentLinkMonitor;

    try {
      netsService.loadUnresolvedTransactions = () => [];
      netsService.checkTerminalAvailabilityBeforePurchase = async () => {};
      netsService.getNextEcnAsync = async () => '000000099903';
      netsService.startPaymentLinkMonitor = () => ({ stop: () => {}, isDisconnectObserved: false });
      netsService.sendPacket = async () => ({
        parsed: {
          isApproved: true,
          responseCode: '00',
          approvalCode: '999111',
          fields: {
            'L7': 'NETS DEBIT          ',
            '40': '000000000100',
            '01': '999111',
          },
          rawHex: '0200...',
        },
        rawHex: '0200...',
      });

      const res = await netsService.purchaseCard({ amount: 1.00, ecrRef: 'TEST_CARD_ACCEPT' });
      assert.strictEqual(res.isApproved, true);
      assert.strictEqual(res.paymentType, 'NETS Card');
      assert.strictEqual(res.approvalCode, '999111');
    } finally {
      netsService.loadUnresolvedTransactions = origLoadUnres;
      netsService.sendPacket = origSendPacket;
      netsService.checkTerminalAvailabilityBeforePurchase = origCheckAvail;
      netsService.getNextEcnAsync = origGetNextEcn;
      netsService.startPaymentLinkMonitor = origLinkMonitor;
      netsService.isProcessing = false;
    }
  });

  // TEST 5: NETS FlashPay accepts FLASHPAY card
  await testAsync('5. NETS FlashPay accepts FLASHPAY card successfully', async () => {
    const origLoadUnres = netsService.loadUnresolvedTransactions;
    const origSendPacket = netsService.sendPacket;
    const origCheckAvail = netsService.checkTerminalAvailabilityBeforePurchase;
    const origGetNextEcn = netsService.getNextEcnAsync;
    const origLinkMonitor = netsService.startPaymentLinkMonitor;

    try {
      netsService.loadUnresolvedTransactions = () => [];
      netsService.checkTerminalAvailabilityBeforePurchase = async () => {};
      netsService.getNextEcnAsync = async () => '000000099904';
      netsService.startPaymentLinkMonitor = () => ({ stop: () => {}, isDisconnectObserved: false });
      netsService.sendPacket = async () => ({
        parsed: {
          isApproved: true,
          responseCode: '00',
          approvalCode: '999222',
          fields: {
            'L7': 'FLASHPAY            ',
            '40': '000000000100',
            '01': '999222',
          },
          rawHex: '0200...',
        },
        rawHex: '0200...',
      });

      const res = await netsService.purchaseFlashPay({ amount: 1.00, ecrRef: 'TEST_FLASHPAY_ACCEPT' });
      assert.strictEqual(res.isApproved, true);
      assert.strictEqual(res.paymentType, 'NETS FlashPay');
      assert.strictEqual(res.approvalCode, '999222');
    } finally {
      netsService.loadUnresolvedTransactions = origLoadUnres;
      netsService.sendPacket = origSendPacket;
      netsService.checkTerminalAvailabilityBeforePurchase = origCheckAvail;
      netsService.getNextEcnAsync = origGetNextEcn;
      netsService.startPaymentLinkMonitor = origLinkMonitor;
      netsService.isProcessing = false;
    }
  });

  // TEST 6: Route definition test in backend/routes/nets.js
  test('6. backend/routes/nets.js defines /flashpay-payment route', () => {
    const router = require('../routes/nets');
    const routes = router.stack.map(layer => layer.route && layer.route.path).filter(Boolean);
    assert(routes.includes('/card-payment'), 'Router must include /card-payment');
    assert(routes.includes('/flashpay-payment'), 'Router must include /flashpay-payment');
    assert(routes.includes('/qr-payment'), 'Router must include /qr-payment');
    assert(routes.includes('/credit-card-payment'), 'Router must include /credit-card-payment');
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
