/**
 * NETS ECR II / ECR2 Prime Protocol Parser and Frame Builder
 * Reference: WITG 3 NETS ECR II Terminal Interface Technical Specification V1.27
 *
 * Framing over LAN/Ethernet (TCP/IP):
 * [2-byte BCD Length] [Message Body] [1-byte LRC]
 *
 * Message Body:
 * [Header] [Message Data Fields]
 *
 * Header (18 bytes for Request, 18 bytes for Response):
 * Request:  [ECN (12 ASC)] [Function Code (2 ASC)] [Version Code (2 ASC = '01')] [RFU (1 ASC = '0')] [FS (0x1C)]
 * Response: [ECN (12 ASC)] [Function Code (2 ASC)] [Response Code (2 ASC)] [RFU (1 ASC = '0')] [FS (0x1C)]
 *
 * Message Data Fields:
 * Repeated sequence:
 * [Field Code (2 ASC)] [Data Length (2-byte BCD)] [Data (ASCII or Binary)] [FS (0x1C)]
 *
 * Total length for BCD length indicator:
 * Length = Message Body Length + 1 (for the 1-byte LRC)
 *
 * LRC calculation:
 * XOR of all bytes in the Message Body (from first byte of ECN to last byte before LRC).
 */

const FS = 0x1c; // Field Separator (28 in decimal)

/**
 * Converts a decimal integer (0..9999) into 2-byte BCD buffer.
 * E.g., 25 -> 0x00, 0x25
 * E.g., 1234 -> 0x12, 0x34
 * @param {number} num
 * @returns {Buffer} 2-byte buffer
 */
function toBcd2(num) {
  const clamped = Math.max(0, Math.min(9999, Math.floor(num)));
  const str = clamped.toString().padStart(4, '0');
  const b1 = parseInt(str.substring(0, 2), 16);
  const b2 = parseInt(str.substring(2, 4), 16);
  return Buffer.from([b1, b2]);
}

/**
 * Parses a 2-byte BCD buffer into a number.
 * @param {Buffer} buf
 * @param {number} offset
 * @returns {number}
 */
function fromBcd2(buf, offset = 0) {
  const b1 = buf[offset];
  const b2 = buf[offset + 1];
  const s1 = b1.toString(16).padStart(2, '0');
  const s2 = b2.toString(16).padStart(2, '0');
  const val = parseInt(s1 + s2, 10);
  return isNaN(val) ? 0 : val;
}

/**
 * Computes XOR LRC across a buffer or slice of buffer.
 * @param {Buffer} buf
 * @param {number} start
 * @param {number} end
 * @returns {number}
 */
function calculateLrc(buf, start = 0, end = buf.length) {
  let lrc = 0;
  for (let i = start; i < end; i++) {
    lrc ^= buf[i];
  }
  return lrc;
}

/**
 * Formats an amount in dollars or cents into 12-char zero-padded string of cents.
 * E.g., 10.5 -> "000000001050"
 * @param {number|string} amount
 * @returns {string}
 */
function formatAmount(amount) {
  let cents = 0;
  if (typeof amount === 'number') {
    cents = Math.round(amount * 100);
  } else if (typeof amount === 'string') {
    const parsed = parseFloat(amount.replace(/[^0-9.]/g, ''));
    cents = isNaN(parsed) ? 0 : Math.round(parsed * 100);
  }
  return cents.toString().padStart(12, '0');
}

/**
 * Builds a NETS ECR II LAN message frame.
 *
 * @param {Object} params
 * @param {string|number} params.ecn - 12-digit ECR Control Number (e.g., "000000000001")
 * @param {string} params.functionCode - 2-character Function Code (e.g., "30", "55", "80")
 * @param {string} [params.versionCode="01"] - 2-character Version Code
 * @param {Array<{code: string, value: string|Buffer}>} [params.fields=[]] - Message fields
 * @returns {Buffer} Complete wire frame [2-byte BCD Length][Message Body][1-byte LRC]
 */
