import { beforeAll, describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { db } from "@/lib/repositories/db";
import {
  wealthCommand,
  recordTransaction,
  portfolio,
} from "@/lib/services/wealth";
import { importCommand, exportQuantity } from "@/lib/services/imports";
import { D } from "@/lib/calculations/decimal";
beforeAll(() => {
  if (!process.env.DATABASE_URL?.includes("/unit"))
    throw new Error("测试必须使用独立数据库");
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: process.env, stdio: "pipe" },
  );
});
const unique = () => crypto.randomUUID();
export async function setup() {
  const platform = await db.platform.create({ data: { name: unique() } }),
    a = await db.account.create({
      data: { platformId: platform.id, name: "A" },
    }),
    b = await db.account.create({
      data: { platformId: platform.id, name: "B" },
    }),
    cash = await db.asset.upsert({
      where: { code: "CASH:CNY" },
      create: {
        code: "CASH:CNY",
        name: "人民币",
        assetClass: "CASH",
        currency: "CNY",
      },
      update: {},
    });
  return { a, b, cash };
}
const at = (n = 0) => new Date(Date.now() - 60000 + n).toISOString();
describe("真实统一账本", () => {
  it("现金CSV导出还原毛额，重新录入时手续费只扣一次", async () => {
    const { a, b, cash } = await setup();
    for (const [offset, type, quantity, fee] of [
      [0, "DEPOSIT", "1000", "2"],
      [1, "WITHDRAWAL", "100", "3"],
      [2, "ADJUSTMENT", "-20", "1"],
      [3, "INTEREST", "10", "1"],
      [4, "FEE", "2", "0"],
    ] as const) {
      const input = {
        accountId: a.id,
        assetId: cash.id,
        type,
        quantity,
        fee,
        at: at(offset),
      };
      const row = await recordTransaction(input);
      const exported = exportQuantity({ ...row, asset: cash });
      expect(D(exported).eq(quantity)).toBe(true);
      await recordTransaction({
        ...input,
        accountId: b.id,
        quantity: exported,
      });
    }
    const balances = await db.assetBalance.findMany({
      where: { accountId: { in: [a.id, b.id] }, assetId: cash.id },
    });
    expect(balances[0].quantity).toBe(balances[1].quantity);
  });
  it("SQLite金额不丢失精度", async () => {
    const { a, cash } = await setup();
    await recordTransaction({
      accountId: a.id,
      assetId: cash.id,
      type: "DEPOSIT",
      quantity: "100000000000000000.00000001",
      at: at(),
    });
    const b = await db.assetBalance.findUniqueOrThrow({
      where: { accountId_assetId: { accountId: a.id, assetId: cash.id } },
    });
    expect(b.quantity).toBe("100000000000000000.00000001");
  });
  it("转账在途与到账不虚增，费用只扣一次", async () => {
    const { a, b, cash } = await setup();
    await recordTransaction({
      accountId: a.id,
      assetId: cash.id,
      type: "DEPOSIT",
      quantity: "1000",
      at: at(),
    });
    const t = await wealthCommand("transfer.create", {
      fromId: a.id,
      toId: b.id,
      assetId: cash.id,
      quantity: "100",
      fee: "1",
      at: at(1),
    });
    const before = await portfolio();
    await wealthCommand("transfer.complete", { id: t.id, at: at(2) });
    const after = await portfolio();
    expect(D(before.net).eq(after.net)).toBe(true);
    const bal = await db.assetBalance.findUniqueOrThrow({
      where: { accountId_assetId: { accountId: a.id, assetId: cash.id } },
    });
    expect(bal.quantity).toBe("899");
    expect(
      await db.accountCashFlow.count({
        where: { accountId: { in: [a.id, b.id] }, kind: "EXTERNAL" },
      }),
    ).toBe(1);
    await expect(
      wealthCommand("transfer.complete", { id: t.id, at: at(3) }),
    ).rejects.toThrow("已经到账");
  });
  it("部分卖出成本和净盈亏一致", async () => {
    const { a, cash } = await setup();
    const asset = await db.asset.create({
      data: {
        code: unique(),
        name: "测试股票",
        assetClass: "STOCK",
        currency: "CNY",
      },
    });
    await recordTransaction({
      accountId: a.id,
      assetId: cash.id,
      type: "DEPOSIT",
      quantity: "1000",
      at: at(),
    });
    await recordTransaction({
      accountId: a.id,
      assetId: asset.id,
      type: "BUY",
      quantity: "10",
      price: "10",
      fee: "2",
      at: at(1),
    });
    await recordTransaction({
      accountId: a.id,
      assetId: asset.id,
      type: "SELL",
      quantity: "5",
      price: "12",
      fee: "1",
      at: at(2),
    });
    const b = await db.assetBalance.findUniqueOrThrow({
      where: { accountId_assetId: { accountId: a.id, assetId: asset.id } },
    });
    expect(b.quantity).toBe("5");
    expect(b.cost).toBe("51");
    expect(b.realized).toBe("8");
  });
  it("余额不足事务回滚", async () => {
    const { a, cash } = await setup();
    await expect(
      recordTransaction({
        accountId: a.id,
        assetId: cash.id,
        type: "WITHDRAWAL",
        quantity: "1",
        at: at(),
      }),
    ).rejects.toThrow("余额不足");
    expect(
      await db.assetTransaction.count({ where: { accountId: a.id } }),
    ).toBe(0);
  });
  it("CSV重复导入幂等，错误整批不写入", async () => {
    const { a, cash } = await setup();
    const csv = `accountId,assetId,type,quantity,at\n${a.id},${cash.id},DEPOSIT,10,${at()}`;
    const mapping = {
      accountId: "accountId",
      assetId: "assetId",
      type: "type",
      quantity: "quantity",
      at: "at",
    };
    const first = await importCommand("import.commit", { csv, mapping });
    const second = await importCommand("import.commit", { csv, mapping });
    expect("imported" in first && first.imported).toBe(1);
    expect("imported" in second && second.imported).toBe(0);
    expect(
      await db.assetTransaction.count({ where: { accountId: a.id } }),
    ).toBe(1);
  });
  it("缺失价格不生成完整快照", async () => {
    const { a } = await setup();
    const asset = await db.asset.create({
      data: {
        code: unique(),
        name: "缺价资产",
        assetClass: "STOCK",
        currency: "CNY",
      },
    });
    await recordTransaction({
      accountId: a.id,
      assetId: asset.id,
      type: "DEPOSIT",
      quantity: "1",
      price: "100",
      at: at(),
    });
    expect((await portfolio()).complete).toBe(false);
    await expect(
      wealthCommand("snapshot.create", { currency: "CNY" }),
    ).rejects.toThrow("缺失");
  });
});

