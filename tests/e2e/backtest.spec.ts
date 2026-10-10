import { test, expect } from "@playwright/test";
test("回测图表只展示已回放K线并可逐根前进", async ({ page, request }) => {
  const stamp = Date.now(),
    post = async (action: string, input: unknown) => {
      const r = await request.post("/api/command", { data: { action, input } });
      expect(r.ok(), await r.text()).toBe(true);
      return (await r.json()).result;
    };
  const asset = await post("asset.create", {
      code: `REPLAY:${stamp}`,
      name: "回放标的",
      assetClass: "STOCK",
      currency: "CNY",
    }),
    strategy = await post("strategy.create", {
      name: `回放策略${stamp}`,
      market: "股票",
      timeframe: "日线",
      environment: "趋势",
      rules: "历史回放策略，只使用当前及此前已知K线，禁止未来数据",
    });
  await post("strategy.publish", { id: strategy.versions[0].id });
  const session = await post("backtest.create", {
    name: `回放任务${stamp}`,
    assetId: asset.id,
    strategyVersionId: strategy.versions[0].id,
    timeframe: "1d",
    initialCapital: "1000",
    adjustment: "RAW",
    feeRate: "0",
  });
  await post("backtest.import", {
    sessionId: session.id,
    csv: "at,open,high,low,close,volume\n2025-01-01T00:00:00Z,100,105,95,100,100\n2025-01-02T00:00:00Z,100,110,95,105,100",
  });
  await page.goto("/trading/backtest");
  await page.getByLabel("选择任务").selectOption(session.id);
  await expect(page.getByText("1 / 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "下一根", exact: true }).click();
  await expect(page.getByText("2 / 2", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "仅含已回放数据的历史K线图" }),
  ).toBeVisible();
});
