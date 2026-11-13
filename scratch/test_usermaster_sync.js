const { syncTable2Way } = require("../backend/services/autoProvisionLocalDb");
const { poolPromise, getRemotePool, connectRemote } = require("../backend/config/db");

async function testUserMasterSync() {
  const localPool = await poolPromise;
  await connectRemote();
  const remotePool = getRemotePool();

  console.log("Calling syncTable2Way for UserMaster (pullOnly)...");
  const res = await syncTable2Way(remotePool, localPool, "UserMaster", "UserId", 2000, "pullOnly");
  console.log("Result of syncTable2Way:", res);

  const targetUserId = "8C026364-77E7-4002-803B-9BBE187C60BD";
  const lUser = await localPool.request().input("id", targetUserId).query("SELECT UserId, UserName, UserPassword, AllowedLogins FROM UserMaster WHERE UserId = @id");
  console.log("Local User row after sync:", lUser.recordset[0]);

  process.exit(0);
}

testUserMasterSync().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
