const express = require('express');
const router = express.Router();
const netsService = require('../services/nets.service');
const { sanitizeFieldsForLogging, sanitizeRawHex } = require('../utils/netsProtocol');

// Module-level in-memory log buffer for NETS terminal debugging & admin monitoring
const COMM_LOGS = [];
const MAX_LOGS = 100;

function logComm(direction, title, data) {
  // Sanitize data to prevent leaking PAN, CAN, Track, or cardholder credentials
  let safeData = data;
  if (data && typeof data === 'object') {
    safeData = { ...data };
    if (safeData.fields) {
      safeData.fields = sanitizeFieldsForLogging(safeData.fields);
    }
    if (safeData.rawHex) {
      safeData.rawHex = sanitizeRawHex(safeData.rawHex);
    }
    if (safeData.receiptData) {
      // Receipt data may contain masked or unmasked PAN
      safeData.receiptData = safeData.receiptData.replace(/\b(\d{6})\d{4,9}(\d{4})\b/g, '$1******$2');
    }
  }

  const entry = {
    id: Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    timestamp: new Date().toISOString(),
    direction, // 'TX' (sent) | 'RX' (received) | 'ERR' (error) | 'INFO'
    title,
    data: safeData,
  };
  COMM_LOGS.unshift(entry);
  if (COMM_LOGS.length > MAX_LOGS) COMM_LOGS.pop();
  return entry;
}

// Wire up POS-001 TMS state change listener to broadcast over Socket.IO and logComm
netsService.setTmsStateListener((tmsState) => {
  logComm('INFO', `POS-001 TMS State: ${tmsState.status}`, tmsState);
  // Broadcast globally to all connected POS frontends
  if (typeof global !== 'undefined' && global.io) {
    global.io.emit('nets_tms_status', tmsState);
  }
});

/**
 * GET /api/nets/config
 * Get current NETS terminal LAN configuration
 */
router.get('/config', (req, res) => {
  res.json({
    success: true,
    config: netsService.config,
    currentEcn: netsService.getCurrentEcn(),
  });
});

/**
 * GET /api/nets/tms-status
 * POS-001: Get current TMS / terminal reboot status
 */
router.get('/tms-status', (req, res) => {
  res.json({
    success: true,
    tmsStatus: netsService.getTmsStatus(),
  });
});

/**
 * POST /api/nets/config
 * Update NETS terminal LAN configuration (IP, Port, Timeouts, RefFieldCode)
 */
