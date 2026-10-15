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
export const tickflowSettingsSchema = z.object({
  base: z.enum(["https://api.tickflow.org", "https://hk-api.tickflow.org"]),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "每日拉取时间须为 HH:mm"),
  automatic: z.boolean(),
  retryMinutes: z.number().int().min(5).max(180),
  maxAttempts: z.number().int().min(1).max(5),
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
  const schema = tickflowSettingsSchema.extend({ key: z.string().max(300) });
  const parsed = schema.safeParse({
    ...defaults,
    ...(saved && typeof saved === "object" ? saved : {}),
  });
  if (!parsed.success)
    throw new TickFlowError(
      "TickFlow 配置无效，请检查服务地址、时间与重试设置",
    );
  return parsed.data;
}
export function proposedTickflowSettings(raw: unknown): TickFlowConfig {
  const input = tickflowSettingsSchema
    .extend({ apiKey: z.string().trim().max(300).optional() })
    .parse(raw);
  const current = tickflowConfig();
  return {
    base: input.base,
    time: input.time,
    automatic: input.automatic,
    retryMinutes: input.retryMinutes,
    maxAttempts: input.maxAttempts,
    key: input.apiKey || current.key,
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
