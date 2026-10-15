import { z } from "zod";
import { db } from "@/lib/repositories/db";
import { dayBounds, shanghaiDay, nextScheduledRun } from "@/lib/schedule";
import { wealthCommand, type Tx } from "./wealth";

const time = "08:00",
  currency = "CNY",
  key = "snapshot.daily";
const jobSchema = z.object({
  day: z.string(),
  at: z.string(),
  complete: z.boolean(),
  error: z.string(),
});
const runtime = globalThis as typeof globalThis & {
  tradeosSnapshots?: {
    ticking: boolean;
    timer?: ReturnType<typeof setInterval>;
  };
};
const state = (runtime.tradeosSnapshots ??= { ticking: false });
export async function snapshotScheduleStatus(client: Tx = db) {
  const saved = await client.systemSetting.findUnique({ where: { key } });
  let last: z.infer<typeof jobSchema> | null = null;
  try {
    const parsed = jobSchema.safeParse(saved ? JSON.parse(saved.value) : null);
    if (parsed.success) last = parsed.data;
  } catch {
    /* Invalid old status does not block the next attempt. */
  }
  const enabled = process.env.SNAPSHOT_AUTO_SAVE !== "false";
  return {
    time,
    currency,
    enabled,
    nextRunAt: enabled ? nextScheduledRun([time]).toISOString() : null,
    last,
  };
}
export async function dailySnapshotTick(now = new Date()) {
  if (process.env.SNAPSHOT_AUTO_SAVE === "false" || state.ticking) return;
  const day = shanghaiDay(now);
  if (now < new Date(`${day}T${time}:00+08:00`)) return;
  state.ticking = true;
  try {
    const { last } = await snapshotScheduleStatus();
    if (last?.day === day) {
      if (
        last.complete &&
        (await db.portfolioSnapshot.findFirst({
          where: { currency, at: dayBounds(now) },
        }))
      )
        return;
      if (
        !last.complete &&
        now.getTime() - new Date(last.at).getTime() < 30 * 60000
      )
        return;
    }
    const job = { day, at: now.toISOString(), complete: false, error: "" };
    try {
      await wealthCommand("snapshot.create", {
        currency,
        at: now.toISOString(),
      });
      job.complete = true;
    } catch (error) {
      job.error =
        error instanceof Error ? error.message : "自动快照保存失败，请手动重试";
    }
    await db.systemSetting.upsert({
      where: { key },
      create: { key, value: JSON.stringify(job) },
      update: { value: JSON.stringify(job) },
    });
  } finally {
    state.ticking = false;
  }
}
export function startSnapshotScheduler() {
  if (
    state.timer ||
    process.env.NODE_ENV === "test" ||
    process.env.SNAPSHOT_AUTO_SAVE === "false"
  )
    return;
  const tick = () => {
    void dailySnapshotTick().catch(() =>
      console.error("自动快照失败，请查看财富轨迹状态"),
    );
  };
  state.timer = setInterval(tick, 60000);
  state.timer.unref();
  const startup = setTimeout(tick, 5000);
  startup.unref();
}
