const { poolPromise, remotePoolPromise } = require("../backend/config/db");
const { syncTable2Way } = require("../backend/services/autoProvisionLocalDb");

async function main() {
  const localPool = await poolPromise;
  const remotePool = await remotePoolPromise;

  console.log("Testing syncTable2Way on SettlementHeader...");
  const res = await syncTable2Way(remotePool, localPool, "SettlementHeader", "SettlementID", 500);
  console.log("Result:", res);

  const lCnt = (await localPool.request().query("SELECT COUNT(*) as cnt FROM SettlementHeader")).recordset[0].cnt;
  const rCnt = (await remotePool.request().query("SELECT COUNT(*) as cnt FROM SettlementHeader")).recordset[0].cnt;
  console.log(`After sync: Local=${lCnt}, Remote=${rCnt}`);

  process.exit(0);
}

main().catch(console.error);
