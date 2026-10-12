import { z } from "zod";
import { db } from "@/lib/repositories/db";
import { id } from "@/lib/validation/common";
import { audit, portfolio } from "./wealth";
import {
  goalSchema,
  validateFireGoal,
  calculateFire,
} from "../../packages/core/src/fire";
export { retirementPath } from "../../packages/core/src/fire";
export async function fireCommand(raw: unknown) {
  const input = goalSchema.parse(raw);
  validateFireGoal(input);
  return db.$transaction(async (tx) => {
    const r = await tx.financialGoal.upsert({
      where: { name: input.name },
      create: input,
      update: { ...input, target: input.target ?? null },
    });
    await audit(tx, "FIRE_GOAL_SAVE", r.id, input);
    return r;
  });
}
export async function fireState(raw: unknown = {}) {
  const { goalId } = z.object({ goalId: id.optional() }).parse(raw);
  const goal = goalId
    ? await db.financialGoal.findUniqueOrThrow({ where: { id: goalId } })
    : await db.financialGoal.findFirst();
  if (!goal) return null;
  const p = await portfolio(goal.currency);
  const result = calculateFire(
    { ...goal, target: goal.target ?? undefined },
    p.investable,
    p.complete,
  );
  return {
    ...result,
    goal: { ...goal, retirementDate: goal.retirementDate.toISOString() },
  };
}
export type FireState = Awaited<ReturnType<typeof fireState>>;
