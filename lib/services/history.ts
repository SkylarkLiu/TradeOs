import { D, sum, canonical } from "@/lib/calculations/decimal";
import type { Tx } from "./wealth";
export async function historicalLiabilities(tx: Tx, at: Date) {
  const liabilities = await tx.liability.findMany();
  if (liabilities.every((l) => l.at <= at))
    return { rows: liabilities, complete: true };
  const audits = await tx.auditLog.findMany({
    where: { action: { in: ["liability.create", "liability.update"] } },
    orderBy: { at: "desc" },
  });
  let complete = true;
  const rows = liabilities.flatMap((l) => {
    if (l.at <= at) return [l];
    const history = audits.filter((a) => a.entityId === l.id);
    const previous = history.find((a) => a.at <= at);
    if (previous)
      return [
        {
          ...l,
          amount: JSON.parse(previous.detail).amount as string,
          at: previous.at,
        },
      ];
    // Before recorded creation there was no liability; an unaudited prior balance is unknown.
    if (
      !history.some((a) => a.action === "liability.create") &&
      history.some((a) => a.action === "liability.update")
    )
      complete = false;
    return [];
  });
  return { rows, complete };
}
export async function historicalBalances(tx: Tx, at: Date) {
  const balances = await tx.assetBalance.findMany({
      include: { asset: true, account: { include: { platform: true } } },
    }),
    ledger = await tx.assetTransaction.findMany({
      where: { at: { lte: at } },
      include: { asset: true },
      orderBy: [{ at: "asc" }, { sequence: "asc" }],
    }),
    values = new Map<
      string,
      {
        q: ReturnType<typeof D>;
        cost: ReturnType<typeof D>;
        realized: ReturnType<typeof D>;
      }
    >();
  const add = (
    accountId: string,
    assetId: string,
    q: string,
    cost: string,
    realized = "0",
  ) => {
    const key = `${accountId}:${assetId}`,
      b = values.get(key) ?? { q: D(0), cost: D(0), realized: D(0) };
    b.q = b.q.plus(q);
    b.cost = b.cost.plus(cost);
    b.realized = b.realized.plus(realized);
    if (b.q.eq(0)) b.cost = D(0);
    values.set(key, b);
  };
  const assets = await tx.asset.findMany();
  for (const r of ledger) {
    if (r.asset.instrument === "SPOT") {
      const cash = r.asset.assetClass === "CASH";
      add(
        r.accountId,
        r.assetId,
        cash ? r.cashDelta : r.quantity,
        cash ? r.cashDelta : r.costDelta,
        r.realizedDelta,
      );
    }
    if (r.asset.assetClass !== "CASH" && !D(r.cashDelta).eq(0)) {
      const cash = assets.find((a) => a.code === `CASH:${r.currency}`);
      if (!cash) throw new Error("结算现金不存在");
      add(r.accountId, cash.id, r.cashDelta, r.cashDelta);
    }
  }
  return balances.map((b) => {
    const v = values.get(`${b.accountId}:${b.assetId}`);
    return {
      ...b,
      quantity: canonical(v?.q ?? 0),
      cost: canonical(v?.cost ?? 0),
      realized: canonical(v?.realized ?? 0),
    };
  });
}
export async function historicalContracts(tx: Tx, at: Date) {
  const trades = await tx.trade.findMany({
    where: { openedAt: { lte: at }, asset: { instrument: { not: "SPOT" } } },
    include: {
      asset: true,
      fills: {
        where: { at: { lte: at } },
        orderBy: [{ at: "asc" }, { sequence: "asc" }],
      },
    },
  });
  return trades
    .map((t) => {
      let q = D(0),
        average = D(0);
      for (const f of t.fills) {
        const next =
          f.action === "ENTRY" ? q.plus(f.quantity) : q.minus(f.quantity);
        if (f.action === "ENTRY")
          average =
            t.asset.instrument === "INVERSE" && q.gt(0)
              ? next.div(q.div(average).plus(D(f.quantity).div(f.price)))
              : q.mul(average).plus(D(f.quantity).mul(f.price)).div(next);
        q = next;
      }
      return { ...t, quantity: q.toFixed(), averageEntry: average.toFixed() };
    })
    .filter((t) => D(t.quantity).gt(0));
}
export async function currencyExposures(
  tx: Tx,
  at: Date,
  priceAt: Date = at,
  accountId?: string,
) {
  const balances = await historicalBalances(tx, at),
    transfers = await tx.transfer.findMany({
      where: {
        at: { lte: at },
        OR: [{ completedAt: null }, { completedAt: { gt: at } }],
      },
      include: { asset: true },
    });
  const positions = [
      ...balances
        .filter((b) => !accountId || b.accountId === accountId)
        .map((b) => ({ asset: b.asset, quantity: b.quantity })),
      ...transfers
        .filter((t) => !accountId || t.fromId === accountId)
        .map((t) => ({ asset: t.asset, quantity: t.quantity })),
    ],
    exposures = new Map<string, ReturnType<typeof D>>();
  let complete = true;
  for (const p of positions) {
    if (D(p.quantity).eq(0)) continue;
    const quote =
      p.asset.assetClass === "CASH"
        ? "1"
        : (
            await tx.assetPrice.findFirst({
              where: { assetId: p.asset.id, at: { lte: priceAt } },
              orderBy: { at: "desc" },
            })
          )?.price;
    if (!quote) {
      complete = false;
      continue;
    }
    exposures.set(
      p.asset.currency,
      (exposures.get(p.asset.currency) ?? D(0)).plus(D(p.quantity).mul(quote)),
    );
  }
  const contracts = await historicalContracts(tx, at);
  if (contracts.some((t) => !accountId || t.accountId === accountId))
    complete = false;
  return {
    complete,
    values: [...exposures].map(([currency, value]) => ({
      currency,
      value: canonical(value),
    })),
    total: sum([...exposures.values()].map((v) => v.toFixed())).toFixed(),
  };
}
