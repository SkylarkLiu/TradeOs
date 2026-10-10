import { z } from "zod";
import { D, canonical } from "@/lib/calculations/decimal";
export const decimal = z
  .string()
  .max(100)
  .regex(/^-?\d+(\.\d+)?$/, "请输入十进制数")
  .refine((v) => D(v).isFinite(), "数值无效")
  .transform(canonical);
export const positive = decimal.refine((v) => D(v).gt(0), "必须大于零");
export const nonnegative = decimal.refine((v) => D(v).gte(0), "不能小于零");
export const date = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v));
export const currency = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9]{1,11}$/, "币种格式无效");
export const id = z.string().min(1).max(100);
export const text = z.string().trim().min(1).max(300);
export const optionalId = id.optional();
export const direction = z.enum(["LONG", "SHORT"]);
export const tags = z.array(z.string().max(60)).max(30);
