const { poolPromise, getRemotePool, connectRemote } = require("../backend/config/db");

async function debugTieBreaker() {
  const localPool = await poolPromise;
  await connectRemote();
  const remotePool = getRemotePool();
  const id = '8C026364-77E7-4002-803B-9BBE187C60BD';

  const lFetch = localPool.request().input('cpk_0', id);
  const rFetch = remotePool.request().input('cpk_0', id);
  const lFull = (await lFetch.query('SELECT TOP 1 * FROM [dbo].[UserMaster] WHERE [UserId] = @cpk_0')).recordset[0];
  const rFull = (await rFetch.query('SELECT TOP 1 * FROM [dbo].[UserMaster] WHERE [UserId] = @cpk_0')).recordset[0];

  const lColsRes = await localPool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'UserMaster'");
  const rColsRes = await remotePool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'UserMaster'");
  const lCols = new Set(lColsRes.recordset.map(c => c.COLUMN_NAME.toLowerCase()));
  const rCols = new Set(rColsRes.recordset.map(c => c.COLUMN_NAME.toLowerCase()));

  const LOCAL_SESSION_PROTECTED_COLS = new Set(['isloggedin', 'lastheartbeat', 'activesessionid']);
  const isProtectedColumn = col => LOCAL_SESSION_PROTECTED_COLS.has(col.toLowerCase());
  const readOnlyCols = new Set();
  const pkCols = ['UserId'];

  const compareCols = Object.keys(lFull).filter(k => 
    !readOnlyCols.has(k.toLowerCase()) && 
    !isProtectedColumn(k) &&
    rCols.has(k.toLowerCase()) && 
    lCols.has(k.toLowerCase()) &&
    !pkCols.some(pk => pk.toLowerCase() === k.toLowerCase())
  );

  console.log("compareCols count:", compareCols.length);

  const uReq = localPool.request();
  const updateAssignments = compareCols.map((k, idx) => {
    uReq.input(`up_${idx}`, rFull[k]);
    return `[${k}] = @up_${idx}`;
  }).join(', ');
  uReq.input('up_pk_0', id);
  const uWhere = '[UserId] = @up_pk_0';
  const sql = `UPDATE [dbo].[UserMaster] SET ${updateAssignments} WHERE ${uWhere}`;
  
  console.log("Executing UPDATE...");
  try {
    const res = await uReq.query(sql);
    console.log("UPDATE SUCCESS! rowsAffected:", res.rowsAffected);
  } catch (err) {
    console.error("UPDATE ERROR CAUGHT:", err.message);
  }

  process.exit(0);
}

debugTieBreaker().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
