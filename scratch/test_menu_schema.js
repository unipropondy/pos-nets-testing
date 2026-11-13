const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../backend/.env") });
const { remotePoolPromise, connectRemote } = require("../backend/config/db");

async function checkMenuTables() {
  try {
    const remote = await remotePoolPromise || await connectRemote();
    if (!remote) {
      console.log("Remote DB not connected");
      process.exit(1);
    }
    console.log("Connected to Remote DB!");
    
    const tables = [
      "CategoryMaster",
      "SubCategoryMaster",
      "DishGroupMaster",
      "DishMaster",
      "ModifierMaster",
      "DishModifier",
      "DishGroupModifier",
      "ComboGroupMaster",
      "ComboGroupDishMapping",
      "ParentDishComboGroupMapping",
      "TableMaster",
      "Paymode"
    ];

    for (const t of tables) {
      const countRes = await remote.request().query(`SELECT COUNT(*) AS cnt FROM [dbo].[${t}]`).catch(err => ({ error: err.message }));
      if (countRes.error) {
        console.log(`Table [${t}]: ERROR - ${countRes.error}`);
      } else {
        const pkRes = await remote.request().query(`
          SELECT kcu.COLUMN_NAME
          FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
          JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc 
            ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME 
           AND kcu.TABLE_NAME = tc.TABLE_NAME
          WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' 
            AND kcu.TABLE_NAME = '${t}'
        `).catch(() => ({ recordset: [] }));
        const pks = pkRes.recordset.map(r => r.COLUMN_NAME).join(", ");
        console.log(`Table [${t}]: ${countRes.recordset[0].cnt} rows, PK: [${pks}]`);
      }
    }
  } catch (e) {
    console.error("Error:", e);
  } finally {
    process.exit(0);
  }
}

checkMenuTables();