import { tradingCommand, recordFill } from "@/lib/services/trading";
describe("真实交易闭环", () => {
  it("发布策略版本不可修改，新版本不覆盖历史", async () => {
    const s = await tradingCommand("strategy.create", {
      name: unique(),
      market: "股票",
      timeframe: "日线",
      environment: "趋势",
      rules: "完整测试规则，入场出场止损仓位假设失效条件均明确",
    });
    const version = await db.strategyVersion.findFirstOrThrow({
      where: { strategyId: s.id },
    });
    await tradingCommand("strategy.publish", { id: version.id });
    await expect(
      tradingCommand("strategy.edit", {
        id: version.id,
        market: "股票",
        timeframe: "日线",
        environment: "趋势",
        rules: "尝试改变已经发布的历史策略规则，应该拒绝",
      }),
    ).rejects.toThrow("不可修改");
    const next = await tradingCommand("strategy.version", {
      strategyId: s.id,
      market: "股票",
      timeframe: "周线",
      environment: "趋势",
      rules: "新的测试策略版本，保留以前的版本不覆盖历史规则",
    });
    expect("version" in next && next.version).toBe(2);
  });
  it("分批成交与资产账本只记一次且净盈亏一致", async () => {
    const { a, cash } = await setup(),
      asset = await db.asset.create({
        data: {
          code: unique(),
          name: "交易股票",
          assetClass: "STOCK",
          currency: "CNY",
        },
      });
    await recordTransaction({
      accountId: a.id,
      assetId: cash.id,
      type: "DEPOSIT",
      quantity: "1000",
      at: at(),
    });
    const t = await tradingCommand("trade.create", {
      accountId: a.id,
      assetId: asset.id,
      direction: "LONG",
      initialRisk: "10",
      openedAt: at(1),
    });
    for (const [index, action, quantity, fee] of [
      [2, "ENTRY", "10", "2"],
      [3, "EXIT", "5", "1"],
      [4, "EXIT", "5", "1"],
    ] as const)
      await recordFill({
        tradeId: t.id,
        action,
        quantity,
        price: action === "ENTRY" ? "10" : "12",
        fee,
        at: at(index),
      });
    const trade = await db.trade.findUniqueOrThrow({
        where: { id: t.id },
        include: { fills: true },
      }),
      balance = await db.assetBalance.findUniqueOrThrow({
        where: { accountId_assetId: { accountId: a.id, assetId: cash.id } },
      });
    expect(trade.status).toBe("CLOSED");
    expect(trade.realized).toBe("16");
    expect(balance.quantity).toBe("1016");
    expect(trade.fills.length).toBe(3);
    expect(
      await db.assetTransaction.count({ where: { accountId: a.id } }),
    ).toBe(4);
    await expect(
      recordFill({
        tradeId: t.id,
        action: "ENTRY",
        quantity: "1",
        price: "10",
        at: at(5),
      }),
    ).rejects.toThrow("已平仓");
  });
  it("合约保证金不是资产，占用资金不能取出", async () => {
    const { a, cash } = await setup(),
      asset = await db.asset.create({
        data: {
          code: unique(),
          name: "线性合约",
          assetClass: "OTHER",
          currency: "CNY",
          instrument: "LINEAR",
        },
      });
    await recordTransaction({
      accountId: a.id,
      assetId: cash.id,
      type: "DEPOSIT",
      quantity: "1000",
      at: at(),
    });
    const t = await tradingCommand("trade.create", {
      accountId: a.id,
      assetId: asset.id,
      direction: "SHORT",
      leverage: "1",
      openedAt: at(1),
    });
    await recordFill({
      tradeId: t.id,
      action: "ENTRY",
      quantity: "5",
      price: "100",
      fee: "0",
      at: at(2),
    });
    await expect(
      recordTransaction({
        accountId: a.id,
        assetId: cash.id,
        type: "WITHDRAWAL",
        quantity: "600",
        at: at(3),
      }),
    ).rejects.toThrow("保证金");
    await recordFill({
      tradeId: t.id,
      action: "EXIT",
      quantity: "5",
      price: "80",
      fee: "0",
      at: at(4),
    });
    const balance = await db.assetBalance.findUniqueOrThrow({
      where: { accountId_assetId: { accountId: a.id, assetId: cash.id } },
    });
    expect(balance.quantity).toBe("1100");
    expect(
      await db.assetBalance.count({
        where: { accountId: a.id, assetId: asset.id },
      }),
    ).toBe(0);
  });
});

