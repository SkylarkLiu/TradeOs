-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TradeFill" (
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
INSERT INTO "new_TradeFill" ("action", "at", "fee", "id", "price", "quantity", "slippage", "tradeId", "transactionId") SELECT "action", "at", "fee", "id", "price", "quantity", "slippage", "tradeId", "transactionId" FROM "TradeFill";
DROP TABLE "TradeFill";
ALTER TABLE "new_TradeFill" RENAME TO "TradeFill";
CREATE UNIQUE INDEX "TradeFill_transactionId_key" ON "TradeFill"("transactionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
