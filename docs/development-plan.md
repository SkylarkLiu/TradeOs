# 开发阶段
- Phase 1：基础工程、全量数据模型、计算基础、导航。
- Phase 2：资产闭环、CSV。
- Phase 3：真实交易闭环。
- Phase 4：复盘、绩效、资产收益。
- Phase 5：隔离手动回测。
- Phase 6：FIRE、对账、备份恢复。
- Phase 7：集成测试、性能、Docker、文档。
只有对应检查通过后才标记完成。

## Phase 1 完成
数据库迁移、中文导航、主题、精度计算及基础文档。6项单元测试、1条E2E、typecheck、lint通过。提交d3f0f07。

## Phase 2 完成
平台账户、资产、资金流水、含手续费在途转账、多币种估值、负债、完整快照、CSV映射预览/校验/幂等导入/导出。12项测试、2条E2E、typecheck、lint通过。首次浏览器来源校验发现Next内部URL与Host不同，已改为校验Origin与实际Host并验证。
