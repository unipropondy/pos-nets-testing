const { poolPromise } = require('../config/db');

async function setupSequence() {
  const pool = await poolPromise;
  if (!pool || !pool.connected) {
    throw new Error('Could not connect to database pool');
  }

  // 1. Ensure Table or Sequence exists
  // We can use both a dedicated single-row table dbo.NetsEcnCounter (works in all editions and transactions with UPDLOCK)
  // AND a SEQUENCE dbo.NetsEcnSequence.
  // Using a Table with UPDATE ... OUTPUT inserted.CurrentEcn is standard, extremely reliable, atomic, and supports restart/recovery.
  const createTableScript = `
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'NetsEcnCounter')
    BEGIN
      CREATE TABLE dbo.NetsEcnCounter (
        Id INT NOT NULL PRIMARY KEY DEFAULT 1,
        CurrentEcn BIGINT NOT NULL DEFAULT 1,
        UpdatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        CONSTRAINT CK_NetsEcnCounter_SingleRow CHECK (Id = 1)
      );

      INSERT INTO dbo.NetsEcnCounter (Id, CurrentEcn, UpdatedAt)
      VALUES (1, 1, GETDATE());
      PRINT 'Created NetsEcnCounter table';
    END

    IF NOT EXISTS (SELECT * FROM sys.sequences WHERE name = 'NetsEcnSequence')
    BEGIN
      CREATE SEQUENCE dbo.NetsEcnSequence
        AS BIGINT
        START WITH 1
        INCREMENT BY 1
        MINVALUE 1
        MAXVALUE 999999999999
        CYCLE;
      PRINT 'Created NetsEcnSequence';
    END
  `;

  await pool.request().query(createTableScript);

  // Sync with current JSON file value if higher
  const fs = require('fs');
  const path = require('path');
  const jsonPath = path.join(__dirname, '../config/netsEcn.json');
  let currentJsonEcn = 1;
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      currentJsonEcn = parseInt(data.ecn, 10) || 1;
    } catch (_) {}
  }

  const syncScript = `
    UPDATE dbo.NetsEcnCounter
    SET CurrentEcn = CASE 
      WHEN CurrentEcn < @jsonEcn THEN @jsonEcn
      ELSE CurrentEcn
    END
    WHERE Id = 1;

    SELECT CurrentEcn FROM dbo.NetsEcnCounter WHERE Id = 1;
  `;

  const req = pool.request();
  req.input('jsonEcn', currentJsonEcn);
  const syncRes = await req.query(syncScript);
  console.log('NetsEcnCounter Initialized. CurrentEcn:', syncRes.recordset[0].CurrentEcn);

  process.exit(0);
}

setupSequence().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});

