const crypto = require("crypto");
const processedRequests = new Map(); // requestId -> { status, timestamp, response: { status, headers, body } }

// Cleanup interval: run every 5 minutes to clear entries older than 5 minutes (fallback safety)
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of processedRequests.entries()) {
    if (now - value.timestamp > 5 * 60 * 1000) {
      processedRequests.delete(key);
    }
  }
}, 5 * 60 * 1000);

module.exports = function idempotencyMiddleware(req, res, next) {
  const requestId = req.headers['x-request-id'] || req.headers['X-Request-ID'];
  
  // Only apply to modifying requests (POST, PUT, DELETE) that specify a request ID
  if (!requestId || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const bodyChecksum = crypto
    .createHash('sha256')
    .update(typeof req.body === 'object' ? JSON.stringify(req.body) : String(req.body || ''))
    .digest('hex');

  if (processedRequests.has(requestId)) {
    const record = processedRequests.get(requestId);
    console.log(`[Idempotency] Duplicate request detected for ID: ${requestId}. Method: ${req.method}, URL: ${req.originalUrl}. Status: ${record.status}`);
    
    // Check if the payload matches the original request
    if (record.checksum && record.checksum !== bodyChecksum) {
      console.warn(`[Idempotency] Request ID reuse with differing payload: ${requestId}`);
      return res.status(422).json({ 
        error: "Unprocessable Entity: Idempotency-Key reuse with different request parameters or payload." 
      });
    }

    if (record.status === 'processing') {
      // If it is still being processed by the server:
      // For financial operations, wait for the pending request instead of failing hard with 409
      if (record.emitter) {
        console.log(`[Idempotency] Awaiting in-flight response for request ID: ${requestId}`);
        return record.emitter.once('done', (savedRecord) => {
          if (!savedRecord || !savedRecord.response) {
            return res.status(500).json({ error: "Original in-flight request terminated unexpectedly." });
          }
          res.status(savedRecord.response.status);
          Object.entries(savedRecord.response.headers || {}).forEach(([key, val]) => {
            res.setHeader(key, val);
          });
          return res.send(savedRecord.response.body);
        });
      }
      return res.status(409).json({ error: "Request is already processing. Please try again." });
    }
    
    // Serve the cached response directly
    res.status(record.response.status);
    Object.entries(record.response.headers).forEach(([key, val]) => {
      res.setHeader(key, val);
    });
    return res.send(record.response.body);
  }

  // Register request as processing to lock it with an EventEmitter
  const EventEmitter = require('events');
  const emitter = new EventEmitter();

  processedRequests.set(requestId, { 
    status: 'processing', 
    checksum: bodyChecksum,
    timestamp: Date.now(),
    emitter
  });

  // Intercept the send method to capture response once it resolves
  const originalSend = res.send;
  res.send = function (body) {
    const savedRecord = {
      status: 'resolved',
      checksum: bodyChecksum,
      timestamp: Date.now(),
      response: {
        status: res.statusCode,
        headers: res.getHeaders(),
        body: body
      }
    };

    // Save response details to cache
    processedRequests.set(requestId, savedRecord);

    // Notify any in-flight waiting duplicates
    try {
      emitter.emit('done', savedRecord);
    } catch (_) {}

    // Remove from memory cache after 5 minutes
    setTimeout(() => {
      processedRequests.delete(requestId);
    }, 5 * 60 * 1000);

    return originalSend.apply(res, arguments);
  };

  next();
};
