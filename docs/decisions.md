# 技术决策
1. 遵循用户指定Next.js和SQLite；不使用TanStack/云端模板。
2. Prisma 7.10稳定版，避开registry默认预发布版本。参考 https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/sqlite 。
3. 金额TEXT映射Decimal，避免SQLite数值亲和性造成精度损失。
4. 统一账本、业务事务和不可变成交；不增加微服务、权限系统和自动交易。
5. 用户已批准中文深色金融终端方向与七阶段执行；按brief直接实现，不再重复视觉选择。
