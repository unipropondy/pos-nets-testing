const { getPool, poolPromise, getRemotePool, dbConfig } = require("../backend/config/db");

async function checkHybridFlow() {
  console.log("=== Hybrid Architecture Cross-Check ===");
  const pool = await poolPromise;
  
  // 1. Check local server identity
  const serverRes = await pool.request().query("SELECT @@SERVERNAME as srv, DB_NAME() as db, @@VERSION as ver");
  console.log("Active Primary Pool Connected To:");
  console.log("  Server:", serverRes.recordset[0].srv);
  console.log("  Database:", serverRes.recordset[0].db);
  
  // 2. Check local sync queue
  const queueRes = await pool.request().query(`
    SELECT Status, COUNT(*) as count 
    FROM POS_SyncQueue WITH (NOLOCK) 
    GROUP BY Status
  `);
  console.log("\nPOS_SyncQueue status counts in Local DB:");
  console.table(queueRes.recordset);

  // 3. Check recent synced / pending records
  const recentQueue = await pool.request().query(`
    SELECT TOP 5 SyncID, EntityName, Action, Status, CreatedAt, SyncedAt, Retries 
    FROM POS_SyncQueue WITH (NOLOCK) 
    ORDER BY SyncID DESC
  `);
  console.log("\nLast 5 Sync Queue records:");
  console.table(recentQueue.recordset);

  // 4. Verify Local Menu tables
  const menuRes = await pool.request().query(`
    SELECT 
      (SELECT COUNT(*) FROM CategoryMaster WITH (NOLOCK)) as CategoriesCount,
      (SELECT COUNT(*) FROM DishGroupMaster WITH (NOLOCK)) as DishGroupsCount,
      (SELECT COUNT(*) FROM DishMaster WITH (NOLOCK)) as DishesCount
  `);
  console.log("\nLocal Menu Counts in Local DB:");
  console.table(menuRes.recordset);

  process.exit(0);
}

checkHybridFlow().catch(err => {
  console.error("Diagnostic error:", err);
  process.exit(1);
});
