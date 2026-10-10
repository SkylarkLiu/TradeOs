-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AssetTransaction" (
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
INSERT INTO "new_AssetTransaction" ("accountId", "assetId", "at", "cashDelta", "currency", "externalId", "fee", "id", "note", "price", "quantity", "reversalOf", "transferId", "type") SELECT "accountId", "assetId", "at", "cashDelta", "currency", "externalId", "fee", "id", "note", "price", "quantity", "reversalOf", "transferId", "type" FROM "AssetTransaction";
DROP TABLE "AssetTransaction";
ALTER TABLE "new_AssetTransaction" RENAME TO "AssetTransaction";
CREATE UNIQUE INDEX "AssetTransaction_externalId_key" ON "AssetTransaction"("externalId");
CREATE UNIQUE INDEX "AssetTransaction_reversalOf_key" ON "AssetTransaction"("reversalOf");
CREATE INDEX "AssetTransaction_accountId_at_idx" ON "AssetTransaction"("accountId", "at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
