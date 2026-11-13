const path = require('path');
const { poolPromise, sql } = require(path.join(__dirname, '../backend/config/db'));

async function testUpdate() {
  const pool = await poolPromise;
  const transaction = pool.transaction();
  await transaction.begin();

  try {
    const displayOrderId = '20261015-0012';
    const cleanTableId = 'FCBF4D7D-C7A5-49B6-B13B-F5D781A0D1FB';
    const tableNo = undefined;
    const DEFAULT_GUID = '00000000-0000-0000-0000-000000000000';
    const guidOrderId = null;

    console.log("Running query with params:", { displayOrderId, cleanTableId, tableNo });

    const res = await transaction.request()
      .input("orderNo", sql.NVarChar(50), displayOrderId)
      .input("guidOid", sql.UniqueIdentifier, guidOrderId || DEFAULT_GUID)
      .input("targetTno", sql.NVarChar(50), String(tableNo || cleanTableId))
      .query(`
        UPDATE RestaurantOrderCur 
        SET isOrderClosed = 1, ModifiedOn = GETDATE() 
        WHERE OrderNumber = @orderNo 
           OR OrderId IN (
             SELECT omh.ChildOrderId 
             FROM OrderMergeHistory omh
             WHERE omh.ParentOrderId = @guidOid 
                OR omh.ParentTableNo = @targetTno
                OR omh.ParentOrderId IN (SELECT OrderId FROM RestaurantOrderCur WHERE OrderNumber = @orderNo)
                OR omh.ParentOrderId IN (SELECT OrderId FROM RestaurantOrder WHERE OrderNumber = @orderNo)
           )
      `);
    console.log("Rows affected:", res.rowsAffected);
    await transaction.rollback();
  } catch (err) {
    console.error("Query failed with error:", err);
    await transaction.rollback();
  }
  process.exit(0);
}

testUpdate();
