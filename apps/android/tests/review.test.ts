import { it, expect } from "vitest";
import { setup } from "./sql";
import { digest } from "../src/ledger";
import { performance } from "../src/review";
import { defaultScoreRules, scoreSummary } from "@tradeos/core/review";
const rules = {
  name: "复盘策略",
  market: "股票现货",
  timeframe: "日线",
  environment: "上涨",
  rules: "突破最近二十日高点入场，回落至止损位置退出，达到目标分批止盈。",
};
async function book() {
  const b = setup();
  await b.ledger.init();
  const a = await b.ledger.createAccount({
    platform: "虚拟券商",
    name: "人民币",
    currency: "CNY",
  });
  const asset = await b.ledger.createAsset({
    code: "REVIEW",
    name: "复盘股票",
    assetClass: "STOCK",
    currency: "CNY",
  });
  await b.ledger.post({
    accountId: a.id,
    type: "DEPOSIT",
    amount: "1000",
    at: "2025-01-01T00:00:00Z",
  });
  const v = await b.ledger.createStrategy(rules);
  await b.ledger.publishVersion({ id: v.id });
  return { ...b, a, asset, v };
}
async function close(
  b: Awaited<ReturnType<typeof book>>,
  entryAt = "2025-01-02T00:00:00Z",
  exitAt = "2025-01-03T00:00:00Z",
  exitPrice = "15",
) {
  const t = await b.ledger.createTrade({
    accountId: b.a.id,
    assetId: b.asset.id,
    strategyVersionId: b.v.id,
    direction: "LONG",
    initialRisk: "10",
    openedAt: entryAt,
  });
  await b.ledger.recordFill({
    tradeId: t.id,
    action: "ENTRY",
    quantity: "2",
    price: "10",
    fee: "1",
    at: entryAt,
  });
  await b.ledger.recordFill({
    tradeId: t.id,
    action: "EXIT",
    quantity: "2",
    price: exitPrice,
    fee: "1",
    at: exitAt,
  });
  return t;
}
const review = (tradeId: string) => ({
  tradeId,
  period: "TRADE",
  at: "2025-02-01T00:00:00Z",
  scores: Object.fromEntries(defaultScoreRules.map((r) => [r.name, 4])),
  tags: ["按计划执行"],
  content: "本次按计划入场和平仓，执行过程中仍应更早核对风险预算。",
  lessons: "先核对风险预算",
  nextAction: "入场前逐项确认止损和仓位",
});
it("拒绝未平仓、过早/未来、缺项及越界复盘，财务账本不变", async () => {
  const b = await book();
  const t = await b.ledger.createTrade({
    accountId: b.a.id,
    assetId: b.asset.id,
    direction: "LONG",
    openedAt: "2025-01-02T00:00:00Z",
  });
  await expect(b.ledger.saveReview(review(t.id))).rejects.toThrow("平仓");
  const closed = await close(b),
    before = await b.ledger.state();
  await expect(
    b.ledger.saveReview({ ...review(closed.id), at: "2025-01-02T00:00:00Z" }),
  ).rejects.toThrow("早于");
  await expect(
    b.ledger.saveReview({
      ...review(closed.id),
      at: new Date(Date.now() + 86400000).toISOString(),
    }),
  ).rejects.toThrow("未来");
  await expect(
    b.ledger.saveReview({ ...review(closed.id), scores: {} }),
  ).rejects.toThrow("评分");
  await expect(
    b.ledger.saveReview({
      ...review(closed.id),
      scores: Object.fromEntries(defaultScoreRules.map((r) => [r.name, 6])),
    }),
  ).rejects.toThrow("评分");
  expect(await b.ledger.state()).toEqual(before);
});
it("规则快照保留，最新复盘决定纪律，标签保留历次记录", async () => {
  const b = await book(),
    t = await close(b);
  const r = await b.ledger.saveReview(review(t.id));
  expect(scoreSummary(JSON.parse(r.scores))).toEqual({
    score: "80",
    compliant: true,
  });
  await b.ledger.setScoreRules(
    defaultScoreRules.map((r) => ({
      ...r,
      max: 10,
      threshold: r.compliance ? 9 : 0,
    })),
  );
  await b.ledger.saveReview({
    ...review(t.id),
    at: "2025-02-02T00:00:00Z",
    tags: ["待改进"],
  });
  const state = await b.ledger.state();
  expect(scoreSummary(JSON.parse(state.reviews[0].scores)).score).toBe("80");
  const result = performance(state, { currency: "CNY" });
  expect(result.averageScore).toBe("40");
  expect(result.compliance).toBe("0");
  expect(result.reviewCoverage).toBe("1");
  expect(
    performance(state, { currency: "CNY", tag: "按计划执行" }).metrics.count,
  ).toBe(1);
});
it("多币种、日期、策略及标签筛选不混算，亏损与回撤口径准确", async () => {
  const b = await book(),
    win = await close(b);
  await close(b, "2025-01-04T00:00:00Z", "2025-01-05T00:00:00Z", "5");
  await b.ledger.saveReview(review(win.id));
  const usd = await b.ledger.createAccount({
    platform: "虚拟券商",
    name: "美元",
    currency: "USD",
  });
  const asset = await b.ledger.createAsset({
    code: "USD",
    name: "美元股票",
    currency: "USD",
    assetClass: "STOCK",
  });
  await b.ledger.post({
    accountId: usd.id,
    type: "DEPOSIT",
    amount: "1000",
    at: "2025-01-01T00:00:00Z",
  });
  await close({ ...b, a: usd, asset });
  const state = await b.ledger.state(),
    p = performance(state, { currency: "CNY" });
  expect(p.metrics.count).toBe(2);
  expect(p.net).toBe("-4");
  expect(p.fees).toBe("4");
  expect(p.metrics.winRate).toBe("0.5");
  expect(p.metrics.profitFactor).toBe(
    "0.6666666666666666666666666666666666666667",
  );
  expect(p.metrics.averageR).toBe("-0.2");
  expect(p.drawdown).toBe("12");
  expect(p.reviewCoverage).toBe("0.5");
  expect(performance(state, { currency: "USD" }).net).toBe("8");
  expect(
    performance(state, {
      currency: "CNY",
      start: "2025-01-04",
      strategyVersionId: b.v.id,
    }).net,
  ).toBe("-12");
  expect(
    performance(state, { currency: "CNY", tag: "不存在" }).metrics.count,
  ).toBe(0);
  expect(() =>
    performance(state, {
      currency: "CNY",
      start: "2025-02-01",
      end: "2025-01-01",
    }),
  ).toThrow("日期");
});
it("相同平仓时间合并，空样本和无亏损/无纪律项目不显示伪值", async () => {
  const b = await book();
  let p = performance(await b.ledger.state(), { currency: "CNY" });
  expect(p.metrics.winRate).toBeNull();
  expect(p.compliance).toBeNull();
  await close(b);
  p = performance(await b.ledger.state(), { currency: "CNY" });
  expect(p.metrics.profitFactor).toBeNull();
  expect(p.metrics.profitFactorReason).toContain("无亏损");
  await close(b, "2025-01-03T00:00:00Z", "2025-01-03T00:00:00Z", "5");
  p = performance(await b.ledger.state(), { currency: "CNY" });
  expect(p.points).toHaveLength(1);
  expect(p.drawdown).toBe("4");
  expect(
    scoreSummary({
      rules: defaultScoreRules.map((r) => ({ ...r, compliance: false })),
      values: Object.fromEntries(defaultScoreRules.map((r) => [r.name, 4])),
    }).compliant,
  ).toBeNull();
});
it("改进草稿和关联原子提交，历史版本与交易不变", async () => {
  const b = await book(),
    t = await close(b),
    r = await b.ledger.saveReview(review(t.id));
  const before = await b.ledger.state(),
    newRules = {
      reviewId: r.id,
      ...rules,
      rules: rules.rules + "新增入场前复核风险预算。",
    };
  await b.sql.batch([
    {
      statement:
        "CREATE TRIGGER fail_improvement BEFORE INSERT ON ReviewImprovement BEGIN SELECT RAISE(ABORT,'改进故障'); END",
      values: [],
    },
  ]);
  await expect(b.ledger.improveStrategy(newRules)).rejects.toThrow("改进故障");
  expect(await b.ledger.state()).toEqual(before);
  await b.sql.batch([
    { statement: "DROP TRIGGER fail_improvement", values: [] },
  ]);
  const v = await b.ledger.improveStrategy(newRules);
  const state = await b.ledger.state();
  expect(v.version).toBe(2);
  expect(v.published).toBe(0);
  expect(state.versions[0].rules).toBe(rules.rules);
  expect(state.trades[0].strategyVersionId).toBe(b.v.id);
  expect(state.improvements[0].versionId).toBe(v.id);
  await expect(b.ledger.improveStrategy(newRules)).rejects.toThrow("已生成");
  await b.ledger.publishVersion({ id: v.id });
  await b.ledger.restore(await b.ledger.backup());
  expect((await b.ledger.state()).improvements).toHaveLength(1);
});
it("复盘及改进关联篡改拒绝，v3备份可恢复且保留交易", async () => {
  const b = await book(),
    t = await close(b),
    r = await b.ledger.saveReview(review(t.id));
  await b.ledger.improveStrategy({
    reviewId: r.id,
    ...rules,
    rules: rules.rules + "新增确认规则。",
  });
  const file = await b.ledger.backup(),
    before = await b.ledger.state();
  const bad = structuredClone(file);
  bad.payload.reviews[0].tradeId = "missing";
  bad.checksum = await digest(bad.payload);
  await expect(b.ledger.restore(bad)).rejects.toThrow("复盘");
  const links = structuredClone(file);
  links.payload.improvements[0].versionId = b.v.id;
  links.checksum = await digest(links.payload);
  await expect(b.ledger.restore(links)).rejects.toThrow("改进关联");
  expect(await b.ledger.state()).toEqual(before);
  const { reviews, improvements, scoreRules, ...payload } = file.payload;
  void reviews;
  void improvements;
  void scoreRules;
  await b.ledger.restore({
    kind: file.kind,
    version: 3,
    payload,
    checksum: await digest(payload),
  });
  expect((await b.ledger.state()).trades).toHaveLength(1);
  expect((await b.ledger.state()).reviews).toHaveLength(0);
});
it("周期复盘独立，规则输入校验和周/月生成策略保护", async () => {
  const b = await book();
  const input = { ...review("unused"), tradeId: undefined, period: "WEEK" };
  const r = await b.ledger.saveReview(input);
  expect(r.tradeId).toBeNull();
  await expect(
    b.ledger.saveReview({ ...input, tradeId: "unused" }),
  ).rejects.toThrow("绑定");
  await expect(
    b.ledger.setScoreRules(defaultScoreRules.map((r) => ({ ...r, weight: 0 }))),
  ).rejects.toThrow("权重");
  await expect(
    b.ledger.improveStrategy({
      reviewId: r.id,
      ...rules,
      rules: rules.rules + "新增风险规则。",
    }),
  ).rejects.toThrow("单笔复盘");
  expect(
    performance(await b.ledger.state(), { currency: "CNY" }).reviewed,
  ).toBe(0);
});
