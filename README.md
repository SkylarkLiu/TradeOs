# TradeOS

本地优先的个人财富与交易管理系统，包含全局资产、真实交易、策略版本、交易复盘、手动历史回测、绩效分析和财务自由规划。中文界面，默认深色，支持浅色及手机布局。

所有金额以十进制字符串保存、使用 Decimal 计算。真实成交与财富账本共用事务；模拟回测使用独立数据表。首版无需云账号，价格、汇率与成交由用户录入。

## 开始使用

需要 Node.js 22.12+ 和 npm。依赖包含 SQLite 原生模块；没有适配预编译包时需要本机编译工具。

```sh
npm ci
npm run db:setup
npm run dev
```

访问 [TradeOS](http://127.0.0.1:3000/wealth)。正式数据库为 `data/tradeos.db`，首次启动是空账本。自定义位置可复制 `.env.example` 为 `.env` 后设置 `DATABASE_URL`；相对路径从项目根目录解析。

首先创建平台和账户，创建资产，录入期初持仓，再更新非现金资产价格及跨币种汇率。建议录入个人财务数据前先阅读 [使用手册](docs/user-guide.md)。

## 虚拟演示

```sh
npm run demo
npm run dev:demo -- --port 3002
```

访问 [虚拟演示](http://127.0.0.1:3002/wealth)。演示只写入 `data/demo.db`，包含虚拟平台、交易、历史价格、复盘和回测任务。再次执行 `npm run demo` 会重建演示数据；不能用于保存个人账本。演示脚本检查数据库文件名，禁止写入正式数据库。

## 生产运行与备份

```sh
npm run build
npm run start
```

服务默认只监听本机。设置页提供完整JSON和SQLite备份。JSON恢复先显示记录数量，并自动保存恢复前备份；校验或事务失败保留原数据。不要用CSV代替完整备份，也不要在服务运行时仅复制SQLite主文件。

Docker部署文件已提供：

```sh
docker compose up --build -d
```

Compose绑定 `127.0.0.1:3000`，数据库保存于命名卷 `tradeos-data`。本次仅验证了配置，本机Docker守护进程未运行，尚未完成容器构建和启动验证。不要使用删除卷的命令清理财务数据。

## 验证

```sh
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm run test:standalone
npm audit --omit=dev
```

当前48项计算/数据库/访问保护测试与11条浏览器测试通过，覆盖20个主要页面。测试使用 `data/unit.db`、`data/e2e.db`，不会写入正式或演示账本。执行结果与边界见 [测试及验收](docs/testing.md)。

## 文档

- [使用手册](docs/user-guide.md)：首次建账、交易、回测、备份恢复。
- [架构](docs/architecture.md)、[数据库](docs/database.md)、[计算口径](docs/calculations.md)。
- [开发记录](docs/development-plan.md)、[测试及验收](docs/testing.md)、[技术决策](docs/decisions.md)。
- [产品范围](PRODUCT.md)、[设计规范](DESIGN.md)。

首版适用于个人规模的本地使用。支持现货、线性及反向合约；不模拟维持保证金、强平、资金费、期权或交易所特殊规则。不连接交易所自动执行买卖、提现或划转。FIRE情景是用户假设下的数学模拟。
