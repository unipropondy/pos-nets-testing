const { poolPromise, sql } = require('./backend/config/db');
(async () => {
  try {
    const pool = await poolPromise;
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const prefix = '' + y + m + day;
    console.log('Today prefix:', prefix);

    const seq = await pool.request().query('SELECT * FROM OrderSequences');
    console.log('OrderSequences:', seq.recordset);

    const cur = await pool.request().query(`SELECT TOP 20 OrderNumber, Tableno, isOrderClosed, CreatedOn FROM RestaurantOrderCur WHERE OrderNumber LIKE '${prefix}%' ORDER BY OrderNumber DESC`);
    console.log('RestaurantOrderCur recent:', cur.recordset);

    const hist = await pool.request().query(`SELECT TOP 20 OrderNumber, Tableno, CreatedOn FROM RestaurantOrder WHERE OrderNumber LIKE '${prefix}%' ORDER BY OrderNumber DESC`).catch(e => ({recordset: e.message}));
    console.log('RestaurantOrder recent:', hist.recordset);

    const set = await pool.request().query(`SELECT TOP 20 BillNo, CreatedOn FROM SettlementHeader WHERE BillNo LIKE '${prefix}%' ORDER BY BillNo DESC`).catch(e => ({recordset: e.message}));
    console.log('SettlementHeader recent:', set.recordset);

    const tbls = await pool.request().query(`SELECT TableNumber, Status, CurrentOrderId FROM TableMaster WHERE CurrentOrderId IS NOT NULL OR Status > 0`);
    console.log('TableMaster active:', tbls.recordset);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
})();
