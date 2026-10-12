import { z } from "zod";
import { text } from "./validation";
import { D, sum, canonical } from "./decimal";
export const defaultScoreRules = [
  { name: "策略符合度", max: 5, weight: 1, compliance: true, threshold: 4 },
  { name: "风险控制", max: 5, weight: 1, compliance: true, threshold: 4 },
  { name: "执行纪律", max: 5, weight: 1, compliance: true, threshold: 4 },
  { name: "交易心理", max: 5, weight: 1, compliance: false, threshold: 0 },
  { name: "复盘完整度", max: 5, weight: 1, compliance: false, threshold: 0 },
];
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
export const scoreSnapshotSchema = z
  .object({
    values: z.record(z.string(), z.number().nonnegative()),
    rules: scoreRulesSchema,
  })
  .refine(
    (s) =>
      Object.keys(s.values).length === s.rules.length &&
      s.rules.every(
        (r) => s.values[r.name] !== undefined && s.values[r.name] <= r.max,
      ),
    "评分项目不完整或超出范围",
  );
export function scoreSummary(raw: unknown) {
  const { values, rules } = scoreSnapshotSchema.parse(raw);
  const gates = rules.filter((r) => r.compliance);
  return {
    score: canonical(
      sum(
        rules.map((r) => D(values[r.name]).div(r.max).mul(r.weight).toFixed()),
      )
        .div(sum(rules.map((r) => String(r.weight))))
        .mul(100),
    ),
    compliant: gates.length
      ? gates.every((r) => values[r.name] >= r.threshold)
      : null,
  };
}