import {
  analytics,
  reviewCommand,
  defaultScoreRules,
} from "@/lib/services/analytics";
describe("复盘与账户绩效", () => {
  it("现金利息归因使用净额，不重复扣除费用", async () => {
    const { a, cash } = await setup();
    await recordTransaction({
      accountId: a.id,
      assetId: cash.id,
      type: "DEPOSIT",
      quantity: "100",
      at: "2025-01-01T00:00:00Z",
    });
    await wealthCommand("valuation.create", {
      accountId: a.id,
      value: "100",
      currency: "CNY",
      at: "2025-01-01T00:00:00Z",
    });
    await recordTransaction({
      accountId: a.id,
      assetId: cash.id,
      type: "INTEREST",
      quantity: "10",
      fee: "2",
      at: "2025-02-01T00:00:00Z",
    });
    await wealthCommand("valuation.create", {
      accountId: a.id,
      value: "108",
      currency: "CNY",
      at: "2025-02-01T00:00:00Z",
    });
    const r = await analytics({ accountId: a.id });
    expect(r.attribution.income).toBe("8");
    expect(r.attribution.residual).toBe("0");
    expect(r.account.investmentPnl).toBe("8");
  });
  it("账户收益不受其他账户资金流影响", async () => {
    const { a } = await setup();
    await wealthCommand("valuation.create", {
      accountId: a.id,
      value: "100",
      currency: "CNY",
      source: "MANUAL",
      at: "2025-01-01T00:00:00Z",
    });
    await wealthCommand("valuation.create", {
      accountId: a.id,
      value: "110",
      currency: "CNY",
      source: "MANUAL",
      at: "2026-01-01T00:00:00Z",
    });
    const result = await analytics({ accountId: a.id, currency: "CNY" });
    expect(result.account.twr).toBe("0.1");
    expect(D(result.account.xirr!).minus("0.1").abs().lt("0.00000001")).toBe(
      true,
    );
  });
  it("缺失资金流边界估值时拒绝TWR", async () => {
    const { a, cash } = await setup();
    await recordTransaction({
      accountId: a.id,
      assetId: cash.id,
      type: "DEPOSIT",
      quantity: "50",
      at: "2025-06-01T00:00:00Z",
    });
    await wealthCommand("valuation.create", {
      accountId: a.id,
      value: "100",
      currency: "CNY",
      at: "2025-01-01T00:00:00Z",
    });
    await wealthCommand("valuation.create", {
      accountId: a.id,
      value: "160",
      currency: "CNY",
      at: "2026-01-01T00:00:00Z",
    });
    const result = await analytics({ accountId: a.id });
    expect(result.account.twr).toBeNull();
    expect(result.account.investmentPnl).toBe("10");
  });
  it("亏损交易可以有合规高评分，未平仓不能单笔复盘", async () => {
    const { a, cash } = await setup();
    const asset = await db.asset.create({
      data: {
        code: unique(),
        name: "复盘测试",
        assetClass: "STOCK",
        currency: "CNY",
      },
    });
    await recordTransaction({
      accountId: a.id,
      assetId: cash.id,
      type: "DEPOSIT",
      quantity: "100",
      at: "2024-12-31T00:00:00Z",
    });
    const t = await tradingCommand("trade.create", {
      accountId: a.id,
      assetId: asset.id,
      direction: "LONG",
      initialRisk: "10",
      openedAt: "2025-01-01T00:00:00Z",
    });
    await recordFill({
      tradeId: t.id,
      action: "ENTRY",
      quantity: "1",
      price: "100",
      at: "2025-01-01T00:00:00Z",
    });
    await recordFill({
      tradeId: t.id,
      action: "EXIT",
      quantity: "1",
      price: "90",
      at: "2025-01-02T00:00:00Z",
    });
    const scores = Object.fromEntries(
      defaultScoreRules.map((r) => [r.name, 5]),
    );
    await reviewCommand("review.create", {
      tradeId: t.id,
      period: "TRADE",
      at: "2025-01-03T00:00:00Z",
      scores,
      tags: ["GOOD_EXECUTION"],
      content: "按照计划止损，执行规则完整，继续按纪律交易。",
    });
    const r = await analytics({ accountId: a.id });
    expect(r.compliance).toBe("1");
    expect(r.metrics.winRate).toBe("0");
    const open = await tradingCommand("trade.create", {
      accountId: a.id,
      assetId: asset.id,
      direction: "LONG",
      openedAt: "2025-01-03T00:00:00Z",
    });
    await expect(
      reviewCommand("review.create", {
        tradeId: open.id,
        period: "TRADE",
        at: "2025-01-03T00:00:00Z",
        scores,
        tags: [],
        content: "尚未平仓，单笔复盘应当被拒绝。",
      }),
    ).rejects.toThrow("平仓后");
  });
});

