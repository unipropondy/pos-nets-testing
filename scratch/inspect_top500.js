const { poolPromise, remotePoolPromise } = require("../backend/config/db");

async function main() {
  const localPool = await poolPromise;
  const remotePool = await remotePoolPromise;

  // Run the EXACT query from syncTable2Way
  const lPkRes = await localPool.request().query(`SELECT TOP 500 [SettlementID], [CreatedOn] FROM [dbo].[SettlementHeader] ORDER BY [CreatedOn] DESC`);
  const rPkRes = await remotePool.request().query(`SELECT TOP 500 [SettlementID], [CreatedOn] FROM [dbo].[SettlementHeader] ORDER BY [CreatedOn] DESC`);

  console.log("Local TOP 500 rows count:", lPkRes.recordset.length);
  console.log("Remote TOP 500 rows count:", rPkRes.recordset.length);

  const makePkKey = (row) => [String(row.SettlementID ?? '')].join('___');

  const lPkMap = new Map();
  lPkRes.recordset.forEach(r => lPkMap.set(makePkKey(r), r));

  const rPkMap = new Map();
  rPkRes.recordset.forEach(r => rPkMap.set(makePkKey(r), r));

  const missingOnRemote = lPkRes.recordset.filter(r => !rPkMap.has(makePkKey(r)));
  const missingOnLocal = rPkRes.recordset.filter(r => !lPkMap.has(makePkKey(r)));

  console.log("missingOnRemote in TOP 500:", missingOnRemote.length);
  console.log("missingOnLocal in TOP 500:", missingOnLocal.length);

  if (missingOnRemote.length > 0) {
    console.log("First missingOnRemote:", missingOnRemote[0]);
  } else {
    console.log("None of the 13 missing rows are in the TOP 500 by CreatedOn DESC!");
    // Find where the missing rows are!
    const allL = await localPool.request().query("SELECT SettlementID, CreatedOn, BillNo FROM SettlementHeader");
    const allR = await remotePool.request().query("SELECT SettlementID FROM SettlementHeader");
    const rSet = new Set(allR.recordset.map(r => String(r.SettlementID).toUpperCase()));
    const realMissing = allL.recordset.filter(r => !rSet.has(String(r.SettlementID).toUpperCase()));
    console.log("Real missing count:", realMissing.length);
    console.log("Real missing samples:", realMissing.slice(0, 10));
  }

  process.exit(0);
}

main().catch(console.error);
