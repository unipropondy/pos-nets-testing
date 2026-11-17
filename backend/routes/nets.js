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
 * POST /api/nets/payment
 * Initiate NETS Purchase (T2="01") or NETS QR (T2="04")
 * Body: { amount, ecrRef, isQr, tableId }
 */
router.post('/payment', async (req, res) => {
  const { amount, ecrRef, isQr = false, tableId = null } = req.body;
  const io = req.app.get('socketio');

  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return res.status(400).json({ success: false, error: 'Valid amount is required.' });
  }

  const txnTitle = isQr ? 'NETS QR Purchase (FC 30 T2=04)' : 'NETS Card Purchase (FC 30 T2=01)';
  logComm('TX', txnTitle, { amount, ecrRef, isQr, tableId });

  // Broadcast initial terminal payment status
  if (io) {
    io.emit('terminal_payment_sync', {
      tableId,
      status: 'WAITING_CARD',
      message: isQr ? 'Presenting QR code on terminal...' : 'Please tap, insert card or present mobile device on NETS terminal...',
      paymentMethod: isQr ? 'NETS QR' : 'NETS',
      amount: parseFloat(amount),
      ecrRef,
    });
  }

  try {
    const onProgress = (prog) => {
      if (io) {
        io.emit('terminal_payment_sync', {
          tableId,
          status: 'PROCESSING',
          message: prog.message,
          paymentMethod: isQr ? 'NETS QR' : 'NETS',
          amount: parseFloat(amount),
          ecrRef,
        });
      }
    };

    const result = await netsService.purchase({
      amount: parseFloat(amount),
      ecrRef,
      isQr: Boolean(isQr),
      onProgress,
    });

    logComm('RX', `${txnTitle} Result`, result);

    if (result.isApproved) {
      if (io) {
        io.emit('terminal_payment_sync', {
          tableId,
          status: 'APPROVED',
          message: 'Payment Approved by NETS!',
          paymentMethod: isQr ? 'NETS QR' : 'NETS',
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
        ...result,
        rawHex: sanitizeRawHex(result.rawHex),
      });
    } else {
      if (io) {
        io.emit('terminal_payment_sync', {
          tableId,
          status: 'FAILED',
          message: result.approvalReason || result.responseDescription || 'Payment declined by terminal.',
          paymentMethod: isQr ? 'NETS QR' : 'NETS',
          amount: parseFloat(amount),
          responseCode: result.responseCode,
          hostResponseCode: result.hostResponseCode,
        });
      }
      return res.status(400).json({
        success: false,
        approved: false,
        error: result.approvalReason || result.responseDescription || `Payment declined (${result.responseCode})`,
        ...result,
        rawHex: sanitizeRawHex(result.rawHex),
      });
    }
  } catch (err) {
    logComm('ERR', `${txnTitle} Failure`, { error: err.message, code: err.code });
    if (io) {
      io.emit('terminal_payment_sync', {
        tableId,
        status: 'FAILED',
        message: err.message,
        paymentMethod: isQr ? 'NETS QR' : 'NETS',
        amount: parseFloat(amount),
      });
    }
    return res.status(500).json({
      success: false,
      approved: false,
      error: err.message,
      errorCode: err.code || 'EUNKNOWN',
    });
  }
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
 * POST /api/nets/qr-payment
 * FC Q2: Complete QR Payment after display
 */
router.post('/qr-payment', async (req, res) => {
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

module.exports = router;
