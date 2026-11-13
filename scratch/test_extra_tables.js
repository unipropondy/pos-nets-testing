const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../backend/.env") });
const { remotePoolPromise, connectRemote } = require("../backend/config/db");

async function checkExtraTables() {
  try {
    const remote = await remotePoolPromise || await connectRemote();
    const tables = [
      "CategoryKitchenType",
      "DishGroupKitchentype",
      "DishGroupMapping",
      "PrintMaster",
      "KitchenMaster",
      "TerminalMaster",
      "DiningSectionMaster",
      "Paymode"
    ];

    for (const t of tables) {
      const exists = await remote.request().query(`SELECT OBJECT_ID('${t}', 'U') AS id`);
      if (!exists.recordset[0].id) {
        console.log(`Table [${t}] does NOT exist in Remote DB.`);
        continue;
      }
      const countRes = await remote.request().query(`SELECT COUNT(*) AS cnt FROM [dbo].[${t}]`);
      const pkRes = await remote.request().query(`
        SELECT kcu.COLUMN_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc 
          ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME 
         AND kcu.TABLE_NAME = tc.TABLE_NAME
        WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' 
          AND kcu.TABLE_NAME = '${t}'
      `);
      const pks = pkRes.recordset.map(r => r.COLUMN_NAME).join(", ");
      const cols = await remote.request().query(`SELECT TOP 1 * FROM [dbo].[${t}]`);
      console.log(`Table [${t}]: ${countRes.recordset[0].cnt} rows, PK: [${pks}], Cols: [${Object.keys(cols.recordset[0] || {}).join(", ")}]`);
    }
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

checkExtraTables();
