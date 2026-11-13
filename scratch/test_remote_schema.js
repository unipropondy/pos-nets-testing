const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../backend/.env") });
const { remotePoolPromise, connectRemote } = require("../backend/config/db");

async function checkRemote() {
  try {
    const remote = await remotePoolPromise || await connectRemote();
    if (!remote) {
      console.log("Remote DB not connected");
      process.exit(1);
    }
    console.log("Connected to Remote DB!");
    
    // Check UserMaster columns and identity
    const cols = await remote.request().query(`
      SELECT 
        c.name AS col_name,
        t.name AS type_name,
        c.is_identity,
        c.is_nullable,
        c.is_computed
      FROM sys.columns c
      JOIN sys.types t ON c.user_type_id = t.user_type_id
      WHERE c.object_id = OBJECT_ID('UserMaster')
      ORDER BY c.column_id
    `);
    console.log("UserMaster columns in Remote DB:", cols.recordset);

    const userCount = await remote.request().query("SELECT COUNT(*) AS cnt FROM UserMaster");
    console.log("UserMaster count in Remote DB:", userCount.recordset[0].cnt);

    const topUsers = await remote.request().query("SELECT TOP 5 UserId, UserName, UserCode, UserGroupId FROM UserMaster");
    console.log("Top users in Remote DB:", topUsers.recordset);
  } catch (e) {
    console.error("Error:", e);
  } finally {
    process.exit(0);
  }
}

checkRemote();
