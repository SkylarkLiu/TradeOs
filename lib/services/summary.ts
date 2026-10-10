import { D, Decimal, maxDrawdown, twr, sum } from "@/lib/calculations/decimal";
import { fxAt, type Tx } from "./wealth";
export async function wealthSummary(
  tx: Tx,
  report: string,
  current: {
    assets: string;
    net: string;
    investable: string;
    complete: boolean;
  },
) {
  const snapshots = await tx.portfolioSnapshot.findMany({
    where: { currency: report, complete: true, at: { lte: new Date() } },
    orderBy: { at: "asc" },
  });
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
    dayStart = new Date(`${today}T00:00:00+08:00`),
    monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00+08:00`),
    yearStart = new Date(`${today.slice(0, 4)}-01-01T00:00:00+08:00`),
    todayBase = snapshots.find((s) => s.at.getTime() === dayStart.getTime()),
    monthBase = snapshots.find((s) => s.at.getTime() === monthStart.getTime()),
    yearBase = snapshots.find((s) => s.at.getTime() === yearStart.getTime());
  const peak = snapshots.length
    ? Decimal.max(...snapshots.map((s) => D(s.net)), D(current.net))
    : null;
  let monthlyPnl: string | null = null,
    ytd: string | null = null;
  if (current.complete && monthBase) {
    const flows = await tx.accountCashFlow.findMany({
        where: { kind: "EXTERNAL", at: { gt: monthBase.at, lte: new Date() } },
      }),
      converted = [];
    let valid = true;
    for (const f of flows) {
      const fx = await fxAt(tx, f.currency, report, f.at);
      if (!fx) {
        valid = false;
        break;
      }
      converted.push(D(f.amount).mul(fx).toFixed());
    }
    if (valid)
      monthlyPnl = D(current.assets)
        .minus(monthBase.assets)
        .minus(sum(converted))
        .toFixed();
  }
  if (yearBase && current.complete) {
    const list = [
        ...snapshots
          .filter((s) => s.at >= yearBase.at)
          .map((s) => ({ at: s.at, assets: s.assets })),
        { at: new Date(), assets: current.assets },
      ],
      periods = [];
    let valid = true;
    for (let i = 1; i < list.length; i++) {
      const flows = await tx.accountCashFlow.findMany({
          where: {
            kind: "EXTERNAL",
            at: { gt: list[i - 1].at, lte: list[i].at },
          },
        }),
        values = [];
      for (const f of flows) {
        const fx = await fxAt(tx, f.currency, report, f.at);
        if (!fx || f.at.getTime() !== list[i].at.getTime()) {
          valid = false;
          break;
        }
        values.push(D(f.amount).mul(fx).toFixed());
      }
      periods.push({
        begin: list[i - 1].assets,
        end: list[i].assets,
        flowAtEnd: sum(values).toFixed(),
      });
    }
    if (valid) ytd = twr(periods);
  }
  const goal = await tx.financialGoal.findFirst();
  let fireProgress: string | null = null;
  if (goal && current.complete) {
    const months = Math.max(
        0,
        Math.ceil(
          (goal.retirementDate.getTime() - Date.now()) /
            ((365.25 / 12) * 86400000),
        ),
      ),
      target = goal.target
        ? D(goal.target)
        : D(goal.monthlyExpense)
            .mul(12)
            .mul(D(1).plus(goal.inflation).pow(D(months).div(12)))
            .div(goal.withdrawalRate),
      fx = await fxAt(tx, goal.currency, report, new Date());
    if (fx) fireProgress = D(current.investable).div(target.mul(fx)).toFixed();
  }
  return {
    todayChange:
      current.complete && todayBase
        ? D(current.assets).minus(todayBase.assets).toFixed()
        : null,
    monthlyPnl,
    ytd,
    peak: peak?.toFixed() ?? null,
    currentDrawdown:
      peak && peak.gt(0) && current.complete
        ? peak.minus(current.net).div(peak).toFixed()
        : null,
    maxDrawdown: snapshots.length
      ? maxDrawdown(snapshots.map((s) => s.net))
      : null,
    fireProgress,
  };
}
