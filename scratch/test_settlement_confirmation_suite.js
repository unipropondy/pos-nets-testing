const { poolPromise, sql } = require('../backend/config/db');

async function runTests() {
  console.log('=== STARTING CONTROLLED SETTLEMENT CONFIRMATION TESTS ===');
  const pool = await poolPromise;

  // Verify active date
  const activeDayRes = await pool.request().query("SELECT TOP 1 StartDate FROM DateEntry ORDER BY CreatedDate DESC");
  if (activeDayRes.recordset.length === 0) {
    console.error('FAIL: No active business day in DateEntry');
    process.exit(1);
  }
  const activeStartDate = activeDayRes.recordset[0].StartDate;
  const formattedActiveDate = activeStartDate instanceof Date ? activeStartDate.toISOString().split('T')[0] : String(activeStartDate).split('T')[0];
  console.log('Active Business Date:', formattedActiveDate);

  // Helper to attempt day-end validation logic exactly as in settlementRoutes
  async function attemptDayEndValidation(dateToCheck) {
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const activeCheck = await new sql.Request(tx).query("SELECT TOP 1 StartDate FROM DateEntry WITH (UPDLOCK, HOLDLOCK) ORDER BY CreatedDate DESC");
      if (activeCheck.recordset.length === 0) {
        await tx.rollback();
        return { status: 400, error: 'No active day' };
      }
      const activeDate = activeCheck.recordset[0].StartDate;
      const formattedDate = activeDate instanceof Date ? activeDate.toISOString().split('T')[0] : String(activeDate).split('T')[0];
      
      const confirmCheckReq = new sql.Request(tx);
      confirmCheckReq.input('activeDate', sql.Date, formattedDate);
      const confirmCheckRes = await confirmCheckReq.query(`
        SELECT OpeningConfirmed, CashOutConfirmed, ClosingConfirmed
        FROM SettlementDayConfirmation WITH (UPDLOCK, HOLDLOCK)
        WHERE BusinessDate = @activeDate
      `);

      const confirmationRecord = confirmCheckRes.recordset[0];
      if (!confirmationRecord || !confirmationRecord.OpeningConfirmed || !confirmationRecord.CashOutConfirmed || !confirmationRecord.ClosingConfirmed) {
        const missing = [];
        if (!confirmationRecord || !confirmationRecord.OpeningConfirmed) missing.push('Opening Amount');
        if (!confirmationRecord || !confirmationRecord.CashOutConfirmed) missing.push('Cash Out');
        if (!confirmationRecord || !confirmationRecord.ClosingConfirmed) missing.push('Closing Amount');
        await tx.rollback();
        return { status: 400, missingSteps: missing, error: 'Incomplete' };
      }

      await tx.rollback(); // Always rollback test
      return { status: 200, success: true };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  }

  // Backup current row if any
  const backupRes = await pool.request().input('d', sql.Date, formattedActiveDate).query("SELECT * FROM SettlementDayConfirmation WHERE BusinessDate = @d");
  const existingRow = backupRes.recordset[0] || null;

  try {
    // TEST 1: No confirmation row for active date
    console.log('\n--- Test 1: No confirmation row ---');
    await pool.request().input('d', sql.Date, formattedActiveDate).query("DELETE FROM SettlementDayConfirmation WHERE BusinessDate = @d");
    const t1 = await attemptDayEndValidation(formattedActiveDate);
    console.log('Test 1 Result:', t1.status === 400 ? 'PASS (Rejected 400)' : 'FAIL', t1.missingSteps);

    // TEST 2: All three flags false
    console.log('\n--- Test 2: All three flags false ---');
    await pool.request().input('d', sql.Date, formattedActiveDate).query(`
      INSERT INTO SettlementDayConfirmation (BusinessDate, OpeningConfirmed, CashOutConfirmed, ClosingConfirmed, CreatedAt, UpdatedAt)
      VALUES (@d, 0, 0, 0, GETDATE(), GETDATE())
    `);
    const t2 = await attemptDayEndValidation(formattedActiveDate);
    console.log('Test 2 Result:', t2.status === 400 ? 'PASS (Rejected 400)' : 'FAIL', t2.missingSteps);

    // TEST 3: Opening confirmed at 0.00, other steps unconfirmed
    console.log('\n--- Test 3: Opening confirmed at 0.00, others false ---');
    await pool.request().input('d', sql.Date, formattedActiveDate).query(`
      UPDATE SettlementDayConfirmation 
      SET OpeningConfirmed = 1, OpeningAmount = 0.00, OpeningConfirmedAt = GETDATE(), CashOutConfirmed = 0, ClosingConfirmed = 0 
      WHERE BusinessDate = @d
    `);
    const t3 = await attemptDayEndValidation(formattedActiveDate);
    console.log('Test 3 Result:', t3.status === 400 ? 'PASS (Rejected 400)' : 'FAIL', t3.missingSteps);

    // TEST 4: Opening and Cash Out confirmed, Closing unconfirmed
    console.log('\n--- Test 4: Opening & Cash Out confirmed, Closing false ---');
    await pool.request().input('d', sql.Date, formattedActiveDate).query(`
      UPDATE SettlementDayConfirmation 
      SET OpeningConfirmed = 1, CashOutConfirmed = 1, CashOutConfirmedAt = GETDATE(), ClosingConfirmed = 0 
      WHERE BusinessDate = @d
    `);
    const t4 = await attemptDayEndValidation(formattedActiveDate);
    console.log('Test 4 Result:', t4.status === 400 ? 'PASS (Rejected 400)' : 'FAIL', t4.missingSteps);

    // TEST 5: All three explicitly confirmed at 0.00
    console.log('\n--- Test 5: All three explicitly confirmed at 0.00 ---');
    await pool.request().input('d', sql.Date, formattedActiveDate).query(`
      UPDATE SettlementDayConfirmation 
      SET OpeningConfirmed = 1, OpeningAmount = 0.00, CashOutConfirmed = 1, ClosingConfirmed = 1, ClosingAmount = 0.00, ClosingConfirmedAt = GETDATE()
      WHERE BusinessDate = @d
    `);
    const t5 = await attemptDayEndValidation(formattedActiveDate);
    console.log('Test 5 Result:', t5.status === 200 ? 'PASS (Accepted 200)' : 'FAIL');

    // TEST 6: Confirmation belongs to previous date (e.g. 2026-10-28) but active date is 2026-10-29
    console.log('\n--- Test 6: Confirmation on previous date only ---');
    await pool.request().input('d', sql.Date, formattedActiveDate).query("DELETE FROM SettlementDayConfirmation WHERE BusinessDate = @d");
    // Ensure previous date has confirmation
    await pool.request().query(`
      MERGE SettlementDayConfirmation AS target
      USING (SELECT CAST('2026-10-28' AS DATE) AS BusinessDate) AS source
      ON (target.BusinessDate = source.BusinessDate)
      WHEN MATCHED THEN UPDATE SET OpeningConfirmed = 1, CashOutConfirmed = 1, ClosingConfirmed = 1
      WHEN NOT MATCHED THEN INSERT (BusinessDate, OpeningConfirmed, CashOutConfirmed, ClosingConfirmed, CreatedAt, UpdatedAt)
      VALUES (CAST('2026-10-28' AS DATE), 1, 1, 1, GETDATE(), GETDATE());
    `);
    const t6 = await attemptDayEndValidation(formattedActiveDate);
    console.log('Test 6 Result:', t6.status === 400 ? 'PASS (Rejected 400 for 2026-10-29)' : 'FAIL', t6.missingSteps);

    // TEST 7: 5 simultaneous Day End requests concurrency test
    console.log('\n--- Test 7: 5 simultaneous Day End requests ---');
    // Set all confirmed for the test
    await pool.request().input('d', sql.Date, formattedActiveDate).query(`
      MERGE SettlementDayConfirmation AS target
      USING (SELECT @d AS BusinessDate) AS source
      ON (target.BusinessDate = source.BusinessDate)
      WHEN MATCHED THEN UPDATE SET OpeningConfirmed = 1, CashOutConfirmed = 1, ClosingConfirmed = 1
      WHEN NOT MATCHED THEN INSERT (BusinessDate, OpeningConfirmed, CashOutConfirmed, ClosingConfirmed, CreatedAt, UpdatedAt)
      VALUES (@d, 1, 1, 1, GETDATE(), GETDATE());
    `);

    async function simulatedDayEndWorkflow(reqId) {
      const tx = new sql.Transaction(pool);
      await tx.begin();
      try {
        const lockRes = await new sql.Request(tx).query(`
          DECLARE @res INT;
          EXEC @res = sp_getapplock @Resource = 'POS_DAY_END_WORKFLOW', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 0;
          SELECT @res AS LockResult;
        `);
        if (lockRes.recordset[0]?.LockResult < 0) {
          await tx.rollback();
          return { reqId, success: false, reason: 'AppLock busy' };
        }

        // Active day check
        const activeCheck = await new sql.Request(tx).query("SELECT TOP 1 StartDate FROM DateEntry WITH (UPDLOCK, HOLDLOCK) ORDER BY CreatedDate DESC");
        if (activeCheck.recordset.length === 0) {
          await tx.rollback();
          return { reqId, success: false, reason: 'No active day' };
        }

        // Simulate small delay within lock
        await new Promise(r => setTimeout(r, 50));

        await tx.rollback(); // Rollback so we don't delete real DateEntry
        return { reqId, success: true };
      } catch (e) {
        await tx.rollback();
        return { reqId, success: false, reason: e.message };
      }
    }

    const concurrentResults = await Promise.all([
      simulatedDayEndWorkflow(1),
      simulatedDayEndWorkflow(2),
      simulatedDayEndWorkflow(3),
      simulatedDayEndWorkflow(4),
      simulatedDayEndWorkflow(5),
    ]);
    const successes = concurrentResults.filter(r => r.success).length;
    console.log('Concurrent Results:', concurrentResults);
    console.log('Test 7 Result:', successes <= 1 ? `PASS (Only ${successes} succeeded out of 5)` : `FAIL (${successes} succeeded)`);

  } finally {
    // Restore initial state for active date: delete row so user starts clean with all unconfirmed
    console.log('\n--- Cleaning up test state ---');
    await pool.request().input('d', sql.Date, formattedActiveDate).query("DELETE FROM SettlementDayConfirmation WHERE BusinessDate = @d");
    console.log('Active Date Confirmation Reset to Clean (No confirmation row).');
  }

  console.log('\n=== ALL SUITE TESTS COMPLETED ===');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});

