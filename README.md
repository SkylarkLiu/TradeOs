# TradeOS
本地优先的个人财富与交易管理系统。中文、单用户，默认深色。无自动交易、提现或资金划转。

## 本地运行
需要 Node.js 22.12+。

```sh
npm ci
npm run db:setup
npm run dev
```
打开 http://127.0.0.1:3000 。默认数据库是 `data/tradeos.db`，不进入 Git。自定义数据库路径可复制 `.env.example` 为 `.env`。

## 验证
```sh
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```
