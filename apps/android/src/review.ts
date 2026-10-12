import { z } from "zod";
import { D, canonical, sum, tradeMetrics } from "@tradeos/core";
import { id, date, tags, currency } from "@tradeos/core/validation";
import {
  defaultScoreRules,
  scoreRulesSchema,
  scoreSnapshotSchema,
  scoreSummary,
} from "@tradeos/core/review";
import { rulesSchema } from "@tradeos/core/trading";
import { insertRow } from "./assets";
import { TradingCommands, type TradingState } from "./trading";
import type { Sql } from "./sql";
import type { State } from "./ledger";
const iso = date.transform((d) => d.toISOString());
function validJson<T>(schema: z.ZodType<T>, max: number) {
  return z
    .string()
    .max(max)
    .superRefine((v, ctx) => {
      try {
        schema.parse(JSON.parse(v));
      } catch {
        ctx.addIssue({ code: "custom", message: "复盘JSON内容无效" });
      }
    });
}
export const reviewSchema = z.object({
  id,
  tradeId: id.nullable(),
  period: z.enum(["TRADE", "WEEK", "MONTH"]),
  at: iso,
  sequence: z.number().int().positive(),
  scores: validJson(scoreSnapshotSchema, 100000),
  tags: validJson(tags, 10000),
  content: z.string().trim().min(10).max(50000),
  lessons: z.string().trim().min(1).max(3000),
  nextAction: z.string().trim().min(1).max(3000),
});
export const improvementSchema = z.object({
  id,
  reviewId: id,
  sourceVersionId: id,
  versionId: id,
  at: iso,
});
export const reviewStateSchema = z.object({
  reviews: z.array(reviewSchema).max(100000),
  improvements: z.array(improvementSchema).max(100000),
  scoreRules: scoreRulesSchema,
});
export type Review = z.infer<typeof reviewSchema>;
export type ReviewState = z.infer<typeof reviewStateSchema>;
export const emptyReviews = (): ReviewState => ({
  reviews: [],
  improvements: [],
  scoreRules: structuredClone(defaultScoreRules),
});
export const reviewTables = [
  "CREATE TABLE IF NOT EXISTS ReviewSettings(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS TradeReview(id TEXT PRIMARY KEY,tradeId TEXT REFERENCES Trade(id),period TEXT NOT NULL,at TEXT NOT NULL,sequence INTEGER NOT NULL UNIQUE,scores TEXT NOT NULL,tags TEXT NOT NULL,content TEXT NOT NULL,lessons TEXT NOT NULL,nextAction TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS ReviewImprovement(id TEXT PRIMARY KEY,reviewId TEXT NOT NULL UNIQUE REFERENCES TradeReview(id),sourceVersionId TEXT NOT NULL REFERENCES StrategyVersion(id),versionId TEXT NOT NULL UNIQUE REFERENCES StrategyVersion(id),at TEXT NOT NULL)",
];
export const scoreSettingsInsert = (
  rules: z.infer<typeof scoreRulesSchema>,
) => ({
  statement:
    "INSERT INTO ReviewSettings(key,value) VALUES('scoreRules',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  values: [JSON.stringify(rules)],
});
export async function readReviews(db: Sql): Promise<ReviewState> {
  const saved = (
    await db.query("SELECT value FROM ReviewSettings WHERE key='scoreRules'")
  )[0];
  return {
    scoreRules: scoreRulesSchema.parse(
      saved ? JSON.parse(String(saved.value)) : defaultScoreRules,
    ),
    reviews: (
      await db.query("SELECT * FROM TradeReview ORDER BY sequence")
    ).map((r) => reviewSchema.parse(r)),
    improvements: (
      await db.query("SELECT * FROM ReviewImprovement ORDER BY rowid")
    ).map((r) => improvementSchema.parse(r)),
  };
}
export class ReviewCommands {
  constructor(
    private db: Sql,
    private trading: TradingCommands,
  ) {}
  async setRules(raw: unknown) {
    const rules = scoreRulesSchema.parse(raw);
    await this.db.batch([scoreSettingsInsert(rules)]);
  }
  async saveReview(raw: unknown) {
    const input = z
      .object({
        tradeId: id.optional(),
        period: z.enum(["TRADE", "WEEK", "MONTH"]),
        at: date,
        scores: z.record(z.string(), z.number().nonnegative()),
        tags,
        content: z.string().trim().min(10).max(50000),
        lessons: z.string().trim().min(1).max(3000),
        nextAction: z.string().trim().min(1).max(3000),
      })
      .parse(raw);
    if (input.at > new Date()) throw new Error("复盘不能使用未来时间");
    if (input.period === "TRADE") {
      if (!input.tradeId) throw new Error("单笔复盘需要选择交易");
      const t = (
        await this.db.query("SELECT status,closedAt FROM Trade WHERE id=?", [
          input.tradeId,
        ])
      )[0];
      if (!t || t.status !== "CLOSED")
        throw new Error("平仓后才能完成单笔复盘");
      if (input.at.toISOString() < String(t.closedAt))
        throw new Error("复盘时间不能早于平仓");
    } else if (input.tradeId) throw new Error("周/月复盘不应绑定单笔交易");
    const rules = (await readReviews(this.db)).scoreRules;
    const snapshot = scoreSnapshotSchema.parse({ values: input.scores, rules });
    const seq = (
      await this.db.query("SELECT MAX(sequence) AS sequence FROM TradeReview")
    )[0];
    const review = {
      ...input,
      id: crypto.randomUUID(),
      tradeId: input.tradeId ?? null,
      at: input.at.toISOString(),
      sequence: Number(seq?.sequence ?? 0) + 1,
      scores: JSON.stringify(snapshot),
      tags: JSON.stringify([...new Set(input.tags)]),
    };
    await this.db.batch([insertRow("TradeReview", review)]);
    return review;
  }
  async improveStrategy(raw: unknown) {
    const { reviewId, ...rules } = rulesSchema
      .extend({ reviewId: id })
      .parse(raw);
    const review = reviewSchema.parse(
      (
        await this.db.query("SELECT * FROM TradeReview WHERE id=?", [reviewId])
      )[0],
    );
    if (!review.tradeId)
      throw new Error("请从关联策略交易的单笔复盘生成改进草稿");
    const t = (
      await this.db.query("SELECT strategyVersionId FROM Trade WHERE id=?", [
        review.tradeId,
      ])
    )[0];
    if (!t?.strategyVersionId)
      throw new Error("该交易未关联策略，请先在策略页建立策略");
    if (
      (
        await this.db.query(
          "SELECT id FROM ReviewImprovement WHERE reviewId=?",
          [reviewId],
        )
      ).length
    )
      throw new Error("该复盘已生成改进草稿，请到策略页查看");
    const old = (
      await this.db.query("SELECT * FROM StrategyVersion WHERE id=?", [
        String(t.strategyVersionId),
      ])
    )[0];
    const strategy = (
      await this.db.query("SELECT name FROM Strategy WHERE id=?", [
        String(old.strategyId),
      ])
    )[0];
    if (Object.entries(rules).every(([k, v]) => old[k] === v))
      throw new Error("请填写实际修改的规则或适用条件");
    const prepared = await this.trading.prepareStrategy({
      ...rules,
      name: String(strategy.name),
    });
    const link = {
      id: crypto.randomUUID(),
      reviewId,
      sourceVersionId: String(t.strategyVersionId),
      versionId: prepared.version.id,
      at: new Date().toISOString(),
    };
    await this.db.batch([
      ...prepared.statements,
      insertRow("ReviewImprovement", link),
    ]);
    return prepared.version;
  }
}
export function validateReviews(state: ReviewState & TradingState) {
  const reviews = [...state.reviews].sort((a, b) => a.sequence - b.sequence);
  if (
    new Set(reviews.map((r) => r.id)).size !== reviews.length ||
    reviews.some((r, i) => r.sequence !== i + 1)
  )
    throw new Error("备份复盘ID或顺序重复/缺失");
  for (const r of reviews) {
    if (new Date(r.at) > new Date()) throw new Error("备份复盘时间无效");
    scoreSummary(JSON.parse(r.scores));
    const labels = tags.parse(JSON.parse(r.tags));
    if (new Set(labels).size !== labels.length)
      throw new Error("备份复盘标签重复");
    if (r.period === "TRADE") {
      const t = state.trades.find((t) => t.id === r.tradeId);
      if (!t || t.status !== "CLOSED" || !t.closedAt || r.at < t.closedAt)
        throw new Error("备份复盘与已平仓交易不一致");
    } else if (r.tradeId !== null) throw new Error("备份周期复盘不应关联交易");
  }
  const links = state.improvements;
  for (const key of ["id", "reviewId", "versionId"] as const)
    if (new Set(links.map((i) => i[key])).size !== links.length)
      throw new Error("备份改进关联重复");
  for (const link of links) {
    const r = reviews.find((r) => r.id === link.reviewId),
      t = state.trades.find((t) => t.id === r?.tradeId),
      source = state.versions.find((v) => v.id === link.sourceVersionId),
      version = state.versions.find((v) => v.id === link.versionId);
    if (
      !r ||
      !t ||
      !source ||
      !version ||
      t.strategyVersionId !== source.id ||
      source.strategyId !== version.strategyId ||
      version.version <= source.version ||
      link.at < r.at ||
      new Date(link.at) > new Date()
    )
      throw new Error("备份策略改进关联无效");
  }
}
export function latestReview(state: ReviewState, tradeId: string) {
  return state.reviews
    .filter((r) => r.period === "TRADE" && r.tradeId === tradeId)
    .sort((a, b) => b.at.localeCompare(a.at) || b.sequence - a.sequence)[0];
}
export const performanceFilterSchema = z.object({
  currency,
  accountId: id.optional(),
  assetId: id.optional(),
  strategyVersionId: id.optional(),
  tag: z.string().max(60).optional(),
  start: z.iso.date().optional(),
  end: z.iso.date().optional(),
});
export function performance(state: State, raw: unknown) {
  const f = performanceFilterSchema.parse(raw),
    start = f.start
      ? new Date(`${f.start}T00:00:00+08:00`).toISOString()
      : null,
    end = f.end ? new Date(`${f.end}T23:59:59.999+08:00`).toISOString() : null;
  if (start && end && start > end) throw new Error("开始日期不能晚于结束日期");
  const trades = state.trades
    .filter(
      (t) =>
        t.status === "CLOSED" &&
        t.closedAt &&
        state.assets.find((a) => a.id === t.assetId)?.currency === f.currency &&
        (!f.accountId || t.accountId === f.accountId) &&
        (!f.assetId || t.assetId === f.assetId) &&
        (!f.strategyVersionId || t.strategyVersionId === f.strategyVersionId) &&
        (!start || t.closedAt >= start) &&
        (!end || t.closedAt <= end) &&
        (!f.tag ||
          state.reviews.some(
            (r) => r.tradeId === t.id && JSON.parse(r.tags).includes(f.tag),
          )),
    )
    .sort(
      (a, b) =>
        a.closedAt!.localeCompare(b.closedAt!) || a.id.localeCompare(b.id),
    );
  const reviewed = trades
      .map((t) => latestReview(state, t.id))
      .filter((r): r is Review => !!r),
    graded = reviewed.map((r) => scoreSummary(JSON.parse(r.scores))),
    eligible = graded.filter((r) => r.compliant !== null);
  let cumulative = D(0),
    peak = D(0),
    drawdown = D(0),
    lossRun = 0,
    maxLossRun = 0;
  const points: { at: string; value: string }[] = [],
    timeline = new Map<string, string>();
  for (const t of trades) {
    timeline.set(
      t.closedAt!,
      canonical(D(timeline.get(t.closedAt!) ?? "0").plus(t.realized)),
    );
    lossRun = D(t.realized).lt(0) ? lossRun + 1 : 0;
    maxLossRun = Math.max(maxLossRun, lossRun);
  }
  for (const [at, pnl] of timeline) {
    cumulative = cumulative.plus(pnl);
    if (cumulative.gt(peak)) peak = cumulative;
    if (peak.minus(cumulative).gt(drawdown)) drawdown = peak.minus(cumulative);
    points.push({ at, value: canonical(cumulative) });
  }
  const groups = [...new Set(trades.map((t) => t.strategyVersionId))].map(
    (versionId) => {
      const list = trades.filter((t) => t.strategyVersionId === versionId),
        version = state.versions.find((v) => v.id === versionId),
        name = version
          ? `${state.strategies.find((s) => s.id === version.strategyId)?.name} v${version.version}`
          : "未关联策略";
      return {
        name,
        net: canonical(sum(list.map((t) => t.realized))),
        ...tradeMetrics(list),
      };
    },
  );
  const months = [
    ...new Set(
      trades.map((t) =>
        new Date(new Date(t.closedAt!).getTime() + 8 * 3600000)
          .toISOString()
          .slice(0, 7),
      ),
    ),
  ].map((month) => {
    const list = trades.filter(
      (t) =>
        new Date(new Date(t.closedAt!).getTime() + 8 * 3600000)
          .toISOString()
          .slice(0, 7) === month,
    );
    return {
      month,
      count: list.length,
      net: canonical(sum(list.map((t) => t.realized))),
    };
  });
  return {
    trades,
    metrics: tradeMetrics(trades),
    net: canonical(cumulative),
    fees: canonical(sum(trades.map((t) => t.fees))),
    reviewed: reviewed.length,
    reviewCoverage: trades.length
      ? canonical(D(reviewed.length).div(trades.length))
      : null,
    compliance: eligible.length
      ? canonical(
          D(eligible.filter((r) => r.compliant).length).div(eligible.length),
        )
      : null,
    complianceSample: eligible.length,
    averageScore: graded.length
      ? canonical(sum(graded.map((r) => r.score)).div(graded.length))
      : null,
    drawdown: canonical(drawdown),
    maxLossRun,
    points,
    groups,
    months,
    rSample: trades.filter((t) => D(t.initialRisk).gt(0)).length,
  };
}
