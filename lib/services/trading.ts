import { z } from "zod";
import { db } from "@/lib/repositories/db";
import {
  D,
  canonical,
  contractPnl,
  positionSize,
} from "@/lib/calculations/decimal";
import {
  id,
  text,
  date,
  positive,
  nonnegative,
  direction,
  optionalId,
  tags,
} from "@/lib/validation/common";
import {
  audit,
  nextLedgerSequence,
  postLedger,
  cashAsset,
  setBalance,
  chronology,
  type Tx,
} from "./wealth";
const rulesSchema = z.object({
  market: text,
  timeframe: text,
  environment: text,
  rules: z.string().min(20).max(50000),
});
async function published(tx: Tx, versionId: string) {
  const v = await tx.strategyVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: { strategy: true },
  });
  if (!v.published || v.strategy.archived)
    throw new Error("请选择活跃策略的已发布版本");
  return v;
}
const planSchema = z.object({
  accountId: id,
  assetId: id,
  strategyVersionId: optionalId,
  direction,
  entry: positive,
  stop: positive,
  target: positive,
  equity: positive,
  riskPercent: positive,
  reason: text,
  invalidation: text,
});
const tradeSchema = z.object({
  accountId: id,
  assetId: id,
  strategyVersionId: optionalId,
  planId: optionalId,
  direction,
  initialRisk: nonnegative.default("0"),
  leverage: positive.default("1"),
  stop: positive.optional(),
  target: positive.optional(),
  reason: z.string().max(3000).default(""),
  emotion: z.string().max(1000).default(""),
  tags: tags.default([]),
  environment: z.string().max(300).default(""),
  openedAt: date,
});
export async function tradingCommand(action: string, raw: unknown) {
  switch (action) {
    case "strategy.create": {
      const input = rulesSchema.extend({ name: text }).parse(raw);
      return db.$transaction(async (tx) => {
        const { name, ...rules } = input;
        const r = await tx.strategy.create({
          data: { name, versions: { create: { ...rules, version: 1 } } },
          include: { versions: true },
        });
        await audit(tx, action, r.id, input);
        return r;
      });
    }
    case "strategy.version": {
      const input = rulesSchema.extend({ strategyId: id }).parse(raw);
      return db.$transaction(async (tx) => {
        const strategy = await tx.strategy.findUniqueOrThrow({
          where: { id: input.strategyId },
        });
        if (strategy.archived) throw new Error("策略已归档");
        const latest = await tx.strategyVersion.findFirst({
          where: { strategyId: input.strategyId },
          orderBy: { version: "desc" },
        });
        const r = await tx.strategyVersion.create({
          data: { ...input, version: (latest?.version ?? 0) + 1 },
        });
        await audit(tx, action, r.id, input);
        return r;
      });
    }
    case "strategy.edit": {
      const input = rulesSchema.extend({ id }).parse(raw);
      return db.$transaction(async (tx) => {
        const { id: versionId, ...data } = input;
        const v = await tx.strategyVersion.findUniqueOrThrow({
          where: { id: versionId },
        });
        if (v.published) throw new Error("已发布版本不可修改，请创建新版本");
        const r = await tx.strategyVersion.update({
          where: { id: versionId },
          data,
        });
        await audit(tx, action, r.id, input);
        return r;
      });
    }
    case "strategy.publish": {
      const input = z.object({ id }).parse(raw);
      return db.$transaction(async (tx) => {
        const old = await tx.strategyVersion.findUniqueOrThrow({
          where: { id: input.id },
        });
        if (old.published) throw new Error("版本已经发布");
        if (old.rules.replace(/^#+.*$/gm, "").trim().length < 20)
          throw new Error("请填写具体策略规则后再发布");
        const r = await tx.strategyVersion.update({
          where: { id: input.id },
          data: { published: true },
        });
        await audit(tx, action, r.id, input);
        return r;
      });
    }
    case "strategy.archive": {
      const input = z.object({ id, archived: z.boolean() }).parse(raw);
      return db.$transaction(async (tx) => {
        const r = await tx.strategy.update({
          where: { id: input.id },
          data: { archived: input.archived },
        });
        await audit(tx, action, r.id, input);
        return r;
      });
    }
    case "plan.create": {
      const input = planSchema.parse(raw);
      return db.$transaction(async (tx) => {
        const a = await tx.asset.findUniqueOrThrow({
          where: { id: input.assetId },
        });
        if (input.direction === "SHORT" && a.instrument === "SPOT")
          throw new Error("现货不支持无借券卖空");
        if (input.strategyVersionId)
          await published(tx, input.strategyVersionId);
        if (
          input.direction === "LONG"
            ? D(input.target).lte(input.entry)
            : D(input.target).gte(input.entry)
        )
          throw new Error("止盈方向错误");
        const size = positionSize({
          ...input,
          instrument: a.instrument,
          multiplier: a.multiplier,
        });
        const r = await tx.tradingPlan.create({
          data: { ...input, quantity: size.quantity },
        });
        await audit(tx, action, r.id, { ...input, ...size });
        return r;
      });
    }
    case "trade.create": {
      let input = tradeSchema.parse(raw);
      return db.$transaction(async (tx) => {
        const account = await tx.account.findUniqueOrThrow({
          where: { id: input.accountId },
        });
        if (account.archived) throw new Error("账户已归档");
        const asset = await tx.asset.findUniqueOrThrow({
          where: { id: input.assetId },
        });
        if (asset.instrument === "SPOT" && input.direction === "SHORT")
          throw new Error("现货不支持无借券卖空");
        if (D(input.leverage).gt(100)) throw new Error("杠杆参数不能超过100");
        if (input.planId) {
          const p = await tx.tradingPlan.findUniqueOrThrow({
            where: { id: input.planId },
          });
          if (
            p.accountId !== input.accountId ||
            p.assetId !== input.assetId ||
            p.direction !== input.direction
          )
            throw new Error("交易与计划的账户、标的及方向必须一致");
          input = {
            ...input,
            strategyVersionId: p.strategyVersionId ?? undefined,
            initialRisk: canonical(D(p.equity).mul(p.riskPercent).div(100)),
            stop: p.stop,
            target: p.target,
          };
        }
        if (input.strategyVersionId)
          await published(tx, input.strategyVersionId);
        const r = await tx.trade.create({
          data: {
            ...input,
            tags: JSON.stringify(
              input.planId ? input.tags : [...input.tags, "UNPLANNED"],
            ),
          },
        });
        await audit(tx, action, r.id, input);
        return r;
      });
    }
    case "fill.create":
      return recordFill(raw);
    case "position.event": {
      const input = z
        .object({
          tradeId: id,
          type: z.enum([
            "STOP_ADJUSTMENT",
            "TARGET_ADJUSTMENT",
            "PLAN_DEVIATION",
            "MARKET_OBSERVATION",
          ]),
          detail: text,
          value: positive.optional(),
          at: date,
        })
        .parse(raw);
      return db.$transaction(async (tx) => {
        const t = await tx.trade.findUniqueOrThrow({
          where: { id: input.tradeId },
        });
        if (t.status !== "OPEN") throw new Error("交易已平仓");
        if (input.at < t.openedAt) throw new Error("事件不能早于开仓");
        if (["STOP_ADJUSTMENT", "TARGET_ADJUSTMENT"].includes(input.type)) {
          if (!input.value) throw new Error("请输入新价格");
          await tx.trade.update({
            where: { id: t.id },
            data: {
              [input.type === "STOP_ADJUSTMENT" ? "stop" : "target"]:
                input.value,
            },
          });
        }
        const r = await tx.positionEvent.create({
          data: {
            tradeId: t.id,
            type: input.type,
            detail: JSON.stringify({ note: input.detail, value: input.value }),
            at: input.at,
          },
        });
        await audit(tx, action, r.id, input);
        return r;
      });
    }
    case "attachment.create": {
      const input = z
        .object({
          tradeId: optionalId,
          strategyVersionId: optionalId,
          name: text,
          mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
          data: z
            .string()
            .max(7_000_000)
            .regex(/^[A-Za-z0-9+/]+=*$/),
        })
        .parse(raw);
      if (!!input.tradeId === !!input.strategyVersionId)
        throw new Error("附件必须属于一笔交易或一个策略版本");
      return db.$transaction(async (tx) => {
        if (input.tradeId)
          await tx.trade.findUniqueOrThrow({ where: { id: input.tradeId } });
        if (input.strategyVersionId) {
          const v = await tx.strategyVersion.findUniqueOrThrow({
            where: { id: input.strategyVersionId },
          });
          if (v.published) throw new Error("已发布策略附件不可修改");
        }
        const bytes = Buffer.from(input.data, "base64");
        const actual = bytes.subarray(0, 8).toString("hex");
        if (!(
          (input.mime === "image/png" && actual === "89504e470d0a1a0a") ||
          (input.mime === "image/jpeg" && actual.startsWith("ffd8ff")) ||
          (input.mime === "image/webp" &&
            bytes.subarray(0, 4).toString() === "RIFF" &&
            bytes.subarray(8, 12).toString() === "WEBP")
        ))
          throw new Error("图片内容与类型不匹配");
        const r = await tx.tradeAttachment.create({
          data: input,
          select: { id: true, name: true, mime: true },
        });
        await audit(tx, action, r.id, { name: input.name });
        return r;
      });
    }
    default:
      throw new Error("未知交易操作");
  }
}
export async function recordFill(raw: unknown) {
  const input = z
    .object({
      tradeId: id,
      action: z.enum(["ENTRY", "EXIT"]),
      quantity: positive,
      price: positive,
      fee: nonnegative.default("0"),
      slippage: nonnegative.default("0"),
      at: date,
    })
    .parse(raw);
  return db.$transaction(async (tx) => {
    const trade = await tx.trade.findUniqueOrThrow({
      where: { id: input.tradeId },
      include: {
        asset: true,
        fills: { orderBy: [{ at: "desc" }, { sequence: "desc" }], take: 1 },
      },
    });
    if (trade.status !== "OPEN") throw new Error("已平仓交易不可追加成交");
    if (
      input.at < trade.openedAt ||
      (trade.fills[0] && input.at < trade.fills[0].at)
    )
      throw new Error("成交时间不能早于开仓或上一笔成交");
    const oldQ = D(trade.quantity),
      q = D(input.quantity),
      price = D(input.price),
      fee = D(input.fee),
      entry = input.action === "ENTRY";
    if (!entry && q.gt(oldQ)) throw new Error("平仓数量超过持仓");
    const nextQ = entry ? oldQ.plus(q) : oldQ.minus(q);
    let avg = D(trade.averageEntry);
    if (entry) {
      avg =
        trade.asset.instrument === "INVERSE" && oldQ.gt(0)
          ? nextQ.div(oldQ.div(avg).plus(q.div(price)))
          : oldQ.mul(avg).plus(q.mul(price)).div(nextQ);
    }
    const realized = entry
        ? fee.neg()
        : contractPnl(
            trade.asset.instrument,
            trade.direction,
            input.quantity,
            trade.averageEntry,
            input.price,
            trade.asset.multiplier,
          ).minus(fee),
      closed = !entry && nextQ.eq(0);
    let margin = D(0);
    if (trade.asset.instrument !== "SPOT" && nextQ.gt(0))
      margin = nextQ
        .mul(trade.asset.multiplier)
        .mul(trade.asset.instrument === "INVERSE" ? D(1).div(avg) : avg)
        .div(trade.leverage);
    await tx.trade.update({
      where: { id: trade.id },
      data: {
        quantity: canonical(nextQ),
        averageEntry: canonical(avg),
        realized: canonical(D(trade.realized).plus(realized)),
        fees: canonical(D(trade.fees).plus(fee)),
        margin: canonical(margin),
        status: closed ? "CLOSED" : "OPEN",
        closedAt: closed ? input.at : null,
      },
    });
    let transaction;
    if (trade.asset.instrument === "SPOT") {
      transaction = await postLedger(tx, {
        accountId: trade.accountId,
        assetId: trade.assetId,
        type: entry ? "BUY" : "SELL",
        quantity: input.quantity,
        price: input.price,
        fee: input.fee,
        at: input.at,
        note: `交易 ${trade.id}`,
        purpose: "TRADING",
      });
    } else {
      await chronology(tx, trade.accountId, input.at);
      const cash = await cashAsset(tx, trade.asset.currency);
      await setBalance(
        tx,
        trade.accountId,
        cash.id,
        canonical(realized),
        canonical(realized),
      );
      transaction = await tx.assetTransaction.create({
        data: {
          sequence: await nextLedgerSequence(tx, trade.accountId),
          accountId: trade.accountId,
          assetId: trade.assetId,
          type: entry ? "CONTRACT_ENTRY" : "CONTRACT_EXIT",
          quantity: canonical(q.mul(entry ? 1 : -1)),
          price: input.price,
          fee: input.fee,
          cashDelta: canonical(realized),
          realizedDelta: canonical(realized),
          currency: trade.asset.currency,
          at: input.at,
          note: `合约成交 ${trade.id}`,
        },
      });
    }
    const fill = await tx.tradeFill.create({
      data: {
        ...input,
        sequence: (trade.fills[0]?.sequence ?? 0) + 1,
        transactionId: transaction.id,
        pnl: canonical(realized),
      },
    });
    await tx.positionEvent.create({
      data: {
        tradeId: trade.id,
        type: entry
          ? oldQ.eq(0)
            ? "ENTRY"
            : "ADD_POSITION"
          : closed
            ? "EXIT"
            : "PARTIAL_EXIT",
        detail: JSON.stringify(input),
        at: input.at,
      },
    });
    await audit(tx, "FILL_POST", fill.id, input);
    return fill;
  });
}