import { backtestCommand, backtestState } from "@/lib/services/backtest";
async function simulated() {
  const asset = await db.asset.create({
      data: {
        code: unique(),
        name: "回测测试",
        assetClass: "STOCK",
        currency: "CNY",
      },
    }),
    strategy = await db.strategy.create({
      data: {
        name: unique(),
        versions: {
          create: {
            version: 1,
            published: true,
            market: "股票",
            timeframe: "1d",
            environment: "趋势",
            rules: "仅使用已知数据验证入场出场和风险管理",
          },
        },
      },
      include: { versions: true },
    });
  const session = await backtestCommand("backtest.create", {
    name: "测试回放",
    assetId: asset.id,
    strategyVersionId: strategy.versions[0].id,
    timeframe: "1d",
    initialCapital: "1000",
    adjustment: "RAW",
    feeRate: "0",
    slippageBps: "0",
  });
  if (!("id" in session)) throw new Error("缺少任务");
  return session.id;
}
describe("手动回测隔离", () => {
  it("服务端不返回未来K线，同根止盈止损按止损，回退产生分支", async () => {
    const before = await db.assetTransaction.count(),
      sessionId = await simulated();
    await backtestCommand("backtest.import", {
      sessionId,
      csv: "at,open,high,low,close,volume\n2025-01-01T00:00:00Z,100,105,95,100,1000\n2025-01-02T00:00:00Z,100,120,80,100,1000\n2025-01-03T00:00:00Z,999,1000,998,999,1000",
    });
    const initial = await backtestState({ sessionId });
    expect(initial.candles).toHaveLength(1);
    expect(JSON.stringify(initial)).not.toContain('1000","low":"998');
    await backtestCommand("backtest.entry", {
      sessionId,
      direction: "LONG",
      quantity: "1",
      stop: "90",
      target: "110",
    });
    await backtestCommand("backtest.step", { sessionId, direction: "NEXT" });
    const next = await backtestState({ sessionId });
    expect(next.trades[0].exit).toBe("90");
    expect(next.report.equity).toBe("990");
    await backtestCommand("backtest.step", {
      sessionId,
      direction: "PREVIOUS",
    });
    const rewind = await backtestState({ sessionId });
    expect(rewind.session.branch).toBe(2);
    expect(rewind.trades[0].exit).toBeNull();
    expect(rewind.candles).toHaveLength(1);
    expect(await db.assetTransaction.count()).toBe(before);
  });
  it("重复或非法OHLC整批拒绝", async () => {
    const sessionId = await simulated();
    await expect(
      backtestCommand("backtest.import", {
        sessionId,
        csv: "at,open,high,low,close,volume\n2025-01-01T00:00:00Z,100,80,95,100,1000",
      }),
    ).rejects.toThrow("OHLC");
    expect(await db.candle.count({ where: { sessionId } })).toBe(0);
  });
});

