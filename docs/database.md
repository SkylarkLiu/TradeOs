# 数据库
完整字段、唯一约束和外键见 `prisma/schema.prisma`，迁移见 `prisma/migrations`。

Platform→Account→AssetBalance。Asset全局唯一code。AssetTransaction是账本，余额可重建。TradeFill唯一关联AssetTransaction。StrategyVersion发布后锁定。Transfer关联两侧流水；IN_TRANSIT资产计一次。

BacktestSession、Candle、BacktestTrade与真实流水无关联。PortfolioSnapshot记录完整性，缺失价格不能作为完整收益计算输入。AccountValuation允许平台手工估值。ImportBatch和行标识保证幂等。AuditLog保留关键操作。
