const { poolPromise } = require('../backend/config/db');

async function auditDb() {
  const pool = await poolPromise;
  console.log('--- AUDITING LOCAL DATABASE ROWS AND INDEXES ---');

  const countsQuery = `
    SELECT 
      t.NAME AS TableName,
      p.rows AS RowCounts
    FROM sys.tables t
    INNER JOIN sys.indexes i ON t.OBJECT_ID = i.object_id
    INNER JOIN sys.partitions p ON i.object_id = p.OBJECT_ID AND i.index_id = p.index_id
    WHERE t.NAME IN ('RestaurantOrder', 'RestaurantOrderDetail', 'RestaurantOrderCur', 'RestaurantOrderDetailCur', 'SettlementHeader', 'SettlementDetail', 'TableMaster', 'CartItems', 'POS_SyncQueue')
      AND i.index_id < 2
    GROUP BY t.NAME, p.rows
    ORDER BY p.rows DESC;
  `;
  const counts = await pool.request().query(countsQuery);
  console.log('Table Row Counts:');
  console.table(counts.recordset);

  const indexQuery = `
    SELECT 
      t.name AS TableName,
      ind.name AS IndexName,
      ind.is_unique AS IsUnique,
      col.name AS ColumnName
    FROM sys.indexes ind
    INNER JOIN sys.index_columns ic ON ind.object_id = ic.object_id AND ind.index_id = ic.index_id
    INNER JOIN sys.columns col ON ic.object_id = col.object_id AND ic.column_id = col.column_id
    INNER JOIN sys.tables t ON ind.object_id = t.object_id
    WHERE t.name IN ('RestaurantOrder', 'RestaurantOrderDetail', 'RestaurantOrderCur', 'RestaurantOrderDetailCur', 'SettlementHeader')
    ORDER BY t.name, ind.name, ic.index_column_id;
  `;
  const indexes = await pool.request().query(indexQuery);
  console.log('Indexes on Core Transaction Tables:');
  console.table(indexes.recordset);

  process.exit(0);
}

auditDb().catch(e => {
  console.error(e);
  process.exit(1);
});
