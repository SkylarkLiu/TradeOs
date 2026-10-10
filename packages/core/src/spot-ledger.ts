import { z } from "zod";
import { D, canonical } from "./decimal";
import { id, decimal, nonnegative, date } from "./validation";

export const transactionSchema = z.object({
  accountId: id,
  assetId: id,
  type: z.enum([
    "BUY",
    "SELL",
    "DEPOSIT",
    "WITHDRAWAL",
    "DIVIDEND",
    "INTEREST",
    "FEE",
    "ADJUSTMENT",
  ]),
  quantity: decimal,
  price: nonnegative.default("0"),
  fee: nonnegative.default("0"),
  at: date,
  note: z.string().max(3000).default(""),
  externalId: id.optional(),
  purpose: z
    .enum(["LONG_TERM", "TRADING", "CASH_RESERVE", "OTHER"])
    .default("LONG_TERM"),
});
export type LedgerInput = z.output<typeof transactionSchema>;

// Computes changes only; each platform applies them with its own reservation guards and transaction.
export function spotLedgerChanges(
  input: LedgerInput,
  isCash: boolean,
  holding: { quantity: string; cost: string },
) {
  const q = D(input.quantity),
    fee = D(input.fee),
    price = isCash ? D(1) : D(input.price);
  if (q.eq(0) || (input.type !== "ADJUSTMENT" && q.lt(0)))
    throw new Error("数量必须大于零；调整允许负数");
  if (!isCash && price.lte(0))
    throw new Error("非现金流水需要有效成交或估值价格");
  if (isCash && ["BUY", "SELL"].includes(input.type))
    throw new Error("现金请使用存入、取出或调整");
  if (input.type === "FEE" && !isCash) throw new Error("费用应使用现金资产");
  if (input.type === "FEE" && fee.gt(0))
    throw new Error("费用流水数量即费用金额，不应重复填写手续费");
  const oldQ = D(holding.quantity),
    avg = oldQ.gt(0) ? D(holding.cost).div(oldQ) : D(0);
  let delta = q,
    cost = q.mul(price),
    realized = D(0),
    cashDelta = D(0);
  if (
    ["SELL", "WITHDRAWAL", "FEE"].includes(input.type) ||
    (input.type === "ADJUSTMENT" && q.lt(0))
  ) {
    delta = input.type === "ADJUSTMENT" ? q : q.neg();
    cost = avg.mul(delta);
  }
  if (input.type === "BUY") {
    cost = cost.plus(fee);
    cashDelta = q.mul(price).plus(fee).neg();
  } else if (input.type === "SELL") {
    cashDelta = q.mul(price).minus(fee);
    realized = q.mul(price).minus(avg.mul(q)).minus(fee);
  } else if (!isCash) cashDelta = fee.neg();
  else {
    delta = delta.minus(fee);
    cost = delta;
    cashDelta = delta;
  }
  return {
    quantity: canonical(delta),
    price: canonical(price),
    fee: canonical(fee),
    cashDelta: canonical(cashDelta),
    costDelta: canonical(cost),
    realizedDelta: canonical(realized),
  };
}
