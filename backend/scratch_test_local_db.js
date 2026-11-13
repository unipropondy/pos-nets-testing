const sql = require("mssql");
require("dotenv").config();

async function testConnection(label, config) {
  console.log(`\n-----------------------------------------`);
  console.log(`Testing [${label}]...`);
  try {
    const pool = await new sql.ConnectionPool(config).connect();
    console.log(`✅ [${label}] SUCCESS! Connected to database.`);
    const result = await pool.request().query("SELECT @@VERSION AS ver, DB_NAME() as dbname");
    console.log(`   Database: ${result.recordset[0].dbname}`);
    console.log(`   Version: ${result.recordset[0].ver.split('\n')[0]}`);
    await pool.close();
    return true;
  } catch (err) {
    console.error(`❌ [${label}] FAILED: ${err.message}`);
    return false;
  }
}

async function runTests() {
  const user = process.env.LOCAL_DB_USER || "sa";
  const password = process.env.LOCAL_DB_PASSWORD || "Unipro@2026";
  const database = process.env.LOCAL_DB_NAME || "UCSPONDY";

  await testConnection("Port 1434 - 127.0.0.1", {
    user, password, database,
    server: "127.0.0.1", port: 1434,
    options: { encrypt: false, trustServerCertificate: true, connectTimeout: 5000 }
  });

  await testConnection("Port 1434 - master DB", {
    user, password, database: "master",
    server: "127.0.0.1", port: 1434,
    options: { encrypt: false, trustServerCertificate: true, connectTimeout: 5000 }
  });
}

runTests();
