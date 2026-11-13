const path = require("path");
const fs = require("fs");
const plainEnvPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(plainEnvPath)) {
  require("dotenv").config({ path: plainEnvPath });
}
const sql = require("mssql"); 

// --- Local Database Config (Primary for fast offline & online operations) ---
let rawLocalServer = process.env.LOCAL_DB_SERVER || "127.0.0.1";
let localServerHost = rawLocalServer;
let localInstanceName = undefined;

if (rawLocalServer.includes("\\")) {
  const parts = rawLocalServer.split("\\");
  localServerHost = (parts[0] || "127.0.0.1").replace(/:$/, "").trim();
  localInstanceName = (parts[1] || "").trim();
}

const localDbConfig = {
  user: process.env.LOCAL_DB_USER || process.env.DB_USER,
  password: process.env.LOCAL_DB_PASSWORD || process.env.DB_PASSWORD,
  server: localServerHost,
  ...(localInstanceName ? {} : { port: parseInt(process.env.LOCAL_DB_PORT || process.env.DB_PORT || "1433") }),
  database: process.env.LOCAL_DB_NAME || process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    connectTimeout: 3000, 
    requestTimeout: 30000,
    appName: "POS_System_Local",
    keepAlive: true,
    ...(localInstanceName ? { instanceName: localInstanceName } : {})
  },
  connectionTimeout: 3000,
  requestTimeout: 30000,
  pool: {
    max: 100,
    min: 0,
    idleTimeoutMillis: 15000
  }
};

// --- Remote Database Config (Cloud / Central Server for sync) ---
const remoteDbServer = process.env.REMOTE_DB_SERVER || (process.env.LOCAL_DB_SERVER ? process.env.DB_SERVER : null);
const remoteDbConfig = remoteDbServer ? {
  user: process.env.REMOTE_DB_USER || process.env.DB_USER,
  password: process.env.REMOTE_DB_PASSWORD || process.env.DB_PASSWORD,
  server: remoteDbServer,
  port: parseInt(process.env.REMOTE_DB_PORT || process.env.DB_PORT || "1433"),
  database: process.env.REMOTE_DB_NAME || process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    connectTimeout: 15000, 
    requestTimeout: 30000,
    appName: "POS_System_RemoteSync",
    keepAlive: true
  },
  connectionTimeout: 15000,
  requestTimeout: 30000,
  pool: {
    max: 50,
    min: 0,
    idleTimeoutMillis: 30000
  }
} : null;

const displayLocalPort = localDbConfig.port || (localInstanceName ? `\\${localInstanceName}` : "1433");
console.log("📋 [Hybrid DB Architecture Configuration]:");
console.log(`   Local DB  : ${localDbConfig.server}:${displayLocalPort} (${localDbConfig.database})`);
if (remoteDbConfig) {
  console.log(`   Remote DB : ${remoteDbConfig.server}:${remoteDbConfig.port} (${remoteDbConfig.database})`);
} else {
  console.log(`   Remote DB : Not configured (Operating in Local standalone mode)`);
}

let localPoolInstance = null;
let remotePoolInstance = null;
let isRemoteConnected = false;
let isReconnecting = false;
let supervisorTimer = null;
let currentRetryDelay = 5000;
let lastRemoteError = null;
let lastHealthyCheckTime = null;
let onRemoteReconnectedCallbacks = [];

// Step 0: Ensure target database exists on Local SQL Server before connecting
async function ensureLocalDatabaseExists() {
  const masterConfig = {
    user: localDbConfig.user,
    password: localDbConfig.password,
    server: localServerHost,
    ...(localInstanceName ? {} : { port: localDbConfig.port || 1433 }),
    database: "master",
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
      connectTimeout: 5000,
      ...(localInstanceName ? { instanceName: localInstanceName } : {})
    }
  };

  const targetDbName = localDbConfig.database || "UCSPONDY_HYBRID";
  let masterPool = null;
  try {
    masterPool = await new sql.ConnectionPool(masterConfig).connect();
    const checkDbResult = await masterPool.request()
      .input("DbName", sql.NVarChar, targetDbName)
      .query(`SELECT database_id FROM sys.databases WHERE name = @DbName`);

    if (checkDbResult.recordset.length === 0) {
      console.log(`✨ [Auto-Provision] Database '${targetDbName}' NOT found on Local SQL Server! Creating database automatically...`);
      await masterPool.request().query(`CREATE DATABASE [${targetDbName}]`);
      console.log(`✅ [Auto-Provision] Local database '${targetDbName}' created successfully!`);
    } else {
      console.log(`✅ [Auto-Provision] Local database '${targetDbName}' already exists.`);
    }
  } catch (err) {
    console.warn(`⚠️ [Auto-Provision] Local database existence check on master:`, err.message);
  } finally {
    if (masterPool) {
      try { await masterPool.close(); } catch (_) {}
    }
  }
}

