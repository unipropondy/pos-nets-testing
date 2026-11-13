const { poolPromise } = require("./config/db");

async function checkUsers() {
  try {
    const pool = await poolPromise;
    console.log("Checking Local DB UserMaster and UserGroupMaster...");

    const users = await pool.request().query(`
      SELECT u.UserId, u.UserName, u.UserPassword, u.IsDisabled, u.UserGroupid, g.UserGroupCode, g.UserGroupName
      FROM UserMaster u
      LEFT JOIN UserGroupMaster g ON u.UserGroupid = g.UserGroupId
    `);
    console.log("Users in Local DB:", JSON.stringify(users.recordset, null, 2));

    const groups = await pool.request().query(`SELECT * FROM UserGroupMaster`);
    console.log("UserGroups in Local DB:", JSON.stringify(groups.recordset, null, 2));
  } catch (err) {
    console.error("Error checking users:", err.message);
  } finally {
    process.exit(0);
  }
}

checkUsers();
