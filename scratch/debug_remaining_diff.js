const { poolPromise, remotePoolPromise } = require("../backend/config/db");

async function main() {
  const localPool = await poolPromise;
  const remotePool = await remotePoolPromise;

  // 1. SettlementTotalSales check
  const lTSCols = await localPool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'SettlementTotalSales'");
  const rTSCols = await remotePool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'SettlementTotalSales'");
  console.log("Local SettlementTotalSales columns:", lTSCols.recordset.map(c => c.COLUMN_NAME));
  console.log("Remote SettlementTotalSales columns:", rTSCols.recordset.map(c => c.COLUMN_NAME));

  const lTS = await localPool.request().query("SELECT TOP 5 * FROM SettlementTotalSales");
  console.log("Local sample row:", lTS.recordset[0]);

  // Check diff
  const lKeys = await localPool.request().query("SELECT SettlementID, PayMode FROM SettlementTotalSales");
  const rKeys = await remotePool.request().query("SELECT SettlementID, PayMode FROM SettlementTotalSales");
  const rKeySet = new Set(rKeys.recordset.map(r => `${String(r.SettlementID).toLowerCase()}___${String(r.PayMode).toLowerCase()}`));
  const missing = lKeys.recordset.filter(r => !rKeySet.has(`${String(r.SettlementID).toLowerCase()}___${String(r.PayMode).toLowerCase()}`));
  console.log("Missing SettlementTotalSales count:", missing.length);
  if (missing.length > 0) {
    console.log("Sample missing:", missing[0]);
    // Try inserting this sample row
    const target = missing[0];
    const fullRow = (await localPool.request().input("s", target.SettlementID).input("p", target.PayMode).query("SELECT TOP 1 * FROM SettlementTotalSales WHERE SettlementID = @s AND PayMode = @p")).recordset[0];
    console.log("Full row:", fullRow);

    const keys = Object.keys(fullRow).filter(k => fullRow[k] !== null);
    const colList = keys.map(k => `[${k}]`).join(", ");
    const req = remotePool.request();
    const valList = keys.map((k, idx) => {
      req.input(`p_${idx}`, fullRow[k]);
      return `@p_${idx}`;
    }).join(", ");

    try {
      await req.query(`INSERT INTO SettlementTotalSales (${colList}) VALUES (${valList})`);
      console.log("✅ Successfully inserted sample row into Remote!");
    } catch (e) {
      console.error("❌ Error inserting into Remote:", e.message);
    }
  }

  // 2. RestaurantOrderDetail check
  const lODKeys = await localPool.request().query("SELECT OrderDetailId FROM RestaurantOrderDetail");
  const rODKeys = await remotePool.request().query("SELECT OrderDetailId FROM RestaurantOrderDetail");
  const rODSet = new Set(rODKeys.recordset.map(r => String(r.OrderDetailId).toLowerCase()));
  const missingOD = lODKeys.recordset.filter(r => !rODSet.has(String(r.OrderDetailId).toLowerCase()));
  console.log("\nMissing RestaurantOrderDetail count:", missingOD.length);
  if (missingOD.length > 0) {
    console.log("Sample missing OD:", missingOD[0]);
    const odTarget = missingOD[0];
    const odRow = (await localPool.request().input("id", odTarget.OrderDetailId).query("SELECT TOP 1 * FROM RestaurantOrderDetail WHERE OrderDetailId = @id")).recordset[0];
    
    const odColsRes = await remotePool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'RestaurantOrderDetail'");
    const rColsSet = new Set(odColsRes.recordset.map(c => c.COLUMN_NAME.toLowerCase()));
    const validKeys = Object.keys(odRow).filter(k => odRow[k] !== null && rColsSet.has(k.toLowerCase()));
    const colList = validKeys.map(k => `[${k}]`).join(", ");
    const req = remotePool.request();
    const valList = validKeys.map((k, idx) => {
      req.input(`p_${idx}`, odRow[k]);
      return `@p_${idx}`;
    }).join(", ");

    try {
      await req.query(`INSERT INTO RestaurantOrderDetail (${colList}) VALUES (${valList})`);
      console.log("✅ Successfully inserted sample RestaurantOrderDetail into Remote!");
    } catch (e) {
      console.error("❌ Error inserting RestaurantOrderDetail into Remote:", e.message);
    }
  }

  process.exit(0);
}

main().catch(console.error);
