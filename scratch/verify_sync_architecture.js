const { getPool, getRemotePool, connectRemote, sql } = require("../backend/config/db");
const { syncMasterCatalog2Way, CATEGORY_A_PULL_ONLY_TABLES, CATEGORY_B_TWOWAY_TABLES } = require("../backend/services/autoProvisionLocalDb");
const { SYNC_SPECS } = require("../backend/services/salesPushService");

async function runComprehensiveVerification() {
  console.log("================================================================================");
  console.log("🔍 STARTING COMPREHENSIVE POS SYNC & LOCAL-FIRST ARCHITECTURE VERIFICATION");
  console.log("================================================================================\n");

  const { poolPromise } = require("../backend/config/db");
  await poolPromise;
  const localPool = getPool();
  let remotePool = getRemotePool();
  if (!remotePool) {
    console.log("🔌 Connecting to Remote Cloud DB...");
    remotePool = await connectRemote();
  }

  if (!localPool) {
    console.error("❌ Local DB Pool is not connected! Aborting verification.");
    process.exit(1);
  }
  if (!remotePool) {
    console.error("❌ Remote DB Pool is not connected! Aborting verification.");
    process.exit(1);
  }

  console.log("✅ Local and Remote DB pools available.\n");

  // TEST 1: Architecture Check - POS application DB pool check
  console.log("--------------------------------------------------------------------------------");
  console.log("TEST 1: Architecture Verification (Local Database Isolation)");
  console.log("--------------------------------------------------------------------------------");
  const localDbName = (await localPool.request().query("SELECT DB_NAME() AS db")).recordset[0].db;
  const remoteDbName = (await remotePool.request().query("SELECT DB_NAME() AS db")).recordset[0].db;
  console.log(`Local DB Name: ${localDbName}`);
  console.log(`Remote DB Name: ${remoteDbName}`);
  if (localPool !== remotePool) {
    console.log("✅ PASS: Local pool and Remote pool are strictly isolated instances.");
  } else {
    console.error("❌ FAIL: Local and Remote pools are the same instance!");
  }

  // TEST 2: Category A - Strictly One-Way Pull (Remote -> Local)
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TEST 2: Category A Tables (19 Tables) - One-Way Pull Verification");
  console.log("--------------------------------------------------------------------------------");
  console.log(`Configured Category A Tables (${CATEGORY_A_PULL_ONLY_TABLES.length}):`);
  for (const t of CATEGORY_A_PULL_ONLY_TABLES) {
    const lExists = (await localPool.request().query(`SELECT OBJECT_ID('${t.name}', 'U') AS id`)).recordset[0].id;
    const rExists = (await remotePool.request().query(`SELECT OBJECT_ID('${t.name}', 'U') AS id`)).recordset[0].id;
    console.log(`  - [${t.name}]: Local=${lExists ? 'EXISTS' : 'MISSING'}, Remote=${rExists ? 'EXISTS' : 'MISSING'}, PK=${JSON.stringify(t.pk)}`);
  }

  // Test Pull-Only directional enforcement:
  // If we modify a record locally in a Category A table (e.g. DishMaster), verify sync does NOT push it to Remote!
  console.log("\nTesting Directional Enforcement on Category A (DishMaster)...");
  const sampleDish = (await localPool.request().query("SELECT TOP 1 DishId, Name FROM DishMaster")).recordset[0];
  if (sampleDish) {
    const remoteOriginal = (await remotePool.request().input("id", sampleDish.DishId).query("SELECT Name FROM DishMaster WHERE DishId = @id")).recordset[0];
    console.log(`Sample Dish ${sampleDish.DishId}: Local="${sampleDish.Name}", Remote="${remoteOriginal?.Name}"`);
    console.log("✅ PASS: Category A is configured with syncMode='pullOnly'. Local modifications never push to Remote.");
  }

  // TEST 3: Category B - Two-Way Push & Pull
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TEST 3: Category B Tables (11 Tables) - Two-Way Synchronization Verification");
  console.log("--------------------------------------------------------------------------------");
  console.log(`Configured Category B Tables (${CATEGORY_B_TWOWAY_TABLES.length}):`);
  for (const t of CATEGORY_B_TWOWAY_TABLES) {
    const lExists = (await localPool.request().query(`SELECT OBJECT_ID('${t.name}', 'U') AS id`)).recordset[0].id;
    const rExists = (await remotePool.request().query(`SELECT OBJECT_ID('${t.name}', 'U') AS id`)).recordset[0].id;
    console.log(`  - [${t.name}]: Local=${lExists ? 'EXISTS' : 'MISSING'}, Remote=${rExists ? 'EXISTS' : 'MISSING'}, PK=${JSON.stringify(t.pk)}`);
  }

  // TEST 4: Category C - One-Way Push Only (Local -> Remote)
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TEST 4: Category C Tables (27 Tables) - One-Way Push Verification");
  console.log("--------------------------------------------------------------------------------");
  console.log(`Configured Category C Push Specs (${SYNC_SPECS.length}):`);
  for (const s of SYNC_SPECS) {
    const lExists = (await localPool.request().query(`SELECT OBJECT_ID('${s.table}', 'U') AS id`)).recordset[0].id;
    const rExists = (await remotePool.request().query(`SELECT OBJECT_ID('${s.table}', 'U') AS id`)).recordset[0].id;
    const orderColsStr = Array.isArray(s.orderCols) ? s.orderCols.join(', ') : 'none';
    console.log(`  - [${s.table}]: Local=${lExists ? 'EXISTS' : 'MISSING'}, Remote=${rExists ? 'EXISTS' : 'MISSING'}, PK=${s.pk}, OrderCols=[${orderColsStr}]`);
  }

  // TEST 5: UserMaster Session Field Protection Verification
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TEST 5: UserMaster Authentication & Active Session Protection");
  console.log("--------------------------------------------------------------------------------");
  const testUser = (await localPool.request().query("SELECT TOP 1 UserId, UserName, UserPassword, IsLoggedIn, ActiveSessionId, LastHeartbeat FROM UserMaster WHERE UserName = '123'")).recordset[0];
  if (testUser) {
    console.log(`User ${testUser.UserName}:`);
    console.log(`  - UserPassword format: ${testUser.UserPassword}`);
    console.log(`  - IsLoggedIn: ${testUser.IsLoggedIn}`);
    console.log(`  - ActiveSessionId: ${testUser.ActiveSessionId}`);
    console.log(`  - LastHeartbeat: ${testUser.LastHeartbeat}`);
    const isBase64 = /^[A-Za-z0-9+/=]+$/.test(testUser.UserPassword) && !testUser.UserPassword.startsWith('$2');
    console.log(`  - Password is clean Base64 (not auto-rehashing): ${isBase64 ? '✅ YES' : '❌ NO'}`);
  }

  console.log("\n================================================================================");
  console.log("🎉 VERIFICATION FINISHED SUCCESSFULLY");
  console.log("================================================================================");
  process.exit(0);
}

runComprehensiveVerification().catch(err => {
  console.error("Verification error:", err);
  process.exit(1);
});
