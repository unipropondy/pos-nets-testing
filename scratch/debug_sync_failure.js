const { poolPromise, remotePoolPromise } = require("../backend/config/db");

async function main() {
  const localPool = await poolPromise;
  const remotePool = await remotePoolPromise;

  // 1. Check SettlementHeader difference
  const lSettlements = await localPool.request().query("SELECT SettlementID, BillNo, CreatedOn FROM SettlementHeader");
  const rSettlements = await remotePool.request().query("SELECT SettlementID FROM SettlementHeader");
  const rSet = new Set(rSettlements.recordset.map(r => String(r.SettlementID).toLowerCase()));
  
  const missingSettlements = lSettlements.recordset.filter(r => !rSet.has(String(r.SettlementID).toLowerCase()));
  console.log(`Missing Settlements on Remote: ${missingSettlements.length}`);
  console.dir(missingSettlements.slice(0, 5));

  // Let's attempt to push ONE missing settlement to remote to see if it succeeds or what error throws!
  if (missingSettlements.length > 0) {
    const testId = missingSettlements[0].SettlementID;
    console.log(`\nAttempting test push of SettlementID: ${testId}`);
    const rowRes = await localPool.request().input("id", testId).query("SELECT * FROM SettlementHeader WHERE SettlementID = @id");
    const row = rowRes.recordset[0];
    
    // Check remote columns
    const rColsRes = await remotePool.request().query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'SettlementHeader'");
    const rColMap = new Map(rColsRes.recordset.map(c => [c.COLUMN_NAME.toLowerCase(), c]));
    
    const validKeys = Object.keys(row).filter(k => row[k] !== null && rColMap.has(k.toLowerCase()));
    const colList = validKeys.map(k => `[${k}]`).join(", ");
    const req = remotePool.request();
    const valList = validKeys.map((k, idx) => {
      req.input(`p_${idx}`, row[k]);
      return `@p_${idx}`;
    }).join(", ");

    try {
      await req.query(`INSERT INTO SettlementHeader (${colList}) VALUES (${valList})`);
      console.log("✅ Successfully inserted test SettlementHeader into Remote DB!");
    } catch (e) {
      console.error("❌ Error inserting SettlementHeader into Remote DB:", e.message);
    }
  }

  // 2. Check SettlementTotalSales difference
  const lTotalSales = await localPool.request().query("SELECT SettlementID, PayMode FROM SettlementTotalSales");
  const rTotalSales = await remotePool.request().query("SELECT SettlementID, PayMode FROM SettlementTotalSales");
  const rTSSet = new Set(rTotalSales.recordset.map(r => `${String(r.SettlementID).toLowerCase()}___${r.PayMode}`));
  const missingTS = lTotalSales.recordset.filter(r => !rTSSet.has(`${String(r.SettlementID).toLowerCase()}___${r.PayMode}`));
  console.log(`\nMissing SettlementTotalSales on Remote: ${missingTS.length}`);
  console.dir(missingTS.slice(0, 5));

  if (missingTS.length > 0) {
    const target = missingTS[0];
    const tsRowRes = await localPool.request()
      .input("sid", target.SettlementID)
      .input("pm", target.PayMode)
      .query("SELECT * FROM SettlementTotalSales WHERE SettlementID = @sid AND PayMode = @pm");
    const tsRow = tsRowRes.recordset[0];
    
    const rColsRes = await remotePool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'SettlementTotalSales'");
    const rCols = new Set(rColsRes.recordset.map(c => c.COLUMN_NAME.toLowerCase()));
    
    const validKeys = Object.keys(tsRow).filter(k => tsRow[k] !== null && rCols.has(k.toLowerCase()));
    const colList = validKeys.map(k => `[${k}]`).join(", ");
    const req = remotePool.request();
    const valList = validKeys.map((k, idx) => {
      req.input(`p_${idx}`, tsRow[k]);
      return `@p_${idx}`;
    }).join(", ");

    try {
      await req.query(`INSERT INTO SettlementTotalSales (${colList}) VALUES (${valList})`);
      console.log("✅ Successfully inserted test SettlementTotalSales into Remote DB!");
    } catch (e) {
      console.error("❌ Error inserting SettlementTotalSales into Remote DB:", e.message);
    }
  }

  process.exit(0);
}

main().catch(console.error);
