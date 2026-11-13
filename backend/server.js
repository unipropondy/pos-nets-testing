// QR POS Backend Modular Server
const express = require("express");
const compression = require("compression");
const cors = require("cors");
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const sql = require("mssql");

// 📝 LOCAL LOGGING SYSTEM: Write all logs to local .txt / .log files
function resolveLogsDirectory() {
  if (process.env.LOGS_DIR) {
    try {
      if (!fs.existsSync(process.env.LOGS_DIR)) fs.mkdirSync(process.env.LOGS_DIR, { recursive: true });
      return process.env.LOGS_DIR;
    } catch { }
  }

  // Standardized production logs directory: %ProgramData%\SmartPOS\logs
  const programData = process.env.ProgramData || "C:\\ProgramData";
  const standardLogDir = path.join(programData, "SmartPOS", "logs");
  try {
    if (!fs.existsSync(standardLogDir)) {
      fs.mkdirSync(standardLogDir, { recursive: true });
    }
    const testFile = path.join(standardLogDir, ".perm_test");
    fs.writeFileSync(testFile, "test");
    fs.unlinkSync(testFile);
    return standardLogDir;
  } catch (err) {
    // Fallback to local app directory if ProgramData is unavailable
    const fallbackBase = process.env.LOCALAPPDATA || process.env.APPDATA || path.resolve(__dirname, "..");
    const userLogDir = path.join(fallbackBase, "SmartPOS", "logs");
    try {
      if (!fs.existsSync(userLogDir)) fs.mkdirSync(userLogDir, { recursive: true });
      return userLogDir;
    } catch {
      return path.resolve(__dirname, "..", "logs");
    }
  }
}

const logsDir = resolveLogsDirectory();
const backendSubDir = path.join(logsDir, "backend");
const frontendSubDir = path.join(logsDir, "frontend");

try {
  if (!fs.existsSync(backendSubDir)) fs.mkdirSync(backendSubDir, { recursive: true });
  if (!fs.existsSync(frontendSubDir)) fs.mkdirSync(frontendSubDir, { recursive: true });
} catch { }

const { writeToLogFile, cleanOldLogs, getDateTag } = require("./utils/logManager");

function getDailyBackendLogPath() {
  return path.join(backendSubDir, `backend-${getDateTag()}.log`);
}

function getDailyFrontendLogPath() {
  return path.join(frontendSubDir, `frontend-${getDateTag()}.log`);
}

const backendLogPath = getDailyBackendLogPath();
const frontendLogPath = getDailyFrontendLogPath();

// Execute log rotation cleanup on startup and periodically every 6 hours across all log folders
cleanOldLogs(logsDir);
setInterval(() => {
  cleanOldLogs(logsDir);
}, 6 * 60 * 60 * 1000);

const logToFile = (filePath, message, level = "INFO") => {
  writeToLogFile(filePath, message, level);
};

// Mirror console.log, console.warn and console.error to logs/backend/backend-YYYY-MM-DD.log
const origLog = console.log;
const origError = console.error;
const origWarn = console.warn;

console.log = (...args) => {
  origLog(...args);
  logToFile(getDailyBackendLogPath(), args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" "), "INFO");
};

console.error = (...args) => {
  origError(...args);
  logToFile(getDailyBackendLogPath(), args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" "), "ERROR");
};

console.warn = (...args) => {
  origWarn(...args);
  logToFile(getDailyBackendLogPath(), args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" "), "WARN");
};

// Load plain text environment variables directly via dotenv
const plainEnvPath = path.resolve(__dirname, ".env");
if (fs.existsSync(plainEnvPath)) {
  require("dotenv").config({ path: plainEnvPath });
}

const { poolPromise } = require("./config/db");
const { initDB, syncKitchensToPrintMaster } = require("./config/init");
const dbCheck = require("./middleware/dbCheck");
const idempotencyMiddleware = require("./middleware/idempotency");
const { getHoldOvertimeMinutes } = require("./utils/settingsCache");
const { rollbackAllActive } = require("./utils/transactionHelper");
const { startPrintQueueWorker } = require("./services/printQueueWorker");

// Import Routes
const authRoutes = require("./routes/auth");
const tableRoutes = require("./routes/tables");
const menuRoutes = require("./routes/menu");
const salesRoutes = require("./routes/sales");
const memberRoutes = require("./routes/members");
const attendanceRoutes = require("./routes/attendance");
const adminRoutes = require("./routes/admin");
const orderRoutes = require("./routes/orders");
const serverRoutes = require("./routes/servers");
const settingsRoutes = require("./routes/settings");
const companySettingsRoutes = require("./routes/companySettings");
const uploadRoutes = require("./routes/upload");
const exportRoutes = require("./routes/export");
const creditCustomerRoutes = require("./routes/creditCustomers");
const settlementRoutes = require("./routes/settlementRoutes");
const settlementLegacyRoutes = require("./routes/settlement");
const config = require('./config');
const yeahpayRoutes = require('./routes/yeahpay');
const loyaltyRoutes = require("./routes/loyalty");
const loyaltyConfigRoutes = require("./routes/loyaltyConfig");
const comboRoutes = require("./routes/combo");
const rewardRoutes = require("./routes/rewardRoutes");
const syncRoutes = require("./routes/sync");
const { startSyncWorker } = require("./services/syncService");
const { ensureLocalDatabaseExists, syncSchemaFromRemoteToLocal } = require("./services/autoProvisionLocalDb");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  perMessageDeflate: true,
});