function buildNetsFrame({ ecn, functionCode, versionCode = '01', responseCode = null, fields = [] }) {
  // Normalize ECN to 12 digits
  const ecnStr = (ecn || '1').toString().padStart(12, '0').slice(-12);
  const fnCode = (functionCode || '55').toString().padStart(2, '0').slice(-2);
  // In request frames, bytes 14-16 are Version Code (e.g. '01').
  // In terminal response frames, bytes 14-16 are Terminal Response Code (e.g. '00', '51').
  const code14_16 = (responseCode !== null && responseCode !== undefined)
    ? responseCode.toString().padStart(2, '0').slice(-2)
    : (versionCode || '01').toString().padStart(2, '0').slice(-2);
  const rfu = '0'; // 1 byte RFU

  // 1. Build Header Buffer (18 bytes total)
  const headerStr = `${ecnStr}${fnCode}${code14_16}${rfu}`;
  const headerBuf = Buffer.concat([
    Buffer.from(headerStr, 'ascii'),
    Buffer.from([FS]),
  ]);

  // 2. Build Field Buffers
  const fieldBuffers = [];
  for (const field of fields) {
    if (!field || !field.code) continue;
    const codeStr = field.code.toString().slice(0, 2);
    const codeBuf = Buffer.from(codeStr, 'ascii');

    let valBuf;
    if (Buffer.isBuffer(field.value)) {
      valBuf = field.value;
    } else {
      valBuf = Buffer.from((field.value !== undefined && field.value !== null ? field.value : '').toString(), 'ascii');
    }

    const lenBcd = toBcd2(valBuf.length);
    const fsBuf = Buffer.from([FS]);

    fieldBuffers.push(Buffer.concat([codeBuf, lenBcd, valBuf, fsBuf]));
  }

  // 3. Assemble Message Body
  const messageBody = Buffer.concat([headerBuf, ...fieldBuffers]);

  // 4. Calculate LRC
  const lrc = calculateLrc(messageBody);

  // 5. Total Length = messageBody.length + 1 (for LRC byte)
  const totalLength = messageBody.length + 1;
  const lengthBcd = toBcd2(totalLength);

  // 6. Complete LAN Frame: [2-byte BCD Length] [Message Body] [1-byte LRC]
  return Buffer.concat([lengthBcd, messageBody, Buffer.from([lrc])]);
}

/**
 * Validates whether a response is strictly approved according to:
 * 1. Terminal Response Code == '00'
 * 2. Host Response Code (Field HC) == '00' (Mandatory for financial transactions; must not be missing or declined)
 * 3. Approval Code:
 *    - For standard Card transactions: Field 01 must be present, non-empty, and != '000000'.
 *    - For NETS QR transactions (FC 30 T2=04 or FC Q2, or identified by flow context/receipt indicators):
 *      Per NETS ECR II specifications, QR transactions originate via mobile banking (FAST/PayNow/SGQR/DBS PayLah!)
 *      where Field 01 is returned by the terminal as blank spaces (e.g. '      ') or '000000' while Host Code HC='00'
 *      and Response Code RC='00' confirm the debit approval. When RC='00' and HC='00' are both confirmed,
 *      a blank, space-filled, or '000000' Field 01 is valid for NETS QR.
 *
 * @param {string} functionCode
 * @param {string} responseCode
 * @param {Object} fields
 * @param {Object} [context={}] - Optional transaction context (e.g. { isQr: true, txnType: '04' })
 * @returns {{isApproved: boolean, reason: string}}
 */
