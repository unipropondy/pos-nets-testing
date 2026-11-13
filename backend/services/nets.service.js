const net = require('net');
const fs = require('fs');
const path = require('path');
const {
  buildNetsFrame,
  parseNetsFrame,
  formatAmount,
  getNetsResponseDescription,
  sanitizeFieldsForLogging,
  sanitizeRawHex,
} = require('../utils/netsProtocol');

const CONFIG_FILE_PATH = path.join(__dirname, '../config/netsConfig.json');
const ECN_FILE_PATH = path.join(__dirname, '../config/netsEcn.json');

class NetsService {
  constructor() {
    this.config = this.loadConfig();
    this.currentEcn = this.loadEcn();
    this.activeSocket = null;
    this.isProcessing = false;
    this.lastTransaction = null;
    this.ecnLock = false;
  }

  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_FILE_PATH)) {
        const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.error('[NetsService] Error loading config:', err.message);
    }
    // Default UAT / LAN settings
    return {
      terminalIp: '192.168.9.38',
      terminalPort: 7500,
      financialTimeoutMs: 120000, // 2 minutes for payment/pin entry
      adminTimeoutMs: 35000,       // 35 seconds for admin/status
      connectionTimeoutMs: 10000,  // 10s TCP connect timeout
      merchantId: '',
      terminalId: '',
      ecrRefFieldCode: 'HD',       // Default to 'HD' as per spec; configurable to 'HS' if cert requires
      autoRetryWithSameEcn: true,
      lastApprovedQueryOnTimeout: true,
    };
  }

  saveConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    try {
      const dir = path.dirname(CONFIG_FILE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(this.config, null, 2), 'utf8');
      console.log('[NetsService] Configuration updated:', this.config);
      return this.config;
    } catch (err) {
      console.error('[NetsService] Error saving config:', err.message);
      throw err;
    }
  }

  loadEcn() {
    try {
      if (fs.existsSync(ECN_FILE_PATH)) {
        const raw = fs.readFileSync(ECN_FILE_PATH, 'utf8');
        const data = JSON.parse(raw);
        return parseInt(data.ecn, 10) || 1;
      }
    } catch (err) {
      console.error('[NetsService] Error loading ECN:', err.message);
    }
    return 1;
  }

  saveEcn(ecn) {
    this.currentEcn = ecn;
    try {
      const dir = path.dirname(ECN_FILE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(ECN_FILE_PATH, JSON.stringify({ ecn, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
    } catch (err) {
      console.error('[NetsService] Error saving ECN:', err.message);
    }
  }

  /**
   * Thread-safe / asynchronous-safe sequential ECN generator.
   * Atomically increments ECN and persists it.
   */
  getNextEcn() {
    let next = (this.currentEcn >= 999999999999) ? 1 : this.currentEcn + 1;
    this.saveEcn(next);
    return next.toString().padStart(12, '0');
  }

  getCurrentEcn() {
    return this.currentEcn.toString().padStart(12, '0');
  }

  /**
   * Sends a framed packet over TCP to the NETS Ingenico DESK/5000 terminal and awaits full response.
   * Handles:
   * - 2-byte BCD length framing over Ethernet
   * - 0x15 NAK detection (Terminal Busy)
   * - Timeout and connection lifecycle
   *
   * @param {Buffer} frameBuffer
   * @param {number} timeoutMs
   * @param {Function} onProgress
   * @returns {Promise<{parsed: Object, rawHex: string}>}
   */
  async sendPacket(frameBuffer, timeoutMs = 35000, onProgress = null) {
    const { terminalIp, terminalPort, connectionTimeoutMs } = this.config;

    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let responseBuffer = Buffer.alloc(0);
      let expectedTotalLength = null;
      let timer = null;
      let isResolved = false;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        socket.removeAllListeners();
        socket.destroy();
      };

      const finishSuccess = (buf) => {
        if (isResolved) return;
        isResolved = true;
        cleanup();
        try {
          const parsed = parseNetsFrame(buf);
          resolve({ parsed, rawHex: buf.toString('hex') });
        } catch (err) {
          reject(new Error(`Failed to parse terminal response: ${err.message}`));
        }
      };

      const finishError = (err) => {
        if (isResolved) return;
        isResolved = true;
        cleanup();
        reject(err);
      };

      timer = setTimeout(() => {
        const timeoutErr = new Error(`Terminal communication timed out after ${timeoutMs / 1000} seconds`);
        timeoutErr.code = 'ETIMEDOUT';
        timeoutErr.isTimeout = true;
        finishError(timeoutErr);
      }, timeoutMs);

      socket.setTimeout(connectionTimeoutMs);

      socket.connect(terminalPort, terminalIp, () => {
        socket.setTimeout(0);
        if (onProgress) onProgress({ status: 'connected', message: `Connected to NETS terminal at ${terminalIp}:${terminalPort}` });

        socket.write(frameBuffer, (err) => {
          if (err) {
            finishError(new Error(`Failed to send data to terminal: ${err.message}`));
          } else {
            if (onProgress) onProgress({ status: 'sent', message: 'Frame dispatched to terminal, awaiting response' });
          }
        });
      });

      socket.on('data', (chunk) => {
        responseBuffer = Buffer.concat([responseBuffer, chunk]);

        // CRITICAL SPEC REQUIREMENT: Section 2.2.2.2 - NAK Handling on Ethernet Mode
        // If terminal is busy, it returns a 1-byte 0x15 (NAK)
        if (responseBuffer.length === 1 && responseBuffer[0] === 0x15) {
          const nakErr = new Error('Terminal Busy (NAK 0x15 received from terminal)');
          nakErr.code = 'ETERMINALBUSY';
          nakErr.isNak = true;
          return finishError(nakErr);
        }

        // BCD Length Header Parsing (First 2 bytes)
        if (expectedTotalLength === null && responseBuffer.length >= 2) {
          const b1 = responseBuffer[0];
          const b2 = responseBuffer[1];
          const bcdStr = b1.toString(16).padStart(2, '0') + b2.toString(16).padStart(2, '0');
          const bodyAndLrcLen = parseInt(bcdStr, 10);
          if (!isNaN(bodyAndLrcLen) && bodyAndLrcLen > 0) {
            expectedTotalLength = bodyAndLrcLen + 2;
          }
        }

        // Complete Frame Received
        if (expectedTotalLength !== null && responseBuffer.length >= expectedTotalLength) {
          const completeFrame = responseBuffer.slice(0, expectedTotalLength);
          finishSuccess(completeFrame);
        }
      });

      socket.on('error', (err) => {
        finishError(new Error(`NETS Terminal socket error: ${err.message}`));
      });

      socket.on('close', () => {
        if (!isResolved) {
          if (responseBuffer.length >= 21) {
            finishSuccess(responseBuffer);
          } else {
            finishError(new Error('Connection closed by terminal before complete response was received'));
          }
        }
      });
    });
  }

  /**
   * FC 55: Request Terminal Status
   */
  async requestTerminalStatus() {
    const ecn = this.getNextEcn();
    const frame = buildNetsFrame({
      ecn,
      functionCode: '55',
      versionCode: '01',
      fields: [],
    });

    console.log(`[NetsService] Sending FC 55 (Status) ECN=${ecn}`);
    const res = await this.sendPacket(frame, this.config.adminTimeoutMs);
    return {
      ecn,
      success: res.parsed.responseCode === '00',
      responseCode: res.parsed.responseCode,
      description: res.parsed.responseDescription,
      fields: res.parsed.fields,
      rawHex: res.rawHex,
      parsed: res.parsed,
    };
  }

  /**
   * FC 56: Get Last Approved Transaction
   * Used for transaction inquiry and recovery
   */
  async getLastApprovedTransaction() {
    const ecn = this.getNextEcn();
    const frame = buildNetsFrame({
      ecn,
      functionCode: '56',
      versionCode: '01',
      fields: [],
    });

    console.log(`[NetsService] Sending FC 56 (Last Approved) ECN=${ecn}`);
    const res = await this.sendPacket(frame, this.config.adminTimeoutMs);
    return {
      ecn,
      success: res.parsed.responseCode === '00',
      responseCode: res.parsed.responseCode,
      description: res.parsed.responseDescription,
      approvalCode: res.parsed.approvalCode,
      fields: res.parsed.fields,
      rawHex: res.rawHex,
      parsed: res.parsed,
    };
  }

  /**
   * FC 80: NETS Logon
   */
  async logon() {
    const ecn = this.getNextEcn();
    const frame = buildNetsFrame({
      ecn,
      functionCode: '80',
      versionCode: '01',
      fields: [],
    });

    console.log(`[NetsService] Sending FC 80 (Logon) ECN=${ecn}`);
    const res = await this.sendPacket(frame, this.config.adminTimeoutMs);
    return {
      ecn,
      success: res.parsed.responseCode === '00',
      responseCode: res.parsed.responseCode,
      description: res.parsed.responseDescription,
      fields: res.parsed.fields,
      rawHex: res.rawHex,
      parsed: res.parsed,
    };
  }

  /**
   * FC 81: NETS Settlement
   */
  async settlement() {
    const ecn = this.getNextEcn();
    const frame = buildNetsFrame({
      ecn,
      functionCode: '81',
      versionCode: '01',
      fields: [],
    });

    console.log(`[NetsService] Sending FC 81 (NETS Settlement) ECN=${ecn}`);
    const res = await this.sendPacket(frame, this.config.adminTimeoutMs);
    return {
      ecn,
      success: res.parsed.responseCode === '00',
      responseCode: res.parsed.responseCode,
      description: res.parsed.responseDescription,
      fields: res.parsed.fields,
      rawHex: res.rawHex,
      parsed: res.parsed,
    };
  }

  /**
   * FC I5: Credit Card Settlement
   * Official Specification & Sample Command:
   * 02002930303030303030303537373349353031301C394700064442532020201C036C
   * Field Code is '9G' (Card Acquirer), Length 6, Value 'DBS   '
   *
   * @param {string} [acquirer="DBS"]
   */
  async creditSettlement(acquirer = 'DBS') {
    const ecn = this.getNextEcn();
    // 6-character padded acquirer code as specified
    const acquirerPadded = acquirer.padEnd(6, ' ').slice(0, 6);

    const frame = buildNetsFrame({
      ecn,
      functionCode: 'I5',
      versionCode: '01',
      fields: [
        { code: '9G', value: acquirerPadded },
      ],
    });

    console.log(`[NetsService] Sending FC I5 (Credit Settlement) ECN=${ecn} Acquirer=${acquirerPadded}`);
    const res = await this.sendPacket(frame, this.config.adminTimeoutMs);
    return {
      ecn,
      success: res.parsed.responseCode === '00',
      responseCode: res.parsed.responseCode,
      description: res.parsed.responseDescription,
      fields: res.parsed.fields,
      rawHex: res.rawHex,
      parsed: res.parsed,
    };
  }

  /**
   * FC 84: TMS / CTS Update
   */
  async tmsUpdate() {
    const ecn = this.getNextEcn();
    const frame = buildNetsFrame({
      ecn,
      functionCode: '84',
      versionCode: '01',
      fields: [],
    });

    console.log(`[NetsService] Sending FC 84 (TMS Update) ECN=${ecn}`);
    const res = await this.sendPacket(frame, this.config.adminTimeoutMs);
    return {
      ecn,
      success: res.parsed.responseCode === '00',
      responseCode: res.parsed.responseCode,
      description: res.parsed.responseDescription,
      fields: res.parsed.fields,
      rawHex: res.rawHex,
      parsed: res.parsed,
    };
  }

  /**
   * FC 30: All NETS Purchase (T2="01" for NETS Payment, T2="04" for Terminal QR)
   * Mandatory fields:
   * - T2: Transaction Type ("01" or "04")
   * - 40: Amount in cents, 12 digits zero padded
   * - 42: Cashback amount, 12 digits zero padded
   * - HD / HS: Enhanced ECR Reference Number (configurable, default 'HD')
   */
  async purchase({ amount, ecrRef, isQr = false, retrySameEcn = null, onProgress = null }) {
    if (this.isProcessing) {
      throw new Error('A payment transaction is already in progress on the terminal.');
    }

    this.isProcessing = true;
    const ecn = retrySameEcn || this.getNextEcn();
    const amountStr = formatAmount(amount);
    const cashbackStr = '000000000000';
    const txnType = isQr ? '04' : '01';
    const refNum = (ecrRef || `ECR${Date.now()}`).toString().slice(0, 20);
    const refCode = (this.config.ecrRefFieldCode || 'HD').toUpperCase().slice(0, 2);

    const fields = [
      { code: 'T2', value: txnType },
      { code: '40', value: amountStr },
      { code: '42', value: cashbackStr },
      { code: refCode, value: refNum },
    ];

    const frame = buildNetsFrame({
      ecn,
      functionCode: '30',
      versionCode: '01',
      fields,
    });

    console.log(`[NetsService] Initiating FC 30 Purchase: ECN=${ecn}, Amount=${amount} (${amountStr}), Type=${txnType}, RefField=${refCode}, Ref=${refNum}`);

    try {
      const res = await this.sendPacket(frame, this.config.financialTimeoutMs, onProgress);
      this.isProcessing = false;

      const isApproved = res.parsed.isApproved;
      const result = {
        ecn,
        isApproved,
        approvalReason: res.parsed.approvalReason,
        responseCode: res.parsed.responseCode,
        hostResponseCode: res.parsed.hostResponseCode,
        responseDescription: res.parsed.responseDescription,
        approvalCode: res.parsed.approvalCode || res.parsed.fields['01'] || '',
        stan: res.parsed.fields['65'] || '',
        rrn: res.parsed.fields['D3'] || '',
        merchantId: res.parsed.fields['D1'] || '',
        terminalId: res.parsed.fields['16'] || '',
        cardLabel: res.parsed.fields['L7'] || '',
        receiptData: res.parsed.fields['RP'] || '',
        date: res.parsed.fields['03'] || '',
        time: res.parsed.fields['04'] || '',
        amount: amount,
        ecrRef: refNum,
        fields: res.parsed.fields,
        rawHex: res.rawHex,
      };

      this.lastTransaction = result;
      return result;
    } catch (err) {
      this.isProcessing = false;
      console.error(`[NetsService] Purchase error ECN=${ecn}:`, err.message);

      // Handle NAK (Terminal Busy)
      // Section 2.2.2.2: Do NOT retry financial payments blindly! Terminal is busy with another customer.
      if (err.isNak) {
        throw new Error('Terminal is currently busy. Please wait and try again.');
      }

      // Handle Timeout / Uncertain outcome: Rigorous FC 56 Recovery
      if (err.isTimeout && this.config.lastApprovedQueryOnTimeout) {
        console.warn(`[NetsService] Timeout on ECN=${ecn}. Querying FC 56 to check if approved.`);
        try {
          const inquiry = await this.getLastApprovedTransaction();

          // RIGOROUS RECONCILIATION MATCHING:
          // Check 1: ECR Reference Number match (HD or HS)
          const inqRef = inquiry.fields['HD'] || inquiry.fields['HS'] || '';
          const isRefMatched = inqRef.trim() === refNum.trim();

          // Check 2: Transaction Amount match
          const inqAmountStr = inquiry.fields['40'] || '';
          const isAmountMatched = inqAmountStr === amountStr;

          // Check 3: Strict Approval verification
          if (inquiry.success && isRefMatched && isAmountMatched && inquiry.parsed.isApproved) {
            console.log(`[NetsService] Transaction conclusively matched & recovered via FC 56! Approved.`);
            const recoveredResult = {
              ecn,
              isApproved: true,
              recovered: true,
              approvalReason: 'Approved (Conclusively matched & recovered via FC 56)',
              responseCode: inquiry.responseCode,
              hostResponseCode: inquiry.parsed.hostResponseCode,
              responseDescription: 'Approved (Recovered via FC 56 Inquiry)',
              approvalCode: inquiry.approvalCode,
              stan: inquiry.fields['65'] || '',
              rrn: inquiry.fields['D3'] || '',
              merchantId: inquiry.fields['D1'] || '',
              terminalId: inquiry.fields['16'] || '',
              cardLabel: inquiry.fields['L7'] || '',
              receiptData: inquiry.fields['RP'] || '',
              date: inquiry.fields['03'] || '',
              time: inquiry.fields['04'] || '',
              amount: amount,
              ecrRef: refNum,
              fields: inquiry.fields,
              rawHex: inquiry.rawHex,
            };
            this.lastTransaction = recoveredResult;
            return recoveredResult;
          } else {
            console.warn(`[NetsService] FC 56 inquiry did not match active transaction (inqRef='${inqRef}', expected='${refNum}', inqAmt='${inqAmountStr}', expected='${amountStr}').`);
            const unconfirmedErr = new Error('Transaction outcome uncertain. FC 56 inquiry did not match this order. Manual reconciliation required. Do NOT recharge customer.');
            unconfirmedErr.code = 'ERECONCILIATIONREQUIRED';
            throw unconfirmedErr;
          }
        } catch (inqErr) {
          console.error(`[NetsService] FC 56 recovery failed:`, inqErr.message);
          throw inqErr;
        }
      }

      throw err;
    }
  }

  /**
   * FC Q1: Request QR Payload for POS Display
   */
  async requestQrPayload({ amount, ecrRef }) {
    const ecn = this.getNextEcn();
    const amountStr = formatAmount(amount);
    const refNum = (ecrRef || `ECR${Date.now()}`).toString().slice(0, 20);
    const refCode = (this.config.ecrRefFieldCode || 'HD').toUpperCase().slice(0, 2);

    const fields = [
      { code: '40', value: amountStr },
      { code: refCode, value: refNum },
    ];

    const frame = buildNetsFrame({
      ecn,
      functionCode: 'Q1',
      versionCode: '01',
      fields,
    });

    console.log(`[NetsService] Sending FC Q1 (QR Payload) ECN=${ecn} Amount=${amount}`);
    const res = await this.sendPacket(frame, this.config.adminTimeoutMs);
    return {
      ecn,
      success: res.parsed.responseCode === '00',
      responseCode: res.parsed.responseCode,
      description: res.parsed.responseDescription,
      qrPayload: res.parsed.fields['Q1'] || res.parsed.fields['Q0'] || '',
      fields: res.parsed.fields,
      rawHex: res.rawHex,
      parsed: res.parsed,
    };
  }

  /**
   * FC Q2: Complete QR Payment after display
   */
  async qrPayment({ amount, qrPayload, ecrRef }) {
    const ecn = this.getNextEcn();
    const amountStr = formatAmount(amount);
    const refNum = (ecrRef || `ECR${Date.now()}`).toString().slice(0, 20);
    const refCode = (this.config.ecrRefFieldCode || 'HD').toUpperCase().slice(0, 2);

    const fields = [
      { code: '40', value: amountStr },
      { code: refCode, value: refNum },
      { code: 'Q1', value: qrPayload || '' },
    ];

    const frame = buildNetsFrame({
      ecn,
      functionCode: 'Q2',
      versionCode: '01',
      fields,
    });

    console.log(`[NetsService] Sending FC Q2 (QR Payment) ECN=${ecn}`);
    const res = await this.sendPacket(frame, this.config.financialTimeoutMs);
    return {
      ecn,
      isApproved: res.parsed.isApproved,
      approvalReason: res.parsed.approvalReason,
      responseCode: res.parsed.responseCode,
      hostResponseCode: res.parsed.hostResponseCode,
      description: res.parsed.responseDescription,
      approvalCode: res.parsed.approvalCode,
      fields: res.parsed.fields,
      rawHex: res.rawHex,
      parsed: res.parsed,
    };
  }

  /**
   * Automated End-of-Day Settlement Sequence as required by NETS UAT certification:
   * 1. Credit Card Settlement (FC I5, Acquirer DBS)
   * 2. Wait 20 seconds
   * 3. NETS Settlement (FC 81)
   * 4. Wait 20 seconds
   * 5. NETS Logon (FC 80)
   * 6. Wait 20 seconds
   * 7. TMS / CTS Update (FC 84)
   *
   * @param {Function} onStepProgress - Callback(stepIndex, stepName, status, message)
   */
  async runEndOfDaySequence(onStepProgress = () => {}) {
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const results = [];

    // Step 1: Credit Card Settlement (I5 with DBS acquirer)
    onStepProgress(1, 'Credit Card Settlement', 'running', 'Sending FC I5 (Credit Settlement DBS)...');
    try {
      const res1 = await this.creditSettlement('DBS');
      results.push({ step: 'Credit Card Settlement', code: 'I5', result: res1 });
      onStepProgress(1, 'Credit Card Settlement', res1.success ? 'completed' : 'failed', res1.description);
    } catch (err) {
      results.push({ step: 'Credit Card Settlement', code: 'I5', error: err.message });
      onStepProgress(1, 'Credit Card Settlement', 'error', err.message);
    }

    // Delay 20 seconds
    onStepProgress(1.5, 'Settlement Delay', 'waiting', 'Waiting 20 seconds before NETS settlement...');
    await delay(20000);

    // Step 2: NETS Settlement (81)
    onStepProgress(2, 'NETS Settlement', 'running', 'Sending FC 81 (NETS Settlement)...');
    try {
      const res2 = await this.settlement();
      results.push({ step: 'NETS Settlement', code: '81', result: res2 });
      onStepProgress(2, 'NETS Settlement', res2.success ? 'completed' : 'failed', res2.description);
    } catch (err) {
      results.push({ step: 'NETS Settlement', code: '81', error: err.message });
      onStepProgress(2, 'NETS Settlement', 'error', err.message);
    }

    // Delay 20 seconds
    onStepProgress(2.5, 'Logon Delay', 'waiting', 'Waiting 20 seconds before NETS logon...');
    await delay(20000);

    // Step 3: NETS Logon (80)
    onStepProgress(3, 'NETS Logon', 'running', 'Sending FC 80 (NETS Logon)...');
    try {
      const res3 = await this.logon();
      results.push({ step: 'NETS Logon', code: '80', result: res3 });
      onStepProgress(3, 'NETS Logon', res3.success ? 'completed' : 'failed', res3.description);
    } catch (err) {
      results.push({ step: 'NETS Logon', code: '80', error: err.message });
      onStepProgress(3, 'NETS Logon', 'error', err.message);
    }

    // Delay 20 seconds
    onStepProgress(3.5, 'TMS Delay', 'waiting', 'Waiting 20 seconds before TMS update...');
    await delay(20000);

    // Step 4: TMS Update (84)
    onStepProgress(4, 'TMS Update', 'running', 'Sending FC 84 (TMS / CTS Update)...');
    try {
      const res4 = await this.tmsUpdate();
      results.push({ step: 'TMS Update', code: '84', result: res4 });
      onStepProgress(4, 'TMS Update', res4.success ? 'completed' : 'failed', res4.description);
    } catch (err) {
      results.push({ step: 'TMS Update', code: '84', error: err.message });
      onStepProgress(4, 'TMS Update', 'error', err.message);
    }

    return results;
  }
}

// Export singleton instance
module.exports = new NetsService();