const PORT = process.env.PORT || 3000;

// Expose io to routes
app.set("io", io);

// Socket.io Connection
io.on("connection", (socket) => {
  console.log("🔌 New client connected:", socket.id);

  // Broadcast new orders to other clients (e.g. KDS screens)
  socket.on("new_order", (data) => {
    console.log("📦 [Server] New order event received:", data.orderId);
    io.emit("new_order", data);
  });

  // 🚀 INSTANT SYNC: Relay cart changes globally between all tablets & devices without DB lag
  socket.on("join_table", ({ tableId }) => {
    if (!tableId) return;
    const cleanTableId = String(tableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
    const room = `table_${cleanTableId}`;
    socket.join(room);
    console.log(`🔌 [Server] Socket ${socket.id} joined table room: ${room}`);
  });

  socket.on("cart_change", (data) => {
    console.log(`🛒 [Server] Cart change relay for Table: ${data?.tableId || "global"} (items: ${data?.items?.length || 0})`);
    // Broadcast to all other devices/tablets on LAN/Wi-Fi immediately
    socket.broadcast.emit("cart_change", data);
  });

  socket.on("cart_updated", (data) => {
    console.log(`🛒 [Server] Cart updated relay for Table: ${data?.tableId || "global"}`);
    socket.broadcast.emit("cart_updated", data);
  });

  socket.on("table_status_updated", (data) => {
    console.log(`🪑 [Server] Table status updated relay: ${data?.tableId || "global"}`);
    socket.broadcast.emit("table_status_updated", data);
  });

  // Broadcast status updates (e.g. order completed, items voided)
  socket.on("order_status_update", (data) => {
    console.log("🔄 [Server] Order status update received:", data.orderId);
    io.emit("order_status_update", data);
  });

  // Relay customer request (e.g. Call Waiter, Water, Spoon)
  socket.on("customer_request", (data) => {
    console.log(`🛎️ [Server] Customer Request from Table ${data.tableNo}: ${data.type}`);
    io.emit("customer_request", data);
  });

  // 💵 QUICK CASH SYNC: Broadcast quick-cash button amounts to all POS terminals
  socket.on("quick_cash_updated", (data) => {
    console.log("💵 [Server] Quick cash amounts updated:", data.amounts);
    socket.broadcast.emit("quick_cash_updated", data);
  });

  // 🖥️ TERMINAL ROOM JOIN: POS devices and Customer Display screens join a shared room
  // Room name format: terminal_{TerminalCode} (e.g. terminal_COUNTER_1)
  socket.on("join_terminal", ({ terminalCode }) => {
    if (!terminalCode) return;
    const room = `terminal_${terminalCode}`;
    socket.join(room);
    console.log(`🖥️ [Server] Socket ${socket.id} joined room: ${room}`);
  });

  // 🖥️ CUSTOMER DISPLAY SYNC: Route to terminal room so only the paired display receives updates
  // Falls back to global broadcast if no terminalCode (legacy/unconfigured devices)
  socket.on("customer_display_sync", (data) => {
    const { terminalCode } = data;
    if (terminalCode) {
      const room = `terminal_${terminalCode}`;
      console.log(`🖥️ [Server] Customer Display Sync → room: ${room} | State: ${data.paymentSuccess ? "SUCCESS" : data.active ? "CART" : "IDLE"}`);
      io.to(room).emit("customer_display_sync", data);
    } else {
      // Legacy fallback: no terminal configured, broadcast to all
      console.log("🖥️ [Server] Customer Display Sync → BROADCAST (no terminalCode)");
      io.emit("customer_display_sync", data);
    }
  });

  // Relay terminal payment status to other tablets
  socket.on("terminal_payment_sync", (data) => {
    console.log(`🔌 [Server] Terminal payment sync:`, data);
    socket.broadcast.emit("terminal_payment_sync", data);
  });

  // Relay terminal split rows status to other tablets
  socket.on("terminal_split_rows_sync", (data) => {
    console.log(`🔌 [Server] Terminal split rows sync:`, data);
    socket.broadcast.emit("terminal_split_rows_sync", data);
  });

  // Relay live table & layout configuration updates to other devices on LAN/Wi-Fi
  socket.on("table_config_updated", (data) => {
    console.log(`🔌 [Server] Relay table_config_updated:`, data);
    socket.broadcast.emit("table_config_updated", data || {});
  });

  socket.on("section_layout_updated", (data) => {
    console.log(`🔌 [Server] Relay section_layout_updated:`, data);
    socket.broadcast.emit("section_layout_updated", data || {});
  });

  // 🍽️ MENU PUBLISH & UPDATES SYNC: Broadcast menu published status changes to all QR menus and POS apps
  socket.on("menu_updated", (data) => {
    console.log("🍽️ [Server] Socket menu_updated event received:", data);
    const menuRoute = require("./routes/menu");
    if (menuRoute && typeof menuRoute.clearMenuCache === "function") {
      menuRoute.clearMenuCache(io);
    } else {
      io.emit("menu_updated", data || {});
    }
  });

  socket.on("disconnect", () => {
    console.log("🔌 Client disconnected:", socket.id);
  });
});
console.log('🔐 [YeahPay] AppId loaded:', config.appId ? '✅ Yes' : '❌ Missing');
console.log('🔐 [YeahPay] Sync URL:', config.syncApiUrl);
// 🔄 REAL-TIME DB POLLER: Syncs database updates (e.g. from online/QR orders or external systems) with Socket.io clients instantly
// Only emits when changes are detected, preventing performance issues.
const previousTablesState = new Map();
const sectionMap = { "1": "SECTION_1", "2": "SECTION_2", "3": "SECTION_3", "4": "TAKEAWAY" };

let previousMenuPublishHash = null;

async function pollMenuPublishStatus() {
  try {
    const pool = await poolPromise;
    if (pool && pool.connected) {
      // Check if DishMaster exists before querying
      const checkTable = await pool.request().query("SELECT OBJECT_ID('DishMaster', 'U') AS id").catch(() => ({ recordset: [] }));
      if (!checkTable.recordset[0]?.id) {
        return; // Table not ready yet, skip quietly
      }

      const result = await pool.request().query(`
        SELECT 
          (SELECT CHECKSUM_AGG(CHECKSUM(DishId, ISNULL(IsPublished, 0))) FROM DishMaster WITH (NOLOCK)) AS dishHash,
          (SELECT CHECKSUM_AGG(CHECKSUM(CategoryId, ISNULL(IsPublished, 0))) FROM CategoryMaster WITH (NOLOCK)) AS catHash,
          (SELECT CHECKSUM_AGG(CHECKSUM(DishGroupId, ISNULL(IsPublished, 0))) FROM DishGroupMaster WITH (NOLOCK)) AS groupHash
      `);

      const row = result.recordset[0];
      const currentHash = `${row?.dishHash}_${row?.catHash}_${row?.groupHash}`;

      if (previousMenuPublishHash !== null && previousMenuPublishHash !== currentHash) {
        console.log(`🔌 [DB Poller Sync] Menu IsPublished change detected! Clearing menu cache & emitting menu_updated...`);
        const menuRoute = require("./routes/menu");
        if (menuRoute && typeof menuRoute.clearMenuCache === "function") {
          menuRoute.clearMenuCache(io);
        } else {
          io.emit("menu_updated", { source: "db_poller", timestamp: Date.now() });
        }
      }
      previousMenuPublishHash = currentHash;
    }
  } catch (err) {
    console.error("🔄 [DB Poller Menu] Error:", err.message);
  } finally {
    setTimeout(pollMenuPublishStatus, 3000);
  }
}

async function pollTables() {
  try {
    const pool = await poolPromise;
    if (pool && pool.connected) {
      // Check if TableMaster exists before querying
      const checkTable = await pool.request().query("SELECT OBJECT_ID('TableMaster', 'U') AS id").catch(() => ({ recordset: [] }));
      if (!checkTable.recordset[0]?.id) {
        return; // Table not ready yet, skip quietly
      }

      const holdMinutes = await getHoldOvertimeMinutes();

      const result = await pool.request()
        .input("holdMinutes", sql.Int, holdMinutes)
        .query(`
        SELECT 
          TableId AS id, 
          CAST(TableNumber AS VARCHAR(50)) AS label,
          CAST(DiningSection AS VARCHAR(10)) AS DiningSection, 
          LockedByName as lockedByName,
          Status, 
          CONVERT(VARCHAR, StartTime, 126) as StartTime, 
          ISNULL(TotalAmount, 0) as totalAmount, 
          CurrentOrderId as currentOrderId,
          entry_status AS entryStatus,
          CustomerName as customerName,
          Pax as pax,
          TableType,
          Seats,
          XSize,
          YSize,
          CASE 
            WHEN Status IN (1, 2, 3) AND StartTime IS NOT NULL AND StartTime > '2000-01-01' AND DATEDIFF(MINUTE, StartTime, GETDATE()) >= 60 THEN 1 
            ELSE 0 
          END AS isOvertime,
          CASE 
            WHEN Status = 3 AND ModifiedOn IS NOT NULL AND DATEDIFF(MINUTE, ModifiedOn, GETDATE()) >= @holdMinutes THEN 1 
            ELSE 0 
          END AS isHoldOvertime,
          CONVERT(VARCHAR, ModifiedOn, 126) as ModifiedOn
        FROM TableMaster WITH (NOLOCK)
      `);

      const currentTables = result.recordset || [];
      currentTables.forEach((table) => {
        const tableId = String(table.id || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
        const prevState = previousTablesState.get(tableId);

        const hasChanged = !prevState ||
          prevState.status !== table.Status ||
          prevState.entryStatus !== table.entryStatus ||
          prevState.totalAmount !== table.totalAmount ||
          prevState.lockedByName !== table.lockedByName ||
          prevState.customerName !== table.customerName ||
          prevState.pax !== table.pax;

        if (hasChanged) {
          // Update local memory state
          previousTablesState.set(tableId, {
            status: table.Status,
            entryStatus: table.entryStatus,
            totalAmount: table.totalAmount,
            lockedByName: table.lockedByName,
            customerName: table.customerName,
            pax: table.pax
          });

          // Only emit if this is not the very first load/state initialization
          if (prevState) {
            io.emit("table_status_updated", {
              tableId,
              status: Number(table.Status),
              totalAmount: Number(table.totalAmount) || 0,
              startTime: table.StartTime,
              tableNo: table.label,
              section: sectionMap[String(table.DiningSection)] || table.DiningSection,
              modifiedOn: table.ModifiedOn,
              isOvertime: table.isOvertime || 0,
              isHoldOvertime: table.isHoldOvertime || 0,
              entryStatus: table.entryStatus || null,
              customerName: table.customerName || null,
              pax: table.pax || null
            });
            console.log(`🔌 [DB Poller Sync] Table ${table.label} updated -> Emit socket. Status: ${table.Status}, QR: ${table.entryStatus}`);
          } else {
            // Initialize memory state silently on startup
            console.log(`🔌 [DB Poller Sync] Initialized table state for: ${table.label}`);
          }
        }
      });
    }
  } catch (err) {
    console.error("🔄 [DB Poller Sync] Error:", err.message);
  } finally {
    // Schedule the next poll to execute 5 seconds after this one finished (prevents overlapping)
    setTimeout(pollTables, 5000);
  }
}

// Pollers will be started after initial DB setup completes in httpServer.listen

// ✅ Global Middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`🌐 [Request] ${req.method} ${req.originalUrl} - Status: ${res.statusCode} (${duration}ms)`);
  });
  next();
});
app.use(compression()); // Compress all responses
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  }),
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));
app.use(express.static(path.join(__dirname, "dist"), { extensions: ["html"] }));

