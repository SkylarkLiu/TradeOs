import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { execFileSync } from "node:child_process";
import { db } from "@/lib/repositories/db";
import {
  marketSymbol,
  quoteCurrency,
  lookupInstrument,
  fetchQuote,
} from "@/lib/integrations/tickflow";
import {
  dailyMarketTick,
  marketImport,
  marketStatus,
  scheduledDay,
  syncMarket,
} from "@/lib/services/market";
import { GET } from "@/app/api/market/route";

const created: string[] = [];
const stamp = Date.now() - 60000;
const quote = (symbol = "600001.SH", price: number | string = 12.345) => ({
  data: [{ symbol, last_price: price, timestamp: stamp }],
});
const fakeFetch = vi.fn<typeof fetch>();
beforeAll(() => {
  if (!process.env.DATABASE_URL?.includes("/unit"))
    throw new Error("必须使用独立测试账本");
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { env: process.env, stdio: "pipe" },
  );
});
beforeEach(() => {
  vi.stubEnv("TICKFLOW_API_KEY", "unit-secret");
  vi.stubEnv("TICKFLOW_BASE_URL", "https://api.tickflow.org");
  vi.stubEnv("TICKFLOW_AUTO_SYNC", "false");
  vi.stubEnv("TICKFLOW_DAILY_TIME", "18:00");
  vi.stubGlobal("fetch", fakeFetch);
  fakeFetch.mockReset();
  fakeFetch.mockImplementation(async (input) => {
    const url = new URL(String(input)),
      symbol = url.searchParams.get("symbols")!;
    return Response.json(
      url.pathname.endsWith("instruments")
        ? { data: [{ symbol, name: "测试股票", type: "stock" }] }
        : quote(symbol),
    );
  });
});
afterEach(async () => {
  await db.assetPrice.deleteMany({ where: { assetId: { in: created } } });
  await db.asset.deleteMany({ where: { id: { in: created } } });
  created.length = 0;
  await db.systemSetting.deleteMany({
    where: { key: { startsWith: "tickflow." } },
  });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
async function asset(
  code = "600001.SH",
  currency = "CNY",
  assetClass = "STOCK",
) {
  const a = await db.asset.create({
    data: { code, currency, assetClass, name: "测试资产" },
  });
  created.push(a.id);
  return a;
}
describe("TickFlow 行情集成", () => {
  it("代码识别保留市场，外币与B股不会误按人民币计价", () => {
    expect(marketSymbol("600000")).toBe("600000.SH");
    expect(marketSymbol("000001")).toBe("000001.SZ");
    expect(marketSymbol("920662")).toBe("920662.BJ");
    expect(marketSymbol("NASDAQ:AAPL")).toBe("AAPL.US");
    expect(marketSymbol("SZSE:159915")).toBe("159915.SZ");
    expect(marketSymbol("CRYPTO:BTC")).toBeNull();
    expect(quoteCurrency("AAPL.US")).toBe("USD");
    expect(quoteCurrency("200001.SZ")).toBe("HKD");
  });
  it("服务端认证，单只报价保留原始精度、原始时间，不接受错误标的或未来数据", async () => {
    fakeFetch.mockResolvedValueOnce(
      Response.json(quote("600001.SH", "12.34567890123456789")),
    );
    expect(await fetchQuote("600001.SH")).toEqual({
      symbol: "600001.SH",
      price: "12.34567890123456789",
      at: new Date(stamp).toISOString(),
    });
    expect(fakeFetch.mock.calls[0][1]?.headers).toEqual({
      "x-api-key": "unit-secret",
    });
    fakeFetch.mockResolvedValueOnce(Response.json(quote("600002.SH")));
    await expect(fetchQuote("600001.SH")).rejects.toThrow("暂无该标的报价");
    fakeFetch.mockResolvedValueOnce(
      Response.json({
        data: [
          {
            symbol: "600001.SH",
            last_price: 12,
            timestamp: Date.now() + 86400000,
          },
        ],
      }),
    );
    await expect(fetchQuote("600001.SH")).rejects.toThrow("时间无效");
    fakeFetch.mockResolvedValueOnce(Response.json(quote("600001.SH", 0)));
    await expect(fetchQuote("600001.SH")).rejects.toThrow("格式异常");
  });
  it("导入股票及报价且重复登记复用资产，不写入持仓、流水或成本", async () => {
    const transactions = await db.assetTransaction.count(),
      balances = await db.assetBalance.count();
    const first = await marketImport({ symbol: "600001" });
    created.push(first.assetId);
    const second = await marketImport({ symbol: "SH:600001" });
    expect(second.assetId).toBe(first.assetId);
    expect(
      await db.assetPrice.count({ where: { assetId: first.assetId } }),
    ).toBe(1);
    expect(await db.assetTransaction.count()).toBe(transactions);
    expect(await db.assetBalance.count()).toBe(balances);
    expect(
      await db.assetPrice.findFirst({ where: { assetId: first.assetId } }),
    ).toMatchObject({ source: "TICKFLOW", at: new Date(stamp) });
    fakeFetch.mockResolvedValueOnce(
      Response.json({
        data: [{ symbol: "000300.SH", name: "指数", type: "index" }],
      }),
    );
    await expect(lookupInstrument("000300.SH")).rejects.toThrow(
      "仅支持股票和ETF",
    );
  });
  it("行情更新去重，保留手动同一时点估值，跳过非支持资产", async () => {
    const a = await asset();
    await asset("自住房", "CNY", "REAL_ESTATE");
    const first = await syncMarket();
    expect(first.updated).toBe(1);
    expect(first.skipped.some((i) => i.code === "自住房")).toBe(true);
    const again = await syncMarket();
    expect(again.updated).toBe(0);
    expect(again.unchanged).toBe(1);
    await db.assetPrice.updateMany({
      where: { assetId: a.id },
      data: { source: "MANUAL", price: "20" },
    });
    await syncMarket();
    expect(
      (await db.assetPrice.findFirst({ where: { assetId: a.id } }))?.price,
    ).toBe("20");
    expect((await marketStatus()).last?.unchanged).toBe(1);
  });
  it("并发更新共享请求，限流时停止请求并保留旧价格", async () => {
    const a = await asset();
    let release!: (value: Response) => void;
    fakeFetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const one = syncMarket(),
      two = syncMarket();
    expect(one).toBe(two);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release(Response.json(quote()));
    await one;
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    await asset("600002.SH");
    fakeFetch.mockReset();
    fakeFetch.mockResolvedValue(
      Response.json({ message: "unit-secret" }, { status: 429 }),
    );
    const failed = await syncMarket();
    expect(failed.failed).toHaveLength(2);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(failed)).not.toContain("unit-secret");
    expect(
      (await db.assetPrice.findFirst({ where: { assetId: a.id } }))?.price,
    ).toBe("12.345");
  });
  it("外币配置不符时不保存报价，断网不写入假零或当前时间", async () => {
    await asset("AAPL.US", "CNY");
    const a = await asset();
    fakeFetch.mockRejectedValue(new Error("unit-secret"));
    const result = await syncMarket();
    expect(result.failed.some((i) => i.message.includes("USD"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("unit-secret");
    expect(await db.assetPrice.count({ where: { assetId: a.id } })).toBe(0);
  });
  it("北京时间调度跨日补更、成功去重、失败30分钟重试且最多3次", async () => {
    expect(scheduledDay(new Date("2026-10-15T09:59:00Z"), "18:00")).toBe(
      "2026-10-14",
    );
    expect(scheduledDay(new Date("2026-10-15T10:00:00Z"), "18:00")).toBe(
      "2026-10-15",
    );
    expect(scheduledDay(new Date("2026-01-01T00:00:00Z"), "18:00")).toBe(
      "2025-12-31",
    );
    await asset();
    vi.stubEnv("TICKFLOW_AUTO_SYNC", "true");
    const now = new Date("2026-10-15T10:00:00Z");
    await dailyMarketTick(now);
    await dailyMarketTick(new Date(now.getTime() + 60000));
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    await db.systemSetting.deleteMany({ where: { key: "tickflow.daily" } });
    fakeFetch.mockReset();
    fakeFetch.mockResolvedValue(Response.json({}, { status: 503 }));
    await dailyMarketTick(now);
    await dailyMarketTick(new Date(now.getTime() + 29 * 60000));
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    await dailyMarketTick(new Date(now.getTime() + 30 * 60000));
    await dailyMarketTick(new Date(now.getTime() + 60 * 60000));
    await dailyMarketTick(new Date(now.getTime() + 90 * 60000));
    expect(fakeFetch).toHaveBeenCalledTimes(3);
    expect(
      JSON.parse(
        (
          await db.systemSetting.findUniqueOrThrow({
            where: { key: "tickflow.daily" },
          })
        ).value,
      ).attempts,
    ).toBe(3);
  });
  it("状态与错误接口不暴露密钥，缺少配置时不访问外网", async () => {
    const response = await GET(new Request("http://localhost/api/market"));
    expect(await response.text()).not.toContain("unit-secret");
    fakeFetch.mockResolvedValue(
      Response.json({ message: "unit-secret" }, { status: 401 }),
    );
    const rejected = await GET(
      new Request("http://localhost/api/market?symbol=600001"),
    );
    expect(await rejected.text()).not.toContain("unit-secret");
    vi.stubEnv("TICKFLOW_API_KEY", "");
    fakeFetch.mockReset();
    await expect(syncMarket()).rejects.toThrow("尚未配置");
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});
