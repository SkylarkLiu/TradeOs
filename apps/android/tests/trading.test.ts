import { describe, it, expect } from "vitest";
import { setup } from "./sql";
import { digest } from "../src/ledger";
const rules = {
  name: "突破策略",
  market: "股票现货",
  timeframe: "日线",
  environment: "上涨",
  rules: "突破最近二十日高点入场，回落至止损位置退出，达到目标分批止盈。",
};
async function book() {
  const { ledger, sql } = setup();
  await ledger.init();
  const a = await ledger.createAccount({
    platform: "虚拟券商",
    name: "交易",
    currency: "CNY",
  });
  const asset = await ledger.createAsset({
    code: "SPOT",
    name: "虚拟股票",
    assetClass: "STOCK",
    currency: "CNY",
  });
  await ledger.post({
    accountId: a.id,
    type: "DEPOSIT",
    amount: "1000",
    at: "2025-01-01T00:00:00Z",
  });
  return { ledger, sql, a, asset };
}
async function opened() {
  const b = await book();
  const version = await b.ledger.createStrategy(rules);
  await b.ledger.publishVersion({ id: version.id });
  const plan = await b.ledger.createPlan({
    accountId: b.a.id,
    assetId: b.asset.id,
    strategyVersionId: version.id,
    direction: "LONG",
    entry: "10",
    stop: "8",
    target: "20",
    equity: "1000",
    riskPercent: "1",
    reason: "突破",
    invalidation: "跌破支撑",
  });
  const trade = await b.ledger.createTrade({
    accountId: b.a.id,
    assetId: b.asset.id,
    planId: plan.id,
    direction: "LONG",
    openedAt: "2025-01-02T00:00:00Z",
  });
  return { ...b, trade, version, plan };
}
const fill = (
  tradeId: string,
  action = "ENTRY",
  quantity = "2",
  price = "10",
  at = "2025-01-02T00:00:00Z",
) => ({ tradeId, action, quantity, price, fee: "1", at });
describe("原生现货策略交易", () => {
  it("策略发布不可重写，版本递增，归档禁止新计划但允许已有交易退出", async () => {
    const { ledger, trade, version, a, asset } = await opened();
    expect((await ledger.state()).plans[0].quantity).toBe("5");
    await expect(ledger.publishVersion({ id: version.id })).rejects.toThrow(
      "已发布",
    );
    const next = await ledger.createStrategy({
      ...rules,
      rules: rules.rules + "使用新的过滤条件。",
    });
    expect(next.version).toBe(2);
    expect((await ledger.state()).versions[0].rules).toBe(rules.rules);
    await expect(
      ledger.createTrade({
        accountId: a.id,
        assetId: asset.id,
        strategyVersionId: next.id,
        direction: "LONG",
        openedAt: "2025-01-02T00:00:00Z",
      }),
    ).rejects.toThrow("已发布");
    await ledger.recordFill(fill(trade.id));
    await ledger.archiveStrategy({ id: version.strategyId, archived: 1 });
    await expect(ledger.createStrategy(rules)).rejects.toThrow("归档");
    await ledger.recordFill(
      fill(trade.id, "EXIT", "2", "15", "2025-01-03T00:00:00Z"),
    );
    expect((await ledger.state()).trades[0]).toMatchObject({
      status: "CLOSED",
      realized: "8",
      initialRisk: "10",
    });
  });
  it("加仓、减仓、全平与现金、整体持仓同时入账，费用不重复", async () => {
    const { ledger, trade } = await opened();
    await ledger.recordFill(fill(trade.id));
    await ledger.recordFill(
      fill(trade.id, "ENTRY", "2", "20", "2025-01-03T00:00:00Z"),
    );
    await ledger.recordFill(
      fill(trade.id, "EXIT", "1", "30", "2025-01-04T00:00:00Z"),
    );
    let state = await ledger.state();
    expect(state.trades[0]).toMatchObject({
      quantity: "3",
      averageEntry: "15",
      realized: "12",
      fees: "3",
      sequence: 3,
    });
    expect(state.accounts[0].balance).toBe("967");
    expect(state.events.map((e) => e.type)).toEqual([
      "ENTRY",
      "ADD_POSITION",
      "PARTIAL_EXIT",
    ]);
    await ledger.recordFill(
      fill(trade.id, "EXIT", "3", "25", "2025-01-05T00:00:00Z"),
    );
    state = await ledger.state();
    expect(state.trades[0]).toMatchObject({
      status: "CLOSED",
      quantity: "0",
      realized: "41",
      fees: "4",
    });
    expect(state.accounts[0].balance).toBe("1041");
    expect(state.holdings[0]).toMatchObject({
      quantity: "0",
      cost: "0",
      realized: "41",
    });
    expect(state.assetEntries).toHaveLength(4);
    expect(state.fills).toHaveLength(4);
    await expect(ledger.recordFill(fill(trade.id))).rejects.toThrow("已平仓");
    const before = await ledger.state();
    await ledger.restore(await ledger.backup());
    expect(await ledger.state()).toEqual(before);
  });
  it("同标的多笔交易占用互相独立，手工流水不能动用交易持仓", async () => {
    const { ledger, trade, a, asset } = await opened();
    const second = await ledger.createTrade({
      accountId: a.id,
      assetId: asset.id,
      direction: "LONG",
      openedAt: "2025-01-02T00:00:00Z",
    });
    await ledger.recordFill(fill(trade.id));
    await ledger.recordFill(
      fill(second.id, "ENTRY", "3", "20", "2025-01-03T00:00:00Z"),
    );
    const before = await ledger.state();
    await expect(
      ledger.postAsset({
        accountId: a.id,
        assetId: asset.id,
        type: "SELL",
        quantity: "1",
        price: "30",
        at: "2025-01-04T00:00:00Z",
      }),
    ).rejects.toThrow("占用");
    await expect(
      ledger.recordFill(
        fill(trade.id, "EXIT", "3", "30", "2025-01-04T00:00:00Z"),
      ),
    ).rejects.toThrow("超过持仓");
    expect(await ledger.state()).toEqual(before);
    await ledger.recordFill(
      fill(trade.id, "EXIT", "2", "30", "2025-01-04T00:00:00Z"),
    );
    expect(
      (await ledger.state()).trades.find((t) => t.id === second.id)?.quantity,
    ).toBe("3");
    await ledger.restore(await ledger.backup());
  });
  it("故障注入时成交、现金、持仓、汇总和事件全部回滚", async () => {
    const { ledger, sql, trade } = await opened();
    const before = await ledger.state();
    await sql.batch([
      {
        statement:
          "CREATE TRIGGER fail_fill BEFORE INSERT ON TradeFill BEGIN SELECT RAISE(ABORT,'成交故障'); END",
        values: [],
      },
    ]);
    await expect(ledger.recordFill(fill(trade.id))).rejects.toThrow("成交故障");
    expect(await ledger.state()).toEqual(before);
  });
  it("事件与成交按时间顺序，价格事件保留历史且更新当前止损", async () => {
    const { ledger, trade } = await opened();
    await ledger.recordFill(fill(trade.id));
    await ledger.recordEvent({
      tradeId: trade.id,
      type: "STOP_ADJUSTMENT",
      value: "11",
      detail: "移到盈利保护位",
      at: "2025-01-03T00:00:00Z",
    });
    expect((await ledger.state()).trades[0].stop).toBe("11");
    await expect(
      ledger.recordFill(
        fill(trade.id, "ENTRY", "1", "12", "2025-01-02T12:00:00Z"),
      ),
    ).rejects.toThrow("上次成交");
    await expect(
      ledger.recordEvent({
        tradeId: trade.id,
        type: "TARGET_ADJUSTMENT",
        detail: "遗漏价格",
        at: "2025-01-04T00:00:00Z",
      }),
    ).rejects.toThrow("价格");
    await ledger.restore(await ledger.backup());
    expect((await ledger.state()).trades[0].stop).toBe("11");
  });
  it("备份拒绝交易汇总篡改、孤立成交与未关联资产流水", async () => {
    const { ledger, trade } = await opened();
    await ledger.recordFill(fill(trade.id));
    const saved = await ledger.backup(),
      before = await ledger.state();
    const bad = structuredClone(saved);
    bad.payload.trades[0].realized = "999";
    bad.checksum = await digest(bad.payload);
    await expect(ledger.restore(bad)).rejects.toThrow("汇总");
    const missing = structuredClone(saved);
    missing.payload.events = [];
    missing.checksum = await digest(missing.payload);
    await expect(ledger.restore(missing)).rejects.toThrow("对应事件");
    const link = structuredClone(saved);
    link.payload.fills[0].transactionId = "absent";
    link.checksum = await digest(link.payload);
    await expect(ledger.restore(link)).rejects.toThrow("资产流水");
    expect(await ledger.state()).toEqual(before);
  });
  it("并发提交成交串行累加，旧v2备份恢复清除交易数据", async () => {
    const { ledger, trade } = await opened();
    await Promise.all(
      Array.from({ length: 10 }, () =>
        ledger.recordFill({ ...fill(trade.id), quantity: "0.1", fee: "0" }),
      ),
    );
    expect((await ledger.state()).trades[0].quantity).toBe("1");
    expect((await ledger.state()).fills).toHaveLength(10);
    const saved = await ledger.backup();
    const { strategies, versions, plans, trades, fills, events, ...payload } =
      saved.payload;
    void strategies;
    void versions;
    void plans;
    void trades;
    void fills;
    void events;
    await ledger.restore({
      kind: saved.kind,
      version: 2,
      payload,
      checksum: await digest(payload),
    });
    expect((await ledger.state()).trades).toHaveLength(0);
    expect((await ledger.state()).holdings[0].quantity).toBe("1");
  });
  it("无效止损、错误计划关联、未来成交与现金不足均不改变账本", async () => {
    const { ledger, a, asset, trade, plan } = await opened();
    const before = await ledger.state();
    await expect(
      ledger.createPlan({
        ...plan,
        stop: "11",
        strategyVersionId: plan.strategyVersionId ?? undefined,
      }),
    ).rejects.toThrow("止损方向");
    const other = await ledger.createAccount({
      name: "其他账户",
      platform: "银行",
      currency: "CNY",
    });
    await expect(
      ledger.createTrade({
        accountId: other.id,
        assetId: asset.id,
        planId: plan.id,
        direction: "LONG",
        openedAt: "2025-01-02T00:00:00Z",
      }),
    ).rejects.toThrow("计划");
    await expect(
      ledger.recordFill(fill(trade.id, "ENTRY", "1000", "10")),
    ).rejects.toThrow("现金余额不足");
    await expect(
      ledger.recordFill(
        fill(
          trade.id,
          "ENTRY",
          "1",
          "10",
          new Date(Date.now() + 86400000).toISOString(),
        ),
      ),
    ).rejects.toThrow("未来");
    expect(
      (await ledger.state()).accounts.find((x) => x.id === a.id)?.balance,
    ).toBe(before.accounts[0].balance);
    expect((await ledger.state()).fills).toHaveLength(0);
  });
});
