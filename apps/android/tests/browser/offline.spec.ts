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
  await expect(page.locator("li")).toHaveCount(6);
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
