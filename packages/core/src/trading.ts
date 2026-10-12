import { z } from "zod";
import { D, canonical, contractPnl } from "./decimal";
import {
  id,
  text,
  date,
  positive,
  nonnegative,
  direction,
  optionalId,
  tags,
} from "./validation";
export const rulesSchema = z.object({
  market: text,
  timeframe: text,
  environment: text,
  rules: z.string().min(20).max(50000),
});
export const planSchema = z.object({
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
export const tradeSchema = z.object({
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
export const fillSchema = z.object({
  tradeId: id,
  action: z.enum(["ENTRY", "EXIT"]),
  quantity: positive,
  price: positive,
  fee: nonnegative.default("0"),
  slippage: nonnegative.default("0"),
  at: date,
});
export type FillInput = z.output<typeof fillSchema>;
export function fillChanges(
  trade: {
    quantity: string;
    averageEntry: string;
    realized: string;
    fees: string;
    direction: string;
    leverage: string;
  },
  input: FillInput,
  asset: { instrument: string; multiplier: string },
) {
  const oldQ = D(trade.quantity),
    q = D(input.quantity),
    price = D(input.price),
    fee = D(input.fee),
    entry = input.action === "ENTRY";
  if (!entry && q.gt(oldQ)) throw new Error("平仓数量超过持仓");
  const nextQ = entry ? oldQ.plus(q) : oldQ.minus(q);
  let avg = D(trade.averageEntry);
  if (entry)
    avg =
      asset.instrument === "INVERSE" && oldQ.gt(0)
        ? nextQ.div(oldQ.div(avg).plus(q.div(price)))
        : oldQ.mul(avg).plus(q.mul(price)).div(nextQ);
  const realized = entry
    ? fee.neg()
    : contractPnl(
        asset.instrument,
        trade.direction,
        input.quantity,
        trade.averageEntry,
        input.price,
        asset.multiplier,
      ).minus(fee);
  const closed = !entry && nextQ.eq(0);
  let margin = D(0);
  if (asset.instrument !== "SPOT" && nextQ.gt(0))
    margin = nextQ
      .mul(asset.multiplier)
      .mul(asset.instrument === "INVERSE" ? D(1).div(avg) : avg)
      .div(trade.leverage);
  return {
    quantity: canonical(nextQ),
    averageEntry: canonical(avg),
    realized: canonical(D(trade.realized).plus(realized)),
    fees: canonical(D(trade.fees).plus(fee)),
    margin: canonical(margin),
    status: closed ? ("CLOSED" as const) : ("OPEN" as const),
    closedAt: closed ? input.at : null,
    pnl: canonical(realized),
  };
}
