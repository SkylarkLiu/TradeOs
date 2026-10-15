import { z } from "zod";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { databaseFile } from "@/lib/repositories/db";
export class TickFlowError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "每日拉取时间须为 HH:mm");
export const tickflowSettingsSchema = z
  .object({
    base: z.enum(["https://api.tickflow.org", "https://hk-api.tickflow.org"]),
    time: timeSchema.optional(),
    times: z
      .array(timeSchema)
      .min(1, "至少保留一个拉取时间")
      .max(24, "最多设置24个时间")
      .optional(),
    automatic: z.boolean(),
    retryMinutes: z.number().int().min(5).max(180),
    maxAttempts: z.number().int().min(1).max(5),
  })
  .transform((input) => {
    const times = [...new Set(input.times ?? [input.time ?? "18:00"])].sort();
    return { ...input, times, time: times[0] };
  });
export type TickFlowSettings = z.infer<typeof tickflowSettingsSchema>;
export type TickFlowConfig = TickFlowSettings & { key: string };
export const tickflowSettingsFile = `${databaseFile}.tickflow.json`;
export function tickflowConfig(): TickFlowConfig {
  const defaults = {
    base: (process.env.TICKFLOW_BASE_URL || "https://api.tickflow.org").replace(
      /\/$/,
      "",
    ),
    time: process.env.TICKFLOW_DAILY_TIME || "18:00",
    automatic: process.env.TICKFLOW_AUTO_SYNC !== "false",
    retryMinutes: 30,
    maxAttempts: 3,
    key: process.env.TICKFLOW_API_KEY?.trim() || "",
  };
  let saved: unknown = {};
  try {
    if (existsSync(tickflowSettingsFile))
      saved = JSON.parse(readFileSync(tickflowSettingsFile, "utf8"));
  } catch {
    throw new TickFlowError("TickFlow 本机配置文件无法读取");
  }
  const merged = {
    ...defaults,
    ...(saved && typeof saved === "object" ? saved : {}),
  };
  const parsed = tickflowSettingsSchema.safeParse(merged);
  const key = z.string().max(300).safeParse(merged.key);
  if (!parsed.success || !key.success)
    throw new TickFlowError(
      "TickFlow 配置无效，请检查服务地址、时间与重试设置",
    );
  return { ...parsed.data, key: key.data };
}
export function proposedTickflowSettings(raw: unknown): TickFlowConfig {
  const input = tickflowSettingsSchema.parse(raw);
  const { apiKey } = z
    .object({ apiKey: z.string().trim().max(300).optional() })
    .parse(raw);
  const current = tickflowConfig();
  return {
    ...input,
    key: apiKey || current.key,
  };
}
export function writeTickflowSettings(config: TickFlowConfig) {
  mkdirSync(path.dirname(tickflowSettingsFile), { recursive: true });
  const temporary = `${tickflowSettingsFile}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(config, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, tickflowSettingsFile);
  } finally {
    rmSync(temporary, { force: true });
  }
}