function validateApprovalStatus(functionCode, responseCode, fields = {}, context = {}) {
  const fn = (functionCode || '').toUpperCase();
  const rc = (responseCode || '').trim();
  const approvalCode = (fields['01'] || '').trim();
  const hostResponseCode = fields['HC'] !== undefined && fields['HC'] !== null ? String(fields['HC']).trim() : null;
  const txnType = (fields['T2'] || context.txnType || '').toString().trim();

  // Detect QR transactions:
  // 1. Explicit function code Q2
  // 2. T2 === '04' from fields or transaction execution context
  // 3. context.isQr === true
  // 4. Receipt data (Field RP) containing QR keywords like 'PURCHASE(QR)' or 'PURCHASE (QR)'
  const rpText = (fields['RP'] || '').toString();
  const isQrTxn = fn === 'Q2' ||
    txnType === '04' ||
    context.isQr === true ||
    /PURCHASE\s*\(QR\)/i.test(rpText);

  // Administrative / non-financial transactions (e.g. 55, 80, 81, 84, I5)
  // Approval code is not required; responseCode '00' indicates success.
  const isFinancialTxn = (fn === '30' || fn === 'Q2' || fn === 'I0' || fn === 'I1' || fn === 'I4' || fn === '13');

  if (!isFinancialTxn) {
    const isSuccess = rc === '00';
    return {
      isApproved: isSuccess,
      reason: isSuccess ? 'Operation successful' : `Terminal returned response code ${rc}`,
    };
  }

  // Financial transactions: STRICT VALIDATION
  // Check 1: Terminal Response Code (Must be '00')
  if (rc !== '00') {
    return {
      isApproved: false,
      reason: `Terminal response code is ${rc} (${getNetsResponseDescription(rc)})`,
    };
  }

  // Check 2: Host Response Code (HC)
  // For NETS Purchase / Financial transactions (Section 4.5.1 Stream 140 / Annex C),
  // Field HC is mandatory and returns '00' on successful debit.
  if (hostResponseCode === null || hostResponseCode === '') {
    return {
      isApproved: false,
      reason: 'Mandatory Host Response Code (Field HC) is missing from response',
    };
  }
  if (hostResponseCode !== '00') {
    return {
      isApproved: false,
      reason: `Host Response Code (HC) indicates decline/failure: ${hostResponseCode} (${getNetsResponseDescription(hostResponseCode)})`,
    };
  }

  // Check 3: Approval Code Validation
  // For NETS QR: Field 01 may be blank/spaces or '000000' as returned by Ingenico terminals
  // for mobile banking debit (FAST/PayNow/DBS PayLah!), with host approval confirmed by HC='00'.
  if (isQrTxn) {
    return {
      isApproved: true,
      reason: 'Approved (NETS QR: Terminal RC=00, Host HC=00)',
    };
  }

  // For Standard NETS Card & Other Financial Txns: Strict non-empty, non-zero Field 01 required
  if (!approvalCode || approvalCode.length === 0 || approvalCode === '000000') {
    return {
      isApproved: false,
      reason: `Invalid or missing Approval Code (Field 01): '${approvalCode}'`,
    };
  }

  return {
    isApproved: true,
    reason: 'Approved (Terminal RC=00, Host HC=00, Valid Approval Code)',
  };
}

/**
 * Parses a NETS ECR II LAN message frame.
 *
 * @param {Buffer} buffer - Wire frame received from TCP socket
 * @returns {Object} Parsed response object
 */
