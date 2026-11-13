const { poolPromise, getRemotePool, connectRemote } = require("../backend/config/db");

async function checkUserMaster() {
  const localPool = await poolPromise;
  await connectRemote();
  const remotePool = getRemotePool();

  const lCols = await localPool.request().query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'UserMaster'");
  console.log("Local UserMaster Columns:", lCols.recordset.map(c => c.COLUMN_NAME).join(", "));

  const rCols = await remotePool.request().query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'UserMaster'");
  console.log("Remote UserMaster Columns:", rCols.recordset.map(c => c.COLUMN_NAME).join(", "));

  const targetUserId = "8C026364-77E7-4002-803B-9BBE187C60BD";
  const lUser = await localPool.request().input("id", targetUserId).query("SELECT UserId, UserCode, UserName, UserPassword, AllowedLogins, IsDisabled FROM UserMaster WHERE UserId = @id");
  console.log("Local User row:", lUser.recordset[0]);

  const rUser = await remotePool.request().input("id", targetUserId).query("SELECT UserId, UserCode, UserName, UserPassword, AllowedLogins, IsDisabled FROM UserMaster WHERE UserId = @id");
  console.log("Remote User row:", rUser.recordset[0]);

  process.exit(0);
}

checkUserMaster().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
