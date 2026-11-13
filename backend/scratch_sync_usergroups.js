const { poolPromise, remotePoolPromise } = require("./config/db");

async function syncUserGroups() {
  try {
    const localPool = await poolPromise;
    const remotePool = await remotePoolPromise;

    console.log("Fetching UserGroupMaster from Remote DB...");
    const remoteRes = await remotePool.request().query("SELECT * FROM UserGroupMaster");
    const remoteGroups = remoteRes.recordset;

    console.log(`Found ${remoteGroups.length} groups in Remote DB:`, remoteGroups);

    for (const group of remoteGroups) {
      const checkRes = await localPool.request()
        .input("gid", group.UserGroupId)
        .query("SELECT COUNT(*) AS cnt FROM UserGroupMaster WHERE UserGroupId = @gid");

      if (checkRes.recordset[0].cnt === 0) {
        await localPool.request()
          .input("UserGroupId", group.UserGroupId)
          .input("UserGroupCode", group.UserGroupCode)
          .input("UserGroupName", group.UserGroupName)
          .input("isActive", group.isActive !== undefined ? group.isActive : 1)
          .query(`
            INSERT INTO UserGroupMaster (UserGroupId, UserGroupCode, UserGroupName, isActive)
            VALUES (@UserGroupId, @UserGroupCode, @UserGroupName, @isActive)
          `);
        console.log(`✅ Copied group [${group.UserGroupCode}] (${group.UserGroupName}) to Local DB.`);
      }
    }
  } catch (err) {
    console.error("Error syncing UserGroupMaster:", err.message);
  } finally {
    process.exit(0);
  }
}

syncUserGroups();