import {
  backup,
  dataCommand,
  ledgerCheck,
  validateBackup,
} from "@/lib/services/data";
import { fireCommand, fireState, retirementPath } from "@/lib/services/fire";
import { createHash } from "node:crypto";
describe("FIRE、对账和完整恢复", () => {
  it("账本重建与余额一致", async () => {
    const rows = await ledgerCheck(db);
    expect(rows.every((r) => r.status === "MATCH")).toBe(true);
  });
  it("完整JSON包含全部表，可恢复并保留审计", async () => {
    const file = await backup(),
      before = await db.assetTransaction.count();
    const preview = await dataCommand("backup.preview", file);
    expect("counts" in preview && preview.counts.length).toBe(30);
    await dataCommand("backup.restore", {
      backup: file,
      checksum: file.checksum,
    });
    expect(await db.assetTransaction.count()).toBe(before);
    expect(
      await db.auditLog.count({ where: { action: "BACKUP_RESTORE" } }),
    ).toBeGreaterThan(0);
  });
  it("坏关联恢复失败回滚，校验和损坏提前拒绝", async () => {
    const file = await backup(),
      before = await db.account.count();
    const malformed = JSON.parse(JSON.stringify(file));
    malformed.payload.tables.account[0].platformId = "missing-platform";
    malformed.checksum = createHash("sha256")
      .update(JSON.stringify(malformed.payload))
      .digest("hex");
    await expect(
      dataCommand("backup.restore", {
        backup: malformed,
        checksum: malformed.checksum,
      }),
    ).rejects.toThrow();
    expect(await db.account.count()).toBe(before);
    const damaged = JSON.parse(JSON.stringify(file));
    damaged.checksum = "invalid";
    expect(() => validateBackup(damaged)).toThrow("校验和");
  });
  it("FIRE按年率、通胀和排除资产计算目标", async () => {
    const retirement = new Date();
    retirement.setFullYear(retirement.getFullYear() + 5);
    const goal = await fireCommand({
        name: unique(),
        age: 30,
        retirementAge: 35,
        retirementDate: retirement.toISOString(),
        monthlyContribution: "100",
        monthlyExpense: "1000",
        inflation: "0",
        conservative: "0",
        baseReturn: "0",
        optimistic: "0",
        withdrawalRate: "0.04",
        currency: "CNY",
      }),
      r = await fireState({ goalId: goal.id });
    expect(r?.target).toBe("300000");
    expect(r?.scenarios[0].final).toBe(
      D(r!.current).plus(D(r!.months).mul(100)).toFixed(),
    );
    expect(retirementPath("100", "10", "0", "0", 12).shortfall).toBe(11);
  });
});

