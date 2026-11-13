const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../backend/.env") });
const { remotePoolPromise, connectRemote } = require("../backend/config/db");

async function checkCols() {
  try {
    const remote = await remotePoolPromise || await connectRemote();
    const cols = await remote.request().query(`
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME IN ('DishMaster', 'CategoryMaster', 'DishGroupMaster', 'TableMaster', 'Paymode')
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `);
    cols.recordset.forEach(c => console.log(`${c.TABLE_NAME}.${c.COLUMN_NAME} (${c.DATA_TYPE})`));
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

checkCols();
