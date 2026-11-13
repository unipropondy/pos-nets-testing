const { poolPromise, remotePoolPromise } = require("../backend/config/db");

async function main() {
  const localPool = await poolPromise;
  const remotePool = await remotePoolPromise;

  // Find a missing SettlementHeader on Remote
  const lSettlements = await localPool.request().query("SELECT SettlementID FROM SettlementHeader");
  const rSettlements = await remotePool.request().query("SELECT SettlementID FROM SettlementHeader");
  const rSet = new Set(rSettlements.recordset.map(r => String(r.SettlementID).toUpperCase()));
  const missing = lSettlements.recordset.filter(r => !rSet.has(String(r.SettlementID).toUpperCase()));

  console.log(`Missing SettlementHeader count: ${missing.length}`);
  if (missing.length === 0) {
    console.log("No missing settlements!");
    process.exit(0);
  }

  const targetId = missing[0].SettlementID;
  console.log(`Testing push of SettlementID: ${targetId}`);
  const rowRes = await localPool.request().input("id", targetId).query("SELECT * FROM SettlementHeader WHERE SettlementID = @id");
  const row = rowRes.recordset[0];

  // Remote columns
  const rColsRes = await remotePool.request().query(`
    SELECT c.COLUMN_NAME, c.DATA_TYPE, COLUMNPROPERTY(OBJECT_ID(c.TABLE_SCHEMA + '.' + c.TABLE_NAME), c.COLUMN_NAME, 'IsIdentity') as is_identity
    FROM INFORMATION_SCHEMA.COLUMNS c WHERE c.TABLE_NAME = 'SettlementHeader'
  `);
  const rCols = new Map(rColsRes.recordset.map(c => [c.COLUMN_NAME.toLowerCase(), c]));

  // Test 1: Omitting identity column (OrderId)
  const nonIdKeys = Object.keys(row).filter(k => {
    const col = rCols.get(k.toLowerCase());
    return col && col.is_identity !== 1 && row[k] !== null;
  });

  const colList = nonIdKeys.map(k => `[${k}]`).join(", ");
  const req = remotePool.request();
  const valList = nonIdKeys.map((k, idx) => {
    req.input(`p_${idx}`, row[k]);
    return `@p_${idx}`;
  }).join(", ");

  const testSql = `
    IF NOT EXISTS (SELECT 1 FROM SettlementHeader WHERE SettlementID = @p_SettlementID)
    BEGIN
      INSERT INTO SettlementHeader (${colList}) VALUES (${valList});
    END
  `;
  req.input("p_SettlementID", targetId);

  try {
    await req.query(testSql);
    console.log("✅ SUCCESS! Inserting without identity column worked perfectly!");
  } catch (err) {
    console.error("❌ Test 1 failed:", err.message);
  }

  // Verify if it exists on Remote now
  const check = await remotePool.request().input("id", targetId).query("SELECT SettlementID, OrderId, BillNo FROM SettlementHeader WHERE SettlementID = @id");
  console.log("Remote check:", check.recordset);

  process.exit(0);
}

main().catch(console.error);
