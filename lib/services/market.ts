import { z } from "zod";
import { db } from "@/lib/repositories/db";
import { audit, type Tx } from "./wealth";
import {
  proposedTickflowSettings,
  writeTickflowSettings,
} from "@/lib/integrations/tickflow-config";
import {
  fetchQuote,
  lookupInstrument,
  marketSymbol,
  quoteCurrency,
  tickflowConfig,
  TickFlowError,
  type MarketQuote,
} from "@/lib/integrations/tickflow";

const SOURCE = "TICKFLOW";
const itemSchema = z.object({ code: z.string(), message: z.string() });
const resultSchema = z.object({
  at: z.string().datetime(),
  updated: z.number(),
  unchanged: z.number(),
  skipped: z.array(itemSchema),
  failed: z.array(itemSchema),
  retained: z.array(itemSchema).default([]),
});
export type MarketSyncResult = z.infer<typeof resultSchema>;
const dailySchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  attempts: z.number().int().min(0).max(5),
  at: z.string().datetime(),
  complete: z.boolean(),
});
const runtime = globalThis as typeof globalThis & {
  tradeosMarket?: {
    running: Promise<MarketSyncResult> | null;
    timer?: ReturnType<typeof setInterval>;
    ticking: boolean;
    scope?: string;
  };
};
const state = (runtime.tradeosMarket ??= { running: null, ticking: false });
async function saveQuote(tx: Tx, assetId: string, quote: MarketQuote) {
  const at = new Date(quote.at);
  const old = await tx.assetPrice.findUnique({
    where: { assetId_at: { assetId, at } },
  });
  if (old) {
    if (old.source !== SOURCE || old.price === quote.price) return false;
    await tx.assetPrice.update({
      where: { id: old.id },
      data: { price: quote.price },
    });
  } else
    await tx.assetPrice.create({
      data: { assetId, price: quote.price, at, source: SOURCE },
    });
  return true;
}
export async function marketStatus() {
  const config = tickflowConfig();
  const saved = await db.systemSetting.findUnique({
    where: { key: "tickflow.lastResult" },
  });
  const parsed = resultSchema.safeParse(saved ? safeJson(saved.value) : null);
  return {
    configured: !!config.key,
    automatic: config.automatic,
    time: config.time,
    base: config.base,
    retryMinutes: config.retryMinutes,
    maxAttempts: config.maxAttempts,
    nextRunAt:
      config.key && config.automatic
        ? nextMarketRun(config.time).toISOString()
        : null,
    last: parsed.success ? parsed.data : null,
  };
}
export type MarketStatus = Awaited<ReturnType<typeof marketStatus>>;
export function nextMarketRun(time: string, now = new Date()) {
  const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const next = new Date(`${day}T${time}:00+08:00`);
  return next > now ? next : new Date(next.getTime() + 86400000);
}
export async function saveMarketSettings(raw: unknown) {
  const config = proposedTickflowSettings(raw);
  if (state.running || state.ticking)
    throw new TickFlowError("行情正在更新，请完成后再保存设置");
  writeTickflowSettings(config);
  await db.systemSetting.deleteMany({ where: { key: "tickflow.daily" } });
  startMarketScheduler();
  return marketStatus();
}
export async function testMarketConnection(raw: unknown) {
  const config = proposedTickflowSettings(raw);
  const instrument = await lookupInstrument("600000.SH", config);
  const quote = await fetchQuote(instrument.symbol, new Date(), config);
  return {
    connected: true,
    at: new Date().toISOString(),
    symbol: quote.symbol,
  };
}
function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
export async function marketLookup(code: string) {
  const instrument = await lookupInstrument(code);
  try {
    return {
      ...instrument,
      quote: await fetchQuote(instrument.symbol),
      warning: "",
    };
  } catch (e) {
    return { ...instrument, quote: null, warning: publicError(e) };
  }
}
function publicError(e: unknown) {
  return e instanceof TickFlowError ? e.message : "行情操作失败，请稍后重试";
}
export async function marketImport(raw: unknown) {
  const { symbol: rawSymbol } = z
    .object({ symbol: z.string().trim().min(1).max(40) })
    .parse(raw);
  const found = await marketLookup(rawSymbol);
  return db.$transaction(async (tx) => {
    const assets = await tx.asset.findMany();
    const existing = assets.filter(
      (a) => marketSymbol(a.code) === found.symbol,
    );
    if (existing.length > 1)
      throw new Error("相同标的存在多个资产代码，请先核对资产目录");
    let asset = existing[0];
    if (
      asset &&
      (asset.currency !== found.currency ||
        asset.instrument !== "SPOT" ||
        asset.assetClass !== found.assetClass)
    )
      throw new Error("已有资产的币种或品种与TickFlow不符，请先核对");
    if (!asset)
      asset = await tx.asset.create({
        data: {
          code: found.symbol,
          name: found.name,
          assetClass: found.assetClass,
          currency: found.currency,
        },
      });
    if (found.quote) await saveQuote(tx, asset.id, found.quote);
    await audit(tx, "market.import", asset.id, {
      symbol: found.symbol,
      quote: found.quote,
      created: !existing.length,
    });
    return { assetId: asset.id, symbol: found.symbol, warning: found.warning };
  });
}
async function performSync(assetIds?: string[]): Promise<MarketSyncResult> {
  if (!tickflowConfig().key)
    throw new TickFlowError("尚未配置 TickFlow 密钥", 401);
  const assets = await db.asset.findMany({
    where: assetIds ? { id: { in: assetIds } } : undefined,
  });
  if (assetIds && assets.length !== assetIds.length)
    throw new TickFlowError("部分资产不存在，请刷新持仓后重试");
  const result: MarketSyncResult = {
    at: new Date().toISOString(),
    updated: 0,
    unchanged: 0,
    skipped: [],
    failed: [],
    retained: [],
  };
  const quotes = new Map<string, MarketQuote>();
  let requested = false;
  let terminal = "";
  for (const asset of assets) {
    if (asset.assetClass === "CASH") continue;
    const symbol = marketSymbol(asset.code);
    if (
      !symbol ||
      !["STOCK", "ETF"].includes(asset.assetClass) ||
      asset.instrument !== "SPOT"
    ) {
      result.skipped.push({
        code: asset.code,
        message: "该资产暂不支持自动行情",
      });
      continue;
    }
    if (quoteCurrency(symbol) !== asset.currency) {
      result.failed.push({
        code: asset.code,
        message: `计价币种应为 ${quoteCurrency(symbol)}，原价格保留`,
      });
      continue;
    }
    if (terminal) {
      result.failed.push({ code: asset.code, message: terminal });
      continue;
    }
    try {
      let quote = quotes.get(symbol);
      if (!quote) {
        if (requested)
          await new Promise((resolve) => setTimeout(resolve, 1000));
        requested = true;
        quote = await fetchQuote(symbol);
        quotes.set(symbol, quote);
      }
      const changed = await db.$transaction((tx) =>
        saveQuote(tx, asset.id, quote),
      );
      if (changed) result.updated++;
      else result.unchanged++;
      const current = await db.assetPrice.findFirst({
        where: { assetId: asset.id, at: { lte: new Date() } },
        orderBy: { at: "desc" },
      });
      if (
        current &&
        current.source !== SOURCE &&
        current.at >= new Date(quote.at)
      ) {
        result.retained.push({
          code: asset.code,
          message: "手动估值时间不早于行情，保留当前价格",
        });
      }
    } catch (e) {
      const message = publicError(e);
      result.failed.push({ code: asset.code, message });
      if (
        e instanceof TickFlowError &&
        ([401, 403, 429].includes(e.status) || e.status >= 500)
      )
        terminal = message;
    }
  }
  result.at = new Date().toISOString();
  await db.$transaction(async (tx) => {
    await tx.systemSetting.upsert({
      where: { key: "tickflow.lastResult" },
      create: { key: "tickflow.lastResult", value: JSON.stringify(result) },
      update: { value: JSON.stringify(result) },
    });
    await audit(tx, "market.sync", "tickflow", result);
  });
  return result;
}
export function syncMarket(raw: unknown = {}): Promise<MarketSyncResult> {
  const input = z
    .object({
      assetIds: z.array(z.string().min(1).max(100)).min(1).max(1000).optional(),
    })
    .parse(raw);
  const ids = input.assetIds ? [...new Set(input.assetIds)].sort() : undefined;
  const scope = JSON.stringify(ids ?? null);
  if (state.running) {
    if (state.scope === scope) return state.running;
    return state.running.then(
      () => syncMarket(input),
      () => syncMarket(input),
    );
  }
  state.scope = scope;
  state.running = performSync(ids).finally(() => {
    state.running = null;
    state.scope = undefined;
  });
  return state.running;
}
// One local server owns the timer; persisted daily attempts survive restarts.
export function scheduledDay(now: Date, time: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  return `${part("hour")}:${part("minute")}` >= time
    ? day
    : new Date(new Date(`${day}T00:00:00Z`).getTime() - 86400000)
        .toISOString()
        .slice(0, 10);
}
export async function dailyMarketTick(now = new Date()) {
  const config = tickflowConfig();
  if (!config.key || !config.automatic || state.ticking || state.running)
    return;
  state.ticking = true;
  try {
    const day = scheduledDay(now, config.time);
    const saved = await db.systemSetting.findUnique({
      where: { key: "tickflow.daily" },
    });
    const parsed = dailySchema.safeParse(saved ? safeJson(saved.value) : null);
    const previous =
      parsed.success && parsed.data.day === day ? parsed.data : null;
    if (
      previous &&
      (previous.complete ||
        previous.attempts >= config.maxAttempts ||
        now.getTime() - new Date(previous.at).getTime() <
          config.retryMinutes * 60000)
    )
      return;
    const job = {
      day,
      attempts: (previous?.attempts || 0) + 1,
      at: now.toISOString(),
      complete: false,
    };
    await db.systemSetting.upsert({
      where: { key: "tickflow.daily" },
      create: { key: "tickflow.daily", value: JSON.stringify(job) },
      update: { value: JSON.stringify(job) },
    });
    const result = await syncMarket();
    job.complete = result.failed.length === 0;
    await db.systemSetting.update({
      where: { key: "tickflow.daily" },
      data: { value: JSON.stringify(job) },
    });
  } finally {
    state.ticking = false;
  }
}
export function startMarketScheduler() {
  if (state.timer) return;
  const tick = () => {
    void dailyMarketTick().catch(() =>
      console.error("TickFlow 每日更新失败，可在资产明细重试"),
    );
  };
  state.timer = setInterval(tick, 60000);
  state.timer.unref();
  const startup = setTimeout(tick, 5000);
  startup.unref();
}
