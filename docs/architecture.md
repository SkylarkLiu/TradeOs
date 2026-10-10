# 架构
Next.js模块化单体。本地SQLite，Prisma 7驱动适配器。页面调用Route Handlers，Zod验证后进入业务服务。Decimal计算独立于数据库和UI。Zustand仅保存界面状态。

真实成交、资产流水和余额在同一数据库事务提交。回测入口只访问模拟实体。单用户服务只监听loopback；请求写入验证来源。读API无缓存，SQLite事务串行写入。

金额数据库字段使用规范化十进制TEXT；服务还原为Decimal，接口保持字符串。图表绘图时才转换Number。价格、汇率带UTC时间和来源，缺失时显示不完整。
