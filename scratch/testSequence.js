const { getPool, getRemotePool, connectRemote } = require('../backend/config/db');

(async () => {
  try {
    await connectRemote();
    const pool = getPool();
    const rPool = getRemotePool();

    const currentBizId = '00000000-0000-0000-0000-000000000000';
    const datePrefix = '20261010';
    const todayStr = '2026-10-10';

    const testQuery = async (p, name) => {
      if (!p) return;
      const res = await p.request()
        .input('RestId', currentBizId)
        .input('Today', todayStr)
        .input('Prefix', datePrefix)
        .query(`
          BEGIN TRANSACTION;
          IF NOT EXISTS (SELECT 1 FROM OrderSequences WITH (UPDLOCK, HOLDLOCK) WHERE RestaurantId = @RestId AND SequenceDate = @Today)
          BEGIN
              INSERT INTO OrderSequences (RestaurantId, SequenceDate, LastNumber) VALUES (@RestId, @Today, 0);
          END

          DECLARE @CurMax INT = 0;
          DECLARE @SetMax INT = 0;
          DECLARE @SeqMax INT = 0;

          SELECT @SeqMax = ISNULL(LastNumber, 0) FROM OrderSequences WHERE RestaurantId = @RestId AND SequenceDate = @Today;

          SELECT @CurMax = ISNULL(MAX(TRY_CAST(SUBSTRING(OrderNumber, CHARINDEX('-', OrderNumber) + 1, 10) AS INT)), 0)
          FROM RestaurantOrderCur
          WHERE OrderNumber LIKE @Prefix + '-%';

          SELECT @SetMax = ISNULL(MAX(TRY_CAST(SUBSTRING(BillNo, CHARINDEX('-', BillNo) + 1, 10) AS INT)), 0)
          FROM SettlementHeader
          WHERE BillNo LIKE @Prefix + '-%';

          DECLARE @NextNum INT = @SeqMax;
          IF @CurMax > @NextNum SET @NextNum = @CurMax;
          IF @SetMax > @NextNum SET @NextNum = @SetMax;

          SET @NextNum = @NextNum + 1;

          UPDATE OrderSequences SET LastNumber = @NextNum WHERE RestaurantId = @RestId AND SequenceDate = @Today;

          SELECT @NextNum AS NextSeq, @SeqMax AS SeqMax, @CurMax AS CurMax, @SetMax AS SetMax;
          COMMIT TRANSACTION;
        `);
      console.log(name, 'Result:', res.recordset[0]);
    };

    await testQuery(pool, 'LOCAL DB');
    await testQuery(rPool, 'REMOTE DB');

    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
