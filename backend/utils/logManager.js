const fs = require('fs');
const path = require('path');

const MAX_LOG_SIZE = 20 * 1024 * 1024; // 20 MB max per single active file
const RETENTION_DAYS = 10; // Exactly 10 days retention policy
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Sanitize logs before writing to disk
function sanitizeLogMessage(message) {
  if (typeof message !== 'string') {
    try {
      message = JSON.stringify(message);
    } catch {
      message = String(message);
    }
  }
  return message
    .replace(/(password["'\s:=]+)["']?[^"'\s,}&]+["']?/gi, '$1***')
    .replace(/(UserPassword["'\s:=]+)["']?[^"'\s,}&]+["']?/gi, '$1***')
    .replace(/(LOCAL_DB_PASSWORD["'\s:=]+)["']?[^"'\s,}&]+["']?/gi, '$1***')
    .replace(/(REMOTE_DB_PASSWORD["'\s:=]+)["']?[^"'\s,}&]+["']?/gi, '$1***')
    .replace(/(DB_PASSWORD["'\s:=]+)["']?[^"'\s,}&]+["']?/gi, '$1***')
    .replace(/(ADMIN_CONFIG_PASSWORD["'\s:=]+)["']?[^"'\s,}&]+["']?/gi, '$1***')
    .replace(/(Server=[^;]+;.*Password=)[^;]+/gi, '$1***')
    .replace(/(Bearer\s+)[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/gi, '$1***')
    .replace(/(JWT_SECRET["'\s:=]+)["']?[^"'\s,}&]+["']?/gi, '$1***');
}

// Get standard date tag for daily rotated logs (YYYY-MM-DD)
function getDateTag(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Rotate a log file if it exceeds MAX_LOG_SIZE
function rotateLogIfNeeded(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      if (stats.size >= MAX_LOG_SIZE) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const ext = path.extname(filePath);
        const base = filePath.slice(0, -ext.length);
        const rotatedName = `${base}.${timestamp}${ext}`;
        try {
          fs.renameSync(filePath, rotatedName);
        } catch { }
      }
    }
  } catch { }
}

// Clean up logs strictly older than RETENTION_DAYS (10 days) across a directory and its subdirectories
function cleanOldLogs(baseDirectory) {
  try {
    if (!fs.existsSync(baseDirectory)) return;

    const todayDateTag = getDateTag();
    const now = Date.now();

    function processDir(dir) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          processDir(fullPath);
          continue;
        }

        if (!entry.isFile()) continue;

        const fileName = entry.name.toLowerCase();
        // Target log files (.log, .txt, .log.*)
        const isLogFile = fileName.endsWith('.log') ||
                          fileName.endsWith('.txt') ||
                          fileName.includes('.log.');

        if (!isLogFile) continue;

        // NEVER delete current day logs or active primary logs
        const isToday = fileName.includes(todayDateTag);
        const isPrimaryActive = fileName === 'backend.log' ||
                                fileName === 'frontend.log' ||
                                fileName === 'diagnostics.log' ||
                                fileName === 'backend-startup.log';
        if (isToday || isPrimaryActive) continue;

        try {
          const stats = fs.statSync(fullPath);
          const ageMs = now - stats.mtimeMs;

          if (ageMs > RETENTION_MS) {
            fs.unlinkSync(fullPath);
            console.log(`🧹 [LogRotation] Removed log file older than ${RETENTION_DAYS} days: ${entry.name}`);
          }
        } catch (err) {
          // Locked file or permission error: skip gracefully
        }
      }
    }

    processDir(baseDirectory);
  } catch (err) {
    // Non-fatal cleanup error
  }
}

// Asynchronous buffered log writer to prevent synchronous disk I/O from blocking event loop under high load
const logBuffers = new Map(); // filePath -> Array<string>
const isFlushing = new Map();  // filePath -> boolean
const MAX_BUFFER_LINES = 5000; // Bound queue size to prevent memory leaks if disk is full or slow

function flushLogBuffer(filePath, isSync = false) {
  const buf = logBuffers.get(filePath);
  if (!buf || buf.length === 0) {
    isFlushing.set(filePath, false);
    return;
  }
  isFlushing.set(filePath, true);
  const chunk = buf.splice(0, buf.length).join('\n') + '\n';

  try {
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    rotateLogIfNeeded(filePath);

    if (isSync) {
      try {
        fs.appendFileSync(filePath, chunk, 'utf8');
      } catch (err) {
        // Disk full or write error: drop chunk gracefully to avoid process crash
      }
      isFlushing.set(filePath, false);
      return;
    }

    fs.appendFile(filePath, chunk, 'utf8', (err) => {
      if (err) {
        // Disk write failed (e.g. out of disk space) -> skip to prevent crashing
      }
      const remaining = logBuffers.get(filePath);
      if (remaining && remaining.length > 0) {
        setImmediate(() => flushLogBuffer(filePath, false));
      } else {
        isFlushing.set(filePath, false);
      }
    });
  } catch (err) {
    isFlushing.set(filePath, false);
  }
}

// Synchronously flush all active log buffers on process exit or termination
function flushAllLogsSync() {
  for (const filePath of logBuffers.keys()) {
    flushLogBuffer(filePath, true);
  }
}

// Periodic flusher every 2 seconds to guarantee logs are written even during low-frequency periods
setInterval(() => {
  for (const [filePath, buf] of logBuffers.entries()) {
    if (buf && buf.length > 0 && !isFlushing.get(filePath)) {
      flushLogBuffer(filePath, false);
    }
  }
}, 2000).unref();

// Process exit hooks for clean log persistence
process.on('exit', () => flushAllLogsSync());
process.on('SIGINT', () => { flushAllLogsSync(); process.exit(0); });
process.on('SIGTERM', () => { flushAllLogsSync(); process.exit(0); });

// Non-blocking log append with sanitization and rotation
function writeToLogFile(filePath, message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const cleanMsg = sanitizeLogMessage(message);
  const line = `[${timestamp}] [${level}] ${cleanMsg}`;

  let buf = logBuffers.get(filePath);
  if (!buf) {
    buf = [];
    logBuffers.set(filePath, buf);
  }

  // Bounded buffer check: if buffer exceeds 5,000 lines (e.g. disk stalled), drop oldest line
  if (buf.length >= MAX_BUFFER_LINES) {
    buf.shift();
  }
  buf.push(line);

  if (!isFlushing.get(filePath)) {
    isFlushing.set(filePath, true);
    setImmediate(() => flushLogBuffer(filePath, false));
  }
}

module.exports = {
  sanitizeLogMessage,
  getDateTag,
  rotateLogIfNeeded,
  cleanOldLogs,
  writeToLogFile,
  flushAllLogsSync,
  RETENTION_DAYS
};

