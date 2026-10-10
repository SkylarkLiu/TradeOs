import { db } from "../lib/repositories/db";
import { recordTransaction, portfolio } from "../lib/services/wealth";
import { tradingCommand, recordFill } from "../lib/services/trading";
import { reviewCommand, defaultScoreRules } from "../lib/services/analytics";
import { backtestCommand } from "../lib/services/backtest";
import { fireCommand } from "../lib/services/fire";
import { D } from "../lib/calculations/decimal";
if (!process.env.DATABASE_URL?.endsWith("/demo.db"))
  throw new Error("演示数据只能写入独立的data/demo.db");
if (await db.platform.count()) {
  console.log("独立演示账本已存在。");
  await db.$disconnect();
  process.exit(0);
}
await db.systemSetting.create({ data: { key: "demo", value: "true" } });
const time = (value: string) => new Date(`${value}+08:00`).toISOString();
const platforms = await Promise.all(
  ["银行", "IBKR", "富途", "Binance", "支付宝"].map((name) =>
    db.platform.create({
      data: {
        name,
        template:
          name === "银行"
            ? "Bank"
            : name === "支付宝"
              ? "Alipay"
              : name === "富途"
                ? "Futu"
                : name,
      },
    }),
  ),
);
const accounts = await Promise.all(
  platforms.map((p, i) =>
    db.account.create({
      data: {
        platformId: p.id,
        name: ["现金储备", "长期投资", "证券账户", "现货与交易", "基金账户"][i],
        currency: ["CNY", "USD", "CNY", "USDT", "CNY"][i],
      },
    }),
  ),
);
const assets = await Promise.all(
  [
    { code: "CASH:CNY", name: "人民币", assetClass: "CASH", currency: "CNY" },
    { code: "CASH:USD", name: "美元", assetClass: "CASH", currency: "USD" },
    {
      code: "CASH:USDT",
      name: "USDT余额",
      assetClass: "CASH",
      currency: "USDT",
    },
    {
      code: "NASDAQ:QQQ",
      name: "纳斯达克100 ETF",
      assetClass: "ETF",
      currency: "USD",
    },
    {
      code: "NASDAQ:AAPL",
      name: "Apple",
      assetClass: "STOCK",
      currency: "USD",
    },
    {
      code: "CRYPTO:BTC",
      name: "Bitcoin",
      assetClass: "CRYPTO",
      currency: "USDT",
    },
    {
      code: "CRYPTO:ETH",
      name: "Ethereum",
      assetClass: "CRYPTO",
      currency: "USDT",
    },
    {
      code: "FUND:513100",
      name: "纳指ETF（演示）",
      assetClass: "ETF",
      currency: "CNY",
    },
  ].map((data) => db.asset.create({ data })),
);
const strategy = await db.strategy.create({
  data: {
    name: "趋势突破与回踩",
    versions: {
      create: {
        version: 1,
        published: true,
        market: "股票 / 加密资产",
        timeframe: "日线",
        environment: "趋势延续",
        rules:
          "## 入场规则\n价格突破整理区间，回踩确认后入场。\n## 出场规则\n到达目标分批退出。\n## 止损规则\n跌破结构低点即退出。\n## 仓位管理\n每笔风险不超过账户权益的1%。\n## 失效条件\n区间突破失效。\n## 策略假设\n趋势具有短期延续性。\n## 历史验证结果\n演示记录，未经真实市场验证。",
      },
    },
  },
  include: { versions: true },
});
for (const [index, assetId, quantity] of [
  [0, assets[0].id, "240000"],
  [1, assets[1].id, "25000"],
  [2, assets[0].id, "80000"],
  [3, assets[2].id, "15000"],
  [4, assets[0].id, "60000"],
] as const)
  await recordTransaction({
    accountId: accounts[index].id,
    assetId,
    type: "DEPOSIT",
    quantity,
    at: time("2026-01-01T00:00:00"),
    note: "虚构演示期初资金",
  });
await recordTransaction({
  accountId: accounts[1].id,
  assetId: assets[3].id,
  type: "BUY",
  quantity: "25",
  price: "410",
  fee: "5",
  at: time("2026-01-02T10:00:00"),
  note: "虚构演示长期持仓",
});
await recordTransaction({
  accountId: accounts[4].id,
  assetId: assets[7].id,
  type: "BUY",
  quantity: "30000",
  price: "1.2",
  fee: "8",
  at: time("2026-01-02T10:00:00"),
  note: "虚构演示基金持仓",
});
const plan = await tradingCommand("plan.create", {
  accountId: accounts[1].id,
  assetId: assets[4].id,
  strategyVersionId: strategy.versions[0].id,
  direction: "LONG",
  entry: "190",
  stop: "180",
  target: "210",
  equity: "25000",
  riskPercent: "1",
  reason: "虚构演示：回踩确认",
  invalidation: "结构低点失守",
});
const trade = await tradingCommand("trade.create", {
  accountId: accounts[1].id,
  assetId: assets[4].id,
  planId: plan.id,
  direction: "LONG",
  reason: "虚构演示交易",
  emotion: "平静",
  openedAt: time("2026-01-03T10:00:00"),
});
for (const [action, quantity, price, fee, at] of [
  ["ENTRY", "20", "190", "2", "2026-01-03T10:00:00"],
  ["EXIT", "10", "198", "1", "2026-01-07T10:00:00"],
  ["EXIT", "10", "205", "1", "2026-01-10T10:00:00"],
] as const)
  await recordFill({
    tradeId: trade.id,
    action,
    quantity,
    price,
    fee,
    at: time(at),
  });
