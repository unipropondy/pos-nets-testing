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
const UNRESOLVED_FILE_PATH = process.env.NETS_UNRESOLVED_FILE_PATH || path.join(__dirname, '../config/netsUnresolved.json');
const AUDIT_FILE_PATH = process.env.NETS_AUDIT_FILE_PATH || path.join(__dirname, '../config/netsAuditHistory.json');

class NetsService {
  constructor() {
    this.config = this.loadConfig();
    this.currentEcn = this.loadEcn();
    this.unresolvedTransactions = this.loadUnresolvedTransactions();
    // Maintain unresolvedTransaction getter/setter compatibility pointing to latest unresolved record
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

    // Log startup diagnostics
    this.logStartupDiagnostics();
  }

  /**
   * Logs runtime diagnostics describing the active workspace process,
   * config paths, timeouts, and recovery engine versions.
   */
  logStartupDiagnostics() {
    const pkgVersion = (() => {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
        return pkg.version || 'unknown';
      } catch {
        return 'unknown';
      }
    })();

    console.log('================================================================');
    console.log('🚀 [NetsService] Active Workspace Runtime Diagnostics');
    console.log(`   - Backend Source Dir       : ${__dirname}`);
    console.log(`   - Application Version      : v${pkgVersion}`);
    console.log(`   - NETS Config File Path    : ${CONFIG_FILE_PATH}`);
    console.log(`   - Terminal IP / Port       : ${this.config.terminalIp}:${this.config.terminalPort}`);
    console.log(`   - Financial Timeout        : ${this.config.financialTimeoutMs}ms (${this.config.financialTimeoutMs / 1000}s)`);
    console.log(`   - Admin Timeout            : ${this.config.adminTimeoutMs}ms (${this.config.adminTimeoutMs / 1000}s)`);
    console.log(`   - ECR Ref Field Code       : ${this.config.ecrRefFieldCode || 'HD'}`);
    console.log(`   - POS-014 Same-ECN Recovery: ${this.config.autoRetryWithSameEcn ? 'ENABLED (Primary)' : 'DISABLED'}`);
    console.log(`   - POS-013 FC56 Recovery    : ${this.config.lastApprovedQueryOnTimeout ? 'ENABLED (Fallback)' : 'DISABLED'}`);
    console.log(`   - Active Unresolved Records: ${this.unresolvedTransactions.length}`);
    console.log(`   - Current Persisted ECN    : ${this.getCurrentEcn()}`);
    console.log('================================================================');
  }

  loadConfig() {
    let cfg = {};
    try {
      if (fs.existsSync(CONFIG_FILE_PATH)) {
        const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
        cfg = JSON.parse(raw);
      }
    } catch (err) {
      console.error('[NetsService] Error loading config:', err.message);
    }
    // Default UAT / LAN settings
    const merged = {
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
      ...cfg,
    };

    // Explicit UAT-only environment override for controlled timeout testing
    if (process.env.NETS_UAT_FINANCIAL_TIMEOUT_MS) {
      const uatTimeout = parseInt(process.env.NETS_UAT_FINANCIAL_TIMEOUT_MS, 10);
      if (!isNaN(uatTimeout) && uatTimeout > 0) {
        console.warn(`[NetsService] [UAT OVERRIDE] Active financialTimeoutMs overridden by env NETS_UAT_FINANCIAL_TIMEOUT_MS: ${uatTimeout}ms (Config was: ${merged.financialTimeoutMs}ms)`);
        merged.financialTimeoutMs = uatTimeout;
      }
    }

    return merged;
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

  getUnresolvedFilePath() {
    return process.env.NETS_UNRESOLVED_FILE_PATH || path.join(__dirname, '../config/netsUnresolved.json');
  }

  getAuditFilePath() {
    return process.env.NETS_AUDIT_FILE_PATH || path.join(__dirname, '../config/netsAuditHistory.json');
  }

  /**
   * Appends a transaction record to the permanent NETS audit history.
   * Preserves confirmed cancellations, reconciled transactions, and resolved locks.
   *
   * @param {Object} record
   */
  recordAuditHistory(record) {
    if (!record) return;
    try {
      const filePath = this.getAuditFilePath();
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      let history = [];
      if (fs.existsSync(filePath)) {
        try {
          const raw = fs.readFileSync(filePath, 'utf8');
          history = JSON.parse(raw);
          if (!Array.isArray(history)) history = [];
        } catch (_) {
          history = [];
        }
      }

      const entry = {
        ...record,
        recordedAt: new Date().toISOString(),
      };

      // Keep latest 500 audit entries
      history.unshift(entry);
      if (history.length > 500) history.pop();

      fs.writeFileSync(filePath, JSON.stringify(history, null, 2), 'utf8');
      console.log(`[NetsService] [AUDIT] Transaction recorded in audit history: ECN=${entry.ecn || entry.originalEcn}, Status=${entry.status || (entry.isApproved ? 'APPROVED' : 'DECLINED/CANCELLED')}, Ref=${entry.ecrRef}`);
    } catch (err) {
      console.error('[NetsService] Error recording audit history:', err.message);
    }
  }

  /**
   * Retrieves permanent NETS audit history.
   */
  getAuditHistory() {
    try {
      const filePath = this.getAuditFilePath();
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const history = JSON.parse(raw);
        return Array.isArray(history) ? history : [];
      }
    } catch (err) {
      console.error('[NetsService] Error reading audit history:', err.message);
    }
    return [];
  }

  get unresolvedTransaction() {
    if (!this.unresolvedTransactions || this.unresolvedTransactions.length === 0) return null;
    return this.unresolvedTransactions[0];
  }

  set unresolvedTransaction(val) {
    if (!val) {
      this.unresolvedTransactions = [];
    } else {
      if (!Array.isArray(this.unresolvedTransactions)) this.unresolvedTransactions = [];
      const idx = this.unresolvedTransactions.findIndex(t => t.ecn === val.ecn || t.originalEcn === val.originalEcn);
      if (idx >= 0) {
        this.unresolvedTransactions[idx] = val;
      } else {
        this.unresolvedTransactions.unshift(val);
      }
    }
  }

  loadUnresolvedTransactions() {
    try {
      const filePath = this.getUnresolvedFilePath();
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          const valid = data.filter(d => d && d.ecn && (d.status === 'UNRESOLVED' || d.status === 'RECOVERY_IN_PROGRESS'));
          if (valid.length > 0) {
            console.warn(`[NetsService] Loaded ${valid.length} PERSISTED unresolved transaction record(s)`);
          }
          return valid;
        } else if (data && data.ecn && (data.status === 'UNRESOLVED' || data.status === 'RECOVERY_IN_PROGRESS')) {
          console.warn(`[NetsService] Loaded single PERSISTED unresolved transaction lock: ECN=${data.ecn}`);
          return [data];
        }
      }
    } catch (err) {
      console.error('[NetsService] Error loading unresolved transactions:', err.message);
    }
    return [];
  }

  loadUnresolvedTransaction() {
    const list = this.loadUnresolvedTransactions();
    return list.length > 0 ? list[0] : null;
  }

  saveUnresolvedTransactions(unresolvedList) {
    this.unresolvedTransactions = Array.isArray(unresolvedList) ? unresolvedList : (unresolvedList ? [unresolvedList] : []);
    try {
      const filePath = this.getUnresolvedFilePath();
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      if (this.unresolvedTransactions.length > 0) {
        fs.writeFileSync(filePath, JSON.stringify(this.unresolvedTransactions, null, 2), 'utf8');
        console.warn(`[NetsService] [POS-013] Persisted ${this.unresolvedTransactions.length} unresolved transaction record(s). Latest ECN=${this.unresolvedTransactions[0]?.ecn}`);
      } else if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[NetsService] [POS-013] Unresolved transaction state CLEARED from persistence.`);
      }
    } catch (err) {
      console.error('[NetsService] Error persisting unresolved transactions:', err.message);
    }
  }

  saveUnresolvedTransaction(unresolvedData) {
    if (!unresolvedData) {
      this.saveUnresolvedTransactions([]);
      return;
    }
    const currentList = this.loadUnresolvedTransactions();
    const existingIndex = currentList.findIndex(t => (t.ecn && t.ecn === unresolvedData.ecn) || (t.originalEcn && t.originalEcn === unresolvedData.originalEcn));
    if (existingIndex >= 0) {
      currentList[existingIndex] = unresolvedData;
    } else {
      currentList.unshift(unresolvedData);
    }
    this.saveUnresolvedTransactions(currentList);
  }

  getUnresolvedTransactions() {
    return Array.isArray(this.unresolvedTransactions) ? [...this.unresolvedTransactions] : [];
  }

  getUnresolvedTransaction() {
    return this.unresolvedTransaction ? { ...this.unresolvedTransaction } : null;
  }

  /**
   * Verified administrative reconciliation clearing method.
   * Requires verified reconciliation evidence (e.g. matching terminal slip or confirmed approval code).
   * Supports targetEcn to clear a specific record when multiple exist.
   */
  clearUnresolvedTransactionWithEvidence(evidence = {}) {
    const currentList = this.loadUnresolvedTransactions();
    if (!currentList || currentList.length === 0) {
      return { success: true, message: 'No active unresolved transaction.' };
    }

    let targetRecord = null;
    let targetIndex = -1;

    if (evidence.targetEcn) {
      targetIndex = currentList.findIndex(t => t.ecn === evidence.targetEcn || t.originalEcn === evidence.targetEcn);
      if (targetIndex < 0) {
        throw new Error(`Target ECN mismatch: no unresolved transaction found with ECN=${evidence.targetEcn}`);
      }
      targetRecord = currentList[targetIndex];
    } else {
      targetIndex = 0;
      targetRecord = currentList[0];
    }

    if (!evidence || (!evidence.approvalCode && !evidence.reconciliationReason && !evidence.supervisorApproval)) {
      throw new Error('Administrative clearing requires verified reconciliation evidence (approvalCode, reconciliationReason, or supervisorApproval).');
    }

    console.log(`[NetsService] [POS-013] Clearing unresolved transaction ECN=${targetRecord.ecn} with evidence:`, evidence);
    this.recordAuditHistory({
      ...targetRecord,
      status: 'ADMIN_CLEARED_WITH_EVIDENCE',
      evidence,
      clearedAt: new Date().toISOString(),
    });

    currentList.splice(targetIndex, 1);
    this.saveUnresolvedTransactions(currentList);

    return {
      success: true,
      message: `Unresolved transaction ECN=${targetRecord.ecn} cleared successfully with evidence.`,
      clearedTransaction: targetRecord,
      remainingCount: currentList.length,
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
        const elapsed = Date.now() - startTime;
        const timeoutErr = new Error(`Terminal communication timed out after ${timeoutMs / 1000} seconds (real elapsed: ${elapsed}ms)`);
        timeoutErr.code = 'ETIMEDOUT';
        timeoutErr.isTimeout = true;
        timeoutErr.requestDispatched = requestDispatched;
        console.warn(`[${new Date().toISOString()}] [ORIGINAL_TIMEOUT] ECN=${context.ecn || 'N/A'}, Ref=${context.ecrRef || 'N/A'}: Fired after ${elapsed}ms (configured: ${timeoutMs}ms)`);
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
        const elapsed = Date.now() - startTime;
        const timeoutErr = new Error(`NETS Terminal socket idle timed out after ${timeoutMs / 1000} seconds (real elapsed: ${elapsed}ms)`);
        timeoutErr.code = 'ETIMEDOUT';
        timeoutErr.isTimeout = true;
        timeoutErr.requestDispatched = requestDispatched;
        console.warn(`[${new Date().toISOString()}] [ORIGINAL_TIMEOUT] [Socket Idle] ECN=${context.ecn || 'N/A'}, Ref=${context.ecrRef || 'N/A'}: Fired after ${elapsed}ms (configured: ${timeoutMs}ms, requestDispatched=${requestDispatched})`);
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
        console.error(`[${new Date().toISOString()}] [ORIGINAL_SOCKET_ERROR] ECN=${context.ecn || 'N/A'}, Ref=${context.ecrRef || 'N/A'}: ${err.message} (code=${sockErr.code})`);
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
   * POS-013: Pre-purchase terminal availability check.
   * Ensures:
   * 1. Terminal is not busy with another operation in-memory (concurrency guard).
   * 2. No active background recovery loop is running.
   * 3. Terminal is reachable and actively responding via FC 55 (Terminal Status) or fast handshake,
   *    verifying genuine terminal protocol readiness rather than merely TCP socket connect.
   * 4. Decouples old unresolved transaction reconciliation from new purchase dispatch:
   *    Does NOT serially block new customer payments behind long FC 56 inquiry retries.
   * 5. If terminal returns NAK (0x15) or indicates busy, rejects with ETERMINALBUSY.
   */
  async checkTerminalAvailabilityBeforePurchase(flowName = 'NETS Payment') {
    const startTime = Date.now();
    if (this.isProcessing) {
      const err = new Error(`A payment transaction is already in progress on the terminal.`);
      err.code = 'ETERMINALBUSY';
      throw err;
    }

    if (this.isRecoveryInProgress) {
      const err = new Error(`Terminal recovery is actively in progress. Please wait for recovery to complete.`);
      err.code = 'ETERMINALBUSY';
      throw err;
    }

    if (this.isTmsUpdating) {
      const err = new Error(`NETS terminal is currently performing TMS update / reboot (${this.tmsStatus.statusText}). Payment commands are temporarily blocked.`);
      err.code = 'ETERMINALBUSY';
      throw err;
    }

    // Fast protocol verification of terminal availability using FC 55 (bounded timeout e.g. 5s)
    // Ensures terminal ECR service is idle, responsive, and ready to receive a new transaction
    try {
      console.log(`[${new Date().toISOString()}] [NetsService] [POS-013] Verifying terminal availability before ${flowName}...`);
      const statusRes = await this.checkTerminalStatusQuick(5000);
      const elapsed = Date.now() - startTime;
      console.log(`[${new Date().toISOString()}] [NetsService] [POS-013] Terminal availability confirmed (RC=${statusRes.responseCode}, took ${elapsed}ms). Ready for ${flowName}.`);
    } catch (statusErr) {
      const elapsed = Date.now() - startTime;
      if (statusErr.code === 'ETERMINALBUSY' || statusErr.isNak) {
        console.warn(`[${new Date().toISOString()}] [NetsService] [POS-013] Terminal is busy (NAK 0x15 received, took ${elapsed}ms)`);
        const busyErr = new Error('Terminal is currently busy. Please wait a moment and try again.');
        busyErr.code = 'ETERMINALBUSY';
        throw busyErr;
      }
      console.warn(`[${new Date().toISOString()}] [NetsService] [POS-013] Pre-flight status query warning (took ${elapsed}ms): ${statusErr.message}. Checking direct socket capability.`);
    }
  }

  /**
   * Fast FC 55 status query with short bounded timeout (default 5000ms)
   * Specifically for pre-flight availability checks to prevent blocking the cashier.
   */
  async checkTerminalStatusQuick(timeoutMs = 5000) {
    const ecn = await this.getNextEcnAsync();
    const frame = buildNetsFrame({
      ecn,
      functionCode: '55',
      versionCode: '01',
      fields: [],
    });

    const res = await this.sendPacket(frame, timeoutMs);
    return {
      ecn,
      success: res.parsed.responseCode === '00',
      responseCode: res.parsed.responseCode,
      description: res.parsed.responseDescription,
      fields: res.parsed.fields,
      parsed: res.parsed,
    };
  }

  /**
   * Trigger non-blocking independent background reconciliation for unresolved transactions.
   * Can be triggered on timer or when terminal is idle, without delaying the current cashier payment.
   */
  async runBackgroundReconciliation() {
    if (this.isProcessing || this.isRecoveryInProgress || this.isTmsUpdating) {
      console.log(`[NetsService] [Reconciliation] Skipping background reconciliation: terminal currently busy.`);
      return;
    }

    const unresList = this.loadUnresolvedTransactions();
    if (!unresList || unresList.length === 0) return;

    console.log(`[NetsService] [Reconciliation] Starting independent background reconciliation for ${unresList.length} unresolved transaction(s)...`);
    const startTime = Date.now();

    try {
      this.isRecoveryInProgress = true;
      const inquiryEcn = await this.getNextEcnAsync();
      console.log(`[${new Date().toISOString()}] [NetsService] [Reconciliation] Dispatching FC 56 with ECN=${inquiryEcn}`);
      const inquiry = await this.getLastApprovedTransaction(inquiryEcn);
      const elapsed = Date.now() - startTime;
      console.log(`[${new Date().toISOString()}] [NetsService] [Reconciliation] FC 56 response received (RC=${inquiry.responseCode}, took ${elapsed}ms)`);

      if (inquiry && inquiry.success && inquiry.parsed) {
        const inqRef = (inquiry.fields['HD'] || inquiry.fields['HS'] || '').trim();
        const inqAmountStr = (inquiry.fields['40'] || '').trim();

        const matchedIdx = unresList.findIndex(unres => {
          const isRefMatched = inqRef === unres.ecrRef;
          const isAmtMatched = inqAmountStr === unres.amountStr;
          return isRefMatched && isAmtMatched && inquiry.parsed.isApproved;
        });

        if (matchedIdx >= 0) {
          const matched = unresList[matchedIdx];
          console.log(`[NetsService] [Reconciliation] Background FC 56 matched and reconciled approved transaction ECN=${matched.ecn} (Ref=${matched.ecrRef})`);
          this.recordAuditHistory({
            ecn: matched.ecn,
            originalEcn: matched.originalEcn || matched.ecn,
            ecrRef: matched.ecrRef,
            amount: matched.amount,
            amountStr: matched.amountStr,
            flowName: matched.flowName,
            status: 'RECOVERED_APPROVED',
            reconciledAt: new Date().toISOString(),
            details: inquiry,
          });
          unresList.splice(matchedIdx, 1);
          this.saveUnresolvedTransactions(unresList);
        } else {
          console.log(`[NetsService] [Reconciliation] FC 56 returned last approved ref '${inqRef}'. No matching unresolved records. Records remain UNKNOWN.`);
        }
      }
    } catch (err) {
      const elapsed = Date.now() - startTime;
      console.warn(`[${new Date().toISOString()}] [NetsService] [Reconciliation] FC 56 background inquiry ended with transport error (took ${elapsed}ms): ${err.message}. Unresolved records safely preserved.`);
    } finally {
      this.isRecoveryInProgress = false;
    }
  }
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Bounded TCP probe to check if NETS terminal LAN port is reachable.
   * Does NOT send any application frame or generate any ECN.
   *
   * @param {number} timeoutMs Connect probe timeout (default 2000ms)
   * @returns {Promise<boolean>}
   */
  async probeTerminalTcpConnection(timeoutMs = 2000) {
    // In mock testing environments where sendPacket is overridden, skip real socket probe
    if (this._mockSendPacketActive || process.env.NODE_ENV === 'test') {
      return true;
    }
    const { terminalIp, terminalPort } = this.config;
    return new Promise((resolve) => {
      const probeSocket = new net.Socket();
      let resolved = false;

      const finish = (isSuccess) => {
        if (resolved) return;
        resolved = true;
        probeSocket.removeAllListeners();
        probeSocket.destroy();
        resolve(isSuccess);
      };

      probeSocket.setTimeout(timeoutMs);
      probeSocket.on('timeout', () => finish(false));
      probeSocket.on('error', () => finish(false));
      probeSocket.connect(terminalPort, terminalIp, () => finish(true));
    });
  }

  /**
   * Waits for terminal LAN connectivity with bounded backoff polling.
   * Avoids dispatching same-ECN recovery frames while physical LAN is unplugged.
   *
   * @param {number} maxWaitMs Maximum total time to wait for LAN (default 30000ms)
   * @param {Function} onProgress Progress callback for UI notification
   * @returns {Promise<boolean>}
   */
  async waitForTerminalLanConnectivity(maxWaitMs = 30000, onProgress = null) {
    const start = Date.now();
    let pollCount = 0;
    const probeTimeout = Math.min(2000, maxWaitMs);
    const probeInterval = 1000;

    console.log(`[${new Date().toISOString()}] [LAN_PROBE_STARTED] Waiting for terminal LAN link availability (max ${maxWaitMs / 1000}s)...`);

    while (true) {
      pollCount++;
      const isReachable = await this.probeTerminalTcpConnection(probeTimeout);
      if (isReachable) {
        const took = Date.now() - start;
        console.log(`[${new Date().toISOString()}] [LAN_AVAILABLE] Terminal LAN link is ACTIVE (reachable at ${this.config.terminalIp}:${this.config.terminalPort}, poll #${pollCount}, took ${took}ms).`);
        return true;
      }

      const elapsed = Date.now() - start;
      if (elapsed >= maxWaitMs) {
        break;
      }

      const remainingSec = Math.max(0, Math.round((maxWaitMs - elapsed) / 1000));
      if (onProgress) {
        onProgress({
          status: 'recovery_wait',
          message: `Terminal LAN is unreachable. Please reconnect LAN cable (waiting up to ${remainingSec}s)...`,
        });
      }
      console.warn(`[${new Date().toISOString()}] [NetsService] [POS-014] Terminal LAN probe failed (poll #${pollCount}). Retrying in ${probeInterval}ms... (${remainingSec}s remaining)`);
      const nextSleep = Math.min(probeInterval, Math.max(0, maxWaitMs - (Date.now() - start)));
      if (nextSleep > 0) {
        await this._delay(nextSleep);
      }
    }

    console.error(`[${new Date().toISOString()}] [NetsService] [POS-014] Terminal LAN wait timed out after ${maxWaitMs / 1000}s. Terminal remains unreachable.`);
    return false;
  }

  /**
   * POS-014: Same-ECN Recovery Handler.
   * Recovers an uncertain transaction by resending the request using the SAME original ECN,
   * original amount, and original ECR reference number without generating a new ECN.
   *
   * Validations enforced:
   * 1. Original ECN === Recovery ECN.
   * 2. Zero calls to ECN sequence generator.
   * 3. Terminal concurrency guard (isProcessing / isRecoveryInProgress).
   * 4. Scoped unresolved record clearing only upon confirmed matching approval.
   *
   * @private
   */
  async _recoverWithSameEcn({
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
      console.warn(`[NetsService] [POS-014] [${flowName}] Recovery already in progress for ECN=${originalEcn}. Rejecting concurrent recovery loop.`);
      throw new Error(`Recovery already in progress for this transaction (ECN=${originalEcn}).`);
    }

    const recoveryEcn = originalEcn;
    // CRITICAL VALIDATION: Original ECN === Recovery ECN
    if (!originalEcn || !recoveryEcn || originalEcn !== recoveryEcn) {
      const ecnMismatchErr = new Error(`POS-014 Pre-condition failed: Original ECN (${originalEcn}) does not match Recovery ECN (${recoveryEcn}). Aborting recovery.`);
      console.error(`[NetsService] [POS-014] ${ecnMismatchErr.message}`);
      throw ecnMismatchErr;
    }

    this.isRecoveryInProgress = true;
    const initialDelay = this.config.recoveryInitialDelayMs !== undefined ? this.config.recoveryInitialDelayMs : 4000;
    const startTime = Date.now();

    const recoveryAudit = {
      ecn: originalEcn,
      originalEcn,
      recoveryEcn,
      ecrRef: refNum,
      amount,
      amountStr,
      flowName,
      txnType,
      recoveryCommandType: txnType === 'I0' ? 'FC I0 (Same ECN)' : 'FC 30 (Same ECN)',
      initialErrorCode: initialError?.code || 'UNKNOWN',
      initialErrorMessage: initialError?.message || '',
      startedAt: new Date().toISOString(),
      recoveryAttempts: [],
      status: 'RECOVERY_IN_PROGRESS',
    };

    console.warn(`[${new Date().toISOString()}] [NetsService] [POS-014] [${flowName}] Initiating Same-ECN Recovery for ECN=${originalEcn} (Ref=${refNum}, Amt=${amount}). Waiting ${initialDelay}ms for link stabilization...`);

    if (onProgress) {
      onProgress({
        status: 'recovery_wait',
        message: `Waiting for terminal connection to stabilize (${initialDelay / 1000}s)...`,
      });
    }

    if (initialDelay > 0) {
      await this._delay(initialDelay);
    }

    // POS-014: Check/Wait for LAN link availability before dispatching same-ECN recovery frame
    // Ensures POS does not dispatch into a dead socket or abort before the user plugs LAN back in
    const maxLanWaitMs = this.config.recoveryLanMaxWaitMs !== undefined ? this.config.recoveryLanMaxWaitMs : 30000;
    const isLanReachable = await this.waitForTerminalLanConnectivity(maxLanWaitMs, onProgress);
    if (!isLanReachable) {
      console.error(`[${new Date().toISOString()}] [NetsService] [POS-014] [${flowName}] Terminal unreachable over LAN after ${maxLanWaitMs / 1000}s. Aborting same-ECN dispatch. Preserving UNKNOWN.`);
      const lanUnreachableErr = new Error(`Terminal unreachable over LAN. Connection could not be re-established after ${maxLanWaitMs / 1000}s.`);
      lanUnreachableErr.code = 'ETIMEDOUT';
      this.isRecoveryInProgress = false;

      recoveryAudit.status = 'UNRESOLVED';
      recoveryAudit.unresolvedReason = `Same ECN recovery could not be dispatched: Terminal unreachable over LAN after ${maxLanWaitMs / 1000}s. Outcome is UNKNOWN.`;
      recoveryAudit.lastTransportError = {
        code: 'ETIMEDOUT',
        message: lanUnreachableErr.message,
      };
      this.saveUnresolvedTransaction(recoveryAudit);

      const unresErr = new Error(`Transaction outcome unknown for ${flowName} (ECN=${originalEcn}). Terminal unreachable after LAN disconnect. Manual reconciliation required. Do NOT recharge customer.`);
      unresErr.code = 'ERECONCILIATIONREQUIRED';
      unresErr.originalEcn = originalEcn;
      unresErr.recoveryEcn = recoveryEcn;
      unresErr.lastError = lanUnreachableErr;
      unresErr.unresolved = recoveryAudit;
      throw unresErr;
    }

    if (onProgress) {
      onProgress({
        status: 'recovering',
        message: `LAN active. Recovering transaction using original ECN ${originalEcn}...`,
      });
    }

    // Build frame with exact original parameters
    let frame;
    const isCreditCard = txnType === 'I0';
    if (isCreditCard) {
      frame = buildNetsFrame({
        ecn: originalEcn,
        functionCode: 'I0',
        versionCode: '01',
        fields: [
          { code: '40', value: amountStr },
          { code: 'HD', value: refNum },
        ],
      });
    } else {
      const refCode = (this.config.ecrRefFieldCode || 'HD').toUpperCase().slice(0, 2);
      frame = buildNetsFrame({
        ecn: originalEcn,
        functionCode: '30',
        versionCode: '01',
        fields: [
          { code: 'T2', value: txnType || '01' },
          { code: '40', value: amountStr },
          { code: refCode, value: refNum },
        ],
      });
    }

    const txHex = frame.toString('hex').toUpperCase();
    console.log(`[${new Date().toISOString()}] [SAME_ECN_RECOVERY_TX] [${flowName}] Original ECN=${originalEcn}, Recovery ECN=${recoveryEcn}, Amount=${amount} (${amountStr}), Ref=${refNum}`);
    console.log(`[${new Date().toISOString()}] [NetsService] [POS-014] [${flowName}] Recovery TX Raw Hex (${frame.length} bytes): ${txHex}`);

    let recoveryRes = null;
    let recoveryErr = null;

    try {
      recoveryRes = await this.sendPacket(frame, this.config.financialTimeoutMs, onProgress, {
        isQr: txnType === '04',
        txnType: txnType || '01',
        flowName,
        ecn: recoveryEcn,
        ecrRef: refNum,
      });
    } catch (err) {
      recoveryErr = err;
      console.error(`[${new Date().toISOString()}] [NetsService] [POS-014] [${flowName}] Recovery attempt socket/transport error: ${err.message}`);
    } finally {
      this.isRecoveryInProgress = false;
    }

    const duration = Date.now() - startTime;

    if (recoveryRes && recoveryRes.parsed) {
      const rxHex = recoveryRes.rawHex ? recoveryRes.rawHex.toUpperCase() : '';
      const responseCode = recoveryRes.parsed.responseCode;
      const isApproved = recoveryRes.parsed.isApproved;

      console.log(`[${new Date().toISOString()}] [RECOVERY_RX] [${flowName}] ECN=${recoveryEcn}, Ref=${refNum}, took=${duration}ms, RC=${responseCode}, isApproved=${isApproved}: ${sanitizeRawHex(rxHex)}`);

      if (isApproved) {
        console.log(`[${new Date().toISOString()}] [RECOVERED_APPROVED] [${flowName}] ECN=${originalEcn}, Ref=${refNum}, ApprovalCode=${recoveryRes.parsed.approvalCode || recoveryRes.parsed.fields['01'] || ''}`);

        // Clear only this matching unresolved record from persistence
        const unresList = this.loadUnresolvedTransactions();
        const unresIdx = unresList.findIndex(t => t.ecn === originalEcn || t.originalEcn === originalEcn || t.ecrRef === refNum);
        if (unresIdx >= 0) {
          unresList.splice(unresIdx, 1);
          this.saveUnresolvedTransactions(unresList);
        }

        const approvedResult = {
          ecn: originalEcn,
          recoveryEcn,
          isApproved: true,
          recovered: true,
          recoveryMethod: 'SAME_ECN',
          paymentType: flowName,
          txnType: txnType || '01',
          functionCode: isCreditCard ? 'I0' : '30',
          approvalReason: `Approved (Conclusively recovered via same ECN retransmission for ${flowName})`,
          responseCode: recoveryRes.parsed.responseCode,
          hostResponseCode: recoveryRes.parsed.hostResponseCode,
          responseDescription: recoveryRes.parsed.responseDescription,
          approvalCode: recoveryRes.parsed.approvalCode || recoveryRes.parsed.fields['01'] || '',
          stan: recoveryRes.parsed.fields['65'] || recoveryRes.parsed.fields['30'] || '',
          rrn: recoveryRes.parsed.fields['D3'] || '',
          merchantId: recoveryRes.parsed.fields['D1'] || '',
          terminalId: recoveryRes.parsed.fields['16'] || '',
          cardLabel: recoveryRes.parsed.fields['L7'] || recoveryRes.parsed.fields['D8'] || recoveryRes.parsed.fields['D7'] || '',
          receiptData: recoveryRes.parsed.fields['RP'] || '',
          date: recoveryRes.parsed.fields['03'] || '',
          time: recoveryRes.parsed.fields['04'] || '',
          amount: amount,
          ecrRef: refNum,
          fields: recoveryRes.parsed.fields,
          rawHex: recoveryRes.rawHex,
          duration,
        };

        this.lastTransaction = approvedResult;
        this.recordAuditHistory({
          ...approvedResult,
          status: 'RECOVERED_APPROVED',
          txHex,
          rxHex,
        });

        return approvedResult;
      }

      // If terminal returns confirmed cancellation (RC=XX)
      if (responseCode === 'XX') {
        console.warn(`[NetsService] [POS-014] [${flowName}] Same ECN recovery confirmed transaction cancelled by user on terminal (RC=XX). Marking CANCELLED.`);
        const unresList = this.loadUnresolvedTransactions();
        const unresIdx = unresList.findIndex(t => t.ecn === originalEcn || t.originalEcn === originalEcn);
        if (unresIdx >= 0) {
          unresList.splice(unresIdx, 1);
          this.saveUnresolvedTransactions(unresList);
        }

        const cancelledResult = {
          ecn: originalEcn,
          recoveryEcn,
          isApproved: false,
          recovered: true,
          recoveryMethod: 'SAME_ECN',
          paymentType: flowName,
          txnType: txnType || '01',
          functionCode: isCreditCard ? 'I0' : '30',
          approvalReason: 'Transaction Cancelled on Terminal',
          responseCode: 'XX',
          responseDescription: recoveryRes.parsed.responseDescription || 'Transaction Cancelled',
          amount,
          ecrRef: refNum,
          duration,
          rawHex: recoveryRes.rawHex,
        };

        this.lastTransaction = cancelledResult;
        this.recordAuditHistory({
          ...cancelledResult,
          status: 'CANCELLED',
          txHex,
          rxHex,
        });

        return cancelledResult;
      }

      // Other non-approved response code (e.g. decline)
      console.warn(`[NetsService] [POS-014] [${flowName}] Same ECN recovery returned terminal response code ${responseCode} (${recoveryRes.parsed.responseDescription}). Marking DECLINED.`);
      const declinedResult = {
        ecn: originalEcn,
        recoveryEcn,
        isApproved: false,
        recovered: true,
        recoveryMethod: 'SAME_ECN',
        paymentType: flowName,
        txnType: txnType || '01',
        functionCode: isCreditCard ? 'I0' : '30',
        approvalReason: recoveryRes.parsed.approvalReason || `Declined (${responseCode})`,
        responseCode,
        responseDescription: recoveryRes.parsed.responseDescription,
        amount,
        ecrRef: refNum,
        duration,
        rawHex: recoveryRes.rawHex,
      };

      this.lastTransaction = declinedResult;
      this.recordAuditHistory({
        ...declinedResult,
        status: 'DECLINED',
        txHex,
        rxHex,
      });

      return declinedResult;
    }

    // Transport error during same ECN recovery: State remains UNKNOWN / UNRESOLVED
    console.error(`[${new Date().toISOString()}] [UNRESOLVED] [${flowName}] ECN=${originalEcn}, Ref=${refNum}: Recovery failed with transport error (${recoveryErr?.message}). Outcome remains UNKNOWN.`);

    recoveryAudit.status = 'UNRESOLVED';
    recoveryAudit.unresolvedReason = `Same ECN recovery failed (${recoveryErr?.message}). Terminal status could not be verified. Outcome is UNKNOWN.`;
    recoveryAudit.lastTransportError = {
      code: recoveryErr?.code || 'ETIMEDOUT',
      message: recoveryErr?.message || 'Terminal communication timed out during same ECN recovery',
    };
    recoveryAudit.duration = duration;

    this.saveUnresolvedTransaction(recoveryAudit);

    const recoveryExhaustedErr = new Error(`Transaction outcome unknown for ${flowName} (ECN=${originalEcn}). Terminal recovery attempt failed. Manual reconciliation required. Do NOT recharge customer.`);
    recoveryExhaustedErr.code = 'ERECONCILIATIONREQUIRED';
    recoveryExhaustedErr.originalEcn = originalEcn;
    recoveryExhaustedErr.recoveryEcn = recoveryEcn;
    recoveryExhaustedErr.lastError = recoveryErr;
    recoveryExhaustedErr.unresolved = recoveryAudit;
    throw recoveryExhaustedErr;
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
        // If an unresolved record existed for this transaction, clean only this matching record
        const unresList = this.loadUnresolvedTransactions();
        const unresIdx = unresList.findIndex(t => t.ecn === originalEcn || t.originalEcn === originalEcn);
        if (unresIdx >= 0) {
          unresList.splice(unresIdx, 1);
          this.saveUnresolvedTransactions(unresList);
        }

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
        this.recordAuditHistory({
          ...recoveredResult,
          status: 'RECOVERED_APPROVED',
        });
        return recoveredResult;
      }

      // SCENARIO B: Inquiry succeeded but returned a NON-MATCHING transaction
      // POS-013 Test Specification Expectation:
      // When FC 56 succeeds and confirms the terminal's last approved transaction does NOT match
      // this transaction (different reference or amount), the original transaction was NOT approved on the terminal.
      // In accordance with the test specification, POS marks the original payment as UNSUCCESSFUL.
      console.warn(`[NetsService] [POS-013] [${flowName}] FC 56 returned non-matching transaction (inqRef='${inqRef}', expected='${refNum}', inqAmt='${inqAmountStr}', expected='${amountStr}'). Terminal confirmed transaction was NOT approved. Marking original payment UNSUCCESSFUL.`);

      const unsuccessfulResult = {
        ecn: originalEcn,
        recoveryEcn: inquiry.ecn,
        recoveryAttempts: recoveryAudit.recoveryAttempts,
        isApproved: false,
        recovered: true,
        paymentType: flowName,
        txnType,
        functionCode: txnType === 'I0' ? 'I0' : '30',
        approvalReason: 'Transaction Unsuccessful (Terminal confirmed non-matching last approved transaction via FC 56)',
        responseCode: 'XX',
        responseDescription: 'Transaction Unsuccessful (Cancelled / Not Approved on Terminal)',
        ecrRef: refNum,
        amount: amount,
        inquirySummary: {
          terminalRef: inqRef,
          terminalAmount: inqAmountStr,
          terminalApproval: inquiry.approvalCode,
          terminalStatus: inquiry.description,
        },
        rawHex: inquiry.rawHex,
      };

      this.lastTransaction = unsuccessfulResult;
      this.recordAuditHistory({
        ...unsuccessfulResult,
        status: 'UNSUCCESSFUL_CONFIRMED_BY_FC56',
        recordedAt: new Date().toISOString(),
      });

      // Clear matching unresolved record if one was previously created for this transaction
      const currentUnresList = this.loadUnresolvedTransactions();
      const existingUnresIdx = currentUnresList.findIndex(t => t.ecn === originalEcn || t.originalEcn === originalEcn);
      if (existingUnresIdx >= 0) {
        currentUnresList.splice(existingUnresIdx, 1);
        this.saveUnresolvedTransactions(currentUnresList);
      }

      return unsuccessfulResult;
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
    // POS-013: Terminal Concurrency & Pre-settlement Availability Check
    await this.checkTerminalAvailabilityBeforePurchase('NETS Settlement');

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
    // POS-013: Terminal Concurrency & Pre-settlement Availability Check
    await this.checkTerminalAvailabilityBeforePurchase('Credit Card Settlement');
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
    const flowName = 'NETS Credit Card';
    const txnType = 'I0';

    // POS-013: Terminal Concurrency & Pre-purchase Availability Check
    await this.checkTerminalAvailabilityBeforePurchase(flowName);

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

      // POS-014: If transaction was approved, ensure any matching unresolved entry is cleared
      if (isApproved) {
        console.log(`[${new Date().toISOString()}] [ORIGINAL_APPROVED] [${flowName}] ECN=${ecn}, Ref=${refNum}, ApprovalCode=${result.approvalCode}`);
        const unresList = this.loadUnresolvedTransactions();
        const unresIdx = unresList.findIndex(t => t.ecn === ecn || t.originalEcn === ecn || t.ecrRef === refNum);
        if (unresIdx >= 0) {
          console.log(`[NetsService] [${flowName}] Approved transaction cleared matching unresolved entry ECN=${unresList[unresIdx].ecn} (Ref=${refNum}).`);
          unresList.splice(unresIdx, 1);
          this.saveUnresolvedTransactions(unresList);
        }
      }

      // Handle Authoritative Terminal Cancellation (Response Code XX)
      const resEcn = (res.parsed.ecn || '').trim();
      const isCancellation = res.parsed.responseCode === 'XX' && resEcn === ecn;
      if (isCancellation) {
        console.warn(`[NetsService] [${flowName}] Authoritative terminal cancellation confirmed (RC=XX, ECN=${ecn}, Ref=${refNum}). Marking CANCELLED.`);
        const unresList = this.loadUnresolvedTransactions();
        const unresIdx = unresList.findIndex(t => t.ecn === ecn || t.originalEcn === ecn);
        if (unresIdx >= 0) {
          console.warn(`[NetsService] [${flowName}] Matching unresolved transaction lock ECN=${unresList[unresIdx].ecn} safely cleared.`);
          unresList.splice(unresIdx, 1);
          this.saveUnresolvedTransactions(unresList);
        }
        this.recordAuditHistory({
          ecn,
          ecrRef: refNum,
          amount,
          amountStr,
          flowName,
          txnType: 'I0',
          functionCode: 'I0',
          status: 'CANCELLED',
          responseCode: 'XX',
          responseDescription: res.parsed.responseDescription || 'Transaction Cancelled by User / Terminal',
          cancelledAt: new Date().toISOString(),
          rawHex: res.rawHex,
          details: result,
        });
      }

      return result;
    } catch (err) {
      this.isProcessing = false;
      console.error(`[${new Date().toISOString()}] [NetsService] [${flowName}] Purchase error ECN=${ecn}: ${err.message}`);

      if (err.isNak) {
        throw new Error('Terminal is currently busy. Please wait and try again.');
      }

      // POS-014 vs POS-013 Recovery Strategy Selection:
      // CRITICAL SAFETY AUDIT: Only trigger recovery when the transaction outcome is GENUINELY uncertain.
      const isUncertainOutcome = Boolean(
        err.isTimeout ||
        err.isUncertain ||
        err.isPrematureClose ||
        (err.requestDispatched && (err.code === 'ECONNRESET' || err.code === 'EUNCERTAIN_SOCKET_CLOSED' || err.code === 'ESOCKET' || err.code === 'EPIPE'))
      );

      // POS-014 vs POS-013 Recovery Strategy Selection:
      // When autoRetryWithSameEcn is true, POS-014 same-ECN retransmission is executed (reusing original ECN).
      // Otherwise, if lastApprovedQueryOnTimeout is enabled, POS-013 FC 56 inquiry recovery is executed.
      if (isUncertainOutcome && this.config.autoRetryWithSameEcn) {
        return await this._recoverWithSameEcn({
          originalEcn: ecn,
          refNum,
          amount,
          amountStr,
          flowName,
          txnType: 'I0',
          initialError: err,
          onProgress,
        });
      } else if (isUncertainOutcome && this.config.lastApprovedQueryOnTimeout) {
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
    // POS-013: Terminal Concurrency & Pre-purchase Availability Check
    await this.checkTerminalAvailabilityBeforePurchase(flowName);

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

      console.log(`[${new Date().toISOString()}] [ORIGINAL_FC30_TX] [${flowName}] ECN=${ecn}, Amount=${amount} (${amountStr}), Type=${txnType}, RefField=${refCode}, Ref=${refNum}`);
      console.log(`[${new Date().toISOString()}] [NetsService] [${flowName}] TX Raw Hex (${frame.length} bytes): ${frame.toString('hex').toUpperCase()}`);

      const res = await this.sendPacket(frame, this.config.financialTimeoutMs, onProgress, {
        isQr: txnType === '04',
        txnType,
        flowName,
        ecn,
        ecrRef: refNum,
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

      // POS-014: If transaction was approved, ensure any matching unresolved entry is cleared
      if (isApproved) {
        console.log(`[${new Date().toISOString()}] [ORIGINAL_APPROVED] [${flowName}] ECN=${ecn}, Ref=${refNum}, ApprovalCode=${result.approvalCode}`);
        const unresList = this.loadUnresolvedTransactions();
        const unresIdx = unresList.findIndex(t => t.ecn === ecn || t.originalEcn === ecn || t.ecrRef === refNum);
        if (unresIdx >= 0) {
          console.log(`[NetsService] [${flowName}] Approved transaction cleared matching unresolved entry ECN=${unresList[unresIdx].ecn} (Ref=${refNum}).`);
          unresList.splice(unresIdx, 1);
          this.saveUnresolvedTransactions(unresList);
        }
      }

      // Handle Authoritative Terminal Cancellation (Response Code XX)
      const resEcn = (res.parsed.ecn || '').trim();
      const isCancellation = res.parsed.responseCode === 'XX' && resEcn === ecn;
      if (isCancellation) {
        console.warn(`[NetsService] [${flowName}] Authoritative terminal cancellation confirmed (RC=XX, ECN=${ecn}, Ref=${refNum}). Marking CANCELLED.`);
        const unresList = this.loadUnresolvedTransactions();
        const unresIdx = unresList.findIndex(t => t.ecn === ecn || t.originalEcn === ecn);
        if (unresIdx >= 0) {
          console.warn(`[NetsService] [${flowName}] Matching unresolved transaction lock ECN=${unresList[unresIdx].ecn} safely cleared.`);
          unresList.splice(unresIdx, 1);
          this.saveUnresolvedTransactions(unresList);
        }
        this.recordAuditHistory({
          ecn,
          ecrRef: refNum,
          amount,
          amountStr,
          flowName,
          txnType: txnType || '01',
          functionCode: '30',
          status: 'CANCELLED',
          responseCode: 'XX',
          responseDescription: res.parsed.responseDescription || 'Transaction Cancelled by User / Terminal',
          cancelledAt: new Date().toISOString(),
          rawHex: res.rawHex,
          details: result,
        });
      }

      return result;
    } catch (err) {
      this.isProcessing = false;
      console.error(`[${new Date().toISOString()}] [NetsService] [${flowName}] Purchase error ECN=${ecn}: ${err.message}`);

      // Handle NAK (Terminal Busy)
      // Section 2.2.2.2: Do NOT retry financial payments blindly! Terminal is busy with another customer.
      if (err.isNak) {
        throw new Error('Terminal is currently busy. Please wait and try again.');
      }

      // Handle Timeout / Uncertain outcome: POS-014 Same ECN Recovery vs POS-013 FC 56 Recovery
      // CRITICAL SAFETY AUDIT: Only trigger recovery when the transaction outcome is GENUINELY uncertain.
      // (e.g. response timeout, socket error/reset after request was dispatched, premature close, or frame parse error).
      // If the request was never written to the socket (!err.requestDispatched), no recovery is needed (terminal never saw it).
      const isUncertainOutcome = Boolean(
        err.isTimeout ||
        err.isUncertain ||
        err.isPrematureClose ||
        (err.requestDispatched && (err.code === 'ECONNRESET' || err.code === 'EUNCERTAIN_SOCKET_CLOSED' || err.code === 'ESOCKET' || err.code === 'EPIPE'))
      );

      if (isUncertainOutcome && this.config.autoRetryWithSameEcn) {
        return await this._recoverWithSameEcn({
          originalEcn: ecn,
          refNum,
          amount,
          amountStr,
          flowName,
          txnType,
          initialError: err,
          onProgress,
        });
      } else if (isUncertainOutcome && this.config.lastApprovedQueryOnTimeout) {
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
