import { z } from "zod";
import { canonical } from "@/lib/calculations/decimal";

import {
  tickflowConfig,
  TickFlowError,
  type TickFlowConfig,
} from "./tickflow-config";
export { tickflowConfig, TickFlowError } from "./tickflow-config";
export function marketSymbol(code: string): string | null {
  let symbol = code.trim().toUpperCase();
  const prefixed = symbol.match(
    /^(SH|SSE|SZ|SZSE|BJ|BSE|HK|HKEX|NASDAQ|NYSE|AMEX|US):(.+)$/,
  );
  if (prefixed) {
    const suffix: Record<string, string> = {
      SSE: "SH",
      SZSE: "SZ",
      BSE: "BJ",
      HKEX: "HK",
      NASDAQ: "US",
      NYSE: "US",
      AMEX: "US",
    };
    symbol = `${prefixed[2]}.${suffix[prefixed[1]] || prefixed[1]}`;
  }
  if (/^\d{6}$/.test(symbol)) {
    if (/^[56]/.test(symbol)) symbol += ".SH";
    else if (/^[013]/.test(symbol)) symbol += ".SZ";
    else if (/^[48]|^920/.test(symbol)) symbol += ".BJ";
  }
  if (
    /^\d{6}\.(SH|SZ|BJ)$/.test(symbol) ||
    /^\d{5}\.HK$/.test(symbol) ||
    /^[A-Z][A-Z0-9.-]{0,14}\.US$/.test(symbol)
  )
    return symbol;
  return null;
}
export function quoteCurrency(symbol: string): string {
  if (symbol.endsWith(".US")) return "USD";
  if (symbol.endsWith(".HK")) return "HKD";
  // B shares settle in foreign currency, unlike A shares.
  if (/^900\d{3}\.SH$/.test(symbol)) return "USD";
  if (/^200\d{3}\.SZ$/.test(symbol)) return "HKD";
  return "CNY";
}
async function request(endpoint: string, config = tickflowConfig()) {
  const { base, key } = config;
  if (!key) throw new TickFlowError("尚未配置 TickFlow 密钥", 401);
  let response: Response;
  try {
    response = await fetch(`${base}${endpoint}`, {
      headers: { "x-api-key": key },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new TickFlowError("TickFlow 连接失败或超时，请稍后重试", 503);
  }
  if (!response.ok) {
    const messages: Record<number, string> = {
      401: "TickFlow 密钥无效或已过期",
      403: "TickFlow 套餐无此接口权限",
      429: "TickFlow 请求过于频繁，请稍后重试",
    };
    throw new TickFlowError(
      messages[response.status] || `TickFlow 服务异常（${response.status}）`,
      response.status,
    );
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new TickFlowError("TickFlow 返回了无效数据", 502);
  }
}
const instrumentSchema = z.object({
  data: z.array(
    z.object({
      symbol: z.string(),
      name: z.string().nullish(),
      type: z.string().nullish(),
    }),
  ),
});
const priceSchema = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine(
    (v) =>
      /^\d+(\.\d+)?$/.test(v) && Number(v) > 0 && Number.isFinite(Number(v)),
  );
const quoteSchema = z.object({
  data: z.array(
    z.object({
      symbol: z.string(),
      last_price: priceSchema,
      timestamp: z.number().int().positive(),
    }),
  ),
});
export type MarketQuote = { symbol: string; price: string; at: string };
export type MarketInstrument = {
  symbol: string;
  name: string;
  assetClass: "STOCK" | "ETF";
  currency: string;
};
export async function lookupInstrument(
  raw: string,
  config?: TickFlowConfig,
): Promise<MarketInstrument> {
  const symbol = marketSymbol(raw);
  if (!symbol)
    throw new TickFlowError(
      "请输入完整代码，如 600000.SH、510300.SH、00700.HK 或 AAPL.US",
    );
  const parsed = instrumentSchema.safeParse(
    await request(
      `/v1/instruments?${new URLSearchParams({ symbols: symbol })}`,
      config,
    ),
  );
  if (!parsed.success)
    throw new TickFlowError("TickFlow 标的信息格式异常", 502);
  const instrument = parsed.data.data.find((i) => i.symbol === symbol);
  if (!instrument)
    throw new TickFlowError("未找到该标的，请检查代码和市场后缀");
  if (!instrument.name || !["stock", "etf"].includes(instrument.type || ""))
    throw new TickFlowError("目前仅支持股票和ETF，其他资产请手动登记");
  return {
    symbol,
    name: instrument.name,
    assetClass: instrument.type === "etf" ? "ETF" : "STOCK",
    currency: quoteCurrency(symbol),
  };
}
export async function fetchQuote(
  symbol: string,
  now = new Date(),
  config?: TickFlowConfig,
): Promise<MarketQuote> {
  const parsed = quoteSchema.safeParse(
    await request(
      `/v1/quotes?${new URLSearchParams({ symbols: symbol })}`,
      config,
    ),
  );
  if (!parsed.success)
    throw new TickFlowError("TickFlow 报价格式异常，未保存价格", 502);
  const quote = parsed.data.data.find((q) => q.symbol === symbol);
  if (!quote) throw new TickFlowError("TickFlow 暂无该标的报价，原价格保留");
  const at = new Date(quote.timestamp);
  if (
    !Number.isFinite(at.getTime()) ||
    quote.timestamp < 946684800000 ||
    at > now
  )
    throw new TickFlowError("TickFlow 报价时间无效，未保存价格", 502);
  return { symbol, price: canonical(quote.last_price), at: at.toISOString() };
}
