const { poolPromise, remotePoolPromise } = require("../backend/config/db");

async function main() {
  const localPool = await poolPromise;
  const remotePool = await remotePoolPromise;

  const tables = [
    "SettlementHeader",
    "SettlementItemDetail",
    "SettlementTotalSales",
    "SettlementDetail",
    "SettlementTranDetail",
    "SettlementDiscountDetail",
    "SettlementCreditSales",
    "RestaurantInvoice",
    "RestaurantInvoiceCur",
    "RestaurantOrder",
    "RestaurantOrderDetail",
    "Restaurantmodifierdetail",
    "BusinessDayLog",
    "BusinessDayAuditLog",
    "DateEntry",
    "CashInEntry",
    "CashOutEntry",
    "OpeningCashDenomination",
    "ArtistCashBox",
    "dishOrderItemShare",
    "MemberMaster",
    "CreditCustomerMaster",
    "CustomerCreditTransactions",
    "CustomerCreditAllocations",
    "RewardPointDetails",
    "LoyaltyCustomer",
    "LoyaltyVisit",
    "CustomerDishLoyaltyState"
  ];

  for (const tbl of tables) {
    const pkRes = await localPool.request().query(`
      SELECT kcu.COLUMN_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
      JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc 
        ON kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME 
       AND kcu.TABLE_NAME = tc.TABLE_NAME
      WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' 
        AND kcu.TABLE_NAME = '${tbl}'
      ORDER BY kcu.ORDINAL_POSITION
    `).catch(() => ({ recordset: [] }));

    const idRes = await localPool.request().query(`
      SELECT c.name
      FROM sys.columns c JOIN sys.tables t ON c.object_id = t.object_id
      WHERE t.name = '${tbl}' AND c.is_identity = 1
    `).catch(() => ({ recordset: [] }));

    const pks = pkRes.recordset.map(r => r.COLUMN_NAME);
    const idents = idRes.recordset.map(r => r.name);

    console.log(`${tbl.padEnd(30)} PK: [${pks.join(", ")}] | Identity: [${idents.join(", ")}]`);
  }

  process.exit(0);
}

main().catch(console.error);