describe("历史重建与汇率归因", () => {
  it("历史账户估值不使用未来存款", async () => {
    const { a, cash } = await setup();
    await recordTransaction({
      accountId: a.id,
      assetId: cash.id,
      type: "DEPOSIT",
      quantity: "100",
      at: "2025-01-01T00:00:00Z",
    });
    await recordTransaction({
      accountId: a.id,
      assetId: cash.id,
      type: "DEPOSIT",
      quantity: "50",
      at: "2025-02-01T00:00:00Z",
    });
    const p = await portfolio("CNY", new Date("2025-01-15T00:00:00Z"));
    expect(p.rows.find((r) => r.accountId === a.id)?.quantity).toBe("100");
  });
  it("汇率变动单独归因，不冒充Trading收益", async () => {
    const { a } = await setup(),
      cash = await db.asset.upsert({
        where: { code: "CASH:USD" },
        create: {
          code: "CASH:USD",
          name: "美元",
          assetClass: "CASH",
          currency: "USD",
        },
        update: {},
      });
    await recordTransaction({
      accountId: a.id,
      assetId: cash.id,
      type: "DEPOSIT",
      quantity: "100",
      at: "2025-03-01T00:00:00Z",
    });
    for (const [at, rate] of [
      ["2025-02-28T00:00:00Z", "7"],
      ["2025-03-02T00:00:00Z", "7.2"],
    ])
      await db.fXRate.upsert({
        where: { from_to_at: { from: "USD", to: "CNY", at: new Date(at) } },
        create: { from: "USD", to: "CNY", at: new Date(at), rate },
        update: { rate },
      });
    await wealthCommand("valuation.create", {
      accountId: a.id,
      value: "700",
      currency: "CNY",
      at: "2025-03-01T00:00:00Z",
    });
    await wealthCommand("valuation.create", {
      accountId: a.id,
      value: "720",
      currency: "CNY",
      at: "2025-03-02T00:00:00Z",
    });
    const r = await analytics({ accountId: a.id });
    expect(r.attribution.fx).toBe("20");
    expect(r.attribution.trading).toBe("0");
    expect(r.attribution.residual).toBe("0");
  });
  it("冲销保留原流水和反向现金流", async () => {
    const { a, cash } = await setup();
    const t = await recordTransaction({
      accountId: a.id,
      assetId: cash.id,
      type: "DEPOSIT",
      quantity: "100",
      at: at(),
    });
    await wealthCommand("transaction.reverse", {
      id: t.id,
      at: at(1),
      note: "重复录入，更正",
    });
    expect(
      await db.assetTransaction.count({ where: { accountId: a.id } }),
    ).toBe(2);
    const b = await db.assetBalance.findUniqueOrThrow({
      where: { accountId_assetId: { accountId: a.id, assetId: cash.id } },
    });
    expect(b.quantity).toBe("0");
    expect((await ledgerCheck(db)).every((r) => r.status === "MATCH")).toBe(
      true,
    );
  });
});