router.post('/config', (req, res) => {
  try {
    const { terminalIp, terminalPort, financialTimeoutMs, adminTimeoutMs, ecrRefFieldCode } = req.body;
    const updated = netsService.saveConfig({
      terminalIp: terminalIp || netsService.config.terminalIp,
      terminalPort: terminalPort ? parseInt(terminalPort, 10) : netsService.config.terminalPort,
      financialTimeoutMs: financialTimeoutMs ? parseInt(financialTimeoutMs, 10) : netsService.config.financialTimeoutMs,
      adminTimeoutMs: adminTimeoutMs ? parseInt(adminTimeoutMs, 10) : netsService.config.adminTimeoutMs,
      ecrRefFieldCode: ecrRefFieldCode ? ecrRefFieldCode.toUpperCase().slice(0, 2) : netsService.config.ecrRefFieldCode,
    });
    logComm('INFO', 'Config Updated', updated);
    res.json({ success: true, config: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/nets/logs
 * Retrieve recent communication logs (sanitized)
 */
router.get('/logs', (req, res) => {
  res.json({ success: true, logs: COMM_LOGS });
});

/**
 * POST /api/nets/status
 * FC 55: Request Terminal Status
 */
router.post('/status', async (req, res) => {
  try {
    logComm('TX', 'FC 55 - Terminal Status Request', { ecn: netsService.getCurrentEcn() });
    const result = await netsService.requestTerminalStatus();
    logComm('RX', 'FC 55 - Terminal Status Response', result);

    res.json({
      success: result.success,
      responseCode: result.responseCode,
      description: result.description,
      fields: result.fields,
      rawHex: sanitizeRawHex(result.rawHex),
    });
  } catch (err) {
    logComm('ERR', 'FC 55 - Error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/nets/last-approved
 * FC 56: Get Last Approved Transaction
 */
router.post('/last-approved', async (req, res) => {
  try {
    logComm('TX', 'FC 56 - Last Approved Query', { ecn: netsService.getCurrentEcn() });
    const result = await netsService.getLastApprovedTransaction();
    logComm('RX', 'FC 56 - Last Approved Response', result);

    res.json({
      success: result.success,
      responseCode: result.responseCode,
      description: result.description,
      approvalCode: result.approvalCode,
      fields: result.fields,
      rawHex: sanitizeRawHex(result.rawHex),
    });
  } catch (err) {
    logComm('ERR', 'FC 56 - Error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/nets/logon
 * FC 80: NETS Logon
 */
router.post('/logon', async (req, res) => {
  try {
    logComm('TX', 'FC 80 - NETS Logon Request', { ecn: netsService.getCurrentEcn() });
    const result = await netsService.logon();
    logComm('RX', 'FC 80 - NETS Logon Response', result);

    res.json({
      success: result.success,
      responseCode: result.responseCode,
      description: result.description,
      fields: result.fields,
      rawHex: sanitizeRawHex(result.rawHex),
    });
  } catch (err) {
    logComm('ERR', 'FC 80 - Error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/nets/settlement
 * FC 81: NETS Settlement
 */
router.post('/settlement', async (req, res) => {
  try {
    logComm('TX', 'FC 81 - NETS Settlement Request', { ecn: netsService.getCurrentEcn() });
    const result = await netsService.settlement();
    logComm('RX', 'FC 81 - NETS Settlement Response', result);

    res.json({
      success: result.success,
      responseCode: result.responseCode,
      description: result.description,
      fields: result.fields,
      rawHex: sanitizeRawHex(result.rawHex),
    });
  } catch (err) {
    logComm('ERR', 'FC 81 - Error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/nets/credit-settlement
 * FC I5: Credit Card Settlement (Field 9G = DBS)
 */
router.post('/credit-settlement', async (req, res) => {
  try {
    const { acquirer = 'DBS' } = req.body;
    logComm('TX', `FC I5 - Credit Card Settlement Request (${acquirer})`, { ecn: netsService.getCurrentEcn(), acquirer });
    const result = await netsService.creditSettlement(acquirer);
    logComm('RX', 'FC I5 - Credit Card Settlement Response', result);

    res.json({
      success: result.success,
      responseCode: result.responseCode,
      description: result.description,
      fields: result.fields,
      rawHex: sanitizeRawHex(result.rawHex),
    });
  } catch (err) {
    logComm('ERR', 'FC I5 - Error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/nets/tms-update
 * FC 84: TMS / CTS Update
 */
router.post('/tms-update', async (req, res) => {
  try {
    logComm('TX', 'FC 84 - TMS / CTS Update Request', { ecn: netsService.getCurrentEcn() });
    const result = await netsService.tmsUpdate();
    logComm('RX', 'FC 84 - TMS / CTS Update Response', result);

    res.json({
      success: result.success,
      responseCode: result.responseCode,
      description: result.description,
      fields: result.fields,
      rawHex: sanitizeRawHex(result.rawHex),
    });
  } catch (err) {
    logComm('ERR', 'FC 84 - Error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/nets/end-of-day
 * Automated End-of-Day Settlement Sequence with 20s delays:
 * I5 -> 20s -> 81 -> 20s -> 80 -> 20s -> 84
 */
router.post('/end-of-day', async (req, res) => {
  try {
    const io = req.app.get('socketio');
    logComm('INFO', 'End of Day Sequence Started', {});

    const onProgress = (step, stepName, status, message) => {
      if (io) {
        io.emit('nets_eod_progress', { step, stepName, status, message, timestamp: new Date().toISOString() });
      }
    };

    const results = await netsService.runEndOfDaySequence(onProgress);
    logComm('INFO', 'End of Day Sequence Completed', results);

    res.json({ success: true, results });
  } catch (err) {
    logComm('ERR', 'End of Day Sequence Error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Helper to process and broadcast payment transactions cleanly
 */
async function handlePaymentExecution(req, res, { isQr, isCreditCard = false, title, paymentMethodName }) {
  const { amount, ecrRef, tableId = null } = req.body;
  const io = req.app.get('socketio');

  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return res.status(400).json({ success: false, error: 'Valid amount is required.' });
  }

  logComm('TX', title, { amount, ecrRef, isQr, isCreditCard, tableId });

  // Broadcast initial terminal payment status
  const waitingMessage = isCreditCard
    ? 'Please insert, swipe or tap Credit Card (Visa/Master/AMEX) on terminal...'
    : isQr
      ? 'Presenting QR code on terminal...'
      : 'Please tap, insert card or present mobile device on NETS terminal...';

  if (io) {
    io.emit('terminal_payment_sync', {
      tableId,
      status: 'WAITING_CARD',
      message: waitingMessage,
      paymentMethod: paymentMethodName,
      amount: parseFloat(amount),
      ecrRef,
    });
  }

  try {
    const onProgress = (prog) => {
      if (io) {
        const isReconciling = prog.status === 'recovery_wait' || prog.status === 'recovering';
        io.emit('terminal_payment_sync', {
          tableId,
          status: isReconciling ? 'RECONCILING' : 'PROCESSING',
          message: prog.message,
          paymentMethod: paymentMethodName,
          amount: parseFloat(amount),
          ecrRef,
        });
      }
    };

    let result;
    if (isCreditCard) {
      result = await netsService.purchaseCreditCard({ amount: parseFloat(amount), ecrRef, onProgress });
    } else if (isQr) {
      result = await netsService.purchaseQr({ amount: parseFloat(amount), ecrRef, onProgress });
    } else {
      result = await netsService.purchaseCard({ amount: parseFloat(amount), ecrRef, onProgress });
    }

    logComm('RX', `${title} Result`, result);

    if (result.isApproved) {
      if (io) {
        io.emit('terminal_payment_sync', {
          tableId,
          status: 'APPROVED',
          message: `${paymentMethodName} Payment Approved by NETS!`,
          paymentMethod: paymentMethodName,
          amount: parseFloat(amount),
          approvalCode: result.approvalCode,
          stan: result.stan,
          rrn: result.rrn,
          ecrRef: result.ecrRef,
          receiptData: result.receiptData,
        });
      }
      return res.json({
        success: true,
        approved: true,
        status: 'approved',
        paymentMethod: paymentMethodName,
        ...result,
        rawHex: sanitizeRawHex(result.rawHex),
      });
    } else {
      const isCancelled = result.responseCode === 'XX';
      const isTimeout = result.responseCode === 'TO';
      const syncStatus = isCancelled ? 'CANCELLED' : isTimeout ? 'TIMEOUT' : 'FAILED';
      const statusType = isCancelled ? 'cancelled' : isTimeout ? 'timeout' : 'declined';
      const userMessage = isCancelled
        ? 'Transaction Cancelled'
        : isTimeout
          ? 'Transaction Timed Out'
          : (result.approvalReason || result.responseDescription || `${paymentMethodName} declined by terminal.`);

      if (io) {
        io.emit('terminal_payment_sync', {
          tableId,
          status: syncStatus,
          message: userMessage,
          paymentMethod: paymentMethodName,
          amount: parseFloat(amount),
          responseCode: result.responseCode,
          hostResponseCode: result.hostResponseCode,
        });
      }
      return res.status(400).json({
        success: false,
        approved: false,
        status: statusType,
        isCancelled,
        isTimeout,
        paymentMethod: paymentMethodName,
        error: userMessage,
        ...result,
        rawHex: sanitizeRawHex(result.rawHex),
      });
    }
  } catch (err) {
    logComm('ERR', `${title} Failure`, { error: err.message, code: err.code });
    const isConflict = Boolean(err.code === 'EUNRESOLVED_TRANSACTION');
    const isTimeout = Boolean(err.isTimeout || err.code === 'ETIMEDOUT');
    const isUnknownStatus = Boolean(err.code === 'ERECONCILIATIONREQUIRED' || err.isUncertain);
    const syncStatus = isConflict ? 'BLOCKED_UNRESOLVED' : isUnknownStatus ? 'UNKNOWN' : isTimeout ? 'TIMEOUT' : 'FAILED';
    const statusType = isConflict ? 'conflict' : isUnknownStatus ? 'unknown' : isTimeout ? 'timeout' : 'failed';
    const userMessage = isConflict
      ? err.message
      : isUnknownStatus
        ? 'Transaction Status Unknown / Requires Reconciliation'
        : isTimeout
          ? 'Transaction Timed Out'
          : err.message;

    if (io) {
      io.emit('terminal_payment_sync', {
        tableId,
        status: syncStatus,
        message: userMessage,
        paymentMethod: paymentMethodName,
        amount: parseFloat(amount),
        unresolved: err.unresolved || null,
        recoveryAttempts: err.recoveryAttempts || null,
      });
    }

    const httpStatus = isConflict ? 409 : 500;
    return res.status(httpStatus).json({
      success: false,
      approved: false,
      status: statusType,
      isConflict,
      isTimeout,
      isUnknownStatus,
      paymentMethod: paymentMethodName,
      error: userMessage,
      errorCode: err.code || 'EUNKNOWN',
      originalEcn: err.originalEcn || null,
      recoveryAttempts: err.recoveryAttempts || null,
      unresolved: err.unresolved || null,
    });
  }
}

/**
 * POST /api/nets/card-payment
 * Dedicated endpoint for NETS Card Payment (FC 30 T2=01)
 * Supports NETS Debit, Contactless, FlashPay, and chip/pin.
 */
router.post('/card-payment', async (req, res) => {
  return handlePaymentExecution(req, res, {
    isQr: false,
    title: 'NETS Card Purchase (FC 30 T2=01)',
    paymentMethodName: 'NETS CARD'
  });
});

/**
 * POST /api/nets/qr-payment
 * Dedicated endpoint for NETS Terminal QR Payment (FC 30 T2=04)
 * Displays dynamic NETS QR code on the terminal screen.
 */
router.post('/qr-payment', async (req, res) => {
  return handlePaymentExecution(req, res, {
    isQr: true,
    title: 'NETS QR Purchase (FC 30 T2=04)',
    paymentMethodName: 'NETS QR'
  });
});

/**
 * POST /api/nets/credit-card-payment
 * Dedicated endpoint for NETS Credit Card Sale (Function Code I0)
 * Section 4.8.1 - Supports Visa, Mastercard, AMEX with automatic BIN processing.
 */
router.post('/credit-card-payment', async (req, res) => {
  return handlePaymentExecution(req, res, {
    isQr: false,
    isCreditCard: true,
    title: 'NETS Credit Card Sale (FC I0)',
    paymentMethodName: 'NETS CREDIT CARD'
  });
});

/**
 * POST /api/nets/payment
 * Compatibility router: Dispatches cleanly based on `isQr` flag
 */
router.post('/payment', async (req, res) => {
  const isQr = Boolean(req.body && req.body.isQr);
  return handlePaymentExecution(req, res, {
    isQr,
    title: isQr ? 'NETS QR Purchase (FC 30 T2=04)' : 'NETS Card Purchase (FC 30 T2=01)',
    paymentMethodName: isQr ? 'NETS QR' : 'NETS'
  });
});

/**
 * POST /api/nets/qr-request
 * FC Q1: Request QR Payload for POS Display
 */
router.post('/qr-request', async (req, res) => {
  const { amount, ecrRef } = req.body;
  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return res.status(400).json({ success: false, error: 'Valid amount is required.' });
  }

  try {
    logComm('TX', 'FC Q1 - QR Payload Request', { amount, ecrRef });
    const result = await netsService.requestQrPayload({ amount: parseFloat(amount), ecrRef });
    logComm('RX', 'FC Q1 - QR Payload Response', result);

    res.json({
      success: result.success,
      qrPayload: result.qrPayload,
      description: result.description,
      rawHex: sanitizeRawHex(result.rawHex),
    });
  } catch (err) {
    logComm('ERR', 'FC Q1 - Error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/nets/pos-qr-payment
 * FC Q2: Complete Dynamic QR Payment displayed on POS screen
 */
router.post('/pos-qr-payment', async (req, res) => {
  const { amount, qrPayload, ecrRef } = req.body;
  try {
    logComm('TX', 'FC Q2 - QR Payment Confirmation', { amount, ecrRef });
    const result = await netsService.qrPayment({ amount: parseFloat(amount), qrPayload, ecrRef });
    logComm('RX', 'FC Q2 - QR Payment Response', result);

    res.json({
      success: result.isApproved,
      ...result,
      rawHex: sanitizeRawHex(result.rawHex),
    });
  } catch (err) {
    logComm('ERR', 'FC Q2 - Error', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/nets/reconcile-approved-transaction
 * Safe Reconciliation for Approved Transactions that got stuck in processing/failed state.
 * Validates against terminal via FC 56 without recharging the card or re-issuing FC 30.
 * Body: { ecrRef, amount, orderId, tableId, approvalCode }
 */
router.post('/reconcile-approved-transaction', async (req, res) => {
  const { ecrRef, amount, orderId, tableId, approvalCode: clientApprovalCode } = req.body;
  const io = req.app.get('socketio');

  if (!ecrRef || !amount) {
    return res.status(400).json({ success: false, error: 'ecrRef and amount are required for reconciliation.' });
  }

  const amountNum = parseFloat(amount);
  const amountStr = String(Math.round(amountNum * 100)).padStart(12, '0');

  try {
    logComm('TX', 'Reconciliation Query (FC 56)', { ecrRef, amount, orderId, tableId });
    const inquiry = await netsService.getLastApprovedTransaction();
    logComm('RX', 'Reconciliation Response (FC 56)', inquiry);

    const inqRef = (inquiry.fields['HS'] || inquiry.fields['HD'] || '').trim();
    const expectedRef = ecrRef.trim();
    const inqAmt = (inquiry.fields['40'] || '').trim();
    const inqApproval = (inquiry.approvalCode || inquiry.fields['01'] || '').trim();

    const isRefMatched = inqRef === expectedRef;
    const isAmtMatched = inqAmt === amountStr;
    const isApprovalMatched = !clientApprovalCode || (inqApproval === clientApprovalCode.trim());

    if (inquiry.success && isRefMatched && isAmtMatched && inquiry.parsed.isApproved && isApprovalMatched) {
      const reconciledResult = {
        success: true,
        reconciled: true,
        approved: true,
        isApproved: true,
        ecrRef: expectedRef,
        amount: amountNum,
        approvalCode: inqApproval,
        stan: inquiry.fields['65'] || '',
        rrn: inquiry.fields['D3'] || '',
        merchantId: inquiry.fields['D1'] || '',
        terminalId: inquiry.fields['16'] || '',
        cardLabel: inquiry.fields['L7'] || '',
        receiptData: inquiry.fields['RP'] || '',
        date: inquiry.fields['03'] || '',
        time: inquiry.fields['04'] || '',
        fields: inquiry.fields,
        rawHex: sanitizeRawHex(inquiry.rawHex),
      };

      if (io) {
        io.emit('terminal_payment_sync', {
          tableId,
          orderId,
          status: 'APPROVED',
          message: 'Payment Reconciled and Approved by NETS!',
          paymentMethod: 'NETS',
          amount: amountNum,
          approvalCode: reconciledResult.approvalCode,
          stan: reconciledResult.stan,
          rrn: reconciledResult.rrn,
          ecrRef: reconciledResult.ecrRef,
          receiptData: reconciledResult.receiptData,
        });
      }

      // If there was an unresolved lock for this transaction, clear it now that it is reconciled
      netsService.saveUnresolvedTransaction(null);

      return res.json(reconciledResult);
    } else {
      const reason = !inquiry.success
        ? `FC 56 terminal inquiry failed: ${inquiry.description}`
        : !isRefMatched
        ? `ECR reference mismatch (Terminal: '${inqRef}', POS: '${expectedRef}')`
        : !isAmtMatched
        ? `Amount mismatch (Terminal: '${inqAmt}', POS: '${amountStr}')`
        : 'Terminal last transaction was not approved';

      logComm('ERR', 'Reconciliation Mismatch', { reason, inqRef, expectedRef, inqAmt, amountStr });
      return res.status(409).json({
        success: false,
        reconciled: false,
        error: `Reconciliation failed: ${reason}. Please inspect terminal receipt. Do NOT recharge customer.`,
        inquirySummary: {
          terminalRef: inqRef,
          terminalAmount: inqAmt,
          terminalApproval: inqApproval,
          terminalStatus: inquiry.description
        }
      });
    }
  } catch (err) {
    logComm('ERR', 'Reconciliation Exception', { error: err.message });
    return res.status(500).json({
      success: false,
      reconciled: false,
      error: `Reconciliation exception: ${err.message}`
    });
  }
});

/**
 * GET /api/nets/unresolved-transaction
 * Returns currently active unresolved transaction requiring reconciliation
 */
router.get('/unresolved-transaction', (req, res) => {
  const unresolved = netsService.getUnresolvedTransaction();
  res.json({
    hasUnresolved: Boolean(unresolved),
    unresolved,
  });
});

/**
 * POST /api/nets/clear-unresolved-transaction
 * Verified administrative clearing requiring supervisor evidence
 */
router.post('/clear-unresolved-transaction', (req, res) => {
  const { approvalCode, reconciliationReason, supervisorApproval, targetEcn } = req.body || {};
  try {
    const result = netsService.clearUnresolvedTransactionWithEvidence({
      approvalCode,
      reconciliationReason,
      supervisorApproval,
      targetEcn,
    });
    logComm('ADMIN', 'Clear Unresolved Transaction With Evidence', result);
    res.json(result);
  } catch (err) {
    logComm('ERR', 'Failed Clear Unresolved Transaction', { error: err.message });
    res.status(400).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;
