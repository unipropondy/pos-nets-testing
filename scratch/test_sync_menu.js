const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../backend/.env") });
const { poolPromise, remotePoolPromise, connectRemote } = require("../backend/config/db");

async function testSyncMenu() {
  try {
    const local = await poolPromise;
    const remote = await remotePoolPromise || await connectRemote();
    console.log("Local connected:", !!local?.connected);
    console.log("Remote connected:", !!remote?.connected);

    const lDishes = await local.request().query("SELECT COUNT(*) as cnt FROM DishMaster");
    const rDishes = await remote.request().query("SELECT COUNT(*) as cnt FROM DishMaster");
    console.log("Local Dish count:", lDishes.recordset[0].cnt, "Remote Dish count:", rDishes.recordset[0].cnt);

    const lCats = await local.request().query("SELECT COUNT(*) as cnt FROM CategoryMaster");
    const rCats = await remote.request().query("SELECT COUNT(*) as cnt FROM CategoryMaster");
    console.log("Local Category count:", lCats.recordset[0].cnt, "Remote Category count:", rCats.recordset[0].cnt);

    const lGroups = await local.request().query("SELECT COUNT(*) as cnt FROM DishGroupMaster");
    const rGroups = await remote.request().query("SELECT COUNT(*) as cnt FROM DishGroupMaster");
    console.log("Local Group count:", lGroups.recordset[0].cnt, "Remote Group count:", rGroups.recordset[0].cnt);

    const lTables = await local.request().query("SELECT COUNT(*) as cnt FROM TableMaster");
    const rTables = await remote.request().query("SELECT COUNT(*) as cnt FROM TableMaster");
    console.log("Local Table count:", lTables.recordset[0].cnt, "Remote Table count:", rTables.recordset[0].cnt);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

testSyncMenu();