// 🩺 Health check endpoint for frontend warmup ping
// 🩺 Health check endpoint for frontend warmup ping
app.get("/health", (req, res) => res.json({ status: "ok", timestamp: new Date() }));

// 📥 CLIENT LOGS ENDPOINT: Allows frontend to stream logs directly to local frontend/frontend-YYYY-MM-DD.log file
app.post("/api/logs/client", express.json(), (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  const targetFrontendLog = getDailyFrontendLogPath();
  for (const item of items) {
    const { level, message, details } = item || {};
    if (message) {
      const detailStr = details ? ` | ${typeof details === "object" ? JSON.stringify(details) : details}` : "";
      logToFile(targetFrontendLog, `[${(level || "INFO").toUpperCase()}] ${message}${detailStr}`);
    }
  }
  res.status(204).end();
});

// 🔍 SYSTEM LOGS DIAGNOSTICS & VIEWER (Available even if database is offline)
app.get("/api/logs/info", (req, res) => {
  const currentBackendPath = getDailyBackendLogPath();
  const currentFrontendPath = getDailyFrontendLogPath();
  let backendSize = 0;
  let frontendSize = 0;
  try { if (fs.existsSync(currentBackendPath)) backendSize = fs.statSync(currentBackendPath).size; } catch { }
  try { if (fs.existsSync(currentFrontendPath)) frontendSize = fs.statSync(currentFrontendPath).size; } catch { }

  res.json({
    status: "ok",
    logsDir,
    backendSubDir,
    frontendSubDir,
    backendLogPath: currentBackendPath,
    backendLogSizeBytes: backendSize,
    backendLogSizeMB: (backendSize / (1024 * 1024)).toFixed(2),
    frontendLogPath: currentFrontendPath,
    frontendLogSizeBytes: frontendSize,
    frontendLogSizeMB: (frontendSize / (1024 * 1024)).toFixed(2),
  });
});

