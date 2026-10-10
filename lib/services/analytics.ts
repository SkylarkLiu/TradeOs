import { z } from "zod";
import { currencyExposures } from "./history";
import type { Tx } from "./wealth";
import { db } from "@/lib/repositories/db";
import {
  D,
  sum,
  canonical,
  tradeMetrics,
  maxDrawdown,
  twr,
  xirr,
} from "@/lib/calculations/decimal";
import { id, text, date, tags } from "@/lib/validation/common";
import { audit, fxAt } from "./wealth";
import { defaultScoreRules } from "@/lib/review-rules";
export { defaultScoreRules };
export const scoreRulesSchema = z
  .array(
    z.object({
      name: text,
      max: z.number().int().min(1).max(100),
      weight: z.number().min(0).max(100),
      compliance: z.boolean(),
      threshold: z.number().min(0).max(100),
    }),
  )
  .min(1)
  .max(20)
  .refine(
    (r) =>
      new Set(r.map((x) => x.name)).size === r.length &&
      r.some((x) => x.weight > 0) &&
      r.every((x) => x.threshold <= x.max),
    "评分名称不能重复，至少一个权重大于零，门槛不能超过满分",
  );
export async function reviewCommand(action: string, raw: unknown) {
  if (action === "review.rules") {
    const input = scoreRulesSchema.parse(raw);
    return db.$transaction(async (tx) => {
      const r = await tx.systemSetting.upsert({
        where: { key: "scoreRules" },
        create: { key: "scoreRules", value: JSON.stringify(input) },
        update: { value: JSON.stringify(input) },
      });
      await audit(tx, action, "scoreRules", input);
      return r;
    });
  }
  const input = z
    .object({
      tradeId: id.optional(),
      period: z.enum(["TRADE", "WEEK", "MONTH"]),
      at: date,
      scores: z.record(z.string(), z.number().nonnegative()),
      tags,
      content: z.string().min(10).max(50000),
    })
    .parse(raw);
  return db.$transaction(async (tx) => {
    if (input.period === "TRADE") {
      if (!input.tradeId) throw new Error("单笔复盘需要交易");
      const t = await tx.trade.findUniqueOrThrow({
        where: { id: input.tradeId },
      });
      if (t.status !== "CLOSED") throw new Error("平仓后才能完成单笔复盘");
      if (input.at < t.closedAt!) throw new Error("复盘时间不能早于平仓");
      await tx.trade.update({
        where: { id: t.id },
        data: {
          tags: JSON.stringify([
            ...new Set([...JSON.parse(t.tags), ...input.tags]),
          ]),
        },
      });
    } else if (input.tradeId) throw new Error("周/月复盘不应绑定单笔交易");
    const rules = scoreRulesSchema.parse(
      JSON.parse(
        (await tx.systemSetting.findUnique({ where: { key: "scoreRules" } }))
          ?.value ?? JSON.stringify(defaultScoreRules),
      ),
    );
    if (
      Object.keys(input.scores).length !== rules.length ||
      rules.some(
        (r) =>
          input.scores[r.name] === undefined || input.scores[r.name] > r.max,
      )
    )
      throw new Error("评分项目不完整或超出范围");
    const r = await tx.tradeReview.create({
      data: {
        ...input,
        scores: JSON.stringify({ values: input.scores, rules }),
        tags: JSON.stringify(input.tags),
      },
    });
    await audit(tx, action, r.id, {
      period: input.period,
      tradeId: input.tradeId,
    });
    return r;
  });
}
export const filtersSchema = z.object({
  currency: z.enum(["CNY", "USD", "USDT"]).default("CNY"),
  accountId: id.optional(),
  assetId: id.optional(),
  strategyId: id.optional(),
  strategyVersionId: id.optional(),
  direction: z.enum(["LONG", "SHORT"]).optional(),
  environment: z.string().max(300).optional(),
  tag: z.string().max(60).optional(),
  start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export async function analytics(raw: unknown = {}) {
  const f = filtersSchema.parse(raw);
  const start = f.start ? new Date(`${f.start}T00:00:00+08:00`) : undefined,
    end = f.end ? new Date(`${f.end}T23:59:59.999+08:00`) : undefined;
  if (start && end && start > end) throw new Error("开始日期不能晚于结束日期");
  return db.$transaction(
    async (tx) => {
      const rawTrades = await tx.trade.findMany({
          where: {
            accountId: f.accountId,
            assetId: f.assetId,
            strategyVersionId: f.strategyVersionId,
            strategyVersion: f.strategyId
              ? { strategyId: f.strategyId }
              : undefined,
            direction: f.direction,
            environment: f.environment,
            closedAt: { not: null, gte: start, lte: end },
          },
          include: {
            asset: true,
            strategyVersion: { include: { strategy: true } },
            reviews: { orderBy: { at: "desc" }, take: 1 },
            fills: true,
          },
          orderBy: { closedAt: "asc" },
        }),
        trades = rawTrades.filter(
          (t) => !f.tag || JSON.parse(t.tags).includes(f.tag),
        );
      const converted: typeof trades = [];
      let missingFx = 0;
      for (const t of trades) {
        const fx = await fxAt(tx, t.asset.currency, f.currency, t.closedAt!);
        if (!fx) {
          missingFx++;
          continue;
        }
        converted.push({
          ...t,
          realized: D(t.realized).mul(fx).toFixed(),
          initialRisk: D(t.initialRisk).mul(fx).toFixed(),
        });
      }
      const reviewed = trades.filter((t) => t.reviews.length),
        compliant = reviewed.filter((t) => {
          const s = JSON.parse(t.reviews[0].scores) as {
            values: Record<string, number>;
            rules: typeof defaultScoreRules;
          };
          return (
            s.rules
              .filter((r) => r.compliance)
              .every((r) => s.values[r.name] >= r.threshold) &&
            s.rules.some((r) => r.compliance)
          );
        });
      const snapshots = f.accountId
        ? (
            await tx.accountValuation.findMany({
              where: { accountId: f.accountId, at: { gte: start, lte: end } },
              orderBy: { at: "asc" },
            })
          ).map((r) => ({ at: r.at, value: r.value, currency: r.currency }))
        : (
            await tx.portfolioSnapshot.findMany({
              where: {
                currency: f.currency,
                complete: true,
                at: { gte: start, lte: end },
              },
              orderBy: { at: "asc" },
            })
          ).map((r) => ({ at: r.at, value: r.assets, currency: r.currency }));
      const normalized: { at: Date; value: string }[] = [];
      let invalidValuation = false;
      for (const s of snapshots) {
        const fx = await fxAt(tx, s.currency, f.currency, s.at);
        if (!fx) {
          invalidValuation = true;
          continue;
        }
        normalized.push({ at: s.at, value: D(s.value).mul(fx).toFixed() });
      }
      const flows = await tx.accountCashFlow.findMany({
        where: {
          accountId: f.accountId,
          kind: f.accountId ? undefined : "EXTERNAL",
          at: normalized.length
            ? { gt: normalized[0].at, lte: normalized.at(-1)!.at }
            : undefined,
        },
        orderBy: { at: "asc" },
      });
      const cashFlows: { at: Date; amount: string }[] = [];
      let invalidFlow = false;
      for (const c of flows) {
        const fx = await fxAt(tx, c.currency, f.currency, c.at);
        if (!fx || c.kind === "INTERNAL_UNVALUED") {
          invalidFlow = true;
          continue;
        }
        cashFlows.push({ at: c.at, amount: D(c.amount).mul(fx).toFixed() });
      }
      const periods = normalized.slice(1).map((s, i) => {
        const previous = normalized[i],
          inside = cashFlows.filter((c) => c.at > previous.at && c.at <= s.at),
          boundary = inside.every((c) => c.at.getTime() === s.at.getTime());
        return {
          begin: previous.value,
          end: s.value,
          flowAtEnd: sum(inside.map((c) => c.amount)).toFixed(),
          valid: boundary,
          at: s.at,
        };
      });
      const sufficient =
          normalized.length >= 2 && !invalidValuation && !invalidFlow,
        twrValue =
          sufficient && periods.every((p) => p.valid) ? twr(periods) : null;
      const irr = sufficient
        ? xirr([
            {
              amount: D(normalized[0].value).neg().toFixed(),
              at: normalized[0].at,
            },
            ...cashFlows.map((c) => ({
              ...c,
              amount: D(c.amount).neg().toFixed(),
            })),
            { amount: normalized.at(-1)!.value, at: normalized.at(-1)!.at },
          ])
        : { value: null, reason: "估值或历史汇率不足" };
      let unit = D(1);
      const curve = ["1"];
      if (twrValue !== null)
        for (const p of periods) {
          unit = unit.mul(D(p.end).minus(p.flowAtEnd).div(p.begin));
          curve.push(unit.toFixed());
        }
      const strategyNames = [
        ...new Set(
          converted.map((t) =>
            t.strategyVersion
              ? `${t.strategyVersion.strategy.name} v${t.strategyVersion.version}`
              : "未关联策略",
          ),
        ),
      ];
      const byStrategy = strategyNames.map((name) => {
        const list = converted.filter(
          (t) =>
            (t.strategyVersion
              ? `${t.strategyVersion.strategy.name} v${t.strategyVersion.version}`
              : "未关联策略") === name,
        );
        return {
          name,
          net: sum(list.map((t) => t.realized)).toFixed(),
          ...tradeMetrics(list),
        };
      });
      const monthly = [
        ...new Set(
          periods.map((p) =>
            new Date(p.at.getTime() + 8 * 3600000 - 1)
              .toISOString()
              .slice(0, 7),
          ),
        ),
      ].map((month) => {
        const list = periods.filter(
          (p) =>
            new Date(p.at.getTime() + 8 * 3600000 - 1)
              .toISOString()
              .slice(0, 7) === month,
        );
        return {
          month,
          value: sufficient && list.every((p) => p.valid) ? twr(list) : null,
          coverage: "已录入估值区间，不代表完整自然月",
        };
      });
      const netGrowth = sufficient
          ? D(normalized.at(-1)!.value).minus(normalized[0].value)
          : null,
        external = sum(cashFlows.map((c) => c.amount));
      const txns = await tx.assetTransaction.findMany({
        where: {
          accountId: f.accountId,
          at: normalized.length
            ? { gt: normalized[0].at, lte: normalized.at(-1)!.at }
            : undefined,
        },
        include: {
          asset: true,
          fill: { include: { trade: { include: { asset: true } } } },
        },
      });
      let longTerm = D(0),
        trading = D(0),
        income = D(0),
        adjustments = D(0),
        attributionComplete = sufficient;
      for (const r of txns) {
        const fx = await fxAt(tx, r.currency, f.currency, r.at);
        if (!fx) {
          attributionComplete = false;
          continue;
        }
        if (r.fill) {
          trading = trading.plus(D(r.fill.pnl).mul(fx));
        } else if (r.type === "SELL")
          longTerm = longTerm.plus(D(r.realizedDelta).mul(fx));
        else if (["DIVIDEND", "INTEREST"].includes(r.type))
          income = income.plus(
            D(r.quantity)
              .mul(r.price)
              .minus(r.asset.assetClass === "CASH" ? "0" : r.fee)
              .mul(fx),
          );
        else if (r.type === "ADJUSTMENT")
          adjustments = adjustments.plus(D(r.quantity).mul(r.price).mul(fx));
      }
      const fxContribution = attributionComplete
        ? await currencyContribution(
            tx,
            f.currency,
            normalized[0].at,
            normalized.at(-1)!.at,
            f.accountId,
          )
        : null;
      const residual =
        netGrowth && attributionComplete
          ? netGrowth
              .minus(external)
              .minus(longTerm)
              .minus(trading)
              .minus(income)
              .minus(adjustments)
              .minus(fxContribution ?? 0)
          : null;
      return {
        currency: f.currency,
        metrics: tradeMetrics(converted),
        totalClosed: trades.length,
        missingFx,
        compliance: reviewed.length
          ? D(compliant.length).div(reviewed.length).toFixed()
          : null,
        reviewed: reviewed.length,
        byStrategy,
        monthly,
        account: {
          twr: twrValue,
          twrReason:
            twrValue === null
              ? "需要至少两次估值、有效历史汇率，并在资金流发生时记录估值边界"
              : null,
          xirr: irr.value,
          xirrReason: irr.reason,
          rawDrawdown: normalized.length
            ? maxDrawdown(normalized.map((s) => s.value))
            : null,
          returnDrawdown: twrValue !== null ? maxDrawdown(curve) : null,
          peak: normalized.length
            ? canonical(
                normalized.reduce(
                  (a, s) => (D(s.value).gt(a) ? D(s.value) : a),
                  D(0),
                ),
              )
            : null,
          investmentPnl:
            netGrowth && attributionComplete
              ? netGrowth.minus(external).toFixed()
              : null,
          from: normalized[0]?.at.toISOString() ?? null,
          to: normalized.at(-1)?.at.toISOString() ?? null,
        },
        attribution: {
          external: attributionComplete ? external.toFixed() : null,
          longTerm: attributionComplete ? longTerm.toFixed() : null,
          trading: attributionComplete ? trading.toFixed() : null,
          income: attributionComplete ? income.toFixed() : null,
          adjustments: attributionComplete ? adjustments.toFixed() : null,
          fx: fxContribution,
          residual: residual?.toFixed() ?? null,
        },
        curve: normalized.map((s) => ({
          at: s.at.toISOString(),
          value: s.value,
        })),
      };
    },
    { timeout: 30000 },
  );
}
export type AnalyticsResult = Awaited<ReturnType<typeof analytics>>;

async function currencyContribution(
  tx: Tx,
  report: string,
  start: Date,
  end: Date,
  accountId?: string,
) {
  const changes = await tx.fXRate.findMany({
    where: {
      at: { gt: start, lte: end },
      OR: [{ from: report }, { to: report }],
    },
    orderBy: { at: "asc" },
  });
  const times = [...new Set(changes.map((r) => r.at.toISOString()))];
  let contribution = D(0);
  for (const time of times) {
    const at = new Date(time),
      before = new Date(at.getTime() - 1),
      exposure = await currencyExposures(tx, before, at, accountId);
    if (!exposure.complete) return null;
    for (const e of exposure.values) {
      const old = await fxAt(tx, e.currency, report, before),
        next = await fxAt(tx, e.currency, report, at);
      if (!old || !next) return null;
      contribution = contribution.plus(D(e.value).mul(next.minus(old)));
    }
  }
  return contribution.toFixed();
}