await reviewCommand("review.create", {
  tradeId: trade.id,
  period: "TRADE",
  at: time("2026-01-10T18:00:00"),
  scores: Object.fromEntries(defaultScoreRules.map((r) => [r.name, 4])),
  tags: ["PLAN_COMPLIANT", "GOOD_EXECUTION"],
  content:
    "按计划分批退出，初始风险保持不变。下一次继续记录入场时的情绪和成交滑点。本记录为虚构演示。",
});
await recordTransaction({
  accountId: accounts[3].id,
  assetId: assets[6].id,
  type: "BUY",
  quantity: "1",
  price: "2800",
  fee: "1",
  at: time("2026-09-20T10:00:00"),
  note: "虚构演示持仓",
});
const btc = await tradingCommand("trade.create", {
  accountId: accounts[3].id,
  assetId: assets[5].id,
  strategyVersionId: strategy.versions[0].id,
  direction: "LONG",
  initialRisk: "120",
  stop: "61000",
  target: "71000",
  reason: "虚构演示：区间突破",
  openedAt: time("2026-09-25T10:00:00"),
});
await recordFill({
  tradeId: btc.id,
  action: "ENTRY",
  quantity: "0.04",
  price: "64000",
  fee: "1.8",
  at: time("2026-09-25T10:00:00"),
});
await recordFill({
  tradeId: btc.id,
  action: "EXIT",
  quantity: "0.02",
  price: "66000",
  fee: "0.9",
  at: time("2026-09-30T10:00:00"),
});
const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
for (let month = 2; month <= Number(today.slice(5, 7)); month++)
  await recordTransaction({
    accountId: accounts[0].id,
    assetId: assets[0].id,
    type: "DEPOSIT",
    quantity: "5000",
    at: time(`2026-${String(month).padStart(2, "0")}-01T00:00:00`),
    note: "虚构演示新增本金",
  });
const start = new Date("2026-01-01T00:00:00+08:00"),
  end = new Date(`${today}T00:00:00+08:00`),
  prices = [],
  fx = [];
for (
  let tick = start.getTime(), i = 0;
  tick <= end.getTime();
  tick += 86400000, i++
) {
  const at = new Date(tick);
  for (const [assetIndex, base, drift] of [
    [3, 410, 0.2],
    [4, 190, 0.04],
    [5, 60000, 30],
    [6, 2500, 1.1],
    [7, 1.2, 0.0004],
  ])
    prices.push({
      assetId: assets[assetIndex].id,
      price: D(base)
        .plus(D(drift).mul(i))
        .plus(D(Math.sin(i / 18).toFixed(6)).mul(D(base).mul(".015")))
        .toFixed(6),
      at,
      source: "DEMO · 虚构价格",
    });
  for (const currency of ["USD", "USDT"])
    fx.push({
      from: currency,
      to: "CNY",
      rate: D("7.08")
        .plus(D(Math.sin(i / 37).toFixed(6)).mul("0.08"))
        .plus(currency === "USDT" ? "0.002" : "0")
        .toFixed(6),
      at,
      source: "DEMO · 虚构汇率",
    });
}
await db.assetPrice.createMany({ data: prices });
await db.fXRate.createMany({ data: fx });
await db.liability.create({
  data: {
    name: "个人借款（演示）",
    amount: "30000",
    currency: "CNY",
    at: start,
  },
});
for (const date of [
  ...Array.from(
    { length: Number(today.slice(5, 7)) },
    (_, i) => `2026-${String(i + 1).padStart(2, "0")}-01`,
  ),
  today,
]) {
  const at = new Date(`${date}T00:00:00+08:00`),
    p = await portfolio("CNY", at);
  await db.portfolioSnapshot.upsert({
    where: { currency_at: { currency: "CNY", at } },
    create: {
      currency: "CNY",
      assets: p.assets,
      liabilities: p.liabilities,
      net: p.net,
      investable: p.investable,
      complete: p.complete,
      at,
      allocations: {
        create: p.allocation.map((a) => ({
          assetClass: a.name,
          value: a.value,
        })),
      },
    },
    update: {},
  });
}
const retirement = new Date();
retirement.setFullYear(retirement.getFullYear() + 5);
await fireCommand({
  name: "35岁财务自由（演示）",
  age: 30,
  retirementAge: 35,
  retirementDate: retirement.toISOString(),
  monthlyContribution: "5000",
  monthlyExpense: "8000",
  inflation: "0.02",
  conservative: "0.02",
  baseReturn: "0.05",
  optimistic: "0.08",
  withdrawalRate: "0.04",
  currency: "CNY",
});
const session = await backtestCommand("backtest.create", {
  name: "日线趋势练习（虚构数据）",
  assetId: assets[4].id,
  strategyVersionId: strategy.versions[0].id,
  timeframe: "1d",
  initialCapital: "100000",
  adjustment: "RAW",
  feeRate: "0.001",
  slippageBps: "2",
});
if (!("id" in session)) throw new Error("任务缺失");
let csv = "at,open,high,low,close,volume\n";
for (let i = 0; i < 60; i++) {
  const at = new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
    open = D(185)
      .plus(D(i).mul(".4"))
      .plus(Math.sin(i / 5).toFixed(4)),
    close = open.plus(Math.cos(i / 3).toFixed(4));
  csv += `${at},${open.toFixed(4)},${open.plus(2).toFixed(4)},${open.minus(2).toFixed(4)},${close.toFixed(4)},100000\n`;
}
await backtestCommand("backtest.import", { sessionId: session.id, csv });
await db.auditLog.create({
  data: {
    action: "DEMO_SEED",
    entityId: "demo",
    detail:
      "所有金额、价格、汇率、交易及预测输入均为虚构演示数据，独立数据库。",
  },
});
console.log("独立演示账本创建完成，所有数据均为虚构。");
await db.$disconnect();
