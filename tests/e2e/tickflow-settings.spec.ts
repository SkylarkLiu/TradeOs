import { test, expect } from "@playwright/test";

test("TickFlow设置从行情入口可达，保存后刷新保留且密钥不回显", async ({
  page,
  request,
}) => {
  await page.goto("/wealth/assets");
  await page
    .locator("#market-data")
    .getByRole("link", { name: "行情设置", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings#tickflow$/);
  const panel = page.locator("#tickflow"),
    form = panel.getByRole("form", { name: "TickFlow设置", exact: true });
  await expect(form).toBeVisible();
  await form.getByLabel("自动拉取行情", { exact: true }).uncheck();
  await form
    .getByLabel("每日拉取时间（北京时间）", { exact: true })
    .fill("20:35");
  await form.getByText("重试设置", { exact: true }).click();
  await form.getByLabel("失败重试间隔（分钟）", { exact: true }).fill("15");
  await form.getByLabel("每轮最多尝试次数", { exact: true }).fill("4");
  await expect(
    form.getByRole("button", { name: "立即拉取", exact: true }),
  ).toBeDisabled();
  await form.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("已保存");
  await page.reload();
  await expect(
    form.getByLabel("每日拉取时间（北京时间）", { exact: true }),
  ).toHaveValue("20:35");
  await expect(
    form.getByLabel("自动拉取行情", { exact: true }),
  ).not.toBeChecked();
  await expect(form.getByLabel("API Key", { exact: true })).toHaveValue("");
  await form.getByText("重试设置", { exact: true }).click();
  await expect(
    form.getByLabel("失败重试间隔（分钟）", { exact: true }),
  ).toHaveValue("15");
  const data = await (await request.get("/api/market")).json();
  expect(data).toMatchObject({
    time: "20:35",
    automatic: false,
    retryMinutes: 15,
    maxAttempts: 4,
  });
  expect(data).not.toHaveProperty("key");
  expect(data).not.toHaveProperty("apiKey");
  await panel
    .getByRole("link", { name: "查询与添加资产", exact: true })
    .click();
  await expect(page).toHaveURL(/\/wealth\/assets#market-data$/);
  await expect(
    page.getByRole("heading", { name: "TickFlow行情", exact: true }),
  ).toBeVisible();
});

test("设置连接测试使用未保存配置，错误保留输入且手机无横溢", async ({
  page,
  request,
}) => {
  const originalTime = (await (await request.get("/api/market")).json()).time;
  await page.setViewportSize({ width: 390, height: 844 });
  let rejected = true;
  await page.route("**/api/command", async (route) => {
    const data = route.request().postDataJSON();
    if (data.action !== "market.test") return route.continue();
    expect(data.input).toMatchObject({
      time: "21:10",
      apiKey: "e2e-placeholder",
    });
    await route.fulfill(
      rejected
        ? { status: 400, json: { error: "TickFlow 密钥无效或已过期" } }
        : { json: { result: { connected: true, symbol: "600000.SH" } } },
    );
  });
  await page.goto("/settings#tickflow");
  const panel = page.locator("#tickflow"),
    form = panel.getByRole("form", { name: "TickFlow设置", exact: true });
  await form
    .getByLabel("每日拉取时间（北京时间）", { exact: true })
    .fill("21:10");
  await form.getByLabel("API Key", { exact: true }).fill("e2e-placeholder");
  await expect(form.getByLabel("API Key", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await form.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("密钥无效");
  await expect(form.getByLabel("API Key", { exact: true })).toHaveValue(
    "e2e-placeholder",
  );
  rejected = false;
  await form.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(
    panel.getByText("连接正常，修改尚未保存。", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(form.getByLabel("API Key", { exact: true })).toHaveValue("");
  await expect(
    form.getByLabel("每日拉取时间（北京时间）", { exact: true }),
  ).toHaveValue(originalTime);
});
