-- CreateTable
CREATE TABLE "Platform" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "template" TEXT NOT NULL DEFAULT 'Other',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platformId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Account_platformId_fkey" FOREIGN KEY ("platformId") REFERENCES "Platform" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "instrument" TEXT NOT NULL DEFAULT 'SPOT',
    "multiplier" TEXT NOT NULL DEFAULT '1',
    "investable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AssetBalance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "quantity" TEXT NOT NULL DEFAULT '0',
    "cost" TEXT NOT NULL DEFAULT '0',
    "realized" TEXT NOT NULL DEFAULT '0',
    "purpose" TEXT NOT NULL DEFAULT 'LONG_TERM',
    CONSTRAINT "AssetBalance_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AssetBalance_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssetPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    CONSTRAINT "AssetPrice_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FXRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "rate" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL'
);

-- CreateTable
CREATE TABLE "AssetTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "price" TEXT NOT NULL DEFAULT '0',
    "fee" TEXT NOT NULL DEFAULT '0',
    "cashDelta" TEXT NOT NULL DEFAULT '0',
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

-- CreateTable
CREATE TABLE "Transfer" (
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
    CONSTRAINT "Transfer_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Liability" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "investable" BOOLEAN NOT NULL DEFAULT true,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "StrategyVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "strategyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "market" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "rules" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StrategyVersion_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradingPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "strategyVersionId" TEXT,
    "direction" TEXT NOT NULL,
    "entry" TEXT NOT NULL,
    "stop" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "equity" TEXT NOT NULL,
    "riskPercent" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "invalidation" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradingPlan_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TradingPlan_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TradingPlan_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "strategyVersionId" TEXT,
    "planId" TEXT,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
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

-- CreateTable
CREATE TABLE "TradeFill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tradeId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "fee" TEXT NOT NULL,
    "slippage" TEXT NOT NULL DEFAULT '0',
    "at" DATETIME NOT NULL,
    CONSTRAINT "TradeFill_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TradeFill_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "AssetTransaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PositionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tradeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PositionEvent_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tradeId" TEXT,
    "period" TEXT NOT NULL DEFAULT 'TRADE',
    "at" DATETIME NOT NULL,
    "scores" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    CONSTRAINT "TradeReview_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tradeId" TEXT,
    "strategyVersionId" TEXT,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradeAttachment_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BacktestSession" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BacktestSession_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BacktestSession_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Candle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    "open" TEXT NOT NULL,
    "high" TEXT NOT NULL,
    "low" TEXT NOT NULL,
    "close" TEXT NOT NULL,
    "volume" TEXT NOT NULL,
    CONSTRAINT "Candle_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BacktestSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BacktestTrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "branch" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "entry" TEXT NOT NULL,
    "stop" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "exit" TEXT,
    "fee" TEXT NOT NULL,
    "realized" TEXT NOT NULL DEFAULT '0',
    "entryIndex" INTEGER NOT NULL,
    "exitIndex" INTEGER,
    CONSTRAINT "BacktestTrade_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "BacktestSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AccountCashFlow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    CONSTRAINT "AccountCashFlow_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AccountValuation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    CONSTRAINT "AccountValuation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PortfolioSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "currency" TEXT NOT NULL,
    "assets" TEXT NOT NULL,
    "liabilities" TEXT NOT NULL,
    "net" TEXT NOT NULL,
    "investable" TEXT NOT NULL,
    "complete" BOOLEAN NOT NULL,
    "at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AssetAllocationSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "AssetAllocationSnapshot_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "PortfolioSnapshot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FinancialGoal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "retirementAge" INTEGER NOT NULL,
    "retirementDate" DATETIME NOT NULL,
    "monthlyContribution" TEXT NOT NULL,
    "monthlyExpense" TEXT NOT NULL,
    "inflation" TEXT NOT NULL,
    "conservative" TEXT NOT NULL,
    "baseReturn" TEXT NOT NULL,
    "optimistic" TEXT NOT NULL,
    "withdrawalRate" TEXT NOT NULL,
    "target" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'CNY'
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "row" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Platform_name_key" ON "Platform"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Account_platformId_name_key" ON "Account"("platformId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_code_key" ON "Asset"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AssetBalance_accountId_assetId_key" ON "AssetBalance"("accountId", "assetId");

-- CreateIndex
CREATE INDEX "AssetPrice_at_idx" ON "AssetPrice"("at");

-- CreateIndex
CREATE UNIQUE INDEX "AssetPrice_assetId_at_key" ON "AssetPrice"("assetId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "FXRate_from_to_at_key" ON "FXRate"("from", "to", "at");

-- CreateIndex
CREATE UNIQUE INDEX "AssetTransaction_externalId_key" ON "AssetTransaction"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetTransaction_reversalOf_key" ON "AssetTransaction"("reversalOf");

-- CreateIndex
CREATE INDEX "AssetTransaction_accountId_at_idx" ON "AssetTransaction"("accountId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Strategy_name_key" ON "Strategy"("name");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyVersion_strategyId_version_key" ON "StrategyVersion"("strategyId", "version");

-- CreateIndex
CREATE INDEX "Trade_accountId_openedAt_idx" ON "Trade"("accountId", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TradeFill_transactionId_key" ON "TradeFill"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Candle_sessionId_at_key" ON "Candle"("sessionId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "AccountCashFlow_transactionId_key" ON "AccountCashFlow"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountValuation_accountId_at_key" ON "AccountValuation"("accountId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioSnapshot_currency_at_key" ON "PortfolioSnapshot"("currency", "at");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialGoal_name_key" ON "FinancialGoal"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_hash_key" ON "ImportBatch"("hash");
