const net = require('net');
const fs = require('fs');
const path = require('path');
const { getPool, poolPromise } = require('../config/db');
const {
  buildNetsFrame,
  parseNetsFrame,
  formatAmount,
  fromBcd2,
  getNetsResponseDescription,
  sanitizeFieldsForLogging,
  sanitizeRawHex,
} = require('../utils/netsProtocol');

const CONFIG_FILE_PATH = path.join(__dirname, '../config/netsConfig.json');
const ECN_FILE_PATH = path.join(__dirname, '../config/netsEcn.json');
const UNRESOLVED_FILE_PATH = path.join(__dirname, '../config/netsUnresolved.json');

class NetsService {
  constructor() {
    this.config = this.loadConfig();
    this.currentEcn = this.loadEcn();
    this.unresolvedTransaction = this.loadUnresolvedTransaction();
    this.activeSocket = null;
    this.isProcessing = false;
    this.isRecoveryInProgress = false;
    this.lastTransaction = null;
    this.ecnLock = false;

    // POS-001: Automatic TMS Trigger & Terminal Lifecycle State
    // Status can be: 'idle' | 'pending' | 'triggered' | 'terminal_rebooting' | 'ready' | 'failed' | 'timed_out'
    this.tmsStatus = {
      status: 'idle', // 'idle' | 'pending' | 'triggered' | 'terminal_rebooting' | 'ready' | 'failed' | 'timed_out'
      statusText: 'Terminal Ready',
      lastSettlementEcn: null,
      lastSettlementTime: null,
      tmsEcn: null,
      tmsTriggerTime: null,
      terminalRebootStartTime: null,
      terminalReadyTime: null,
      pollCount: 0,
      error: null,
      terminalInfo: null,
    };
    this.isTmsUpdating = false;
    this.tmsPollTimeoutTimer = null;
    this.onTmsStateChange = null;
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
      ecrRefFieldCode: 'HS',       // Mandatory 'HS' per DBS UAT requirement (configurable to 'HD')
      autoRetryWithSameEcn: true,
      lastApprovedQueryOnTimeout: true,
      // POS-013: Bounded LAN recovery settings
      recoveryInitialDelayMs: 4000, // 4s wait to allow LAN link restoration and terminal ECR reset
      recoveryRetryDelayMs: 2000,   // 2s between connection retries
      recoveryMaxRetries: 2,         // Maximum 2 additional retries (3 attempts total)
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

  loadUnresolvedTransaction() {
    try {
      if (fs.existsSync(UNRESOLVED_FILE_PATH)) {
        const raw = fs.readFileSync(UNRESOLVED_FILE_PATH, 'utf8');
        const data = JSON.parse(raw);
        if (data && data.ecn && data.status === 'UNRESOLVED') {
          console.warn(`[NetsService] Loaded PERSISTED unresolved transaction lock: ECN=${data.ecn}, ref=${data.ecrRef}, amount=${data.amount}`);
          return data;
        }
      }
    } catch (err) {
      console.error('[NetsService] Error loading unresolved transaction:', err.message);
    }
    return null;
  }

  saveUnresolvedTransaction(unresolvedData) {
    this.unresolvedTransaction = unresolvedData;
    try {
      const dir = path.dirname(UNRESOLVED_FILE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (unresolvedData) {
        fs.writeFileSync(UNRESOLVED_FILE_PATH, JSON.stringify(unresolvedData, null, 2), 'utf8');
        console.warn(`[NetsService] [POS-013] Unresolved transaction state PERSISTED: ECN=${unresolvedData.ecn}, Ref=${unresolvedData.ecrRef}`);
      } else if (fs.existsSync(UNRESOLVED_FILE_PATH)) {
        fs.unlinkSync(UNRESOLVED_FILE_PATH);
        console.log(`[NetsService] [POS-013] Unresolved transaction state CLEARED from persistence.`);
      }
    } catch (err) {
      console.error('[NetsService] Error persisting unresolved transaction:', err.message);
    }
  }

  getUnresolvedTransaction() {
    return this.unresolvedTransaction ? { ...this.unresolvedTransaction } : null;
  }

  /**
   * Verified administrative reconciliation clearing method.
   * Requires verified reconciliation evidence (e.g. matching terminal slip or confirmed approval code).
   * Unrestricted / empty clears are strictly forbidden.
   */
  clearUnresolvedTransactionWithEvidence(evidence = {}) {
    if (!this.unresolvedTransaction) {
      return { success: true, message: 'No active unresolved transaction.' };
    }

    if (!evidence || (!evidence.approvalCode && !evidence.reconciliationReason && !evidence.supervisorApproval)) {
      throw new Error('Administrative clearing requires verified reconciliation evidence (approvalCode, reconciliationReason, or supervisorApproval).');
    }

    const previous = { ...this.unresolvedTransaction };
    console.log(`[NetsService] [POS-013] Clearing unresolved transaction ECN=${previous.ecn} with evidence:`, evidence);
    this.saveUnresolvedTransaction(null);
    return {
      success: true,
      message: `Unresolved transaction ECN=${previous.ecn} cleared successfully with evidence.`,
      clearedTransaction: previous,
      evidence,
      clearedAt: new Date().toISOString(),
    };
  }

  /**
   * Multi-process & multi-instance safe atomic ECN generator.
   * Utilizes Microsoft SQL Server SEQUENCE / atomic counter table when database is online.
   * Preserves exact 12-digit zero-padded format.
   * Fails closed if SQL Server is unreachable, ensuring zero cross-process collision risk.
   * Never silently resets or rolls over.
   */
  async getNextEcnAsync() {
    let pool = getPool();
    if (!pool || !pool.connected) {
      try {
        pool = await poolPromise;
      } catch (_) { }
    }

    if (!pool || !pool.connected) {
      const dbErr = new Error('NETS ECN generation failed: Database connection is unavailable. Cannot guarantee cross-process unique ECN.');
      dbErr.code = 'ERR_NETS_ECN_DB_UNAVAILABLE';
      throw dbErr;
    }

    try {
      const query = `
        BEGIN TRANSACTION;
        DECLARE @nextEcn BIGINT;

        IF EXISTS (SELECT * FROM sys.sequences WHERE name = 'NetsEcnSequence')
        BEGIN
          SELECT @nextEcn = NEXT VALUE FOR dbo.NetsEcnSequence;
          UPDATE dbo.NetsEcnCounter
          SET CurrentEcn = @nextEcn, UpdatedAt = GETDATE()
          WHERE Id = 1;
        END
        ELSE
        BEGIN
          UPDATE dbo.NetsEcnCounter WITH (UPDLOCK, HOLDLOCK)
          SET CurrentEcn = CurrentEcn + 1,
              UpdatedAt = GETDATE()
          WHERE Id = 1;

          SELECT @nextEcn = CurrentEcn FROM dbo.NetsEcnCounter WHERE Id = 1;
        END

        COMMIT TRANSACTION;
        SELECT @nextEcn AS ecn;
      `;
      const res = await pool.request().query(query);
      if (res.recordset && res.recordset.length > 0 && res.recordset[0].ecn != null) {
        const val = parseInt(res.recordset[0].ecn, 10);
        if (val > 999999999999) {
          const limitErr = new Error('NETS ECN sequence has reached its maximum limit (999999999999). Rollover requires manual administrative authorization.');
          limitErr.code = 'ERR_NETS_ECN_MAX_LIMIT';
          throw limitErr;
        }
        this.saveEcn(val);
        return val.toString().padStart(12, '0');
      }
      throw new Error('Database returned empty or null ECN result');
    } catch (err) {
      if (err.message && err.message.includes('has reached its minimum or maximum value')) {
        const rolloverErr = new Error('NETS ECN sequence limit reached (999999999999). Rollover blocked to prevent duplicate ECN reuse.');
        rolloverErr.code = 'ERR_NETS_ECN_ROLLOVER_BLOCKED';
        throw rolloverErr;
      }
      throw new Error(`NETS atomic ECN generation failed: ${err.message}`);
    }
  }

  /**
   * Thread-safe sequential ECN generator for isolated test or single-process recovery.
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
  async sendPacket(frameBuffer, timeoutMs = 35000, onProgress = null, context = {}) {
    const { terminalIp, terminalPort, connectionTimeoutMs } = this.config;

    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let responseBuffer = Buffer.alloc(0);
      let expectedTotalLength = null;
      let timer = null;
      let connectTimer = null;
      let isResolved = false;
      let requestDispatched = false;
      const startTime = Date.now();

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        if (connectTimer) clearTimeout(connectTimer);
        socket.removeAllListeners();
        socket.destroy();
      };

      const finishSuccess = (buf, remainingBuf = Buffer.alloc(0)) => {
        if (isResolved) return;
        isResolved = true;
        const duration = Date.now() - startTime;
        console.log(`[${new Date().toISOString()}] [NETS Socket] RX Frame Complete (${buf.length} bytes, remaining=${remainingBuf.length} bytes, duration=${duration}ms): ${sanitizeRawHex(buf.toString('hex'))}`);
        cleanup();
        try {
          const parsed = parseNetsFrame(buf, { context });
          resolve({ parsed, rawHex: buf.toString('hex'), remainingBytes: remainingBuf });
        } catch (err) {
          console.error(`[${new Date().toISOString()}] [NETS Socket] RX Frame Parse Error: ${err.message}`);
          err.isUncertain = requestDispatched;
          err.requestDispatched = requestDispatched;
          reject(err);
        }
      };

      const finishError = (err) => {
        if (isResolved) return;
        isResolved = true;
        const duration = Date.now() - startTime;
        console.error(`[${new Date().toISOString()}] [NETS Socket] Error (${err.code || 'UNKNOWN'}, duration=${duration}ms, dispatched=${requestDispatched}): ${err.message}`);
        cleanup();
        err.requestDispatched = requestDispatched;
        reject(err);
      };

      // Connect timeout
      connectTimer = setTimeout(() => {
        const connErr = new Error(`Connection to NETS terminal at ${terminalIp}:${terminalPort} timed out after ${connectionTimeoutMs / 1000}s`);
        connErr.code = 'ETIMEDOUT';
        connErr.isConnectTimeout = true;
        connErr.requestDispatched = false;
        finishError(connErr);
      }, connectionTimeoutMs);

      // Total transaction timeout
      timer = setTimeout(() => {
        const timeoutErr = new Error(`Terminal communication timed out after ${timeoutMs / 1000} seconds`);
        timeoutErr.code = 'ETIMEDOUT';
        timeoutErr.isTimeout = true;
        timeoutErr.requestDispatched = requestDispatched;
        finishError(timeoutErr);
      }, timeoutMs);

      socket.connect(terminalPort, terminalIp, () => {
        if (connectTimer) {
          clearTimeout(connectTimer);
          connectTimer = null;
        }

        console.log(`[${new Date().toISOString()}] [NETS Socket] Connected to terminal at ${terminalIp}:${terminalPort} (took ${Date.now() - startTime}ms)`);

        // Keep socket timeout active for stalled responses instead of clearing it to 0
        socket.setTimeout(timeoutMs);

        if (onProgress) onProgress({ status: 'connected', message: `Connected to NETS terminal at ${terminalIp}:${terminalPort}` });

        socket.write(frameBuffer, (err) => {
          if (err) {
            const writeErr = new Error(`Failed to send data to terminal: ${err.message}`);
            writeErr.requestDispatched = false;
            console.error(`[${new Date().toISOString()}] [NETS Socket] Write failed: ${err.message}`);
            finishError(writeErr);
          } else {
            requestDispatched = true;
            console.log(`[${new Date().toISOString()}] [NETS Socket] TX Buffer Dispatched (${frameBuffer.length} bytes) to ${terminalIp}:${terminalPort}`);
            if (onProgress) onProgress({ status: 'sent', message: 'Frame dispatched to terminal, awaiting response' });
          }
        });
      });

      socket.on('timeout', () => {
        const timeoutErr = new Error(`NETS Terminal socket idle timed out after ${timeoutMs / 1000} seconds`);
        timeoutErr.code = 'ETIMEDOUT';
        timeoutErr.isTimeout = true;
        timeoutErr.requestDispatched = requestDispatched;
        console.warn(`[${new Date().toISOString()}] [NETS Socket] Socket idle timeout fired after ${timeoutMs / 1000}s (requestDispatched=${requestDispatched})`);
        finishError(timeoutErr);
      });

      socket.on('data', (chunk) => {
        responseBuffer = Buffer.concat([responseBuffer, chunk]);
        console.log(`[${new Date().toISOString()}] [NETS Socket] RX chunk received (+${chunk.length} bytes, total=${responseBuffer.length} bytes)`);

        // CRITICAL SPEC REQUIREMENT: Section 2.2.2.2 - NAK Handling on Ethernet Mode
        // If terminal is busy, it returns a 1-byte 0x15 (NAK)
        if (responseBuffer.length === 1 && responseBuffer[0] === 0x15) {
          const nakErr = new Error('Terminal Busy (NAK 0x15 received from terminal)');
          nakErr.code = 'ETERMINALBUSY';
          nakErr.isNak = true;
          nakErr.requestDispatched = false;
          console.warn(`[${new Date().toISOString()}] [NETS Socket] NAK 0x15 received from terminal (Terminal Busy)`);
          return finishError(nakErr);
        }

        // BCD Length Header Parsing (First 2 bytes)
        // Uses protocol fromBcd2 helper for robust BCD decoding across all frame sizes (e.g. 1527 bytes for QR)
        if (expectedTotalLength === null && responseBuffer.length >= 2) {
          const bodyAndLrcLen = fromBcd2(responseBuffer, 0);
          if (bodyAndLrcLen > 0) {
            expectedTotalLength = bodyAndLrcLen + 2;
            console.log(`[${new Date().toISOString()}] [NETS Socket] BCD header parsed: bodyAndLrcLen=${bodyAndLrcLen}, expectedTotalLength=${expectedTotalLength}`);
          }
        }

        // Complete Frame Received
        // Validate that full frame is present before passing to finishSuccess
        // Preserve any additional bytes received beyond the complete frame
        if (expectedTotalLength !== null && responseBuffer.length >= expectedTotalLength) {
          const completeFrame = responseBuffer.slice(0, expectedTotalLength);
          const remainingBuffer = responseBuffer.slice(expectedTotalLength);
          if (remainingBuffer.length > 0) {
            console.log(`[${new Date().toISOString()}] [NETS Socket] Preserved trailing ${remainingBuffer.length} bytes beyond complete frame`);
          }
          finishSuccess(completeFrame, remainingBuffer);
        }
      });

      socket.on('error', (err) => {
        const sockErr = new Error(`NETS Terminal socket error: ${err.message}`);
        sockErr.code = err.code || 'ESOCKET';
        sockErr.requestDispatched = requestDispatched;
        console.error(`[${new Date().toISOString()}] [NETS Socket] Socket error event: ${err.message} (code=${sockErr.code})`);
        finishError(sockErr);
      });

      socket.on('close', (hadError) => {
        console.log(`[${new Date().toISOString()}] [NETS Socket] Socket closed event: hadError=${hadError}, bufferLength=${responseBuffer.length}, expectedTotalLength=${expectedTotalLength}`);
        if (!isResolved) {
          if (expectedTotalLength !== null && responseBuffer.length >= expectedTotalLength) {
            const completeFrame = responseBuffer.slice(0, expectedTotalLength);
            const remainingBuffer = responseBuffer.slice(expectedTotalLength);
            finishSuccess(completeFrame, remainingBuffer);
          } else {
            const closeErr = new Error(
              requestDispatched
                ? `Connection closed prematurely by NETS terminal after request dispatched (${responseBuffer.length} bytes received)`
                : 'Connection closed by terminal before request dispatched'
            );
            closeErr.code = 'EUNCERTAIN_SOCKET_CLOSED';
            closeErr.isPrematureClose = true;
            closeErr.requestDispatched = requestDispatched;
            finishError(closeErr);
          }
        }
      });
    });
  }

  /**
   * FC 55: Request Terminal Status
   */
  async requestTerminalStatus() {
    const ecn = await this.getNextEcnAsync();
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
   * Allows passing an explicit ECN or generating a fresh atomic ECN
   */
  async getLastApprovedTransaction(explicitEcn = null) {
    const ecn = explicitEcn || await this.getNextEcnAsync();
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
   * Sleep helper with cancellation safety
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * POS-013: Bounded LAN Recovery and FC 56 Retry Handler
   * Encapsulates safe recovery with bounded backoff, retry loop for transport errors,
   * fresh atomic ECNs per attempt, and strict reconciliation matching.
   *
   * @private
   */
  async _recoverWithLastApproved({
    originalEcn,
    refNum,
    amount,
    amountStr,
    flowName,
    txnType,
    initialError,
    onProgress = null,
  }) {
    if (this.isRecoveryInProgress) {
      console.warn(`[NetsService] [POS-013] [${flowName}] Recovery already in progress for ECN=${originalEcn}. Rejecting concurrent recovery loop.`);
      throw new Error(`Recovery already in progress for this transaction (ECN=${originalEcn}).`);
    }

    this.isRecoveryInProgress = true;
    const initialDelay = this.config.recoveryInitialDelayMs !== undefined ? this.config.recoveryInitialDelayMs : 4000;
    const retryDelay = this.config.recoveryRetryDelayMs !== undefined ? this.config.recoveryRetryDelayMs : 2000;
    const maxRetries = this.config.recoveryMaxRetries !== undefined ? this.config.recoveryMaxRetries : 2;

    const recoveryAudit = {
      ecn: originalEcn,
      originalEcn,
      ecrRef: refNum,
      amount,
      amountStr,
      flowName,
      txnType,
      initialErrorCode: initialError?.code || 'UNKNOWN',
      initialErrorMessage: initialError?.message || '',
      startedAt: new Date().toISOString(),
      recoveryAttempts: [],
      status: 'RECOVERY_IN_PROGRESS',
    };

    console.warn(`[${new Date().toISOString()}] [NetsService] [POS-013] [${flowName}] Initiating safe LAN recovery for ECN=${originalEcn} (Ref=${refNum}, Amt=${amount}). Waiting ${initialDelay}ms for link stabilization...`);

    if (onProgress) {
      onProgress({
        status: 'recovery_wait',
        message: `Waiting for terminal connection to stabilize (${initialDelay / 1000}s)...`,
      });
    }

    // Step 1: Bounded initial wait period to let POS LAN cable reconnect and terminal ECR reset
    if (initialDelay > 0) {
      await this._delay(initialDelay);
    }

    let inquiry = null;
    let lastInqErr = null;
    const eligibleErrorCodes = ['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT', 'ESOCKET'];

    // Step 2: Retry loop (Attempt 1 + up to maxRetries)
    const totalAttempts = 1 + maxRetries;
    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      let recoveryEcn = null;
      try {
        recoveryEcn = await this.getNextEcnAsync();
        console.log(`[NetsService] [POS-013] [${flowName}] FC 56 recovery attempt ${attempt}/${totalAttempts} with fresh ECN=${recoveryEcn}`);

        if (onProgress) {
          onProgress({
            status: 'recovering',
            message: `Querying terminal status (Attempt ${attempt}/${totalAttempts}, ECN=${recoveryEcn})...`,
          });
        }

        inquiry = await this.getLastApprovedTransaction(recoveryEcn);
        recoveryAudit.recoveryAttempts.push({
          attempt,
          recoveryEcn,
          timestamp: new Date().toISOString(),
          success: true,
          responseCode: inquiry.responseCode,
          approvalCode: inquiry.approvalCode,
        });

        // FC 56 succeeded at transport level
        break;
      } catch (inqErr) {
        lastInqErr = inqErr;
        const errCode = inqErr.code || (inqErr.message.includes('timed out') ? 'ETIMEDOUT' : 'UNKNOWN');
        console.warn(`[NetsService] [POS-013] [${flowName}] FC 56 recovery attempt ${attempt}/${totalAttempts} failed: ${inqErr.message} (code=${errCode})`);

        recoveryAudit.recoveryAttempts.push({
          attempt,
          recoveryEcn,
          timestamp: new Date().toISOString(),
          success: false,
          errorCode: errCode,
          errorMessage: inqErr.message,
        });

        const isEligibleRetry = eligibleErrorCodes.some(c => errCode.includes(c) || inqErr.message.includes(c));
        if (attempt < totalAttempts && isEligibleRetry) {
          console.log(`[NetsService] [POS-013] [${flowName}] Retrying FC 56 in ${retryDelay}ms...`);
          if (retryDelay > 0) await this._delay(retryDelay);
        } else if (!isEligibleRetry) {
          console.error(`[NetsService] [POS-013] [${flowName}] Non-transport error encountered. Aborting retries.`);
          break;
        }
      }
    }

    this.isRecoveryInProgress = false;

    // Step 3: Evaluate Inquiry Outcome
    if (inquiry) {
      const inqRef = (inquiry.fields['HS'] || inquiry.fields['HD'] || '').trim();
      const isRefMatched = inqRef === refNum.trim();
      const inqAmountStr = (inquiry.fields['40'] || '').trim();
      const isAmountMatched = inqAmountStr === amountStr;

      // SCENARIO A: Conclusive Approval Match
      if (inquiry.success && isRefMatched && isAmountMatched && inquiry.parsed.isApproved) {
        console.log(`[NetsService] [POS-013] [${flowName}] Transaction conclusively matched & recovered via FC 56! Approved.`);
        // If an unresolved lock existed, clean it up since transaction is confirmed approved
        this.saveUnresolvedTransaction(null);

        const recoveredResult = {
          ecn: originalEcn,
          recoveryEcn: inquiry.ecn,
          recoveryAttempts: recoveryAudit.recoveryAttempts,
          isApproved: true,
          recovered: true,
          paymentType: flowName,
          txnType,
          functionCode: txnType === 'I0' ? 'I0' : '30',
          approvalReason: `Approved (Conclusively matched & recovered via FC 56 for ${flowName})`,
          responseCode: inquiry.responseCode,
          hostResponseCode: inquiry.parsed.hostResponseCode,
          responseDescription: `Approved (Recovered via FC 56 Inquiry for ${flowName})`,
          approvalCode: inquiry.approvalCode,
          stan: inquiry.fields['65'] || inquiry.fields['30'] || '',
          rrn: inquiry.fields['D3'] || '',
          merchantId: inquiry.fields['D1'] || '',
          terminalId: inquiry.fields['16'] || '',
          cardLabel: inquiry.fields['L7'] || inquiry.fields['D8'] || inquiry.fields['D7'] || '',
          cardIssuer: inquiry.fields['D7'] || '',
          cardScheme: inquiry.fields['D8'] || '',
          acquirer: inquiry.fields['9H'] || inquiry.fields['9G'] || '',
          maskedPan: inquiry.fields['30'] || '',
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
      }

      // SCENARIO B: Inquiry succeeded but returned a NON-MATCHING transaction
      // Requirement 2: Do NOT mark as cancelled or declined solely because FC 56 returns a non-matching previous transaction!
      // The current transaction outcome is UNKNOWN / REQUIRES RECONCILIATION.
      console.warn(`[NetsService] [POS-013] [${flowName}] FC 56 returned non-matching transaction (inqRef='${inqRef}', expected='${refNum}', inqAmt='${inqAmountStr}', expected='${amountStr}'). Transaction outcome is UNKNOWN.`);

      recoveryAudit.status = 'UNRESOLVED';
      recoveryAudit.unresolvedReason = `FC 56 inquiry did not match active transaction (Terminal had ref '${inqRef}' vs expected '${refNum}'). Outcome is UNKNOWN.`;
      recoveryAudit.lastInquiry = {
        ecn: inquiry.ecn,
        inqRef,
        inqAmountStr,
        approvalCode: inquiry.approvalCode,
        responseCode: inquiry.responseCode,
        description: inquiry.description,
      };

      this.saveUnresolvedTransaction(recoveryAudit);

      const unconfirmedErr = new Error(`Transaction outcome unknown for ${flowName}. FC 56 inquiry did not match this order. Manual reconciliation required. Do NOT recharge customer.`);
      unconfirmedErr.code = 'ERECONCILIATIONREQUIRED';
      unconfirmedErr.originalEcn = originalEcn;
      unconfirmedErr.recoveryAttempts = recoveryAudit.recoveryAttempts;
      unconfirmedErr.inquiry = inquiry;
      unconfirmedErr.unresolved = recoveryAudit;
      throw unconfirmedErr;
    }

    // SCENARIO C: All FC 56 transport attempts exhausted or failed
    // Requirement 10: Mark outcome as UNKNOWN / REQUIRES RECONCILIATION rather than confirmed declined or cancelled.
    console.error(`[NetsService] [POS-013] [${flowName}] All FC 56 recovery attempts exhausted. Final transport error: ${lastInqErr?.message}`);

    recoveryAudit.status = 'UNRESOLVED';
    recoveryAudit.unresolvedReason = `All FC 56 recovery attempts failed (${lastInqErr?.message}). Terminal status could not be verified. Outcome is UNKNOWN.`;
    recoveryAudit.lastTransportError = {
      code: lastInqErr?.code || 'ETIMEDOUT',
      message: lastInqErr?.message || 'Terminal communication timed out',
    };

    this.saveUnresolvedTransaction(recoveryAudit);

    const recoveryExhaustedErr = new Error(`Transaction outcome unknown for ${flowName}. Network recovery attempts to terminal exhausted. Manual reconciliation required. Do NOT recharge customer.`);
    recoveryExhaustedErr.code = 'ERECONCILIATIONREQUIRED';
    recoveryExhaustedErr.originalEcn = originalEcn;
    recoveryExhaustedErr.recoveryAttempts = recoveryAudit.recoveryAttempts;
    recoveryExhaustedErr.lastError = lastInqErr;
    recoveryExhaustedErr.unresolved = recoveryAudit;
    throw recoveryExhaustedErr;
  }

  /**
   * FC 80: NETS Logon
   */
  async logon() {
    const ecn = await this.getNextEcnAsync();
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
   * Set callback for TMS state change broadcasts (e.g. Socket.IO)
   */
  setTmsStateListener(listener) {
    this.onTmsStateChange = listener;
  }

  /**
   * Internal helper to update and broadcast TMS state
   */
  _updateTmsStatus(updates = {}) {
    this.tmsStatus = {
      ...this.tmsStatus,
      ...updates,
      timestamp: new Date().toISOString(),
    };
    console.log(`[NetsService] [POS-001] TMS Status -> ${this.tmsStatus.status} (${this.tmsStatus.statusText})`);
    if (typeof this.onTmsStateChange === 'function') {
      try {
        this.onTmsStateChange({ ...this.tmsStatus });
      } catch (err) {
        console.error('[NetsService] Error notifying onTmsStateChange:', err.message);
      }
    }
  }

  /**
   * Returns current TMS / reboot status
   */
  getTmsStatus() {
    return { ...this.tmsStatus };
  }

  /**
   * FC 81: NETS Settlement
   * Automatically triggers FC 84 (TMS / CTS Update) upon successful settlement per POS-001.
   */
  async settlement() {
    if (this.unresolvedTransaction) {
      throw new Error(`Cannot perform settlement while an unresolved transaction exists (ECN=${this.unresolvedTransaction.ecn}, Ref=${this.unresolvedTransaction.ecrRef}). Please reconcile first.`);
    }
    if (this.isProcessing) {
      throw new Error('A terminal operation is already in progress.');
    }
    if (this.isTmsUpdating) {
      throw new Error(`Terminal is currently rebooting/updating via TMS. Please wait until ready.`);
    }

    const ecn = await this.getNextEcnAsync();
    const frame = buildNetsFrame({
      ecn,
      functionCode: '81',
      versionCode: '01',
      fields: [],
    });

    console.log(`[NetsService] Sending FC 81 (NETS Settlement) ECN=${ecn}`);
    const res = await this.sendPacket(frame, this.config.adminTimeoutMs);
    const isSuccess = res.parsed.responseCode === '00';

    const settlementResult = {
      ecn,
      success: isSuccess,
      responseCode: res.parsed.responseCode,
      description: res.parsed.responseDescription,
      fields: res.parsed.fields,
      rawHex: res.rawHex,
      parsed: res.parsed,
    };

    // POS-001: Automatic TMS Trigger After Successful Settlement
    if (isSuccess) {
      console.log(`[NetsService] [POS-001] Settlement FC81 succeeded (ECN=${ecn}). Automatically triggering TMS (FC84)...`);
      // Trigger asynchronously so settlement response returns immediately to cashier,
      // while TMS update & terminal reboot monitoring proceed in background.
      this.triggerTmsAfterSettlement(ecn).catch((tmsErr) => {
        console.error(`[NetsService] [POS-001] Error during automated TMS trigger:`, tmsErr.message);
      });
    } else {
      console.warn(`[NetsService] [POS-001] Settlement FC81 did not succeed (RC=${res.parsed.responseCode}). FC84 will NOT be triggered.`);
    }

    return settlementResult;
  }

  /**
   * POS-001: Automated TMS Workflow Runner
   * 1. Validate against duplicate trigger for same settlement ECN.
   * 2. Wait 2 seconds before dispatching FC84.
   * 3. Send FC84 with unique 12-digit ECN.
   * 4. Receive and validate acknowledgement.
   * 5. Monitor terminal reboot via periodic FC55 status polling until terminal is ready.
   * 6. Block any payment / settlement commands during reboot window.
   */
  async triggerTmsAfterSettlement(settlementEcn) {
    // 1. Prevent duplicate execution for the same successful settlement
    if (this.tmsStatus.lastSettlementEcn === settlementEcn && (this.tmsStatus.status === 'triggered' || this.tmsStatus.status === 'terminal_rebooting')) {
      console.warn(`[NetsService] [POS-001] Duplicate FC84 trigger ignored for Settlement ECN=${settlementEcn}`);
      return;
    }

    this.isTmsUpdating = true;
    this._updateTmsStatus({
      status: 'pending',
      statusText: 'Settlement Succeeded. Preparing TMS Update...',
      lastSettlementEcn: settlementEcn,
      lastSettlementTime: new Date().toISOString(),
      pollCount: 0,
      error: null,
    });

    // Short buffer (2 seconds) after FC81 before sending FC84
    await new Promise((r) => setTimeout(r, 2000));

    try {
      this._updateTmsStatus({
        status: 'triggered',
        statusText: 'Triggering TMS Update (FC 84)...',
        tmsTriggerTime: new Date().toISOString(),
      });

      const tmsRes = await this.tmsUpdate();
      console.log(`[NetsService] [POS-001] FC84 Response received:`, tmsRes);

      if (tmsRes.success) {
        // Acknowledgement received (RC=00)
        this._updateTmsStatus({
          status: 'terminal_rebooting',
          statusText: 'TMS Triggered. Terminal Rebooting...',
          tmsEcn: tmsRes.ecn,
          terminalRebootStartTime: new Date().toISOString(),
        });

        // Begin polling FC55 to detect when terminal finishes reboot and returns to ready state
        this.pollTerminalReadyAfterTms();
      } else {
        this.isTmsUpdating = false;
        this._updateTmsStatus({
          status: 'failed',
          statusText: `TMS Trigger Rejected by Terminal (${tmsRes.responseCode}: ${tmsRes.description})`,
          error: tmsRes.description,
        });
      }
    } catch (err) {
      this.isTmsUpdating = false;
      this._updateTmsStatus({
        status: 'failed',
        statusText: `TMS Communication Error: ${err.message}`,
        error: err.message,
      });
      console.error(`[NetsService] [POS-001] Failed to send FC84:`, err.message);
    }
  }

  /**
   * POS-001: Poll terminal status (FC 55) after TMS trigger until terminal is ready.
   * Per NETS specification, after receiving FC84 acknowledgement, the terminal reboots.
   * During reboot, TCP connections may drop or refuse until terminal OS finishes booting.
   * Once the terminal accepts FC55 and responds with RC='00', the terminal is confirmed Ready.
   */
  async pollTerminalReadyAfterTms() {
    if (this.tmsPollTimeoutTimer) {
      clearTimeout(this.tmsPollTimeoutTimer);
      this.tmsPollTimeoutTimer = null;
    }

    const startTime = Date.now();
    const maxPollDurationMs = 120000; // 2 minutes maximum reboot window
    const pollIntervalMs = 5000;      // Poll every 5 seconds
    // Initial delay before first poll: allow terminal time to close connection and begin rebooting
    const initialRebootDelayMs = 8000;

    await new Promise((r) => setTimeout(r, initialRebootDelayMs));

    let pollCount = 0;

    const executePoll = async () => {
      pollCount++;
      const elapsed = Date.now() - startTime;

      if (elapsed > maxPollDurationMs) {
        console.error(`[NetsService] [POS-001] Terminal reboot poll timed out after ${Math.round(elapsed / 1000)}s.`);
        this.isTmsUpdating = false;
        this._updateTmsStatus({
          status: 'timed_out',
          statusText: 'Terminal Reboot Timed Out. Please verify terminal display.',
          pollCount,
          error: 'Max reboot timeout exceeded',
        });
        return;
      }

      console.log(`[NetsService] [POS-001] Polling Terminal Status (FC 55) [Attempt ${pollCount}, ${Math.round(elapsed / 1000)}s elapsed]...`);
      this._updateTmsStatus({
        pollCount,
        statusText: `Terminal Rebooting... Checking status (${Math.round(elapsed / 1000)}s)`,
      });

      try {
        const statusRes = await this.requestTerminalStatus();
        console.log(`[NetsService] [POS-001] FC 55 poll response: RC=${statusRes.responseCode}, Success=${statusRes.success}`);

        if (statusRes.success && statusRes.responseCode === '00') {
          console.log(`[NetsService] [POS-001] Terminal is CONFIRMED READY after TMS/Reboot!`);
          this.isTmsUpdating = false;
          this._updateTmsStatus({
            status: 'ready',
            statusText: 'TMS Complete. Terminal Ready.',
            terminalReadyTime: new Date().toISOString(),
            terminalInfo: statusRes.fields,
          });
          return;
        } else {
          // Terminal responded but returned non-00 status; wait for next cycle
          this.tmsPollTimeoutTimer = setTimeout(executePoll, pollIntervalMs);
        }
      } catch (pollErr) {
        // Expected during physical reboot: ECONNREFUSED, ETIMEDOUT, socket reset
        console.log(`[NetsService] [POS-001] Terminal still rebooting / unreachable (${pollErr.message}). Retrying in ${pollIntervalMs / 1000}s...`);
        this.tmsPollTimeoutTimer = setTimeout(executePoll, pollIntervalMs);
      }
    };

    executePoll();
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
    const ecn = await this.getNextEcnAsync();
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
    const ecn = await this.getNextEcnAsync();
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
    if (isQr) {
      return this.purchaseQr({ amount, ecrRef, retrySameEcn, onProgress });
    } else {
      return this.purchaseCard({ amount, ecrRef, retrySameEcn, onProgress });
    }
  }

  /**
   * Dedicated NETS Card Purchase Flow (FC 30 with T2="01")
   * Supports: NETS Chip, Tap, Magnetic Stripe, and FlashPay contactless cards.
   */
  async purchaseCard({ amount, ecrRef, retrySameEcn = null, onProgress = null }) {
    return this._executePurchaseTransaction({
      amount,
      ecrRef,
      txnType: '01',
      flowName: 'NETS Card',
      retrySameEcn,
      onProgress,
    });
  }

  /**
   * Dedicated NETS QR Purchase Flow (FC 30 with T2="04")
   * Displays NETS Scan to Pay dynamic QR code on the Ingenico terminal display.
   */
  async purchaseQr({ amount, ecrRef, retrySameEcn = null, onProgress = null }) {
    return this._executePurchaseTransaction({
      amount,
      ecrRef,
      txnType: '04',
      flowName: 'NETS QR',
      retrySameEcn,
      onProgress,
    });
  }

  /**
   * Dedicated NETS Credit Card Purchase Flow (FC I0)
   * Official Specification: Section 4.8.1 - Credit Card Sale (Function Code I0), pages 82-84.
   * Supports Visa, Mastercard, AMEX with automatic BIN processing (Field 9G omitted).
   */
  async purchaseCreditCard({ amount, ecrRef, retrySameEcn = null, onProgress = null }) {
    return this._executeCreditCardTransaction({
      amount,
      ecrRef,
      retrySameEcn,
      onProgress,
    });
  }

  /**
   * Internal dedicated runner for Credit Card Sale (FC I0) with strict isolation and validation
   * @private
   */
  async _executeCreditCardTransaction({ amount, ecrRef, retrySameEcn = null, onProgress = null }) {
    if (this.unresolvedTransaction) {
      throw new Error(`Cannot initiate NETS Credit Card payment while an unresolved transaction exists (ECN=${this.unresolvedTransaction.ecn}, Ref=${this.unresolvedTransaction.ecrRef}). Manual reconciliation is required.`);
    }
    if (this.isProcessing) {
      throw new Error(`A payment transaction is already in progress on the terminal.`);
    }
    if (this.isTmsUpdating) {
      throw new Error(`NETS terminal is currently performing TMS update / reboot (${this.tmsStatus.statusText}). Payment commands are temporarily blocked.`);
    }

    const flowName = 'NETS Credit Card';
    this.isProcessing = true;
    let ecn = null;
    let amountStr = '';
    let refNum = '';

    try {
      ecn = retrySameEcn || await this.getNextEcnAsync();
      amountStr = formatAmount(amount);

      // Section 4.8.1: Field HD (Enhanced ECR Reference) is 13 ASCII characters
      const rawRef = (ecrRef || `P${Date.now()}`).toString().trim().replace(/[^a-zA-Z0-9]/g, '');
      refNum = rawRef.length >= 13 ? rawRef.slice(-13) : rawRef.padStart(13, '0');

      // Section 4.8.1:
      // Header: ECN (12 ASC) + Function Code 'I0' + Version '01' + RFU '0' + FS
      // Mandatory Fields:
      // - Field 40: Transaction Amount (12-char zero-padded amount in cents)
      // - Field HD: Enhanced ECR Reference Number (13 characters)
      // Acquirer selection is automatic via BIN routing: Field 9G is omitted. Field 9Q is omitted.
      const fields = [
        { code: '40', value: amountStr },
        { code: 'HD', value: refNum },
      ];

      const frame = buildNetsFrame({
        ecn,
        functionCode: 'I0',
        versionCode: '01',
        fields,
      });

      console.log(`[${new Date().toISOString()}] [NetsService] [${flowName}] TX Frame Dispatched: ECN=${ecn}, Amount=${amount} (${amountStr}), Function=I0, Field HD=${refNum}`);
      console.log(`[${new Date().toISOString()}] [NetsService] [${flowName}] TX Raw Hex (${frame.length} bytes): ${frame.toString('hex').toUpperCase()}`);

      const res = await this.sendPacket(frame, this.config.financialTimeoutMs, onProgress, {
        isQr: false,
        txnType: 'I0',
        flowName,
      });
      this.isProcessing = false;

      const isApproved = res.parsed.isApproved;
      const result = {
        ecn,
        isApproved,
        paymentType: flowName,
        txnType: 'I0',
        functionCode: 'I0',
        approvalReason: res.parsed.approvalReason,
        responseCode: res.parsed.responseCode,
        hostResponseCode: res.parsed.hostResponseCode,
        responseDescription: res.parsed.responseDescription,
        // Credit card response fields per Spec Section 4.8.1
        approvalCode: res.parsed.approvalCode || res.parsed.fields['01'] || '',
        stan: res.parsed.fields['65'] || res.parsed.fields['30'] || '',
        rrn: res.parsed.fields['D3'] || '',
        merchantId: res.parsed.fields['D1'] || '',
        terminalId: res.parsed.fields['16'] || '',
        cardLabel: res.parsed.fields['L7'] || res.parsed.fields['D8'] || res.parsed.fields['D7'] || '',
        cardIssuer: res.parsed.fields['D7'] || '',
        cardScheme: res.parsed.fields['D8'] || '',
        acquirer: res.parsed.fields['9H'] || res.parsed.fields['9G'] || '',
        cardExpiry: res.parsed.fields['02'] || '',
        maskedPan: res.parsed.fields['30'] || '',
        batchNo: res.parsed.fields['50'] || '',
        invoiceNo: res.parsed.fields['31'] || '',
        entryMode: res.parsed.fields['9M'] || '',
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
      console.error(`[${new Date().toISOString()}] [NetsService] [${flowName}] Purchase error ECN=${ecn}: ${err.message}`);

      if (err.isNak) {
        throw new Error('Terminal is currently busy. Please wait and try again.');
      }

      const isUncertainOutcome = (err.isTimeout || err.isUncertain || err.isPrematureClose || err.requestDispatched);

      if (isUncertainOutcome && this.config.lastApprovedQueryOnTimeout) {
        return await this._recoverWithLastApproved({
          originalEcn: ecn,
          refNum,
          amount,
          amountStr,
          flowName,
          txnType: 'I0',
          initialError: err,
          onProgress,
        });
      }

      throw err;
    }
  }

  /**
   * Internal common runner for FC 30 with strict flow isolation and validation
   * @private
   */
  async _executePurchaseTransaction({ amount, ecrRef, txnType = '01', flowName = 'NETS Card', retrySameEcn = null, onProgress = null }) {
    if (this.unresolvedTransaction) {
      throw new Error(`Cannot initiate ${flowName} payment while an unresolved transaction exists (ECN=${this.unresolvedTransaction.ecn}, Ref=${this.unresolvedTransaction.ecrRef}). Manual reconciliation is required.`);
    }
    if (this.isProcessing) {
      throw new Error(`A payment transaction is already in progress on the terminal.`);
    }
    if (this.isTmsUpdating) {
      throw new Error(`NETS terminal is currently performing TMS update / reboot (${this.tmsStatus.statusText}). Payment commands are temporarily blocked.`);
    }

    this.isProcessing = true;
    let ecn = null;
    let amountStr = '';
    let refNum = '';

    try {
      ecn = retrySameEcn || await this.getNextEcnAsync();
      amountStr = formatAmount(amount);
      // Format 13-character Enhanced ECR Reference for Field HD per NETS support requirements
      const rawRef = (ecrRef || `P${Date.now()}`).toString().trim().replace(/[^a-zA-Z0-9]/g, '');
      refNum = rawRef.length >= 13 ? rawRef.slice(-13) : rawRef.padStart(13, '0');
      const refCode = (this.config.ecrRefFieldCode || 'HD').toUpperCase().slice(0, 2);

      // NETS support instruction:
      // 1. Remove Field 42 (Cash Back Amount) completely from FC 30 request (do not send 0s or empty).
      // 2. Field HD length must be exactly 13 characters (BCD 0013).
      // 3. Preserve T2=04 for QR and T2=01 for Card.
      const fields = [
        { code: 'T2', value: txnType },
        { code: '40', value: amountStr },
        { code: refCode, value: refNum },
      ];

      const frame = buildNetsFrame({
        ecn,
        functionCode: '30',
        versionCode: '01',
        fields,
      });

      console.log(`[${new Date().toISOString()}] [NetsService] [${flowName}] TX Frame Dispatched: ECN=${ecn}, Amount=${amount} (${amountStr}), Type=${txnType}, RefField=${refCode}, Ref=${refNum}`);
      console.log(`[${new Date().toISOString()}] [NetsService] [${flowName}] TX Raw Hex (${frame.length} bytes): ${frame.toString('hex').toUpperCase()}`);

      const res = await this.sendPacket(frame, this.config.financialTimeoutMs, onProgress, {
        isQr: txnType === '04',
        txnType,
        flowName,
      });
      this.isProcessing = false;

      const isApproved = res.parsed.isApproved;
      const result = {
        ecn,
        isApproved,
        paymentType: flowName, // 'NETS Card' or 'NETS QR'
        txnType,
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
      console.error(`[${new Date().toISOString()}] [NetsService] [${flowName}] Purchase error ECN=${ecn}: ${err.message}`);

      // Handle NAK (Terminal Busy)
      // Section 2.2.2.2: Do NOT retry financial payments blindly! Terminal is busy with another customer.
      if (err.isNak) {
        throw new Error('Terminal is currently busy. Please wait and try again.');
      }

      // Handle Timeout / Uncertain outcome: Rigorous FC 56 Recovery
      // Trigger recovery whenever the request was dispatched and outcome became uncertain
      // (e.g. response timeout, socket reset/close, or parsing failure)
      const isUncertainOutcome = (err.isTimeout || err.isUncertain || err.isPrematureClose || err.requestDispatched);

      if (isUncertainOutcome && this.config.lastApprovedQueryOnTimeout) {
        return await this._recoverWithLastApproved({
          originalEcn: ecn,
          refNum,
          amount,
          amountStr,
          flowName,
          txnType,
          initialError: err,
          onProgress,
        });
      }

      throw err;
    }
  }

  /**
   * FC Q1: Request QR Payload for POS Display
   */
  async requestQrPayload({ amount, ecrRef }) {
    const ecn = await this.getNextEcnAsync();
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
    const ecn = await this.getNextEcnAsync();
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
  async runEndOfDaySequence(onStepProgress = () => { }) {
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

// Export singleton instance and class definition for testing
const netsServiceInstance = new NetsService();
netsServiceInstance.NetsService = NetsService;
module.exports = netsServiceInstance;
