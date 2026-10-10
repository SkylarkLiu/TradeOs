# TradeOS Android 离线样机

范围、安装验收和阶段进展见[安卓迁移记录](../../docs/android-migration.md)。

## 构建

需要Node.js、Java 21、Android SDK 36（platform-tools/build-tools），并接受SDK许可。设置 `JAVA_HOME` 和 `ANDROID_SDK_ROOT`；本项目也支持已配置的根目录 `.tools` 本地工具。

```sh
npm ci
npm ci --prefix apps/android
npm run apk --prefix apps/android
```

生成根目录 `artifacts/android/TradeOS-offline-prototype-0.2.0.apk` 及校验文件。源码依赖由独立package-lock锁定；生成的网页资源由Capacitor同步，不提交到Git。

## 检查

```sh
npm run check --prefix apps/android
npm run test --prefix apps/android
npm run test:e2e --prefix apps/android
```

领域测试使用根项目better-sqlite3，因此先安装根依赖。浏览器测试需安装Playwright Chromium。原生测试需连接测试设备/模拟器，在 `apps/android/android` 运行 `./gradlew :app:connectedDebugAndroidTest`，使用app范围，避免生成的库示例测试。此命令可能在结束时卸载测试应用，请只在专用验收设备上使用。

安卓数据适配器在 `src/sql.ts`，领域规则在 `src/ledger.ts`，系统文件插件在 `android/app/src/main/java/com/tradeos/offline/prototype/TradeFilesPlugin.java`。原生数据库与浏览器验证数据库相互独立。

0.2.0将现货流水计算和输入校验与Web共用，新增资产表和Schema版本。0.1.0数据可直接升级，v1备份可恢复；请在独立验收设备验证覆盖升级，不要卸载旧版。
