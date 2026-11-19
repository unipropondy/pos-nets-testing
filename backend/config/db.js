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
    connectTimeout: 30000, 
    requestTimeout: 30000,
    appName: "POS_System_RemoteSync",
    keepAlive: true
  },
  connectionTimeout: 30000,
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
let isLocalConnected = false;
let isLocalReconnecting = false;
let localSupervisorTimer = null;
let localHealthInterval = null;
let currentLocalRetryDelay = 2000;
let lastLocalError = null;
let lastLocalHealthyCheckTime = null;
let onLocalReconnectedCallbacks = [];
let isShuttingDownPools = false;

let remotePoolInstance = null;
let isRemoteConnected = false;
let inFlightRemoteConnectPromise = null;
let supervisorTimer = null;
let remoteHealthInterval = null;
let currentRetryDelay = 5000;
let lastRemoteError = null;
let lastHealthyCheckTime = null;
let onRemoteReconnectedCallbacks = [];

// Authoritative bounded DNS Cache for Remote Database Host (TTL: 60s matching DynDNS authoritative TTL, bounded fallback 180s)
const dns = require("dns");
let cachedRemoteHost = null;
let cachedRemoteIp = null;
let lastDnsResolveTime = 0;
const DNS_CACHE_TTL_MS = 60000; // 60 seconds (Authoritative TTL)
const DNS_MAX_FALLBACK_TTL_MS = 180000; // 180 seconds maximum fallback window for transient outages

/**
 * Resolves remote hostname with bounded caching adhering strictly to authoritative TTL
 */
function resolveRemoteHost(hostname, maxRetries = 2) {
  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1" || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return Promise.resolve(hostname);
  }

  const now = Date.now();
  // Valid active cache check within authoritative TTL
  if (cachedRemoteHost === hostname && cachedRemoteIp && (now - lastDnsResolveTime < DNS_CACHE_TTL_MS)) {
    return Promise.resolve(cachedRemoteIp);
  }

  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryLookup = () => {
      attempt++;
      dns.lookup(hostname, { family: 4 }, (err, address) => {
        if (!err && address) {
          cachedRemoteHost = hostname;
          cachedRemoteIp = address;
          lastDnsResolveTime = Date.now();
          return resolve(address);
        }

        // If lookup fails due to transient drop, use cached IP ONLY if within safe bounded fallback window (180s)
        const age = Date.now() - lastDnsResolveTime;
        if (cachedRemoteHost === hostname && cachedRemoteIp && age < DNS_MAX_FALLBACK_TTL_MS) {
          console.warn(`⚠️ [DNS Cache] Transient lookup failure for ${hostname}. Using safe bounded fallback IP (${(age / 1000).toFixed(0)}s old): ${cachedRemoteIp}`);
          return resolve(cachedRemoteIp);
        }

        if (attempt < maxRetries) {
          setTimeout(tryLookup, 500);
        } else {
          // Beyond fallback window, clear stale cache to prevent permanent stale IP retention
          cachedRemoteIp = null;
          lastDnsResolveTime = 0;
          reject(err || new Error(`Authoritative DNS resolution failed for ${hostname}`));
        }
      });
    };
    tryLookup();
  });
}

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

/**
 * Safely disposes and cleans up an existing local pool instance
 */
async function disposeLocalPool(poolToDispose) {
  const target = poolToDispose || localPoolInstance;
  if (!target) return;
  try {
    target.removeAllListeners("error");
    await target.close();
  } catch (_) {}
  if (target === localPoolInstance) {
    localPoolInstance = null;
  }
}

/**
 * Marks local DB as offline, disposes pool, and schedules reconnection supervisor
 */
function handleLocalDisconnect(reason = "Local DB connection lost") {
  if (isShuttingDownPools) return;
  const wasOnline = isLocalConnected;
  isLocalConnected = false;
  lastLocalError = reason;

  if (wasOnline) {
    console.warn(`⚠️ [Local DB Supervisor] Local connection lost: ${reason}`);
  }

  if (localPoolInstance) {
    const stale = localPoolInstance;
    localPoolInstance = null;
    disposeLocalPool(stale).catch(() => {});
  }

  scheduleLocalReconnect();
}

/**
 * Connects or reconnects to Local SQL Server with verification
 */
