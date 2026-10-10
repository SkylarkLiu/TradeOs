import { z } from "zod";
import { db } from "@/lib/repositories/db";
import type { Prisma } from "@/generated/prisma/client";
import { D, canonical, sum, contractPnl } from "@/lib/calculations/decimal";
import {
  historicalBalances,
  historicalContracts,
  historicalLiabilities,
} from "./history";
import {
  id,
  text,
  currency,
  date,
  positive,
  nonnegative,
} from "@/lib/validation/common";
export type Tx = Prisma.TransactionClient;
import {
  transactionSchema,
  spotLedgerChanges,
  type LedgerInput,
} from "../../packages/core/src/spot-ledger";
export { transactionSchema };
export type { LedgerInput };
export const audit = (
  tx: Tx,
  action: string,
  entityId: string,
  detail: unknown,
) =>
  tx.auditLog.create({
    data: { action, entityId, detail: JSON.stringify(detail) },
  });
export async function cashAsset(tx: Tx, code: string) {
  return tx.asset.upsert({
    where: { code: `CASH:${code}` },
    create: {
      code: `CASH:${code}`,
      name: `${code}现金`,
      assetClass: "CASH",
      currency: code,
      investable: true,
    },
    update: {},
  });
}
async function balance(tx: Tx, accountId: string, assetId: string) {
  return tx.assetBalance.upsert({
    where: { accountId_assetId: { accountId, assetId } },
    create: { accountId, assetId },
    update: {},
  });
}
export async function setBalance(
  tx: Tx,
  accountId: string,
  assetId: string,
  q: string,
  c: string,
  r = "0",
  purpose?: string,
) {
  const b = await balance(tx, accountId, assetId);
  const next = D(b.quantity).plus(q),
    cost = D(b.cost).plus(c);
  if (next.lt(0) || cost.lt("-0.00000000000000000001"))
    throw new Error("可用余额不足");
  const asset = await tx.asset.findUniqueOrThrow({ where: { id: assetId } });
  if (asset.assetClass === "CASH") {
    const reserved = await tx.trade.findMany({
      where: {
        accountId,
        status: "OPEN",
        asset: { currency: asset.currency, instrument: { not: "SPOT" } },
      },
    });
    if (next.lt(sum(reserved.map((t) => t.margin))))
      throw new Error("资金已被合约保证金占用");
  } else if (asset.instrument === "SPOT") {
    const reserved = await tx.trade.findMany({
      where: { accountId, assetId, status: "OPEN" },
    });
    if (next.lt(sum(reserved.map((t) => t.quantity))))
      throw new Error("资产已被未平仓交易占用，请先在交易日志减仓或平仓");
  }
  return tx.assetBalance.update({
    where: { id: b.id },
    data: {
      quantity: canonical(next),
      cost: next.eq(0) ? "0" : canonical(cost),
      realized: canonical(D(b.realized).plus(r)),
      ...(purpose ? { purpose } : {}),
    },
  });
}
export async function chronology(tx: Tx, accountId: string, at: Date) {
  if (at > new Date()) throw new Error("真实记录不能使用未来时间");
  const account = await tx.account.findUniqueOrThrow({
    where: { id: accountId },
  });
  if (account.archived) throw new Error("账户已归档，请先恢复账户");
  const last = await tx.assetTransaction.findFirst({
    where: { accountId },
    orderBy: [{ at: "desc" }, { sequence: "desc" }],
  });
  if (last && last.at > at)
    throw new Error(
      "流水必须按时间顺序录入；历史流水请按日期排序导入，已有历史通过更正记录处理",
    );
}
export async function postLedger(tx: Tx, input: LedgerInput) {
  const account = await tx.account.findUniqueOrThrow({
      where: { id: input.accountId },
    }),
    asset = await tx.asset.findUniqueOrThrow({ where: { id: input.assetId } });
  if (account.archived) throw new Error("账户已归档");
  if (asset.instrument !== "SPOT") throw new Error("合约成交请从交易日志录入");
  await chronology(tx, account.id, input.at);
  if (input.at > new Date()) throw new Error("真实流水不能记录未来时间");
  const isCash = asset.assetClass === "CASH";
  const b = await balance(tx, account.id, asset.id);
  const changes = spotLedgerChanges(input, isCash, b);
  const q = D(input.quantity),
    price = D(changes.price),
    fee = D(changes.fee),
    delta = D(changes.quantity),
    cost = D(changes.costDelta),
    realized = D(changes.realizedDelta),
    cashDelta = D(changes.cashDelta);
  await setBalance(
    tx,
    account.id,
    asset.id,
    canonical(delta),
    canonical(cost),
    canonical(realized),
    input.purpose,
  );
  if (!isCash && !cashDelta.eq(0)) {
    const cash = await cashAsset(tx, asset.currency);
    await setBalance(
      tx,
      account.id,
      cash.id,
      canonical(cashDelta),
      canonical(cashDelta),
    );
  }
  const record = await tx.assetTransaction.create({
    data: {
      sequence: await nextLedgerSequence(tx, account.id),
      accountId: account.id,
      assetId: asset.id,
      type: input.type,
      quantity: canonical(delta),
      price: canonical(price),
      fee: canonical(fee),
      cashDelta: canonical(cashDelta),
      costDelta: canonical(cost),
      realizedDelta: canonical(realized),
      currency: asset.currency,
      at: input.at,
      note: input.note,
      externalId: input.externalId,
    },
  });
  if (["DEPOSIT", "WITHDRAWAL"].includes(input.type))
    await tx.accountCashFlow.create({
      data: {
        accountId: account.id,
        amount: canonical(q.mul(price).mul(input.type === "DEPOSIT" ? 1 : -1)),
        currency: asset.currency,
        kind: "EXTERNAL",
        transactionId: record.id,
        at: input.at,
      },
    });
  await audit(tx, "LEDGER_POST", record.id, input);
  return record;
}
export async function recordTransaction(raw: unknown) {
  const input = transactionSchema.parse(raw);
  return db.$transaction((tx) => postLedger(tx, input));
}
export async function wealthCommand(action: string, raw: unknown) {
  switch (action) {
    case "platform.create": {
      const input = z
        .object({
          name: text,
          template: z
            .enum(["Binance", "OKX", "IBKR", "Futu", "Alipay", "Bank", "Other"])
            .default("Other"),
        })
        .parse(raw);
      return db.$transaction(async (tx) => {
        const r = await tx.platform.create({ data: input });
        await audit(tx, action, r.id, input);
        return r;
      });
    }
    case "account.create": {
      const input = z
        .object({ platformId: id, name: text, currency })
        .parse(raw);
      return db.$transaction(async (tx) => {
        const r = await tx.account.create({ data: input });
        await audit(tx, action, r.id, input);
        return r;
      });
    }
    case "asset.create": {
      const input = z
        .object({
          code: text,
          name: text,
          assetClass: z.enum([
            "CASH",
            "STOCK",
            "ETF",
            "MUTUAL_FUND",
            "CRYPTO",
            "BOND",
            "GOLD",
            "REAL_ESTATE",
            "OTHER",
          ]),
          currency,
          instrument: z.enum(["SPOT", "LINEAR", "INVERSE"]).default("SPOT"),
          multiplier: positive.default("1"),
          investable: z.boolean().optional(),
        })
        .parse(raw);
      input.investable ??= input.assetClass !== "REAL_ESTATE";
      if (input.assetClass === "CASH") {
        input.code = `CASH:${input.currency}`;
        input.instrument = "SPOT";
      }
      if (input.instrument === "SPOT") input.multiplier = "1";
      return db.$transaction(async (tx) => {
        const r = await tx.asset.create({ data: input });
        await audit(tx, action, r.id, input);
        return r;
      });
    }
    case "asset.configure": {
      const input = z.object({ id, investable: z.boolean() }).parse(raw);
      return db.$transaction(async (tx) => {
        const r = await tx.asset.update({
          where: { id: input.id },
          data: { investable: input.investable },
        });
        await audit(tx, action, r.id, input);
        return r;
      });
    }
    case "account.archive": {
      const input = z.object({ id, archived: z.boolean() }).parse(raw);
      return db.$transaction(async (tx) => {
        const r = await tx.account.update({
          where: { id: input.id },
          data: { archived: input.archived },
        });
        await audit(tx, action, r.id, input);
        return r;
      });
    }
    case "transaction.create":
      return recordTransaction(raw);
    case "transaction.reverse":
      return reverseTransaction(raw);
    case "liability.update": {
      const input = z.object({ id, amount: nonnegative }).parse(raw);
      return db.$transaction(async (tx) => {
        const r = await tx.liability.update({
          where: { id: input.id },
          data: { amount: input.amount, at: new Date() },
        });
        await audit(tx, action, r.id, input);
        return r;
      });
    }
    case "price.create": {
      const input = z
        .object({
          assetId: id,
          price: positive,
          at: date,
          source: text.default("MANUAL"),
        })
        .parse(raw);
      return db.$transaction(async (tx) => {
        const asset = await tx.asset.findUniqueOrThrow({
          where: { id: input.assetId },
        });
        if (asset.assetClass === "CASH")
          throw new Error("现金单位价格固定为1；币种折算请更新汇率");
        const r = await tx.assetPrice.create({ data: input });
        await audit(tx, action, r.id, input);
        return r;
      });
    }
    case "fx.create": {
      const input = z
        .object({
          from: currency,
          to: currency,
          rate: positive,
          at: date,
          source: text.default("MANUAL"),
        })
        .parse(raw);
      if (input.from === input.to) throw new Error("相同币种无需汇率");
      return db.$transaction(async (tx) => {
        const r = await tx.fXRate.create({ data: input });
        await audit(tx, action, r.id, input);
        return r;
      });
    }
    case "liability.create": {
      const input = z
        .object({
          name: text,
          amount: nonnegative,
          currency,
          investable: z.boolean().optional(),
        })
        .parse(raw);
      return db.$transaction(async (tx) => {
        const r = await tx.liability.create({ data: input });
        await audit(tx, action, r.id, input);
        return r;
      });
    }
    case "transfer.create":
      return createTransfer(raw);
    case "transfer.complete":
      return completeTransfer(z.object({ id, at: date }).parse(raw));
    case "valuation.create": {
      const input = z
        .object({
          accountId: id,
          value: nonnegative,
          currency,
          at: date,
          source: text.default("MANUAL"),
        })
        .parse(raw);
      return db.$transaction(async (tx) => {
        const r = await tx.accountValuation.create({ data: input });
        await audit(tx, action, r.id, input);
        return r;
      });
    }
    case "snapshot.create": {
      const { currency: report, at: requestedAt } = z
        .object({ currency, at: date.optional() })
        .parse(raw);
      const at = requestedAt ?? new Date();
      if (at > new Date()) throw new Error("快照不能使用未来时间");
      return db.$transaction(async (tx) => {
        const state = await portfolio(report, at, tx);
        if (!state.complete)
          throw new Error("存在缺失或过期估值，更新价格和汇率后再保存完整快照");
        const r = await tx.portfolioSnapshot.create({
          data: {
            currency: report,
            assets: state.assets,
            liabilities: state.liabilities,
            net: state.net,
            investable: state.investable,
            complete: state.complete,
            at,
            allocations: {
              create: state.allocation.map((a) => ({
                assetClass: a.name,
                value: a.value,
              })),
            },
          },
        });
        await audit(tx, action, r.id, { currency: report });
        return r;
      });
    }
    default:
      throw new Error("未知资产操作");
  }
}
const transferSchema = z.object({
  fromId: id,
  toId: id,
  assetId: id,
  quantity: positive,
  fee: nonnegative.default("0"),
  at: date,
});
async function createTransfer(raw: unknown) {
  const input = transferSchema.parse(raw);
  if (input.fromId === input.toId) throw new Error("转出和转入账户不能相同");
  return db.$transaction(async (tx) => {
    const asset = await tx.asset.findUniqueOrThrow({
      where: { id: input.assetId },
    });
    if (asset.instrument !== "SPOT") throw new Error("仅支持现货资产转账");
    const accounts = await tx.account.findMany({
      where: { id: { in: [input.fromId, input.toId] }, archived: false },
    });
    if (accounts.length !== 2) throw new Error("账户不存在或已归档");
    await chronology(tx, input.fromId, input.at);
    const b = await balance(tx, input.fromId, asset.id),
      unit = D(b.quantity).gt(0) ? D(b.cost).div(b.quantity) : D(0),
      cost = unit.mul(input.quantity);
    await setBalance(
      tx,
      input.fromId,
      asset.id,
      D(input.quantity).neg().toFixed(),
      cost.neg().toFixed(),
    );
    if (D(input.fee).gt(0)) {
      const cash = await cashAsset(tx, asset.currency);
      await setBalance(
        tx,
        input.fromId,
        cash.id,
        D(input.fee).neg().toFixed(),
        D(input.fee).neg().toFixed(),
      );
    }
    const transfer = await tx.transfer.create({
      data: { ...input, cost: canonical(cost) },
    });
    const ledger = await tx.assetTransaction.create({
      data: {
        sequence: await nextLedgerSequence(tx, input.fromId),
        accountId: input.fromId,
        assetId: asset.id,
        type: "TRANSFER_OUT",
        quantity: D(input.quantity).neg().toFixed(),
        price: canonical(unit),
        costDelta: cost.neg().toFixed(),
        fee: input.fee,
        cashDelta:
          asset.assetClass === "CASH"
            ? D(input.quantity).plus(input.fee).neg().toFixed()
            : D(input.fee).neg().toFixed(),
        currency: asset.currency,
        at: input.at,
        transferId: transfer.id,
      },
    });
    await internalFlow(
      tx,
      ledger.id,
      input.fromId,
      asset,
      input.quantity,
      input.at,
      -1,
    );
    await audit(tx, "TRANSFER_START", transfer.id, input);
    return transfer;
  });
}
async function completeTransfer(input: { id: string; at: Date }) {
  return db.$transaction(async (tx) => {
    const transfer = await tx.transfer.findUniqueOrThrow({
      where: { id: input.id },
    });
    if (transfer.status !== "IN_TRANSIT") throw new Error("转账已经到账");
    if (input.at < transfer.at) throw new Error("到账时间不能早于转出时间");
    await chronology(tx, transfer.toId, input.at);
    const asset = await tx.asset.findUniqueOrThrow({
      where: { id: transfer.assetId },
    });
    await setBalance(
      tx,
      transfer.toId,
      asset.id,
      transfer.quantity,
      transfer.cost,
    );
    const ledger = await tx.assetTransaction.create({
      data: {
        sequence: await nextLedgerSequence(tx, transfer.toId),
        accountId: transfer.toId,
        assetId: asset.id,
        type: "TRANSFER_IN",
        quantity: transfer.quantity,
        costDelta: transfer.cost,
        price: D(transfer.cost).div(transfer.quantity).toFixed(),
        currency: asset.currency,
        cashDelta: asset.assetClass === "CASH" ? transfer.quantity : "0",
        at: input.at,
        transferId: transfer.id,
      },
    });
    await internalFlow(
      tx,
      ledger.id,
      transfer.toId,
      asset,
      transfer.quantity,
      input.at,
      1,
    );
    const r = await tx.transfer.update({
      where: { id: transfer.id },
      data: { status: "COMPLETED", completedAt: input.at },
    });
    await audit(tx, "TRANSFER_COMPLETE", r.id, input);
    return r;
  });
}
export async function fxAt(
  tx: Tx,
  from: string,
  to: string,
  at: Date,
  stale = true,
) {
  if (from === to) return D(1);
  const direct = await tx.fXRate.findFirst({
      where: { from, to, at: { lte: at } },
      orderBy: { at: "desc" },
    }),
    inverse = await tx.fXRate.findFirst({
      where: { from: to, to: from, at: { lte: at } },
      orderBy: { at: "desc" },
    });
  const row = !direct
    ? inverse
    : !inverse
      ? direct
      : direct.at >= inverse.at
        ? direct
        : inverse;
  if (
    !row ||
    (stale && at.getTime() - row.at.getTime() > (await staleWindow(tx)))
  )
    return null;
  return row.from === from ? D(row.rate) : D(1).div(row.rate);
}
export async function portfolio(
  report = "CNY",
  at = new Date(),
  client: Tx = db,
) {
  const window = await staleWindow(client);
  const [balances, liabilities, transfers, derivatives] = await Promise.all([
    historicalBalances(client, at),
    historicalLiabilities(client, at),
    client.transfer.findMany({
      where: {
        at: { lte: at },
        OR: [{ completedAt: null }, { completedAt: { gt: at } }],
      },
    }),
    historicalContracts(client, at),
  ]);
  const rows: {
    id: string;
    accountId: string;
    assetId: string;
    name: string;
    code: string;
    assetClass: string;
    account: string;
    platform: string;
    currency: string;
    quantity: string;
    cost: string;
    price: string | null;
    value: string | null;
    unrealized: string | null;
    realized: string;
    purpose: string;
    status: string;
    priceAt: string | null;
    source: string;
  }[] = [];
  for (const b of balances) {
    if (D(b.quantity).eq(0)) continue;
    const a = b.asset,
      p =
        a.assetClass === "CASH"
          ? null
          : await client.assetPrice.findFirst({
              where: { assetId: a.id, at: { lte: at } },
              orderBy: { at: "desc" },
            });
    const fx = await fxAt(client, a.currency, report, at),
      price = a.assetClass === "CASH" ? D(1) : p ? D(p.price) : null;
    const old = !!p && at.getTime() - p.at.getTime() > window;
    const value = price && fx ? D(b.quantity).mul(price).mul(fx) : null;
    rows.push({
      id: b.id,
      accountId: b.accountId,
      assetId: b.assetId,
      name: a.name,
      code: a.code,
      assetClass: a.assetClass,
      account: b.account.name,
      platform: b.account.platform.name,
      currency: a.currency,
      quantity: b.quantity,
      cost: b.cost,
      price: price?.toFixed() ?? null,
      value: value?.toFixed() ?? null,
      unrealized: value && fx ? value.minus(D(b.cost).mul(fx)).toFixed() : null,
      realized: b.realized,
      purpose: b.purpose,
      status: !price || !fx ? "MISSING" : old ? "STALE" : "VALID",
      priceAt: p?.at.toISOString() ?? null,
      source: p?.source ?? (a.assetClass === "CASH" ? "UNIT" : "MISSING"),
    });
  }
  let assets = sum(rows.map((r) => r.value ?? "0")),
    investable = sum(
      rows
        .filter((r) => balances.find((b) => b.id === r.id)?.asset.investable)
        .map((r) => r.value ?? "0"),
    ),
    complete = rows.every((r) => r.status === "VALID") && liabilities.complete,
    debt = D(0);
  const allocation = new Map<string, ReturnType<typeof D>>();
  for (const r of rows)
    allocation.set(
      r.assetClass,
      (allocation.get(r.assetClass) ?? D(0)).plus(r.value ?? 0),
    );
  for (const t of transfers) {
    const a = await client.asset.findUniqueOrThrow({
        where: { id: t.assetId },
      }),
      p =
        a.assetClass === "CASH"
          ? D(1)
          : await client.assetPrice
              .findFirst({
                where: { assetId: a.id, at: { lte: at } },
                orderBy: { at: "desc" },
              })
              .then((r) => {
                if (!r || at.getTime() - r.at.getTime() > window) return null;
                return D(r.price);
              }),
      fx = await fxAt(client, a.currency, report, at);
    if (p && fx) {
      const value = D(t.quantity).mul(p).mul(fx);
      assets = assets.plus(value);
      if (a.investable) investable = investable.plus(value);
      allocation.set(
        "IN_TRANSIT",
        (allocation.get("IN_TRANSIT") ?? D(0)).plus(value),
      );
    } else complete = false;
  }
  for (const t of derivatives.filter(
    (t) => t.asset.instrument !== "SPOT" && D(t.quantity).gt(0),
  )) {
    const p = await client.assetPrice.findFirst({
        where: { assetId: t.assetId, at: { lte: at } },
        orderBy: { at: "desc" },
      }),
      fx = await fxAt(client, t.asset.currency, report, at);
    if (!p || !fx || at.getTime() - p.at.getTime() > window) {
      complete = false;
      continue;
    }
    const pnl = contractPnl(
      t.asset.instrument,
      t.direction,
      t.quantity,
      t.averageEntry,
      p.price,
      t.asset.multiplier,
    ).mul(fx);
    assets = assets.plus(pnl);
    if (t.asset.investable) investable = investable.plus(pnl);
    allocation.set(
      "DERIVATIVE_PNL",
      (allocation.get("DERIVATIVE_PNL") ?? D(0)).plus(pnl),
    );
  }
  for (const l of liabilities.rows) {
    const fx = await fxAt(client, l.currency, report, at);
    if (!fx) {
      complete = false;
      continue;
    }
    const v = D(l.amount).mul(fx);
    debt = debt.plus(v);
    if (l.investable) investable = investable.minus(v);
  }
  return {
    currency: report,
    assets: canonical(assets),
    liabilities: canonical(debt),
    net: canonical(assets.minus(debt)),
    investable: canonical(investable),
    complete,
    rows,
    inTransit: transfers.length,
    allocation: [...allocation].map(([name, value]) => ({
      name,
      value: canonical(value),
    })),
  };
}

