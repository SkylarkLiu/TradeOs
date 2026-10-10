-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AccountCashFlow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    CONSTRAINT "AccountCashFlow_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AccountCashFlow_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "AssetTransaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AccountCashFlow" ("accountId", "amount", "at", "currency", "id", "kind", "transactionId") SELECT "accountId", "amount", "at", "currency", "id", "kind", "transactionId" FROM "AccountCashFlow";
DROP TABLE "AccountCashFlow";
ALTER TABLE "new_AccountCashFlow" RENAME TO "AccountCashFlow";
CREATE UNIQUE INDEX "AccountCashFlow_transactionId_key" ON "AccountCashFlow"("transactionId");
CREATE TABLE "new_TradeAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tradeId" TEXT,
    "strategyVersionId" TEXT,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradeAttachment_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TradeAttachment_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TradeAttachment" ("createdAt", "data", "id", "mime", "name", "strategyVersionId", "tradeId") SELECT "createdAt", "data", "id", "mime", "name", "strategyVersionId", "tradeId" FROM "TradeAttachment";
DROP TABLE "TradeAttachment";
ALTER TABLE "new_TradeAttachment" RENAME TO "TradeAttachment";
CREATE TABLE "new_Transfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "fee" TEXT NOT NULL,
    "cost" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_TRANSIT',
    "at" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "Transfer_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transfer_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transfer_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Transfer" ("assetId", "at", "completedAt", "cost", "fee", "fromId", "id", "quantity", "status", "toId") SELECT "assetId", "at", "completedAt", "cost", "fee", "fromId", "id", "quantity", "status", "toId" FROM "Transfer";
DROP TABLE "Transfer";
ALTER TABLE "new_Transfer" RENAME TO "Transfer";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
