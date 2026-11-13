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

// Thread-safe log append with sanitization and rotation
function writeToLogFile(filePath, message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const cleanMsg = sanitizeLogMessage(message);
  const line = `[${timestamp}] [${level}] ${cleanMsg}\n`;

  try {
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    rotateLogIfNeeded(filePath);
    fs.appendFileSync(filePath, line, 'utf8');
  } catch { }
}

module.exports = {
  sanitizeLogMessage,
  getDateTag,
  rotateLogIfNeeded,
  cleanOldLogs,
  writeToLogFile,
  RETENTION_DAYS
};