app.all("/api/logs/open-folder", (req, res) => {
  const { exec } = require("child_process");
  if (process.platform === "win32") {
    exec(`explorer.exe "${logsDir}"`, (err) => {
      if (err) return res.status(500).json({ error: err.message, logsDir });
      res.json({ success: true, message: `Opened logs folder: ${logsDir}`, logsDir });
    });
  } else {
    res.json({ success: false, message: "Not running on Windows", logsDir });
  }
});

app.get("/api/logs/download/backend", (req, res) => {
  const currentBackendPath = getDailyBackendLogPath();
  if (fs.existsSync(currentBackendPath)) {
    res.download(currentBackendPath, path.basename(currentBackendPath));
  } else if (fs.existsSync(path.join(logsDir, "backend.log"))) {
    res.download(path.join(logsDir, "backend.log"), "backend.log");
  } else {
    res.status(404).send("backend log does not exist yet.");
  }
});

app.get("/api/logs/download/frontend", (req, res) => {
  const currentFrontendPath = getDailyFrontendLogPath();
  if (fs.existsSync(currentFrontendPath)) {
    res.download(currentFrontendPath, path.basename(currentFrontendPath));
  } else if (fs.existsSync(path.join(logsDir, "frontend.log"))) {
    res.download(path.join(logsDir, "frontend.log"), "frontend.log");
  } else {
    res.status(404).send("frontend log does not exist yet.");
  }
});

