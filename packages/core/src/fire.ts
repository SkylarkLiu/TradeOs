import { z } from "zod";
import {
  D,
  Decimal,
  canonical,
  projectWealth,
  requiredContribution,
} from "./decimal";
import {
  text,
  currency,
  date,
  positive,
  nonnegative,
  decimal,
} from "./validation";
const rate = decimal.refine(
  (v) => D(v).gt("-1") && D(v).lte("2"),
  "年率必须大于-100%且不超过200%",
);
export const goalSchema = z.object({
  name: text,
  age: z.number().int().min(18).max(100),
  retirementAge: z.number().int().min(18).max(130),
  retirementDate: date,
  monthlyContribution: nonnegative,
  monthlyExpense: positive,
  inflation: rate,
  conservative: rate,
  baseReturn: rate,
  optimistic: rate,
  withdrawalRate: positive.refine((v) => D(v).lte("1"), "提取率不能超过100%"),
  target: positive.optional(),
  currency,
});
export function validateFireGoal(
  input: z.output<typeof goalSchema>,
  now = new Date(),
) {
  if (input.retirementDate <= now || input.retirementAge <= input.age)
    throw new Error("退休时间和年龄必须在未来");
  const years =
    (input.retirementDate.getTime() - now.getTime()) / (365.25 * 86400000);
  if (Math.abs(input.retirementAge - input.age - years) > 1.1)
    throw new Error("目标年龄与退休日期相差超过一年，请核对");
  if (
    !D(input.conservative).lte(input.baseReturn) ||
    !D(input.baseReturn).lte(input.optimistic)
  )
    throw new Error("情景收益率应按保守、基准、乐观递增");
}
export function retirementPath(
  initial: string,
  monthlyExpense: string,
  annual: string,
  inflation: string,
  months = 360,
) {
  const growth = D(1).plus(annual).pow(D(1).div(12)),
    inf = D(1).plus(inflation).pow(D(1).div(12));
  let value = D(initial),
    expense = D(monthlyExpense),
    shortfall: number | null = null;
  const points = [];
  for (let m = 1; m <= months; m++) {
    value = value.mul(growth).minus(expense);
    if (value.lt(0) && shortfall === null) shortfall = m;
    points.push({ month: m, value: canonical(Decimal.max(0, value)) });
    expense = expense.mul(inf);
  }
  return { shortfall, points };
}
export function calculateFire<T extends z.output<typeof goalSchema>>(
  goal: T,
  current: string,
  complete: boolean,
  now = new Date(),
) {
  const months = Math.max(
    0,
    Math.ceil(
      (goal.retirementDate.getTime() - now.getTime()) /
        ((365.25 / 12) * 86400000),
    ),
  );
  const target = goal.target
    ? D(goal.target)
    : D(goal.monthlyExpense)
        .mul(12)
        .mul(D(1).plus(goal.inflation).pow(D(months).div(12)))
        .div(goal.withdrawalRate);
  const retiredMonthly = D(goal.monthlyExpense).mul(
    D(1).plus(goal.inflation).pow(D(months).div(12)),
  );
  const scenarios = [
    ["保守", goal.conservative],
    ["基准", goal.baseReturn],
    ["乐观", goal.optimistic],
  ].map(([name, rate]) => {
    const points = projectWealth(
        current,
        goal.monthlyContribution,
        rate,
        goal.inflation,
        months,
      ),
      final = points.at(-1)!;
    return {
      name,
      rate,
      points,
      final: final.nominal,
      realFinal: final.real,
      meetsTarget: D(final.nominal).gte(target),
      retirement: retirementPath(
        final.nominal,
        retiredMonthly.toFixed(),
        rate,
        goal.inflation,
      ),
    };
  });
  return {
    goal: { ...goal, retirementDate: goal.retirementDate.toISOString() },
    current: current,
    complete: complete,
    target: canonical(target),
    targetReal: target
      .div(D(1).plus(goal.inflation).pow(D(months).div(12)))
      .toFixed(),
    progress: complete ? D(current).div(target).toFixed() : null,
    gap: Decimal.max(0, target.minus(current)).toFixed(),
    months,
    requiredMonthly: complete
      ? requiredContribution(current, target.toFixed(), goal.baseReturn, months)
      : null,
    scenarios,
  };
}
