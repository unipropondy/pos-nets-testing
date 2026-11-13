const { poolPromise, remotePoolPromise } = require("../backend/config/db");

async function main() {
  const localPool = await poolPromise;
  const remotePool = await remotePoolPromise;

  const pkRes = await localPool.request().query(`
    SELECT kcu.COLUMN_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
    JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc 
      ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME 
     AND kcu.TABLE_NAME = tc.TABLE_NAME
    WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' 
      AND kcu.TABLE_NAME = 'SettlementHeader'
    ORDER BY kcu.ORDINAL_POSITION
  `);
  console.log("Local PKs for SettlementHeader:", pkRes.recordset);

  const rPkRes = await remotePool.request().query(`
    SELECT kcu.COLUMN_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
    JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc 
      ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME 
     AND kcu.TABLE_NAME = tc.TABLE_NAME
    WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' 
      AND kcu.TABLE_NAME = 'SettlementHeader'
    ORDER BY kcu.ORDINAL_POSITION
  `);
  console.log("Remote PKs for SettlementHeader:", rPkRes.recordset);

  // Check identity on remote
  const rIdent = await remotePool.request().query(`
    SELECT c.name, c.is_identity
    FROM sys.columns c JOIN sys.tables t ON c.object_id = t.object_id
    WHERE t.name = 'SettlementHeader' AND c.is_identity = 1
  `);
  console.log("Remote identity cols for SettlementHeader:", rIdent.recordset);

  // Check identity on local
  const lIdent = await localPool.request().query(`
    SELECT c.name, c.is_identity
    FROM sys.columns c JOIN sys.tables t ON c.object_id = t.object_id
    WHERE t.name = 'SettlementHeader' AND c.is_identity = 1
  `);
  console.log("Local identity cols for SettlementHeader:", lIdent.recordset);

  process.exit(0);
}

main().catch(console.error);
