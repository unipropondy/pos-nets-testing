const { poolPromise, remotePoolPromise } = require("../backend/config/db");
const { triggerSyncProcess, getSyncStats } = require("../backend/services/syncService");

async function main() {
  await poolPromise;
  await remotePoolPromise;

  console.log("Starting triggerSyncProcess()...");
  await triggerSyncProcess();
  console.log("triggerSyncProcess() completed!");
  console.log("Sync Stats:", getSyncStats());

  process.exit(0);
}

main().catch(console.error);