async function internalFlow(
  tx: Tx,
  transactionId: string,
  accountId: string,
  asset: { id: string; assetClass: string; currency: string },
  quantity: string,
  at: Date,
  sign: number,
) {
  const p =
    asset.assetClass === "CASH"
      ? D(1)
      : await tx.assetPrice
          .findFirst({
            where: { assetId: asset.id, at: { lte: at } },
            orderBy: { at: "desc" },
          })
          .then(async (r) =>
            r && at.getTime() - r.at.getTime() <= (await staleWindow(tx))
              ? D(r.price)
              : null,
          );
  await tx.accountCashFlow.create({
    data: {
      accountId,
      transactionId,
      amount: p ? D(quantity).mul(p).mul(sign).toFixed() : "0",
      currency: asset.currency,
      kind: p ? "INTERNAL" : "INTERNAL_UNVALUED",
      at,
    },
  });
}

async function staleWindow(tx: Tx) {
  const value =
    (await tx.systemSetting.findUnique({ where: { key: "priceStaleDays" } }))
      ?.value ?? "7";
  return Number(value) * 86400000;
}

export async function reverseTransaction(raw: unknown) {
  const input = z.object({ id, at: date, note: text }).parse(raw);
  return db.$transaction(async (tx) => {
    const record = await tx.assetTransaction.findUniqueOrThrow({
      where: { id: input.id },
      include: { asset: true, fill: true, cashFlow: true },
    });
    if (record.fill || record.transferId || record.reversalOf)
      throw new Error("成交、转账和冲销记录需保留原关联，请用更正调整记录处理");
    const latest = await tx.assetTransaction.findFirst({
      where: { accountId: record.accountId },
      orderBy: [{ at: "desc" }, { sequence: "desc" }],
    });
    if (latest?.id !== record.id)
      throw new Error(
        "仅允许冲销账户最后一笔独立流水；较早记录请用人工调整更正",
      );
    if (await tx.assetTransaction.count({ where: { reversalOf: record.id } }))
      throw new Error("记录已经冲销");
    await chronology(tx, record.accountId, input.at);
    if (input.at > new Date()) throw new Error("不能记录未来时间");
    const r = record.asset.assetClass === "CASH";
    await setBalance(
      tx,
      record.accountId,
      record.assetId,
      D(r ? record.cashDelta : record.quantity)
        .neg()
        .toFixed(),
      D(r ? record.cashDelta : record.costDelta)
        .neg()
        .toFixed(),
      D(record.realizedDelta).neg().toFixed(),
    );
    if (!r && !D(record.cashDelta).eq(0)) {
      const cash = await cashAsset(tx, record.currency);
      await setBalance(
        tx,
        record.accountId,
        cash.id,
        D(record.cashDelta).neg().toFixed(),
        D(record.cashDelta).neg().toFixed(),
      );
    }
    const reversal = await tx.assetTransaction.create({
      data: {
        sequence: await nextLedgerSequence(tx, record.accountId),
        accountId: record.accountId,
        assetId: record.assetId,
        type: "REVERSAL",
        quantity: D(record.quantity).neg().toFixed(),
        price: record.price,
        fee: D(record.fee).neg().toFixed(),
        cashDelta: D(record.cashDelta).neg().toFixed(),
        costDelta: D(record.costDelta).neg().toFixed(),
        realizedDelta: D(record.realizedDelta).neg().toFixed(),
        currency: record.currency,
        at: input.at,
        note: input.note,
        reversalOf: record.id,
      },
    });
    if (record.cashFlow)
      await tx.accountCashFlow.create({
        data: {
          accountId: record.accountId,
          transactionId: reversal.id,
          amount: D(record.cashFlow.amount).neg().toFixed(),
          currency: record.currency,
          kind: record.cashFlow.kind,
          at: input.at,
        },
      });
    await audit(tx, "TRANSACTION_REVERSE", record.id, {
      reversalId: reversal.id,
      note: input.note,
    });
    return reversal;
  });
}

export async function nextLedgerSequence(tx: Tx, accountId: string) {
  return (
    ((
      await tx.assetTransaction.aggregate({
        where: { accountId },
        _max: { sequence: true },
      })
    )._max.sequence ?? 0) + 1
  );
}