async function connectLocalWithRetry(retries = 3, delay = 2000) {
  // Ensure local database exists before attempting login
  await ensureLocalDatabaseExists().catch(() => {});

  for (let i = 0; i < retries; i++) {
    try {
      console.log(`🔌 [Local DB] Connecting to ${localDbConfig.server}:${displayLocalPort}... (Attempt ${i + 1}/${retries})`);
      const pool = await new sql.ConnectionPool(localDbConfig).connect();
      console.log("✅ [Local DB] Connected Successfully");
      pool.on("error", (err) => {
        console.error("⚠️ [Local DB Pool Error]:", err.message);
      });
      localPoolInstance = pool;
      try {
        const { ensureEssentialLocalViews } = require("../services/autoProvisionLocalDb");
        ensureEssentialLocalViews(pool);
      } catch (_) {}
      return pool;
    } catch (err) {
      console.error(`❌ [Local DB Connection Attempt ${i + 1} Failed]:`, err.message);
      if (i < retries - 1) {
        console.log(`⏳ Retrying local database connection in ${delay / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.error("❌ All local database connection attempts failed.");
        return null;
      }
    }
  }
  return null;
}

/**
 * Safely disposes and cleans up an existing remote pool instance
 */
async function disposeRemotePool(poolToDispose) {
  const target = poolToDispose || remotePoolInstance;
  if (!target) return;
  try {
    target.removeAllListeners("error");
    await target.close();
  } catch (_) {}
  if (target === remotePoolInstance) {
    remotePoolInstance = null;
  }
}

/**
 * Marks remote DB as offline, disposes pool, and schedules reconnection supervisor
 */
function handleRemoteDisconnect(reason = "Connection lost") {
  const wasOnline = isRemoteConnected;
  isRemoteConnected = false;
  lastRemoteError = reason;
  
  if (wasOnline) {
    console.warn(`[Remote DB Supervisor] Remote connection lost: ${reason}`);
  }
  
  if (remotePoolInstance) {
    const stale = remotePoolInstance;
    remotePoolInstance = null;
    disposeRemotePool(stale).catch(() => {});
  }

  scheduleRemoteReconnect();
}

/**
 * Connects or reconnects to Remote Cloud DB with SQL verification
 */
async function connectRemote() {
  if (!remoteDbConfig) return null;

  // If pool exists and is connected, verify with quick health check
  if (remotePoolInstance && remotePoolInstance.connected && isRemoteConnected) {
    try {
      await remotePoolInstance.request().query("SELECT 1 AS health");
      lastHealthyCheckTime = new Date();
      return remotePoolInstance;
    } catch (err) {
      handleRemoteDisconnect(err.message);
    }
  }

  // Prevent concurrent connection attempts
  if (isReconnecting) {
    return null;
  }

  isReconnecting = true;
  console.log(`[Remote DB Supervisor] Attempting reconnection to ${remoteDbConfig.server}:${remoteDbConfig.port}...`);

  // Safely dispose old pool before allocating new one
  if (remotePoolInstance) {
    await disposeRemotePool(remotePoolInstance);
  }

  let newPool = null;
  try {
    newPool = new sql.ConnectionPool(remoteDbConfig);
    newPool.on("error", (err) => {
      console.error("⚠️ [Remote Cloud DB Pool Error]:", err.message);
      handleRemoteDisconnect(err.message);
    });

    await newPool.connect();
    console.log("[Remote DB Supervisor] SQL connection established.");

    // Verify authentication and query execution via SELECT 1
    await newPool.request().query("SELECT 1 AS healthCheck");
    console.log("[Remote DB Supervisor] SELECT 1 health check successful.");

    remotePoolInstance = newPool;
    isRemoteConnected = true;
    lastRemoteError = null;
    lastHealthyCheckTime = new Date();
    currentRetryDelay = 5000; // Reset backoff
    console.log("[Remote DB Supervisor] Remote DB status: ONLINE.");

    // Notify registered listeners (e.g. Sync Engine)
    notifyRemoteReconnected(newPool);

    return newPool;
  } catch (err) {
    lastRemoteError = err.message;
    console.warn(`[Remote DB Supervisor] Remote connection failed: ${err.message} (${err.code || "ERR_DB_OFFLINE"})`);
    isRemoteConnected = false;
    if (newPool) {
      await disposeRemotePool(newPool);
    }
    remotePoolInstance = null;
    scheduleRemoteReconnect();
    return null;
  } finally {
    isReconnecting = false;
  }
}

/**
 * Schedules the next reconnection attempt with bounded exponential backoff & jitter
 */
function scheduleRemoteReconnect() {
  if (supervisorTimer) return; // Timer already active
  if (!remoteDbConfig) return;

  // Exponential backoff: 5s, 10s, 20s, 40s, max 60s
  const baseDelay = currentRetryDelay;
  const jitter = Math.floor(Math.random() * 1500);
  const nextDelay = Math.min(60000, baseDelay + jitter);

  console.log(`[Remote DB Supervisor] Next retry in ${(nextDelay / 1000).toFixed(1)} seconds.`);

  supervisorTimer = setTimeout(async () => {
    supervisorTimer = null;
    // Step up backoff for next round
    currentRetryDelay = Math.min(60000, currentRetryDelay * 2);
    try {
      await connectRemote();
    } catch (_) {}
  }, nextDelay);
}

/**
 * Register callback to be called whenever Remote DB transitions to ONLINE
 */
function onRemoteReconnected(fn) {
  if (typeof fn === "function") {
    onRemoteReconnectedCallbacks.push(fn);
  }
}

function notifyRemoteReconnected(pool) {
  for (const cb of onRemoteReconnectedCallbacks) {
    try {
      cb(pool);
    } catch (err) {
      console.error("⚠️ [Remote DB Supervisor] Error executing reconnect callback:", err.message);
    }
  }
}

// Supervisor background monitor: periodic check to verify connection if idle
setInterval(async () => {
  if (!remoteDbConfig) return;
  if (!isRemoteConnected || !remotePoolInstance || !remotePoolInstance.connected) {
    if (!supervisorTimer && !isReconnecting) {
      scheduleRemoteReconnect();
    }
  } else {
    // Health probe every 60s if connected
    try {
      await remotePoolInstance.request().query("SELECT 1 AS probe");
      lastHealthyCheckTime = new Date();
    } catch (err) {
      handleRemoteDisconnect(`Health probe failed: ${err.message}`);
    }
  }
}, 30000);

const poolPromise = (async () => {
  const localPool = await connectLocalWithRetry(3, 2000);
  if (localPool && localPool.connected) {
    return localPool;
  }
  console.warn("⚠️ [Local DB Warning] Local database could not connect initially. Local operations will retry connecting to local DB.");
  return localPoolInstance;
})();

module.exports = { 
    sql, 
    poolPromise, 
    // Always returns a dynamic promise connecting to remote
    remotePoolPromise: () => connectRemote(),
    dbConfig: localDbConfig,
    remoteDbConfig,
    ensureLocalDatabaseExists,
    // POS application always uses Local SQL Server
    getPool: () => (localPoolInstance && localPoolInstance.connected) ? localPoolInstance : null,
    // Remote Cloud DB is strictly used only by the background sync service
    getRemotePool: () => (remotePoolInstance && remotePoolInstance.connected && isRemoteConnected) ? remotePoolInstance : null,
    connectRemote,
    isRemoteOnline: () => isRemoteConnected && remotePoolInstance && remotePoolInstance.connected,
    onRemoteReconnected,
    handleRemoteDisconnect,
    getRemoteSupervisorStatus: () => ({
      isConfigured: !!remoteDbConfig,
      isOnline: isRemoteConnected && remotePoolInstance && remotePoolInstance.connected,
      isReconnecting,
      lastError: lastRemoteError,
      lastHealthyCheck: lastHealthyCheckTime ? lastHealthyCheckTime.toISOString() : null,
      server: remoteDbConfig ? `${remoteDbConfig.server}:${remoteDbConfig.port}` : null
    })
};