function parseNetsFrame(buffer, options = {}) {
  const { strictLrc = true, strictLength = true, context = {} } = options;

  if (!buffer || buffer.length < 21) {
    throw new Error(`Buffer too short to be a valid NETS frame (${buffer ? buffer.length : 0} bytes)`);
  }

  // 1. Parse Length (First 2 bytes BCD)
  const expectedBodyAndLrcLen = fromBcd2(buffer, 0);
  const actualBodyAndLrcLen = buffer.length - 2;

  if (strictLength && expectedBodyAndLrcLen !== actualBodyAndLrcLen) {
    throw new Error(`Invalid NETS frame length: BCD header specified ${expectedBodyAndLrcLen} bytes, but received ${actualBodyAndLrcLen} bytes`);
  }

  // 2. Extract Message Body and Received LRC
  // LRC is the last byte
  const receivedLrc = buffer[buffer.length - 1];
  const messageBody = buffer.slice(2, buffer.length - 1);

  // 3. Validate LRC Checksum
  const computedLrc = calculateLrc(messageBody);
  const isLrcValid = receivedLrc === computedLrc;

  if (strictLrc && !isLrcValid) {
    throw new Error(`Invalid NETS frame LRC checksum: expected 0x${computedLrc.toString(16).padStart(2, '0')}, received 0x${receivedLrc.toString(16).padStart(2, '0')}`);
  }

  // 4. Parse Header (18 bytes total)
  if (messageBody.length < 18) {
    throw new Error(`Message body too short for NETS header (expected >= 18 bytes, got ${messageBody.length})`);
  }
  const headerBuf = messageBody.slice(0, 18);
  const ecn = headerBuf.slice(0, 12).toString('ascii');
  const functionCode = headerBuf.slice(12, 14).toString('ascii');
  const responseCode = headerBuf.slice(14, 16).toString('ascii');
  const rfu = headerBuf.slice(16, 17).toString('ascii');
  const headerFs = headerBuf[17];

  if (headerFs !== FS) {
    throw new Error(`Malformed NETS frame header: missing FS (0x1C) delimiter at header offset 17 (got 0x${headerFs ? headerFs.toString(16) : 'none'})`);
  }

  // 5. Parse Fields (starting at offset 18)
  const fields = {};
  const rawFields = [];
  let offset = 18;

  while (offset < messageBody.length) {
    if (offset + 4 > messageBody.length) {
      throw new Error(`Incomplete field header at offset ${offset}: remaining length (${messageBody.length - offset} bytes) is less than 4 bytes`);
    }

    const code = messageBody.slice(offset, offset + 2).toString('ascii');
    const fieldLen = fromBcd2(messageBody, offset + 2);
    offset += 4;

    let fieldDataBuf = Buffer.alloc(0);
    if (fieldLen > 0) {
      if (offset + fieldLen > messageBody.length) {
        throw new Error(`Field ${code} length (${fieldLen} bytes) overflows remaining message body`);
      }
      fieldDataBuf = messageBody.slice(offset, offset + fieldLen);
      offset += fieldLen;
    }

    // Expect FS delimiter
    if (offset < messageBody.length) {
      if (messageBody[offset] === FS) {
        offset += 1;
      } else {
        throw new Error(`Field ${code} missing FS (0x1C) delimiter at offset ${offset} (got 0x${messageBody[offset].toString(16).padStart(2, '0')})`);
      }
    } else {
      throw new Error(`Field ${code} truncated before terminating FS delimiter`);
    }

    // ASCII string interpretation
    const strVal = fieldDataBuf.toString('ascii');
    fields[code] = strVal;
    rawFields.push({ code, length: fieldLen, value: strVal, raw: fieldDataBuf });
  }

  // 5a. If Function Code is 56 (Last Approved Transaction Inquiry) and Field TD (Transaction Data) is present,
  // parse the encapsulated transaction packet inside TD according to NETS ECR II specifications.
  let nestedTransaction = null;
  if ((functionCode === '56' || fields['TD']) && fields['TD']) {
    const tdRawObj = rawFields.find(f => f.code === 'TD');
    const tdBuf = tdRawObj ? tdRawObj.raw : Buffer.from(fields['TD'], 'latin1');

    if (tdBuf && tdBuf.length >= 18) {
      try {
        const nestedEcn = tdBuf.slice(0, 12).toString('ascii');
        const nestedFc = tdBuf.slice(12, 14).toString('ascii');
        const nestedRc = tdBuf.slice(14, 16).toString('ascii');
        const nestedRfu = tdBuf.slice(16, 17).toString('ascii');
        const nestedFs = tdBuf[17];

        const nestedFields = {};
        const nestedRawFields = [];
        let tdOffset = 18;

        while (tdOffset < tdBuf.length) {
          if (tdOffset + 4 > tdBuf.length) break;
          const nCode = tdBuf.slice(tdOffset, tdOffset + 2).toString('ascii');
          const nFieldLen = fromBcd2(tdBuf, tdOffset + 2);
          tdOffset += 4;

          let nFieldDataBuf = Buffer.alloc(0);
          if (nFieldLen > 0) {
            if (tdOffset + nFieldLen > tdBuf.length) break;
            nFieldDataBuf = tdBuf.slice(tdOffset, tdOffset + nFieldLen);
            tdOffset += nFieldLen;
          }

          if (tdOffset < tdBuf.length && tdBuf[tdOffset] === FS) {
            tdOffset += 1;
          }

          const nStrVal = nFieldDataBuf.toString('ascii');
          nestedFields[nCode] = nStrVal;
          nestedRawFields.push({ code: nCode, length: nFieldLen, value: nStrVal, raw: nFieldDataBuf });
        }

        const nestedApprovalValidation = validateApprovalStatus(nestedFc, nestedRc, nestedFields, context);

        nestedTransaction = {
          ecn: nestedEcn,
          functionCode: nestedFc,
          responseCode: nestedRc,
          rfu: nestedRfu,
          isApproved: nestedApprovalValidation.isApproved,
          approvalReason: nestedApprovalValidation.reason,
          approvalCode: nestedFields['01'] || '',
          hostResponseCode: nestedFields['HC'] || '',
          responseDescription: getNetsResponseDescription(nestedRc),
          fields: nestedFields,
          rawFields: nestedRawFields,
        };

        // Merge nested transaction fields onto top-level fields if top-level does not have them
        // This ensures downstream consumers expecting fields['HD'], fields['40'], fields['01'] seamlessly resolve them
        for (const [key, val] of Object.entries(nestedFields)) {
          if (!fields[key]) {
            fields[key] = val;
          }
        }
      } catch (tdErr) {
        // Log or preserve error in nestedTransaction
        nestedTransaction = {
          error: tdErr.message,
          fields: {},
        };
      }
    }
  }

  // 6. Strict Approval Status Evaluation
  // For FC 56: If a nested transaction was parsed from TD, determine approval from the nested transaction
  let approvalValidation;
  let approvalCode;
  let hostResponseCode;

  if (functionCode === '56' && nestedTransaction && !nestedTransaction.error) {
    approvalValidation = {
      isApproved: responseCode === '00' && nestedTransaction.isApproved,
      reason: responseCode === '00' ? nestedTransaction.approvalReason : `FC56 inquiry response code is ${responseCode} (${getNetsResponseDescription(responseCode)})`,
    };
    approvalCode = nestedTransaction.approvalCode || fields['01'] || '';
    hostResponseCode = nestedTransaction.hostResponseCode || fields['HC'] || '';
  } else {
    approvalValidation = validateApprovalStatus(functionCode, responseCode, fields, context);
    approvalCode = fields['01'] || '';
    hostResponseCode = fields['HC'] || '';
  }

  return {
    rawLength: expectedBodyAndLrcLen,
    actualLength: actualBodyAndLrcLen,
    isLrcValid,
    computedLrc,
    receivedLrc,
    ecn,
    functionCode,
    responseCode,
    hostResponseCode,
    rfu,
    isApproved: approvalValidation.isApproved,
    approvalReason: approvalValidation.reason,
    approvalCode,
    responseDescription: getNetsResponseDescription(responseCode),
    fields,
    rawFields,
    nestedTransaction,
  };
}

