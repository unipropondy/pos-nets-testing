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
function buildNetsFrame({ ecn, functionCode, versionCode = '01', fields = [] }) {
  // Normalize ECN to 12 digits
  const ecnStr = (ecn || '1').toString().padStart(12, '0').slice(-12);
  const fnCode = (functionCode || '55').toString().padStart(2, '0').slice(-2);
  const verCode = (versionCode || '01').toString().padStart(2, '0').slice(-2);
  const rfu = '0'; // 1 byte RFU

  // 1. Build Header Buffer (18 bytes total)
  const headerStr = `${ecnStr}${fnCode}${verCode}${rfu}`;
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
 * 3. Approval Code (Field 01) present, non-empty, and != '000000'
 *
 * @param {string} functionCode
 * @param {string} responseCode
 * @param {Object} fields
 * @returns {{isApproved: boolean, reason: string}}
 */
function validateApprovalStatus(functionCode, responseCode, fields = {}) {
  const fn = (functionCode || '').toUpperCase();
  const rc = (responseCode || '').trim();
  const approvalCode = (fields['01'] || '').trim();
  const hostResponseCode = fields['HC'] !== undefined && fields['HC'] !== null ? String(fields['HC']).trim() : null;

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

  // Financial transactions: STRICT 3-WAY VALIDATION
  // Check 1: Terminal Response Code
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

  // Check 3: Approval Code (Field 01)
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
function parseNetsFrame(buffer) {
  if (!buffer || buffer.length < 21) {
    throw new Error(`Buffer too short to be a valid NETS frame (${buffer ? buffer.length : 0} bytes)`);
  }

  // 1. Parse Length (First 2 bytes BCD)
  const expectedBodyAndLrcLen = fromBcd2(buffer, 0);
  const actualBodyAndLrcLen = buffer.length - 2;

  // 2. Extract Message Body and Received LRC
  // LRC is the last byte
  const receivedLrc = buffer[buffer.length - 1];
  const messageBody = buffer.slice(2, buffer.length - 1);

  // 3. Validate LRC
  const computedLrc = calculateLrc(messageBody);
  const isLrcValid = receivedLrc === computedLrc;

  // 4. Parse Header (18 bytes)
  const headerBuf = messageBody.slice(0, 18);
  const ecn = headerBuf.slice(0, 12).toString('ascii');
  const functionCode = headerBuf.slice(12, 14).toString('ascii');
  const responseCode = headerBuf.slice(14, 16).toString('ascii');
  const rfu = headerBuf.slice(16, 17).toString('ascii');

  // 5. Parse Fields (starting at offset 18)
  const fields = {};
  const rawFields = [];
  let offset = 18;

  while (offset < messageBody.length) {
    if (offset + 4 > messageBody.length) {
      break;
    }

    const code = messageBody.slice(offset, offset + 2).toString('ascii');
    const fieldLen = fromBcd2(messageBody, offset + 2);
    offset += 4;

    let fieldDataBuf = Buffer.alloc(0);
    if (fieldLen > 0 && offset + fieldLen <= messageBody.length) {
      fieldDataBuf = messageBody.slice(offset, offset + fieldLen);
      offset += fieldLen;
    }

    // Expect FS delimiter
    if (offset < messageBody.length && messageBody[offset] === FS) {
      offset += 1;
    }

    // ASCII string interpretation
    const strVal = fieldDataBuf.toString('ascii');
    fields[code] = strVal;
    rawFields.push({ code, length: fieldLen, value: strVal, raw: fieldDataBuf });
  }

  // 6. Strict Approval Status Evaluation
  const approvalValidation = validateApprovalStatus(functionCode, responseCode, fields);
  const approvalCode = fields['01'] || '';
  const hostResponseCode = fields['HC'] || '';

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
