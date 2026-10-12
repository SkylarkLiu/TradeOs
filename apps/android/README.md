# TradeOS Android 离线样机

范围、安装验收和阶段进展见[安卓迁移记录](../../docs/android-migration.md)。

## 构建

需要Node.js、Java 21、Android SDK 36（platform-tools/build-tools），并接受SDK许可。设置 `JAVA_HOME` 和 `ANDROID_SDK_ROOT`；本项目也支持已配置的根目录 `.tools` 本地工具。

```sh
npm ci
npm ci --prefix apps/android
npm run apk --prefix apps/android
```

生成根目录 `artifacts/android/TradeOS-offline-prototype-0.6.0.apk` 及校验文件。源码依赖由独立package-lock锁定；生成的网页资源由Capacitor同步，不提交到Git。

## 检查

```sh
npm run check --prefix apps/android
npm run test --prefix apps/android
npm run test:e2e --prefix apps/android
```

领域测试使用根项目better-sqlite3，因此先安装根依赖。浏览器测试需安装Playwright Chromium。原生测试需连接测试设备/模拟器，在 `apps/android/android` 运行 `./gradlew :app:connectedDebugAndroidTest`，使用app范围，避免生成的库示例测试。此命令可能在结束时卸载测试应用，请只在专用验收设备上使用。

安卓数据适配器在 `src/sql.ts`，领域规则在 `src/ledger.ts`，系统文件插件在 `android/app/src/main/java/com/tradeos/offline/prototype/TradeFilesPlugin.java`。原生数据库与浏览器验证数据库相互独立。

0.2.0将现货流水计算和输入校验与Web共用，新增资产表和Schema版本。0.1.0数据可直接升级，v1备份可恢复；请在独立验收设备验证覆盖升级，不要卸载旧版。

0.3.0增加策略、版本、风险计划、现货交易、成交和持仓事件。共用的策略/计划/成交输入及成交变更计算位于 `packages/core/src/trading.ts`，原生业务在 `src/trading.ts`。持仓预留检查由资产和交易写入口共用；交易成交的流水、余额、持仓、汇总和事件一次批量事务提交。备份version3可读v1/v2，恢复前会重算成交与交易汇总，并核对每笔成交对应的资产流水及持仓占用。

0.4.0增加 `src/review.ts` 和 `src/review-view.tsx`，评分定义与验证在 `packages/core/src/review.ts` 共用。复盘带规则快照及全局递增sequence，最新单笔复盘判定纪律，历次标签保留。复盘生成策略草稿时调用无写入的 `TradingCommands.prepareStrategy`，将版本和ReviewImprovement关联一次事务提交；原交易和已发布版本不变。Schema/备份4可读旧v1/v2/v3，恢复校验复盘、规则、已平仓交易及版本关联。

0.6.0增加 `src/wealth.ts` 与 `src/wealth-view.tsx`。Schema/备份直接升至6（0.5.0搁置），可恢复v1/v2/v3/v4/v6。新增9张财富表，保留旧15张业务表；现金与现货内部划转复用现有流水计算，转出/到账和元数据各自原子提交。在途计一次，现货沿用源账户移动平均成本，转入不产生已实现利润。FXRate仅支持最新有效的直接/反向汇率，不做多跳推导。估值默认有效期7天，可设置1–3650天。

Web与安卓共用 `packages/core/src/fire.ts` 的目标校验、三情景增长、必要月投入和退休后30年提取模型。负可投资净资产或估值不完整时不展示达标预测。债务登记只维护余额/历史，不自动创建现金收支。财富快照只保存当前时点，不回填历史估值，不作为TWR/XIRR。

安卓未接入行情数据源，0.5.0回测暂缓。交易复盘使用自己录入的计划、成交与执行记录；图表回测须另行提供真实历史OHLCV。电脑CSV回放仍可使用。正式数据库加密、合约、附件和桌面备份兼容仍在后续阶段。
