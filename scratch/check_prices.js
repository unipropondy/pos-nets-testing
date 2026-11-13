const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../backend/.env") });
const { remotePoolPromise, connectRemote } = require("../backend/config/db");

async function checkPrices() {
  try {
    const remote = await remotePoolPromise || await connectRemote();
    const tables = await remote.request().query(`
      SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_NAME LIKE '%Price%' OR TABLE_NAME LIKE '%Dish%' OR TABLE_NAME LIKE '%Menu%'
      ORDER BY TABLE_NAME
    `);
    console.log("Pricing/Menu tables:", tables.recordset.map(r => r.TABLE_NAME));

    for (const t of tables.recordset.map(r => r.TABLE_NAME)) {
      const c = await remote.request().query(`SELECT COUNT(*) as cnt FROM [dbo].[${t}]`).catch(e => ({ cnt: 'ERR' }));
      console.log(`  ${t}: ${c.recordset ? c.recordset[0].cnt : 'ERR'}`);
    }
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

checkPrices();
