-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BacktestSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "strategyVersionId" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "initialCapital" TEXT NOT NULL,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "branch" INTEGER NOT NULL DEFAULT 1,
    "adjustment" TEXT NOT NULL,
    "feeRate" TEXT NOT NULL DEFAULT '0.001',
    "slippageBps" TEXT NOT NULL DEFAULT '0',
    "annotations" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BacktestSession_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BacktestSession_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BacktestSession" ("adjustment", "assetId", "branch", "createdAt", "currency", "cursor", "id", "initialCapital", "name", "strategyVersionId", "timeframe") SELECT "adjustment", "assetId", "branch", "createdAt", "currency", "cursor", "id", "initialCapital", "name", "strategyVersionId", "timeframe" FROM "BacktestSession";
DROP TABLE "BacktestSession";
ALTER TABLE "new_BacktestSession" RENAME TO "BacktestSession";
CREATE TABLE "new_BacktestTrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "branch" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "entry" TEXT NOT NULL,
    "stop" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "exit" TEXT,
    "exitFee" TEXT NOT NULL DEFAULT '0',
    "fee" TEXT NOT NULL,
    "realized" TEXT NOT NULL DEFAULT '0',
    "entryIndex" INTEGER NOT NULL,
    "exitIndex" INTEGER,
    CONSTRAINT "BacktestTrade_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BacktestSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BacktestTrade" ("branch", "direction", "entry", "entryIndex", "exit", "exitIndex", "fee", "id", "quantity", "realized", "sessionId", "stop", "target") SELECT "branch", "direction", "entry", "entryIndex", "exit", "exitIndex", "fee", "id", "quantity", "realized", "sessionId", "stop", "target" FROM "BacktestTrade";
DROP TABLE "BacktestTrade";
ALTER TABLE "new_BacktestTrade" RENAME TO "BacktestTrade";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