async function connectLocal(isInitial = false) {
  if (isShuttingDownPools) return null;

  // If pool exists and is connected, verify with quick health check
  if (localPoolInstance && localPoolInstance.connected && isLocalConnected) {
    try {
      await localPoolInstance.request().query("SELECT 1 AS localHealth");
      lastLocalHealthyCheckTime = new Date();
      return localPoolInstance;
    } catch (err) {
      handleLocalDisconnect(err.message);
    }
  }

  // Prevent concurrent connection attempts
  if (isLocalReconnecting) {
    return null;
  }

  isLocalReconnecting = true;
  console.log(`🔌 [Local DB Supervisor] Attempting connection to ${localDbConfig.server}:${displayLocalPort}...`);

  // Ensure database exists if master accessible
  if (isInitial) {
    await ensureLocalDatabaseExists().catch(() => {});
  }

  // Safely dispose old pool before allocating new one
  if (localPoolInstance) {
    await disposeLocalPool(localPoolInstance);
  }

  let newPool = null;
  try {
    newPool = new sql.ConnectionPool(localDbConfig);
    newPool.on("error", (err) => {
      console.error("⚠️ [Local DB Pool Error]:", err.message);
      handleLocalDisconnect(err.message);
    });

    await newPool.connect();
    console.log("✅ [Local DB Supervisor] SQL connection established.");

    // Verify query execution via SELECT 1
    await newPool.request().query("SELECT 1 AS healthCheck");
    console.log("✅ [Local DB Supervisor] SELECT 1 health check successful.");

    localPoolInstance = newPool;
    isLocalConnected = true;
    lastLocalError = null;
    lastLocalHealthyCheckTime = new Date();
    currentLocalRetryDelay = 2000; // Reset backoff
    console.log("✅ [Local DB Supervisor] Local DB status: ONLINE.");

    try {
      const { ensureEssentialLocalViews } = require("../services/autoProvisionLocalDb");
      ensureEssentialLocalViews(newPool);
    } catch (_) {}

    notifyLocalReconnected(newPool);
    return newPool;
  } catch (err) {
    lastLocalError = err.message;
    console.warn(`❌ [Local DB Supervisor] Local connection failed: ${err.message}`);
    isLocalConnected = false;
    if (newPool) {
      await disposeLocalPool(newPool);
    }
    localPoolInstance = null;
    scheduleLocalReconnect();
    return null;
  } finally {
    isLocalReconnecting = false;
  }
}

/**
 * Schedules the next local reconnection attempt with bounded jittered exponential backoff
 */
function scheduleLocalReconnect() {
  if (isShuttingDownPools) return;
  if (localSupervisorTimer) return; // Timer already active

  // Exponential backoff: 2s, 4s, 8s, 16s, max 30s
  const baseDelay = currentLocalRetryDelay;
  const jitter = Math.floor(Math.random() * 1000);
  const nextDelay = Math.min(30000, baseDelay + jitter);

  console.log(`🔌 [Local DB Supervisor] Next local retry in ${(nextDelay / 1000).toFixed(1)} seconds.`);

  localSupervisorTimer = setTimeout(async () => {
    localSupervisorTimer = null;
    currentLocalRetryDelay = Math.min(30000, currentLocalRetryDelay * 2);
    try {
      await connectLocal();
    } catch (_) {}
  }, nextDelay);
}

function onLocalReconnected(fn) {
  if (typeof fn === "function") {
    onLocalReconnectedCallbacks.push(fn);
  }
}

