import { test, expect } from "@playwright/test";
test("本机浏览器存储重载、离线校验及JSON导出", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("平台", { exact: true }).fill("验证银行");
  await page.getByLabel("账户名称", { exact: true }).fill("精度现金");
  await page.getByRole("button", { name: "保存账户", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "验证银行 / 精度现金", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("账户", { exact: true })
    .selectOption({ label: "验证银行 / 精度现金 · CNY" });
  await page.getByLabel("金额", { exact: true }).fill("1000.00000001");
  await page.getByRole("button", { name: "保存流水", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "1000.00000001", exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("cell", { name: "验证银行 / 精度现金", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "1000.00000001", exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "离线检查", exact: true }).click();
  await page.getByRole("button", { name: "运行离线检查", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("离线能力检查通过。");
  await expect(page.locator("li")).toHaveCount(9);
  await page.getByRole("button", { name: "备份", exact: true }).click();
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整JSON", exact: true }).click();
  const download = await waiting;
  expect(download.suggestedFilename()).toBe("tradeos-offline-prototype.json");
});
test("非法金额保留输入，手机视口无页面横溢", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("平台", { exact: true }).fill("手机验证");
  await page.getByLabel("账户名称", { exact: true }).fill("现金");
  await page.getByRole("button", { name: "保存账户", exact: true }).click();
  await page
    .getByLabel("账户", { exact: true })
    .selectOption({ label: "手机验证 / 现金 · CNY" });
  await page.getByLabel("金额", { exact: true }).fill("abc");
  await page.getByRole("button", { name: "保存流水", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("十进制");
  await expect(page.getByLabel("金额", { exact: true })).toHaveValue("abc");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("现货买卖、报价及持久化在平板和手机布局可操作", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByLabel("平台", { exact: true }).fill("验证券商");
  await page.getByLabel("账户名称", { exact: true }).fill("股票账户");
  await page.getByRole("button", { name: "保存账户", exact: true }).click();
  await page
    .getByLabel("账户", { exact: true })
    .selectOption({ label: "验证券商 / 股票账户 · CNY" });
  await page.getByLabel("金额", { exact: true }).fill("1000");
  await page.getByLabel("发生时间", { exact: true }).fill("2025-01-01T08:00");
  await page.getByRole("button", { name: "保存流水", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("流水与余额已一起保存。");
  await page.getByRole("button", { name: "资产", exact: true }).click();
  await page.getByLabel("资产代码", { exact: true }).fill("DEMO");
  await page.getByLabel("资产名称", { exact: true }).fill("虚拟股票");
  await page.getByRole("button", { name: "保存资产", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("资产已保存。");
  await page
    .getByLabel("资产账户", { exact: true })
    .selectOption({ label: "验证券商 / 股票账户 · CNY" });
  await page
    .getByLabel("交易资产", { exact: true })
    .selectOption({ label: "DEMO / 虚拟股票 · CNY" });
  await page.getByLabel("数量", { exact: true }).fill("10");
  await page.getByLabel("单价", { exact: true }).fill("10");
  await page.getByLabel("资产手续费", { exact: true }).fill("1");
  await page
    .getByLabel("资产发生时间", { exact: true })
    .fill("2025-01-02T08:00");
  await page.getByRole("button", { name: "保存资产流水", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "现金、持仓和资产流水已一起保存。",
  );
  await page
    .getByLabel("报价资产", { exact: true })
    .selectOption({ label: "DEMO / 虚拟股票" });
  await page.getByLabel("报价", { exact: true }).fill("12");
  await page.getByRole("button", { name: "保存报价", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "120", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../artifacts/android/asset-tablet-0.2.0.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "资产", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "120", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../../artifacts/android/asset-mobile-0.2.0.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "账本", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "899.00", exact: true }),
  ).toBeVisible();
});
