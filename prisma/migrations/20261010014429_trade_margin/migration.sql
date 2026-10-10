-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Trade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "strategyVersionId" TEXT,
    "planId" TEXT,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "leverage" TEXT NOT NULL DEFAULT '1',
    "margin" TEXT NOT NULL DEFAULT '0',
    "initialRisk" TEXT NOT NULL DEFAULT '0',
    "quantity" TEXT NOT NULL DEFAULT '0',
    "averageEntry" TEXT NOT NULL DEFAULT '0',
    "realized" TEXT NOT NULL DEFAULT '0',
    "fees" TEXT NOT NULL DEFAULT '0',
    "stop" TEXT,
    "target" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "emotion" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "environment" TEXT NOT NULL DEFAULT '',
    "openedAt" DATETIME NOT NULL,
    "closedAt" DATETIME,
    CONSTRAINT "Trade_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Trade_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Trade_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Trade_planId_fkey" FOREIGN KEY ("planId") REFERENCES "TradingPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Trade" ("accountId", "assetId", "averageEntry", "closedAt", "direction", "emotion", "environment", "fees", "id", "initialRisk", "openedAt", "planId", "quantity", "realized", "reason", "status", "stop", "strategyVersionId", "tags", "target") SELECT "accountId", "assetId", "averageEntry", "closedAt", "direction", "emotion", "environment", "fees", "id", "initialRisk", "openedAt", "planId", "quantity", "realized", "reason", "status", "stop", "strategyVersionId", "tags", "target" FROM "Trade";
DROP TABLE "Trade";
ALTER TABLE "new_Trade" RENAME TO "Trade";
CREATE INDEX "Trade_accountId_openedAt_idx" ON "Trade"("accountId", "openedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
