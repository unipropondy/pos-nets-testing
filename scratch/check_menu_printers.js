const { poolPromise } = require('../backend/config/db');

(async () => {
  try {
    const pool = await poolPromise;
    const r = await pool.request().query(`
      SELECT DISTINCT
        ISNULL(ckt.KitchenTypeCode, '2') as KitchenTypeCode,
        ISNULL(ISNULL(ckt.KitchenTypeName, cat.CategoryName), 'KITCHEN') as KitchenTypeName,
        pm.PrinterPath AS PrinterIP
      FROM DishMaster d
      LEFT JOIN DishGroupMaster dgm ON d.DishGroupId = dgm.DishGroupId
      LEFT JOIN CategoryMaster cat ON dgm.CategoryId = cat.CategoryId
      LEFT JOIN CategoryKitchenType ckt ON dgm.CategoryId = ckt.CategoryId
      LEFT JOIN (
        SELECT *, ROW_NUMBER() OVER(PARTITION BY LOWER(TRIM(KitchenTypeName)) ORDER BY PrinterId) as rn 
        FROM PrintMaster WHERE IsActive = 1 AND IsEnabled = 1 AND PrinterType = 2
      ) pm ON LOWER(TRIM(ISNULL(ckt.KitchenTypeName, cat.CategoryName))) = LOWER(TRIM(pm.KitchenTypeName)) AND pm.rn = 1
      WHERE d.IsActive = 1
    `);
    console.log('Distinct kitchen categories and PrinterIP:');
    console.log(r.recordset);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
