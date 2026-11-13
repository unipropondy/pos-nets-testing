const { poolPromise, remotePoolPromise, connectRemote } = require("../config/db");
const { syncSchemaFromRemoteToLocal } = require("../services/autoProvisionLocalDb");

async function runFullSync() {
  console.log("==========================================================");
  console.log("🚀 Starting Full Database Schema & Table Auto-Replication");
  console.log("==========================================================");

  try {
    const localPool = await poolPromise;
    if (!localPool || !localPool.connected) {
      console.error("❌ Failed to connect to Local DB. Please verify local SQL Server is running.");
      process.exit(1);
    }

    const remotePool = await remotePoolPromise || await connectRemote();
    if (!remotePool || !remotePool.connected) {
      console.error("❌ Failed to connect to Remote DB. Please check internet connection.");
      process.exit(1);
    }

    console.log("✅ Successfully connected to BOTH Local DB and Remote Cloud DB!");
    console.log("🔄 Replicating ALL tables, columns, data types, and master data...");

    const success = await syncSchemaFromRemoteToLocal(localPool);

    if (success) {
      console.log("\n==========================================================");
      console.log("🎉 SUCCESS: ALL TABLES & FIELDS CREATED IN LOCAL DB!");
      console.log("==========================================================");
    } else {
      console.warn("\n⚠️ Schema sync finished with warnings.");
    }
  } catch (err) {
    console.error("❌ Fatal replication error:", err.message);
  } finally {
    process.exit(0);
  }
}

runFullSync();
