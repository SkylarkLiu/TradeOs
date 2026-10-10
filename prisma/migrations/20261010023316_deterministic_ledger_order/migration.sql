-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AssetTransaction" (
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "price" TEXT NOT NULL DEFAULT '0',
    "fee" TEXT NOT NULL DEFAULT '0',
    "cashDelta" TEXT NOT NULL DEFAULT '0',
    "costDelta" TEXT NOT NULL DEFAULT '0',
    "realizedDelta" TEXT NOT NULL DEFAULT '0',
    "currency" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "externalId" TEXT,
    "transferId" TEXT,
    "reversalOf" TEXT,
    CONSTRAINT "AssetTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssetTransaction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssetTransaction_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AssetTransaction" ("accountId", "assetId", "at", "cashDelta", "costDelta", "currency", "externalId", "fee", "id", "note", "price", "quantity", "realizedDelta", "reversalOf", "transferId", "type") SELECT "accountId", "assetId", "at", "cashDelta", "costDelta", "currency", "externalId", "fee", "id", "note", "price", "quantity", "realizedDelta", "reversalOf", "transferId", "type" FROM "AssetTransaction";
DROP TABLE "AssetTransaction";
ALTER TABLE "new_AssetTransaction" RENAME TO "AssetTransaction";
CREATE UNIQUE INDEX "AssetTransaction_externalId_key" ON "AssetTransaction"("externalId");
CREATE UNIQUE INDEX "AssetTransaction_reversalOf_key" ON "AssetTransaction"("reversalOf");
CREATE INDEX "AssetTransaction_accountId_at_idx" ON "AssetTransaction"("accountId", "at");
WITH ranked AS (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "accountId" ORDER BY "at", rowid) AS ordinal FROM "AssetTransaction") UPDATE "AssetTransaction" SET "sequence"=(SELECT ordinal FROM ranked WHERE ranked.id="AssetTransaction".id);
CREATE UNIQUE INDEX "AssetTransaction_accountId_sequence_key" ON "AssetTransaction"("accountId", "sequence");
CREATE TABLE "new_TradeFill" (
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL PRIMARY KEY,
    "tradeId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "fee" TEXT NOT NULL,
    "slippage" TEXT NOT NULL DEFAULT '0',
    "pnl" TEXT NOT NULL DEFAULT '0',
    "at" DATETIME NOT NULL,
    CONSTRAINT "TradeFill_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TradeFill_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "AssetTransaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TradeFill" ("action", "at", "fee", "id", "pnl", "price", "quantity", "slippage", "tradeId", "transactionId") SELECT "action", "at", "fee", "id", "pnl", "price", "quantity", "slippage", "tradeId", "transactionId" FROM "TradeFill";
DROP TABLE "TradeFill";
ALTER TABLE "new_TradeFill" RENAME TO "TradeFill";
CREATE UNIQUE INDEX "TradeFill_transactionId_key" ON "TradeFill"("transactionId");
WITH ranked AS (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "tradeId" ORDER BY "at", rowid) AS ordinal FROM "TradeFill") UPDATE "TradeFill" SET "sequence"=(SELECT ordinal FROM ranked WHERE ranked.id="TradeFill".id);
CREATE UNIQUE INDEX "TradeFill_tradeId_sequence_key" ON "TradeFill"("tradeId", "sequence");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
