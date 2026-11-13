const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../backend/.env") });
const { poolPromise, remotePoolPromise, connectRemote } = require("../backend/config/db");
const { syncSchemaFromRemoteToLocal } = require("../backend/services/autoProvisionLocalDb");

async function testSync() {
  try {
    const local = await poolPromise;
    const remote = await remotePoolPromise || await connectRemote();
    console.log("Local connected:", !!local?.connected);
    console.log("Remote connected:", !!remote?.connected);
    
    // Let's test syncSchemaFromRemoteToLocal
    const res = await syncSchemaFromRemoteToLocal();
    console.log("syncSchemaFromRemoteToLocal result:", res);
  } catch (e) {
    console.error("Test sync error:", e);
  } finally {
    process.exit(0);
  }
}

testSync();