app.get("/api/logs/view", (req, res) => {
  const getTail = (filePath, linesCount = 200) => {
    try {
      if (!fs.existsSync(filePath)) return "(No log entries yet)";
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.trim().split("\n");
      return lines.slice(-linesCount).join("\n");
    } catch (e) {
      return `Error reading log: ${e.message}`;
    }
  };

  const currentBackendPath = getDailyBackendLogPath();
  const currentFrontendPath = getDailyFrontendLogPath();
  const backendTail = getTail(currentBackendPath);
  const frontendTail = getTail(currentFrontendPath);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>UniPro POS - System Logs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
    h1 { font-size: 20px; margin-bottom: 8px; color: #38bdf8; display: flex; align-items: center; justify-content: space-between; }
    .path-box { background: #1e293b; border: 1px solid #334155; padding: 12px 16px; border-radius: 8px; font-size: 13px; font-family: monospace; color: #a5f3fc; margin-bottom: 20px; line-height: 1.6; }
    .actions { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
    .btn { background: #2563eb; color: #fff; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 600; border: none; cursor: pointer; transition: 0.15s; }
    .btn:hover { background: #1d4ed8; }
    .btn-secondary { background: #334155; }
    .btn-secondary:hover { background: #475569; }
    .tab-bar { display: flex; gap: 8px; margin-bottom: 12px; }
    .tab { padding: 8px 16px; background: #1e293b; color: #94a3b8; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; border: 1px solid #334155; }
    .tab.active { background: #38bdf8; color: #0f172a; border-color: #38bdf8; }
    pre { background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 16px; font-family: 'Consolas', monospace; font-size: 12px; line-height: 1.5; color: #cbd5e1; overflow-x: auto; max-height: 70vh; white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>
  <h1>
    <span>UniPro POS Live Diagnostics & Logs</span>
    <span style="font-size: 12px; color: #94a3b8; font-weight: normal;">Updated: ${new Date().toLocaleTimeString()}</span>
  </h1>
  <div class="path-box">
    <strong>📁 Local Logs Root:</strong> ${logsDir}<br>
    <strong>⚙️ Active Backend Log:</strong> ${currentBackendPath}<br>
    <strong>💻 Active Frontend Log:</strong> ${currentFrontendPath}
  </div>
  <div class="actions">
    <button class="btn" onclick="fetch('/api/logs/open-folder').then(r=>r.json()).then(d=>alert(d.message || 'Folder opened'))">📂 Open Logs Folder in Explorer</button>
    <a class="btn btn-secondary" href="/api/logs/download/backend">⬇️ Download backend.log</a>
    <a class="btn btn-secondary" href="/api/logs/download/frontend">⬇️ Download frontend.log</a>
    <button class="btn btn-secondary" onclick="location.reload()">🔄 Refresh Logs</button>
  </div>
  <div class="tab-bar">
    <div id="tab-backend" class="tab active" onclick="showTab('backend')">Backend Log (Latest 200 lines)</div>
    <div id="tab-frontend" class="tab" onclick="showTab('frontend')">Frontend Log (Latest 200 lines)</div>
  </div>
  <pre id="pre-backend">${backendTail.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
  <pre id="pre-frontend" style="display: none;">${frontendTail.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>

  <script>
    function showTab(type) {
      document.getElementById('pre-backend').style.display = type === 'backend' ? 'block' : 'none';
      document.getElementById('pre-frontend').style.display = type === 'frontend' ? 'block' : 'none';
      document.getElementById('tab-backend').className = type === 'backend' ? 'tab active' : 'tab';
      document.getElementById('tab-frontend').className = type === 'frontend' ? 'tab active' : 'tab';
    }
  </script>
</body>
</html>`);
});

// 🔄 Database Connection Check (for all API routes)
app.use("/api", dbCheck);
app.use("/api", idempotencyMiddleware);

/* ================= ROUTES ================= */
app.use("/api/auth", authRoutes);
app.use("/api/tables", tableRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/reports", salesRoutes);
app.use("/api/members", memberRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/servers", serverRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/company-settings", companySettingsRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/credit-customers", creditCustomerRoutes);
app.use("/api/settlement", settlementRoutes);
app.use("/api/settlement", settlementLegacyRoutes);
app.use('/api/yeahpay', (req, res, next) => {
  req.io = io;
  next();
}, yeahpayRoutes);
const netsRoutes = require('./routes/nets');
app.use('/api/nets', (req, res, next) => {
  req.app.set('socketio', io);
  req.io = io;
  next();
}, netsRoutes);
app.use("/api/loyalty", loyaltyRoutes);
app.use("/api/loyalty/configs", loyaltyConfigRoutes);
app.use("/api/combo", comboRoutes);
app.use("/api/rewards", rewardRoutes);
const cashDrawerRouter = require("./routes/cashDrawer");
app.use("/api/cash-drawer", cashDrawerRouter);
const printJobsRouter = require("./routes/printJobs");
app.use("/api/print-jobs", printJobsRouter);
const terminalRoutes = require("./routes/terminal");
app.use("/api/terminal", terminalRoutes);
app.use("/api/sync", syncRoutes);
// AI Chat Integration
const aiRouter = require("./ai-service-src/routes/ai.routes");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");

const aiApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: "Too many requests, please try again later." }
});

const authenticateAiToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = { shop_id: 1, role: 'ADMIN', username: 'TestOwner', user_id: 1 };
    return next();
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      req.user = { shop_id: 1, role: 'ADMIN', username: 'TestOwner', user_id: 1 };
      return next();
    }
    req.user = decoded;
    next();
  });
};

const requireAiAuthorizedRole = (req, res, next) => {
  const role = (req.user?.role || '').toUpperCase();
  const allowed = ['ADMIN'];
  if (!allowed.includes(role)) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Insufficient privileges. Only ADMIN group users can access the AI Chat assistant."
    });
  }
  next();
};

app.use("/api/ai", aiApiLimiter, authenticateAiToken, requireAiAuthorizedRole, aiRouter);
app.use("/api/v1/ai", aiApiLimiter, authenticateAiToken, requireAiAuthorizedRole, aiRouter);

// Root Endpoints (Serve static client SPA fallback routing)
app.get(["/", /^\/customer.*/], (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.get("/health", (req, res) => {
  const os = require("os");
  const interfaces = os.networkInterfaces();
  const localIps = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === "IPv4" && !net.internal) {
        localIps.push(net.address);
      }
    }
  }

  res.json({
    status: "ok",
    server: "Smart POS",
    version: "3.0.0",
    localIps,
    port: process.env.PORT || 3000,
    timestamp: new Date().toISOString()
  });
});

// Legacy support (redirects to ensure existing frontend calls don't break)
app.post("/api/checkout", (req, res) =>
  res.redirect(307, "/api/orders/checkout"),
);
// 🔥 QR LEGACY: QR app uses /api/order (singular) but routes are /api/orders (plural)
app.use("/api/order", (req, res) => {
  const newPath = "/api/orders" + req.path + (Object.keys(req.query).length ? "?" + new URLSearchParams(req.query).toString() : "");
  res.redirect(307, newPath);
});
app.get("/tables", (req, res) => res.redirect("/api/tables/all"));
app.get("/kitchens", (req, res) => res.redirect("/api/menu/kitchens"));
app.get("/dishgroups/:id", (req, res) =>
  res.redirect(`/api/menu/dishgroups/${req.params.id}`),
);
app.get("/dishes/:id", (req, res) =>
  res.redirect(`/api/menu/dishes/group/${req.params.id}`),
);
app.get("/api/dishes/all", (req, res) => res.redirect("/api/menu/dishes/all"));
app.get("/api/discounts", (req, res) => res.redirect("/api/admin/discounts"));
app.get("/modifiers/:id", (req, res) =>
  res.redirect(`/api/menu/modifiers/${req.params.id}`),
);
app.get("/image/:id", (req, res) =>
  res.redirect(`/api/menu/image/${req.params.id}`),
);

// 🧹 JANITOR HEARTBEAT: Safe Ghost Cleanup (Every 15 minutes)
// Strictly closes orphan orders only if the table has been vacant with 0 items for over 30 minutes
setInterval(async () => {
  try {
    const pool = await poolPromise;
    if (!pool || !pool.connected) return;

    // Close only true stale orphan orders where table is 0 and no active items exist
    const result = await pool.request().query(`
      UPDATE RestaurantOrderCur 
      SET isOrderClosed = 1, ModifiedOn = GETDATE()
      WHERE (isOrderClosed = 0 OR isOrderClosed IS NULL)
      AND Tableno IN (
        SELECT TableNumber 
        FROM TableMaster 
        WHERE Status = 0
      )
      AND OrderId NOT IN (
        SELECT OrderId FROM RestaurantOrderDetailCur WHERE StatusCode IN (1, 2, 3, 5)
      )
      AND CreatedOn < DATEADD(MINUTE, -30, GETDATE());
    `);

    if (result.recordset || result.rowsAffected[0] > 0) {
      const affected = result.rowsAffected[0] || 0;
      if (affected > 0) {
        console.log(`🧹 [Janitor] Cleared ${affected} stale orphan orders.`);
      }
    }
  } catch (err) {
    console.error("🧹 [Janitor] Cleanup failed:", err.message);
  }
}, 15 * 60 * 1000); // 15 Minutes

// 📊 TEMPORARY DIAGNOSTICS LOGGING (Every 5 minutes)
const DIAGNOSTICS_LOG_FILE = path.join(logsDir, "diagnostics.log");

function logDiagnostics(label = "Interval") {
  try {
    const mem = process.memoryUsage();
    const { activeTransactions } = require("./utils/transactionHelper");
    const { getPool } = require("./config/db");

    const pool = getPool();
    const poolStats = pool && pool.pool ? {
      used: pool.pool.used.length,
      free: pool.pool.free.length,
      pendingAcquires: pool.pool.pendingAcquires.length,
      pendingCreates: pool.pool.pendingCreates.length,
      max: pool.pool.max,
      min: pool.pool.min
    } : { used: 0, free: 0, pendingAcquires: 0, pendingCreates: 0, max: 0, min: 0 };

    const io = app.get("io");
    const activeSockets = io ? io.sockets.sockets.size : 0;
    const activeRooms = io && io.sockets.adapter ? io.sockets.adapter.rooms.size : 0;

    const imgCacheStats = menuRoutes && menuRoutes.imageCache ? menuRoutes.imageCache.getStats() : {
      size: 0,
      maxSize: 100,
      estimatedMemoryMb: "0.00 MB",
      hits: 0,
      misses: 0,
      hitRate: "0.00%",
      missRate: "0.00%"
    };

    const stats = {
      timestamp: new Date().toISOString(),
      label,
      memory: {
        rss: (mem.rss / 1024 / 1024).toFixed(2) + " MB",
        heapTotal: (mem.heapTotal / 1024 / 1024).toFixed(2) + " MB",
        heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(2) + " MB",
        external: (mem.external / 1024 / 1024).toFixed(2) + " MB",
        heapUsagePercent: ((mem.heapUsed / mem.heapTotal) * 100).toFixed(2) + "%"
      },
      transactions: {
        activeCount: activeTransactions ? activeTransactions.size : 0
      },
      databasePool: poolStats,
      sockets: {
        activeSockets,
        activeRooms
      },
      imageCache: imgCacheStats
    };

    const logMessage = `[DIAGNOSTICS] [${stats.timestamp}] [${label}]
Memory: RSS=${stats.memory.rss}, HeapTotal=${stats.memory.heapTotal}, HeapUsed=${stats.memory.heapUsed} (Usage: ${stats.memory.heapUsagePercent})
Transactions: ActiveCount=${stats.transactions.activeCount}
DB Pool: Used=${stats.databasePool.used}, Free=${stats.databasePool.free}, PendingAcquires=${stats.databasePool.pendingAcquires}, PendingCreates=${stats.databasePool.pendingCreates}
Sockets: ActiveSockets=${stats.sockets.activeSockets}, ActiveRooms=${stats.sockets.activeRooms}
Image Cache: Size=${stats.imageCache.size}/${stats.imageCache.maxSize}, EstMemory=${stats.imageCache.estimatedMemoryMb}, Hits=${stats.imageCache.hits}, Misses=${stats.imageCache.misses} (HitRate: ${stats.imageCache.hitRate}, MissRate: ${stats.imageCache.missRate})
--------------------------------------------------------------------------------`;

    console.log(logMessage);
    const logsDir = path.dirname(DIAGNOSTICS_LOG_FILE);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    fs.appendFileSync(DIAGNOSTICS_LOG_FILE, logMessage + "\n", "utf8");
  } catch (err) {
    console.error("⚠️ [Diagnostics] Logging failed:", err.message);
  }
}

// Log startup metrics after 5 seconds to let everything initialize
setTimeout(() => {
  logDiagnostics("Startup");
}, 5000);

// Log every 5 minutes
setInterval(() => {
  logDiagnostics("Interval");
}, 5 * 60 * 1000);

function getLocalNetworkIp() {
  try {
    const interfaces = require('os').networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch (_) { }
  return 'localhost';
}

httpServer.listen(PORT, "0.0.0.0", async () => {
  const localIp = getLocalNetworkIp();
  console.log("\n===========================================================");
  console.log("  📡 LOCAL SERVER ACTIVE FOR ALL NETWORK DEVICES & TABLETS");
  console.log("===========================================================");
  console.log(`  Backend Server API : http://${localIp}:${PORT}`);
  console.log(`  Local Database     : ${process.env.LOCAL_DB_NAME || 'UCSPONDY_HYBRID'} (Local MS SQL Server)`);
  console.log(`  Web Client Connect : http://${localIp}:8081`);
  console.log("===========================================================\n");
  startPrintQueueWorker();

  try {
    // 1. Auto-create local database if it doesn't exist on Local SQL Server
    await ensureLocalDatabaseExists();

    const pool = await poolPromise;
    if (pool) {
      // 2. Auto-clone and sync all missing tables and master data from Remote Cloud DB FIRST!
      console.log("🔄 [Startup] Auto-replicating schema and master data from Remote Cloud DB...");
      await syncSchemaFromRemoteToLocal(pool);

      // 3. Run schema check and POS-specific additions/indexes
      await initDB(pool);

      // 4. Safe one-time migration: Fix any active tables with NULL StartTime
      try {
        await pool.request().query(`
          IF OBJECT_ID('TableMaster', 'U') IS NOT NULL
          BEGIN
            UPDATE TableMaster SET StartTime = GETDATE() WHERE StartTime IS NULL AND Status IN (1, 2, 3, 4);
          END
        `);
      } catch (tableErr) {
        console.warn("⚠️ Could not update TableMaster start times:", tableErr.message);
      }
      console.log("✅ Local Database initialized and ready.");
    }
    // Start Hybrid Offline & Online Database Sync Worker (syncs every 5s)
    startSyncWorker(5000);

    // 🚀 Start real-time table & menu pollers now that DB is fully ready
    setTimeout(pollTables, 1000);
    setTimeout(pollMenuPublishStatus, 2000);
  } catch (err) {
    console.error("⚠️ Initial DB setup failed:", err.message);
    startSyncWorker(5000);
    setTimeout(pollTables, 5000);
    setTimeout(pollMenuPublishStatus, 5000);
  }

  // 🔄 KITCHEN AUTO-SYNC: Detect new kitchens from backoffice every 3 minutes
  // This ensures any kitchen added in the backoffice automatically appears
  // in PrintMaster (smart kitchen routing) without needing a server restart.
  setInterval(async () => {
    try {
      const pool = await poolPromise;
      if (pool && pool.connected) {
        await syncKitchensToPrintMaster(pool);
      }
    } catch (err) {
      console.error("❌ [KitchenSync Interval] Error:", err.message);
    }
  }, 3 * 60 * 1000); // Every 3 minutes
  console.log("🍳 [KitchenSync] Background auto-sync started (every 3 minutes).");

  // 🔄 PRINT QUEUE CLEANUP: Reset stuck 'PROCESSING' jobs to 'PENDING' every 60 seconds
  setInterval(async () => {
    try {
      const pool = await poolPromise;
      if (pool && pool.connected) {
        const result = await pool.request().query(`
          UPDATE PrintJobQueue
          SET Status = 'PENDING', ProcessedOn = NULL, Attempts = 0
          WHERE Status = 'PROCESSING' AND DATEDIFF(minute, ProcessedOn, GETDATE()) >= 3
        `);
        if (result.rowsAffected[0] > 0) {
          console.log(`🧹 [PrintQueue Cleanup] Reset ${result.rowsAffected[0]} stuck print jobs back to PENDING.`);
          // Notify the print bridge client that jobs are available to print
          io.emit("print_jobs_available", { storeId: "STORE_001" });
        }
      }
    } catch (err) {
      console.error("❌ [PrintQueue Cleanup] Error resetting stuck jobs:", err.message);
    }
  }, 60 * 1000); // Every 60 seconds
  console.log("🧹 [PrintQueue Cleanup] Background watchdog started (every 60 seconds).");
});

// Register global exception handlers for transaction cleanup
process.on("uncaughtException", async (err) => {
  console.error("🔥 [Fatal] Uncaught Exception occurred:", err);
  try {
    await rollbackAllActive();
  } catch (cleanErr) {
    console.error("⚠️ Failed to clean up transactions during uncaughtException:", cleanErr);
  }
  process.exit(1);
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error("🔥 [Fatal] Unhandled Rejection at:", promise, "reason:", reason);
  try {
    await rollbackAllActive();
  } catch (cleanErr) {
    console.error("⚠️ Failed to clean up transactions during unhandledRejection:", cleanErr);
  }
});

// 🛑 Graceful Shutdown Handler
let isShuttingDown = false;
async function performGracefulShutdown(reason = "NORMAL") {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`🛑 [Shutdown] Received ${reason}. Performing controlled backend shutdown...`);

  // Stop accepting new HTTP requests
  if (typeof httpServer !== 'undefined' && httpServer) {
    httpServer.close(() => {
      console.log("🛑 [Shutdown] HTTP server closed to new requests.");
    });
  }

  // Rollback active transactions to protect database consistency
  try {
    await rollbackAllActive();
    console.log("🛑 [Shutdown] Active transactions rolled back safely.");
  } catch (err) {
    console.error("⚠️ [Shutdown] Error rolling back transactions:", err.message);
  }

  // Close database pools
  try {
    const pool = await poolPromise;
    if (pool && pool.connected) {
      await pool.close();
      console.log("🛑 [Shutdown] Database connection pool closed.");
    }
  } catch (err) {
    console.error("⚠️ [Shutdown] Error closing database pool:", err.message);
  }

  console.log("🛑 [Shutdown] Backend shutdown complete.");
  process.exit(0);
}

// Endpoint for Electron main process to trigger graceful shutdown
app.post("/api/admin/shutdown", async (req, res) => {
  res.json({ success: true, message: "Graceful shutdown sequence initiated" });
  setTimeout(() => {
    performGracefulShutdown("ELECTRON_IPC");
  }, 300);
});

process.on("SIGTERM", () => performGracefulShutdown("SIGTERM"));
process.on("SIGINT", () => performGracefulShutdown("SIGINT"));