function notifyLocalReconnected(pool) {
  for (const cb of onLocalReconnectedCallbacks) {
    try {
      cb(pool);
    } catch (err) {
      console.error("⚠️ [Local DB Supervisor] Error executing reconnect callback:", err.message);
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
        handleLocalDisconnect(err.message);
      });
      await pool.request().query("SELECT 1 AS healthCheck");
      localPoolInstance = pool;
      isLocalConnected = true;
      lastLocalError = null;
      lastLocalHealthyCheckTime = new Date();
      currentLocalRetryDelay = 2000;
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
        console.error("❌ All local database connection attempts failed. Supervisor will continue retrying in background.");
        handleLocalDisconnect(err.message);
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
 * Connects or reconnects to Remote Cloud DB with SQL verification and shared in-flight Promise
 */
function connectRemote() {
  if (!remoteDbConfig) return Promise.resolve(null);

  // If pool exists and is connected, verify with quick health check
  if (remotePoolInstance && remotePoolInstance.connected && isRemoteConnected) {
    return remotePoolInstance.request().query("SELECT 1 AS health")
      .then(() => {
        lastHealthyCheckTime = new Date();
        return remotePoolInstance;
      })
      .catch((err) => {
        handleRemoteDisconnect(err.message);
        return performConnectRemote();
      });
  }

  // If another connection attempt is already in-flight, return the shared Promise
  if (inFlightRemoteConnectPromise) {
    return inFlightRemoteConnectPromise;
  }

  inFlightRemoteConnectPromise = performConnectRemote()
    .finally(() => {
      inFlightRemoteConnectPromise = null;
    });

  return inFlightRemoteConnectPromise;
}

async function performConnectRemote() {
  console.log(`[Remote DB Supervisor] Attempting reconnection to ${remoteDbConfig.server}:${remoteDbConfig.port}...`);

  // Resolve hostname with bounded DNS caching (resilient to transient public DNS drops)
  let targetServer = remoteDbConfig.server;
  let serverNameOption = undefined;
  try {
    const resolvedIp = await resolveRemoteHost(remoteDbConfig.server);
    if (resolvedIp && resolvedIp !== remoteDbConfig.server) {
      targetServer = resolvedIp;
      serverNameOption = remoteDbConfig.server;
    }
  } catch (dnsErr) {
    console.warn(`⚠️ [Remote DB DNS] Resolution warning: ${dnsErr.message}. Attempting direct server address.`);
  }

  // Construct active dynamic configuration
  const activeRemoteConfig = {
    ...remoteDbConfig,
    server: targetServer,
    options: {
      ...remoteDbConfig.options,
      ...(serverNameOption ? { serverName: serverNameOption } : {})
    }
  };

  // Safely dispose old pool before allocating new one
  if (remotePoolInstance) {
    await disposeRemotePool(remotePoolInstance);
  }

  let newPool = null;
  try {
    newPool = new sql.ConnectionPool(activeRemoteConfig);
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

// Local supervisor background monitor: periodic check to verify connection if idle
localHealthInterval = setInterval(async () => {
  if (isShuttingDownPools) return;
  if (!isLocalConnected || !localPoolInstance || !localPoolInstance.connected) {
    if (!localSupervisorTimer && !isLocalReconnecting) {
      scheduleLocalReconnect();
    }
  } else {
    // Health probe every 15s if connected
    try {
      await localPoolInstance.request().query("SELECT 1 AS localProbe");
      lastLocalHealthyCheckTime = new Date();
    } catch (err) {
      handleLocalDisconnect(`Health probe failed: ${err.message}`);
    }
  }
}, 15000);

// Remote supervisor background monitor: periodic check to verify connection if idle
remoteHealthInterval = setInterval(async () => {
  if (isShuttingDownPools) return;
  if (!remoteDbConfig) return;
  if (!isRemoteConnected || !remotePoolInstance || !remotePoolInstance.connected) {
    if (!supervisorTimer && !inFlightRemoteConnectPromise) {
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

/**
 * Cleanly stops all supervisor timers and intervals during shutdown
 */
function stopDatabaseSupervisors() {
  isShuttingDownPools = true;
  if (localSupervisorTimer) {
    clearTimeout(localSupervisorTimer);
    localSupervisorTimer = null;
  }
  if (localHealthInterval) {
    clearInterval(localHealthInterval);
    localHealthInterval = null;
  }
  if (supervisorTimer) {
    clearTimeout(supervisorTimer);
    supervisorTimer = null;
  }
  if (remoteHealthInterval) {
    clearInterval(remoteHealthInterval);
    remoteHealthInterval = null;
  }
  console.log("🛑 [DB Supervisors] All database reconnection timers and intervals stopped.");
}

const initialLocalPromise = connectLocalWithRetry(3, 2000);

const poolPromise = {
  then: function(onFulfilled, onRejected) {
    if (localPoolInstance && localPoolInstance.connected) {
      return Promise.resolve(localPoolInstance).then(onFulfilled, onRejected);
    }
    return initialLocalPromise.then((p) => {
      if (p && p.connected) return p;
      if (localPoolInstance && localPoolInstance.connected) return localPoolInstance;
      return null;
    }).then(onFulfilled, onRejected);
  },
  catch: function(onRejected) {
    return this.then(null, onRejected);
  }
};

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
    connectLocal,
    connectRemote,
    isLocalOnline: () => isLocalConnected && localPoolInstance && localPoolInstance.connected,
    isRemoteOnline: () => isRemoteConnected && remotePoolInstance && remotePoolInstance.connected,
    onLocalReconnected,
    onRemoteReconnected,
    handleLocalDisconnect,
    handleRemoteDisconnect,
    stopDatabaseSupervisors,
    getLocalSupervisorStatus: () => ({
      isOnline: isLocalConnected && localPoolInstance && localPoolInstance.connected,
      isReconnecting: isLocalReconnecting,
      lastError: lastLocalError,
      lastHealthyCheck: lastLocalHealthyCheckTime ? lastLocalHealthyCheckTime.toISOString() : null,
      server: `${localDbConfig.server}:${displayLocalPort} (${localDbConfig.database})`
    }),
    getRemoteSupervisorStatus: () => ({
      isConfigured: !!remoteDbConfig,
      isOnline: isRemoteConnected && remotePoolInstance && remotePoolInstance.connected,
      isReconnecting: !!inFlightRemoteConnectPromise,
      lastError: lastRemoteError,
      lastHealthyCheck: lastHealthyCheckTime ? lastHealthyCheckTime.toISOString() : null,
      server: remoteDbConfig ? `${remoteDbConfig.server}:${remoteDbConfig.port}` : null
    })
};