describe("导入和恢复边界", () => {
  it("CSV第二行失败时第一行也回滚", async () => {
    const { a, cash } = await setup();
    const csv = `accountId,assetId,type,quantity,at\n${a.id},${cash.id},DEPOSIT,10,2025-01-01T00:00:00Z\n${a.id},${cash.id},WITHDRAWAL,20,2025-01-02T00:00:00Z`;
    await expect(
      importCommand("import.commit", {
        csv,
        mapping: {
          accountId: "accountId",
          assetId: "assetId",
          type: "type",
          quantity: "quantity",
          at: "at",
        },
      }),
    ).rejects.toThrow("整批未写入");
    expect(
      await db.assetTransaction.count({ where: { accountId: a.id } }),
    ).toBe(0);
  });
  it("同一时间多次成交按序号重建，备份恢复保留顺序与图片", async () => {
    const { a, cash } = await setup(),
      asset = await db.asset.create({
        data: {
          code: unique(),
          name: "同时间成交",
          assetClass: "STOCK",
          currency: "CNY",
        },
      });
    await recordTransaction({
      accountId: a.id,
      assetId: cash.id,
      type: "DEPOSIT",
      quantity: "5000",
      at: "2024-12-31T00:00:00Z",
    });
    const at = "2025-01-01T00:00:00Z",
      t = await tradingCommand("trade.create", {
        accountId: a.id,
        assetId: asset.id,
        direction: "LONG",
        initialRisk: "100",
        openedAt: at,
      });
    for (const [action, quantity, price] of [
      ["ENTRY", "10", "100"],
      ["EXIT", "5", "110"],
      ["ENTRY", "5", "120"],
      ["EXIT", "10", "130"],
    ])
      await recordFill({ tradeId: t.id, action, quantity, price, at });
    const trade = await db.trade.findUniqueOrThrow({
      where: { id: t.id },
      include: { fills: { orderBy: { sequence: "asc" } } },
    });
    expect(trade.realized).toBe("250");
    expect(trade.fills.map((f) => f.sequence)).toEqual([1, 2, 3, 4]);
    const data =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=";
    const image = await tradingCommand("attachment.create", {
      tradeId: t.id,
      name: "fixture.png",
      mime: "image/png",
      data,
    });
    await dataCommand("setting.save", { key: "priceStaleDays", value: "7" });
    const file = await backup();
    validateBackup(file);
    await dataCommand("backup.restore", {
      backup: file,
      checksum: file.checksum,
    });
    expect(
      (await db.tradeAttachment.findUniqueOrThrow({ where: { id: image.id } }))
        .data,
    ).toBe(data);
    expect(
      (await db.trade.findUniqueOrThrow({ where: { id: t.id } })).realized,
    ).toBe("250");
  });
  it("备份拒绝可执行附件类型", async () => {
    const file = await backup(),
      tampered = JSON.parse(JSON.stringify(file));
    tampered.payload.tables.tradeAttachment[0].mime = "text/html";
    tampered.checksum = createHash("sha256")
      .update(JSON.stringify(tampered.payload))
      .digest("hex");
    expect(() => validateBackup(tampered)).toThrow();
  });
});

it("房地产默认排除FIRE，配置纳入后只改变投资净资产", async () => {
  const { a } = await setup(),
    before = await portfolio();
  const asset = await wealthCommand("asset.create", {
    code: unique(),
    name: "自住房",
    assetClass: "REAL_ESTATE",
    currency: "CNY",
  });
  if (!("investable" in asset)) throw new Error("资产缺失");
  expect(asset.investable).toBe(false);
  await recordTransaction({
    accountId: a.id,
    assetId: asset.id,
    type: "DEPOSIT",
    quantity: "1",
    price: "100000",
    at: at(),
  });
  await wealthCommand("price.create", {
    assetId: asset.id,
    price: "100000",
    at: new Date().toISOString(),
    source: "MANUAL",
  });
  const excluded = await portfolio();
  expect(D(excluded.assets).minus(before.assets).toFixed()).toBe("100000");
  expect(D(excluded.investable).minus(before.investable).toFixed()).toBe("0");
  await wealthCommand("asset.configure", { id: asset.id, investable: true });
  const included = await portfolio();
  expect(D(included.investable).minus(excluded.investable).toFixed()).toBe(
    "100000",
  );
  expect(included.assets).toBe(excluded.assets);
});