/**
 * Masks primary account numbers (PAN), card numbers, and sensitive card data.
 * Keeps only first 6 and last 4 characters if length >= 12, or replaces middle with asterisks.
 * @param {string} str
 * @returns {string}
 */
function maskCardNumber(str) {
  if (!str || typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (trimmed.length < 10) return '****';
  const first = trimmed.slice(0, 6);
  const last = trimmed.slice(-4);
  const maskedMiddle = '*'.repeat(Math.max(4, trimmed.length - 10));
  return `${first}${maskedMiddle}${last}`;
}

/**
 * Sanitizes a parsed NETS fields object and raw hex for safe logging without exposing PANs.
 * @param {Object} fields
 * @returns {Object} Sanitized copy of fields
 */
function sanitizeFieldsForLogging(fields = {}) {
  const sanitized = { ...fields };
  // Field 02 often contains card PAN and balance: "APPROVED\n1111222233334444\nBAL:..."
  if (sanitized['02']) {
    sanitized['02'] = sanitized['02'].replace(/\b(\d{6})\d{4,9}(\d{4})\b/g, '$1******$2');
  }
  // Field L7: Card Name / masked card
  if (sanitized['L7']) {
    sanitized['L7'] = sanitized['L7'].replace(/\b(\d{6})\d{4,9}(\d{4})\b/g, '$1******$2');
  }
  // Field CN / Track / PAN fields if present
  if (sanitized['00']) {
    sanitized['00'] = maskCardNumber(sanitized['00']);
  }
  return sanitized;
}

/**
 * Sanitizes raw hex frame for logging by masking card data regions if applicable.
 * @param {string} rawHex
 * @returns {string}
 */
function sanitizeRawHex(rawHex) {
  if (!rawHex || typeof rawHex !== 'string') return '';
  // Return truncated/safe digest with frame length
  if (rawHex.length <= 60) return rawHex;
  return `${rawHex.substring(0, 40)}...[MASKED ${rawHex.length - 60} HEX CHARS]...${rawHex.slice(-20)}`;
}

/**
 * Standard NETS ECR II Response Codes (Annex A / Spec)
 */
const NETS_RESPONSE_CODES = {
  '00': 'Approved / Success',
  '01': 'Refer to Card Issuer',
  '02': 'Refer to Issuer\'s Special Condition',
  '03': 'Invalid Merchant',
  '04': 'Pick-up Card',
  '05': 'Do Not Honour',
  '06': 'Error',
  '07': 'Pick-up Card, Special Condition',
  '08': 'Honor with Identification',
  '09': 'Request in Progress',
  '12': 'Invalid Transaction',
  '13': 'Invalid Amount',
  '14': 'Invalid Card Number',
  '15': 'No Such Issuer',
  '19': 'Re-enter Transaction',
  '20': 'Invalid Response',
  '21': 'No Action Taken',
  '22': 'Suspected Malfunction',
  '25': 'Unable to Locate Record',
  '30': 'Format Error',
  '31': 'Bank Not Supported by Switch',
  '41': 'Lost Card',
  '43': 'Stolen Card',
  '51': 'Insufficient Funds',
  '52': 'No Checking Account',
  '53': 'No Savings Account',
  '54': 'Expired Card',
  '55': 'Incorrect PIN',
  '57': 'Transaction Not Permitted to Cardholder',
  '58': 'Transaction Not Permitted to Terminal',
  '59': 'Suspected Fraud',
  '61': 'Exceeds Withdrawal Amount Limit',
  '62': 'Restricted Card',
  '63': 'Security Violation',
  '65': 'Exceeds Withdrawal Frequency Limit',
  '68': 'Response Received Too Late',
  '75': 'Allowable Number of PIN Tries Exceeded',
  '76': 'Invalid Previous Date',
  '77': 'Inconsistent Data',
  '78': 'Blocked by Cardholder',
  '80': 'Invalid Date',
  '81': 'Cryptographic Failure',
  '82': 'Incorrect CVV',
  '83': 'Unable to Verify PIN',
  '85': 'No Reason to Decline',
  '90': 'Cutoff in Progress',
  '91': 'Issuer or Switch Inoperative',
  '92': 'Routing Error',
  '93': 'Violation of Law',
  '94': 'Duplicate Transmission',
  '95': 'Reconcile Error',
  '96': 'System Malfunction',
  'SC': 'Failed Transaction (Host Debit Failed)',
  'TO': 'Timeout / No Response from Terminal',
  'CE': 'Communication Error / Connection Refused',
  'NA': 'Negative Acknowledgment (NAK) Received',
  'TB': 'Terminal Busy',
  'XX': 'Transaction Cancelled by User / Terminal',
  'US': 'Unsolicited / Unexpected Status (Uncertain)',
};

function getNetsResponseDescription(code) {
  if (!code) return 'Unknown Status';
  return NETS_RESPONSE_CODES[code] || `Decline / Error (${code})`;
}

module.exports = {
  FS,
  toBcd2,
  fromBcd2,
  calculateLrc,
  formatAmount,
  buildNetsFrame,
  parseNetsFrame,
  validateApprovalStatus,
  maskCardNumber,
  sanitizeFieldsForLogging,
  sanitizeRawHex,
  getNetsResponseDescription,
  NETS_RESPONSE_CODES,
};
