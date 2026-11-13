const { getPool, getRemotePool, isRemoteOnline, connectRemote, onRemoteReconnected, getRemoteSupervisorStatus, sql } = require("../config/db");

let isSyncing = false;
let syncIntervalObj = null;
let lastSyncTime = null;
let syncStats = {
  pendingCount: 0,
  lastSyncStatus: "IDLE",
  lastError: null,
  totalSynced: 0
};

// Ensure POS_SyncQueue table exists in Local Database
async function initSyncQueue() {
  const localPool = getPool();
  if (!localPool) return;
  try {
    await localPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[POS_SyncQueue]') AND type in (N'U'))
      BEGIN
          CREATE TABLE [dbo].[POS_SyncQueue](
              [SyncID] [bigint] IDENTITY(1,1) PRIMARY KEY,
              [EntityName] [nvarchar](100) NOT NULL,
              [EntityID] [nvarchar](255) NOT NULL,
              [Action] [nvarchar](50) NOT NULL,
              [Payload] [nvarchar](max) NOT NULL,
              [Status] [nvarchar](50) DEFAULT 'PENDING',
              [Retries] [int] DEFAULT 0,
              [ErrorMessage] [nvarchar](max) NULL,
              [CreatedAt] [datetime] DEFAULT GETDATE(),
              [SyncedAt] [datetime] NULL
          );
          CREATE INDEX IX_POS_SyncQueue_Status ON [dbo].[POS_SyncQueue]([Status]);
      END
    `);
    console.log("✅ [Sync Engine] Sync queue initialized successfully.");
  } catch (err) {
    console.error("❌ [Sync Engine] Failed to initialize sync queue:", err.message);
  }
}

// Enqueue item to local sync queue
async function enqueueSync(entityName, entityID, action, payloadData) {
  const localPool = getPool();
  if (!localPool) return false;
  try {
    const payloadStr = typeof payloadData === 'string' ? payloadData : JSON.stringify(payloadData);
    await localPool.request()
      .input("EntityName", sql.NVarChar, entityName)
      .input("EntityID", sql.NVarChar, String(entityID))
      .input("Action", sql.NVarChar, action)
      .input("Payload", sql.NVarChar, payloadStr)
      .query(`
        INSERT INTO POS_SyncQueue (EntityName, EntityID, Action, Payload, Status, CreatedAt)
        VALUES (@EntityName, @EntityID, @Action, @Payload, 'PENDING', GETDATE())
      `);
    syncStats.pendingCount++;
    // Immediately attempt sync process if online
    triggerSyncProcess();
    return true;
  } catch (err) {
    console.error(`❌ [Sync Engine] Error enqueuing ${entityName} (${entityID}):`, err.message);
    return false;
  }
}

// Core Sync Processor function
async function triggerSyncProcess() {
  if (isSyncing) return;
  isSyncing = true;

  try {
    let remotePool = getRemotePool();
    if (!isRemoteOnline()) {
      remotePool = await connectRemote();
    }

    if (!remotePool || !isRemoteOnline()) {
      syncStats.lastSyncStatus = "OFFLINE";
      isSyncing = false;
      return;
    }

    const localPool = getPool();
    if (!localPool) {
      isSyncing = false;
      return;
    }

    // 0. Push all Sales, Settlements, Day End, Reports, Members & Credit to Remote DB
    try {
      const { pushAllSalesAndOperationalToRemote } = require("./salesPushService");
      await pushAllSalesAndOperationalToRemote(localPool, remotePool);
    } catch (pushErr) {
      console.warn("⚠️ [Sync Engine] Sales push warning:", pushErr.message);
    }

    // 0B. Perform 2-Way Operational & Cart Sync (Local DB <-> Remote DB)
    try {
      const { syncOperationalStateFromRemote } = require("./autoProvisionLocalDb");
      await syncOperationalStateFromRemote(remotePool, localPool);
    } catch (opErr) {
      console.warn("⚠️ [Sync Engine] Operational state 2-way sync warning:", opErr.message);
    }

    // 1. Fetch PENDING items from Local POS_SyncQueue
    const pendingItemsResult = await localPool.request().query(`
      SELECT TOP 50 SyncID, EntityName, EntityID, Action, Payload, Retries
      FROM POS_SyncQueue
      WHERE Status IN ('PENDING', 'FAILED') AND Retries < 5
      ORDER BY SyncID ASC
    `);

    const pendingItems = pendingItemsResult.recordset;
    syncStats.pendingCount = pendingItems.length;

    if (pendingItems.length === 0) {
      syncStats.lastSyncStatus = "SYNCED";
      lastSyncTime = new Date();
      isSyncing = false;
      return;
    }

    console.log(`🔄 [Sync Engine] Syncing ${pendingItems.length} queued items to Remote Database...`);
    syncStats.lastSyncStatus = "SYNCING";

    for (const item of pendingItems) {
      try {
        const data = JSON.parse(item.Payload);
        const success = await syncSingleItemToRemote(remotePool, item.EntityName, item.Action, data);

        if (success) {
          await localPool.request()
            .input("SyncID", sql.BigInt, item.SyncID)
            .query(`
              UPDATE POS_SyncQueue
              SET Status = 'SYNCED', SyncedAt = GETDATE(), ErrorMessage = NULL
              WHERE SyncID = @SyncID
            `);
          syncStats.totalSynced++;
        } else {
          throw new Error("Sync execution returned false");
        }
      } catch (itemErr) {
        console.warn(`⚠️ [Sync Engine] Item ${item.SyncID} (${item.EntityName}) failed:`, itemErr.message);
        await localPool.request()
          .input("SyncID", sql.BigInt, item.SyncID)
          .input("ErrMsg", sql.NVarChar, itemErr.message)
          .query(`
            UPDATE POS_SyncQueue
            SET Status = 'FAILED', Retries = Retries + 1, ErrorMessage = @ErrMsg
            WHERE SyncID = @SyncID
          `);
        syncStats.lastError = itemErr.message;
      }
    }

    // Refresh pending count
    const countRes = await localPool.request().query(`
      SELECT COUNT(*) AS PendingCount FROM POS_SyncQueue WHERE Status = 'PENDING'
    `);
    syncStats.pendingCount = countRes.recordset[0].PendingCount || 0;
    syncStats.lastSyncStatus = syncStats.pendingCount === 0 ? "SYNCED" : "PENDING";
    lastSyncTime = new Date();
  } catch (err) {
    console.error("❌ [Sync Engine] Process error:", err.message);
    syncStats.lastSyncStatus = "ERROR";
    syncStats.lastError = err.message;
  } finally {
    isSyncing = false;
  }
}

// Sync execution router to remote database
async function syncSingleItemToRemote(remotePool, entityName, action, data) {
  if (!remotePool) return false;
  
  if (entityName === 'SettlementHeader') {
    const req = remotePool.request();
    req.input("SettlementID", sql.UniqueIdentifier, data.SettlementID);
    req.input("OrderNo", sql.NVarChar, data.OrderNo);
    req.input("TotalAmount", sql.Decimal(18, 2), data.TotalAmount);
    req.input("PaymentMode", sql.NVarChar, data.PaymentMode);
    req.input("CreatedOn", sql.DateTime, data.CreatedOn ? new Date(data.CreatedOn) : new Date());

    await req.query(`
      IF NOT EXISTS (SELECT 1 FROM SettlementHeader WHERE SettlementID = @SettlementID OR OrderNo = @OrderNo)
      BEGIN
        INSERT INTO SettlementHeader (SettlementID, OrderNo, TotalAmount, PaymentMode, CreatedOn)
        VALUES (@SettlementID, @OrderNo, @TotalAmount, @PaymentMode, @CreatedOn)
      END
    `);
    return true;
  }

  if (entityName === 'MemberMaster') {
    const req = remotePool.request();
    req.input("MemberId", sql.UniqueIdentifier, data.MemberId);
    req.input("Name", sql.NVarChar, data.Name);
    req.input("Phone", sql.NVarChar, data.Phone);
    req.input("Balance", sql.Decimal(18, 2), data.Balance);
    
    await req.query(`
      IF EXISTS (SELECT 1 FROM MemberMaster WHERE MemberId = @MemberId)
      BEGIN
        UPDATE MemberMaster SET Name = @Name, Phone = @Phone, Balance = @Balance WHERE MemberId = @MemberId
      END
      ELSE
      BEGIN
        INSERT INTO MemberMaster (MemberId, Name, Phone, Balance) VALUES (@MemberId, @Name, @Phone, @Balance)
      END
    `);
    return true;
  }

  if (entityName === 'TableState' || entityName === 'TableMasterUpdate') {
    const req = remotePool.request();
    req.input("tblNo", data.TableNumber);
    req.input("status", data.Status !== undefined ? data.Status : 0);
    req.input("startTime", data.StartTime ? new Date(data.StartTime) : null);
    req.input("totalAmt", data.TotalAmount || 0);
    req.input("currOrder", data.CurrentOrderId || null);
    req.input("custName", data.CustomerName || null);
    req.input("pax", data.Pax || null);
    req.input("lockedBy", data.LockedByName || null);
    req.input("entryStatus", data.entry_status || null);

    await req.query(`
      UPDATE TableMaster
      SET Status = @status,
          StartTime = @startTime,
          TotalAmount = @totalAmt,
          CurrentOrderId = @currOrder,
          CustomerName = @custName,
          Pax = @pax,
          LockedByName = @lockedBy,
          entry_status = @entryStatus,
          ModifiedOn = GETDATE()
      WHERE TableNumber = @tblNo
    `).catch(() => {});
    return true;
  }

  if (entityName === 'CartSync' || entityName === 'CartItems') {
    const req = remotePool.request();
    req.input("id", data.Id || data.id);
    req.input("cartId", data.CartId || data.cartId);
    req.input("payload", data.CartPayload || data.cartPayload || (typeof data.payload === 'object' ? JSON.stringify(data.payload) : data.payload));

    await req.query(`
      IF EXISTS (SELECT 1 FROM CartItems WHERE Id = @id OR CartId = @cartId)
        UPDATE CartItems SET CartId = @cartId, CartPayload = @payload, UpdatedAt = GETDATE() WHERE Id = @id OR CartId = @cartId;
      ELSE
        INSERT INTO CartItems (Id, CartId, CartPayload, UpdatedAt) VALUES (@id, @cartId, @payload, GETDATE());
    `).catch(() => {});
    return true;
  }

  // Master Table push handling (DishGroupMaster, DishMaster, ImageList, TableMaster, ComboGroupMaster, Paymode, MemberMaster, etc.)
  if (['DishGroupMaster', 'DishMaster', 'ImageList', 'TableMaster', 'ComboGroupMaster', 'ComboGroupDishMapping', 'ParentDishComboGroupMapping', 'ModifierMaster', 'DishModifier', 'DishGroupModifier', 'DishModifierGroup', 'CategoryMaster', 'Paymode', 'MemberMaster'].includes(entityName)) {
    const keys = Object.keys(data).filter(k => data[k] !== null && k !== 'rawSql');
    if (keys.length > 0) {
      const primaryKeyCol = keys[0]; // Primary column check
      const checkReq = remotePool.request();
      checkReq.input("pkVal", data[primaryKeyCol]);
      const existsRes = await checkReq.query(`SELECT 1 FROM [dbo].[${entityName}] WHERE [${primaryKeyCol}] = @pkVal`).catch(() => ({ recordset: [] }));
      
      if (!existsRes.recordset || existsRes.recordset.length === 0) {
        const colList = keys.map(k => `[${k}]`).join(", ");
        const req = remotePool.request();
        const valList = keys.map((k, idx) => {
          const paramName = `p_${idx}`;
          req.input(paramName, data[k]);
          return `@${paramName}`;
        }).join(", ");

        const insertSql = `
          SET IDENTITY_INSERT [dbo].[${entityName}] ON;
          INSERT INTO [dbo].[${entityName}] (${colList}) VALUES (${valList});
          SET IDENTITY_INSERT [dbo].[${entityName}] OFF;
        `;
        try {
          await req.query(insertSql);
        } catch (_) {
          const fallbackReq = remotePool.request();
          const fallbackValList = keys.map((k, idx) => {
            const paramName = `p_${idx}`;
            fallbackReq.input(paramName, data[k]);
            return `@${paramName}`;
          }).join(", ");
          await fallbackReq.query(`INSERT INTO [dbo].[${entityName}] (${colList}) VALUES (${fallbackValList});`).catch(() => {});
        }
      }
    }
    return true;
  }

  // Generic fallback query execution if script is passed
  if (data.rawSql) {
    await remotePool.request().query(data.rawSql);
    return true;
  }

  return true;
}

// Pull / Fetch latest Master Data (Dishes, Prices, Categories, Settings) from Remote DB -> Local DB
async function pullMasterDataFromRemote() {
  let remotePool = getRemotePool();
  if (!isRemoteOnline()) {
    remotePool = await connectRemote();
  }

  if (!remotePool || !isRemoteOnline()) {
    console.log("🟡 [Sync Engine] Remote DB is offline. Skipping 5-minute master data pull.");
    return false;
  }

  const localPool = getPool();
  if (!localPool) return false;

  console.log("📥 [Sync Engine] Running scheduled Master Catalog & Settings Pull from Remote DB -> Local DB...");

  try {
    const { syncMasterCatalog2Way } = require("./autoProvisionLocalDb");
    await syncMasterCatalog2Way(remotePool, localPool);
    console.log("✅ [Sync Engine] Scheduled Master Catalog & Settings Pull completed successfully.");
    return true;
  } catch (err) {
    console.warn("⚠️ [Sync Engine] Error during scheduled Master Catalog Pull:", err.message);
    return false;
  }
}

let pullIntervalObj = null;

// Register automatic reconnection listener to immediately resume sync when Remote DB comes back ONLINE
onRemoteReconnected(async (pool) => {
  console.log("[Sync Engine] Remote DB reconnected. Resuming pending synchronization...");
  try {
    // 1. Immediately trigger pending queue push
    await triggerSyncProcess();
    // 2. Perform a master catalog pull
    await pullMasterDataFromRemote();
  } catch (err) {
    console.error("⚠️ [Sync Engine] Error during reconnect auto-sync:", err.message);
  }
});

// Start periodic heartbeat & sync worker
function startSyncWorker(pushIntervalMs = 5000, pullIntervalMs = 3 * 60 * 1000) {
  initSyncQueue();
  if (syncIntervalObj) clearInterval(syncIntervalObj);
  if (pullIntervalObj) clearInterval(pullIntervalObj);
  
  // 1. Push local transactions to Remote DB every 5 seconds (configurable)
  syncIntervalObj = setInterval(() => {
    triggerSyncProcess();
  }, pushIntervalMs);

  // 2. Pull / Fetch updated Master Data from Remote DB every 3-5 minutes (default 3 minutes)
  pullIntervalObj = setInterval(() => {
    pullMasterDataFromRemote();
  }, pullIntervalMs);
  
  console.log(`🚀 [Sync Engine] Automatic Synchronization Worker Started:`);
  console.log(`   ⬆️ Push Local Transactions -> Remote DB: Every ${pushIntervalMs / 1000} seconds`);
  console.log(`   ⬇️ Pull Master Data & Operational State <- Remote DB: Every ${pullIntervalMs / 60000} minutes`);
}

function stopSyncWorker() {
  if (syncIntervalObj) {
    clearInterval(syncIntervalObj);
    syncIntervalObj = null;
  }
  if (pullIntervalObj) {
    clearInterval(pullIntervalObj);
    pullIntervalObj = null;
  }
  console.log("🛑 [Sync Engine] Automatic Sync Worker gracefully stopped.");
}

process.once('SIGINT', stopSyncWorker);
process.once('SIGTERM', stopSyncWorker);

const { pushActiveOrderToRemote } = require("./autoProvisionLocalDb");

module.exports = {
  startSyncWorker,
  stopSyncWorker,
  triggerSyncProcess,
  pullMasterDataFromRemote,
  enqueueSync,
  pushActiveOrderToRemote,
  getSyncStats: () => ({
    ...syncStats,
    isOnline: isRemoteOnline(),
    remoteSupervisor: typeof getRemoteSupervisorStatus === 'function' ? getRemoteSupervisorStatus() : null,
    lastSyncTime: lastSyncTime ? lastSyncTime.toISOString() : null
  })
};
