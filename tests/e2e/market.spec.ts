import { test, expect } from "@playwright/test";

test("查询证券、添加资产后可在账户流水中选中；更新失败可重试", async ({
  page,
  request,
}) => {
  const symbol = "600777.SH";
  const post = async (action: string, input: unknown) => {
    const response = await request.post("/api/command", {
      data: { action, input },
    });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).result;
  };
  const platform = await post("platform.create", {
    name: `行情验收-${Date.now()}`,
  });
  const account = await post("account.create", {
    name: "行情验收A股账户",
    platformId: platform.id,
    currency: "CNY",
  });
  const at = new Date(Date.now() - 60000).toISOString();
  let imported = "",
    failure = true;
  await page.route("**/api/market*", async (route) => {
    const code = new URL(route.request().url()).searchParams.get("symbol");
    await route.fulfill({
      json: code
        ? {
            symbol,
            name: "行情测试股票",
            assetClass: "STOCK",
            currency: "CNY",
            quote: { symbol, price: "12.345", at },
            warning: "",
          }
        : { configured: true, automatic: true, time: "18:00", last: null },
    });
  });
  await page.route("**/api/command", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "market.import") {
      expect(body.input).toEqual({ symbol });
      const asset = await post("asset.create", {
        code: symbol,
        name: "行情测试股票",
        assetClass: "STOCK",
        currency: "CNY",
      });
      imported = asset.id;
      await post("price.create", {
        assetId: asset.id,
        price: "12.345",
        at,
        source: "TICKFLOW",
      });
      await route.fulfill({
        json: { result: { assetId: asset.id, symbol, warning: "" } },
      });
    } else if (body.action === "market.sync") {
      if (failure)
        await route.fulfill({
          status: 400,
          json: { error: "TickFlow 连接失败或超时，请稍后重试" },
        });
      else
        await route.fulfill({
          json: {
            result: { at, updated: 0, unchanged: 1, failed: [], skipped: [] },
          },
        });
    } else await route.continue();
  });
  await page.goto("/wealth/assets");
  const panel = page.locator("#market-data");
  await panel.getByLabel("股票 / ETF代码", { exact: true }).fill("600777");
  await panel.getByRole("button", { name: "查询", exact: true }).click();
  await expect(panel.getByText("行情测试股票", { exact: true })).toBeVisible();
  await expect(panel.locator(".market-found")).toContainText("CNY 12.345");
  await panel.getByRole("button", { name: "添加资产", exact: true }).click();
  await expect(
    panel.getByRole("link", { name: "录入持仓", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "行情测试股票", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "立即更新", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("连接失败");
  failure = false;
  await panel.getByRole("button", { name: "立即更新", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("未变 1 项");
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await panel.getByRole("link", { name: "录入持仓", exact: true }).click();
  const form = page.getByRole("form", {
    name: "录入流水 / 期初余额",
    exact: true,
  });
  await expect(form.getByLabel("资产", { exact: true })).toHaveValue(imported);
  await form.getByLabel("账户", { exact: true }).selectOption(account.id);
  await expect(form.getByLabel("账户", { exact: true })).toHaveValue(
    account.id,
  );
  await expect(
    page.getByRole("link", { name: "添加资产", exact: true }),
  ).toBeVisible();
});

test("行情查询失败保留代码，手机可重试且不会添加错误标的", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let bad = true;
  await page.route("**/api/market*", async (route) => {
    const code = new URL(route.request().url()).searchParams.get("symbol");
    await route.fulfill(
      code
        ? bad
          ? {
              status: 400,
              json: { error: "未找到该标的，请检查代码和市场后缀" },
            }
          : {
              json: {
                symbol: "510300.SH",
                name: "沪深300ETF",
                assetClass: "ETF",
                currency: "CNY",
                quote: null,
                warning: "暂无报价",
              },
            }
        : {
            json: {
              configured: true,
              automatic: true,
              time: "18:00",
              last: null,
            },
          },
    );
  });
  await page.goto("/wealth/assets");
  const panel = page.locator("#market-data");
  const input = panel.getByLabel("股票 / ETF代码", { exact: true });
  await input.fill("510300");
  await panel.getByRole("button", { name: "查询", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("未找到");
  await expect(input).toHaveValue("510300");
  await expect(
    panel.getByRole("button", { name: "添加资产", exact: true }),
  ).toHaveCount(0);
  bad = false;
  await panel.getByRole("button", { name: "查询", exact: true }).click();
  await expect(panel.getByText("沪深300ETF", { exact: true })).toBeVisible();
  await input.fill("600000");
  await expect(
    panel.getByRole("button", { name: "添加资产", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
