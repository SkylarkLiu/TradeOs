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
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import {
  tickflowSettingsFile,
  tickflowConfig,
} from "@/lib/integrations/tickflow-config";
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
  saveMarketSettings,
  testMarketConnection,
  nextMarketRun,
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
  rmSync(tickflowSettingsFile, { force: true });
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
  rmSync(tickflowSettingsFile, { force: true });
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
    await db.systemSetting.deleteMany({
      where: { key: { startsWith: "tickflow.daily" } },
    });
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
            where: { key: "tickflow.daily:18:00" },
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
  it("设置立即持久化，密钥留空保留且不进入状态或业务审计", async () => {
    const input = {
      base: "https://api.tickflow.org",
      time: "20:15",
      automatic: false,
      retryMinutes: 15,
      maxAttempts: 4,
      apiKey: "new-unit-secret",
    };
    const saved = await saveMarketSettings(input);
    expect(saved).toMatchObject({
      time: "20:15",
      automatic: false,
      retryMinutes: 15,
      maxAttempts: 4,
      configured: true,
      nextRunAt: null,
    });
    expect(JSON.stringify(saved)).not.toContain("new-unit-secret");
    expect(tickflowConfig().key).toBe("new-unit-secret");
    expect(JSON.parse(readFileSync(tickflowSettingsFile, "utf8")).time).toBe(
      "20:15",
    );
    expect(statSync(tickflowSettingsFile).mode & 0o777).toBe(0o600);
    await saveMarketSettings({ ...input, automatic: true, apiKey: "" });
    expect(tickflowConfig().key).toBe("new-unit-secret");
    expect((await marketStatus()).nextRunAt).not.toBeNull();
    expect(JSON.stringify(await db.systemSetting.findMany())).not.toContain(
      "new-unit-secret",
    );
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain(
      "new-unit-secret",
    );
    expect(
      nextMarketRun("20:15", new Date("2026-10-15T12:14:00Z")).toISOString(),
    ).toBe("2026-10-15T12:15:00.000Z");
    expect(
      nextMarketRun("20:15", new Date("2026-10-15T12:16:00Z")).toISOString(),
    ).toBe("2026-10-16T12:15:00.000Z");
  });
  it("连接测试使用未保存的节点和密钥，不写入持仓和本机设置", async () => {
    const saved = {
      base: "https://api.tickflow.org",
      time: "18:00",
      automatic: false,
      retryMinutes: 30,
      maxAttempts: 3,
      apiKey: "saved-unit-secret",
    };
    await saveMarketSettings(saved);
    const transactions = await db.assetTransaction.count();
    const result = await testMarketConnection({
      ...saved,
      base: "https://hk-api.tickflow.org",
      apiKey: "draft-unit-secret",
    });
    expect(result.connected).toBe(true);
    expect(String(fakeFetch.mock.calls[0][0])).toContain(
      "https://hk-api.tickflow.org/",
    );
    expect(fakeFetch.mock.calls[0][1]?.headers).toEqual({
      "x-api-key": "draft-unit-secret",
    });
    expect(tickflowConfig().key).toBe("saved-unit-secret");
    expect(await db.assetTransaction.count()).toBe(transactions);
    await expect(
      saveMarketSettings({ ...saved, time: "25:00" }),
    ).rejects.toThrow();
    await expect(
      saveMarketSettings({ ...saved, base: "https://evil.example" }),
    ).rejects.toThrow();
    expect(tickflowConfig().time).toBe("18:00");
  });
  it("自动开关与自定义重试参数在同一进程立即生效", async () => {
    await asset();
    const input = {
      base: "https://api.tickflow.org",
      time: "18:00",
      automatic: false,
      retryMinutes: 5,
      maxAttempts: 2,
      apiKey: "",
    };
    await saveMarketSettings(input);
    const now = new Date("2026-10-15T10:00:00Z");
    await dailyMarketTick(now);
    expect(fakeFetch).not.toHaveBeenCalled();
    await saveMarketSettings({ ...input, automatic: true });
    fakeFetch.mockResolvedValue(Response.json({}, { status: 503 }));
    await dailyMarketTick(now);
    await dailyMarketTick(new Date(now.getTime() + 4 * 60000));
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    await dailyMarketTick(new Date(now.getTime() + 5 * 60000));
    await dailyMarketTick(new Date(now.getTime() + 10 * 60000));
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });
  it("多个拉取时间去重排序，分别去重执行并独立重试，保存不重跑已完成时点", async () => {
    await asset();
    const input = {
      base: "https://api.tickflow.org",
      times: ["18:00", "08:00", "18:00"],
      automatic: true,
      retryMinutes: 5,
      maxAttempts: 2,
      apiKey: "",
    };
    const saved = await saveMarketSettings(input);
    expect(saved.times).toEqual(["08:00", "18:00"]);
    expect(
      nextMarketRun(
        saved.times,
        new Date("2026-10-15T00:01:00Z"),
      ).toISOString(),
    ).toBe("2026-10-15T10:00:00.000Z");
    await dailyMarketTick(new Date("2026-10-15T00:00:00Z"));
    await dailyMarketTick(new Date("2026-10-15T00:01:00Z"));
    await saveMarketSettings(input);
    await dailyMarketTick(new Date("2026-10-15T00:02:00Z"));
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    fakeFetch.mockResolvedValue(Response.json({}, { status: 503 }));
    await dailyMarketTick(new Date("2026-10-15T10:00:00Z"));
    await dailyMarketTick(new Date("2026-10-15T10:04:00Z"));
    await dailyMarketTick(new Date("2026-10-15T10:05:00Z"));
    await dailyMarketTick(new Date("2026-10-15T10:10:00Z"));
    expect(fakeFetch).toHaveBeenCalledTimes(3);
    expect(
      JSON.parse(
        (
          await db.systemSetting.findUniqueOrThrow({
            where: { key: "tickflow.daily:08:00" },
          })
        ).value,
      ).complete,
    ).toBe(true);
    expect(
      JSON.parse(
        (
          await db.systemSetting.findUniqueOrThrow({
            where: { key: "tickflow.daily:18:00" },
          })
        ).value,
      ).attempts,
    ).toBe(2);
    await expect(saveMarketSettings({ ...input, times: [] })).rejects.toThrow();
    await expect(
      saveMarketSettings({ ...input, times: ["24:00"] }),
    ).rejects.toThrow();
  });
  it("旧版单时间本机配置保留密钥与原时间，停机仅补最近到期时点", async () => {
    writeFileSync(
      tickflowSettingsFile,
      JSON.stringify({ time: "19:10", key: "legacy-unit-secret" }),
    );
    expect(tickflowConfig()).toMatchObject({
      time: "19:10",
      times: ["19:10"],
      key: "legacy-unit-secret",
    });
    writeFileSync(
      tickflowSettingsFile,
      JSON.stringify({ time: "18:00", key: "legacy-unit-secret" }),
    );
    await db.systemSetting.create({
      data: {
        key: "tickflow.daily",
        value: JSON.stringify({
          day: "2026-10-15",
          attempts: 1,
          at: "2026-10-15T10:00:00Z",
          complete: true,
        }),
      },
    });
    await asset();
    await saveMarketSettings({
      base: "https://api.tickflow.org",
      times: ["08:00", "12:00", "18:00"],
      automatic: true,
      retryMinutes: 30,
      maxAttempts: 3,
    });
    await dailyMarketTick(new Date("2026-10-15T11:00:00Z"));
    expect(fakeFetch).not.toHaveBeenCalled();
    await db.systemSetting.delete({ where: { key: "tickflow.daily:18:00" } });
    await dailyMarketTick(new Date("2026-10-15T11:00:00Z"));
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(
      await db.systemSetting.findUnique({
        where: { key: "tickflow.daily:12:00" },
      }),
    ).toBeNull();
    expect(
      await db.systemSetting.findUnique({
        where: { key: "tickflow.daily:18:00" },
      }),
    ).not.toBeNull();
  });
  it("指定持仓只更新对应资产，重复ID去重且不回退为全目录拉取", async () => {
    const a = await asset(),
      b = await asset("600002.SH");
    const result = await syncMarket({ assetIds: [a.id, a.id] });
    expect(result.updated).toBe(1);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(await db.assetPrice.count({ where: { assetId: b.id } })).toBe(0);
    await expect(syncMarket({ assetIds: ["missing"] })).rejects.toThrow(
      "不存在",
    );
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(() => syncMarket({ assetIds: [] })).toThrow();
  });
  it("不同资产的并发更新排队，不返回其他资产的结果", async () => {
    const a = await asset(),
      b = await asset("600002.SH");
    let release!: (value: Response) => void;
    fakeFetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const one = syncMarket({ assetIds: [a.id] }),
      two = syncMarket({ assetIds: [b.id] });
    expect(one).not.toBe(two);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release(Response.json(quote()));
    expect((await one).updated).toBe(1);
    expect((await two).updated).toBe(1);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    expect(await db.assetPrice.count({ where: { assetId: b.id } })).toBe(1);
  });
  it("行情与资产ID关联，较新手动估值保留并明确返回原因", async () => {
    const a = await asset("SH:600001");
    await db.assetPrice.create({
      data: {
        assetId: a.id,
        price: "20",
        source: "MANUAL",
        at: new Date(stamp + 1000),
      },
    });
    const result = await syncMarket({ assetIds: [a.id] });
    expect(result.retained).toEqual([
      { code: "SH:600001", message: "手动估值时间不早于行情，保留当前价格" },
    ]);
    const current = await db.assetPrice.findFirst({
      where: { assetId: a.id },
      orderBy: { at: "desc" },
    });
    expect(current).toMatchObject({ price: "20", source: "MANUAL" });
    expect(
      await db.assetPrice.findFirst({
        where: { assetId: a.id, source: "TICKFLOW" },
      }),
    ).toMatchObject({ price: "12.345" });
  });
});
