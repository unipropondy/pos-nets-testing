const { poolPromise, remotePoolPromise } = require("../backend/config/db");

async function main() {
  const localPool = await poolPromise;
  const remotePool = await remotePoolPromise;

  const lDup = await localPool.request().query(`
    SELECT SettlementID, PayMode, COUNT(*) as c
    FROM SettlementTotalSales
    GROUP BY SettlementID, PayMode
    HAVING COUNT(*) > 1
  `);
  console.log("Local SettlementTotalSales duplicates:", lDup.recordset.length);
  if (lDup.recordset.length > 0) {
    console.log("Sample duplicate:", lDup.recordset[0]);
    const sampleRows = await localPool.request()
      .input("s", lDup.recordset[0].SettlementID)
      .input("p", lDup.recordset[0].PayMode)
      .query("SELECT * FROM SettlementTotalSales WHERE SettlementID = @s AND PayMode = @p");
    console.log("Duplicate rows in local:", sampleRows.recordset);
  }

  // RestaurantOrderDetail check
  const lODDup = await localPool.request().query(`
    SELECT OrderDetailId, COUNT(*) as c
    FROM RestaurantOrderDetail
    GROUP BY OrderDetailId
    HAVING COUNT(*) > 1
  `);
  console.log("\nLocal RestaurantOrderDetail duplicates:", lODDup.recordset.length);
  if (lODDup.recordset.length > 0) {
    console.log("Sample OD duplicate:", lODDup.recordset[0]);
  }

  // Check if OrderDetailId is NULL
  const lODNull = await localPool.request().query("SELECT COUNT(*) as c FROM RestaurantOrderDetail WHERE OrderDetailId IS NULL");
  console.log("Local RestaurantOrderDetail with NULL OrderDetailId:", lODNull.recordset[0].c);

  process.exit(0);
}

main().catch(console.error);
