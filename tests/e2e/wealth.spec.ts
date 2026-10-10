import { test, expect } from "@playwright/test";
test("创建平台、账户与期初现金并核对总资产", async ({ page, request }) => {
  const name = `银行-${Date.now()}`;
  await page.goto("/wealth/platforms");
  await page.getByLabel("平台名称").fill(name);
  await page.getByRole("button", { name: "保存", exact: true }).first().click();
  await page.getByLabel("所属平台").selectOption({ label: name });
  await page.getByLabel("账户名称").fill("现金账户");
  await page.getByRole("button", { name: "保存", exact: true }).nth(1).click();
  await expect(
    page.getByRole("cell", { name: "现金账户", exact: true }),
  ).toBeVisible();
  const state = await (await request.get("/api/state")).json();
  let cash = state.assets.find((a: { code: string }) => a.code === "CASH:CNY");
  if (!cash)
    cash = (
      await (
        await request.post("/api/command", {
          data: {
            action: "asset.create",
            input: {
              name: "人民币",
              code: "CASH:CNY",
              assetClass: "CASH",
              currency: "CNY",
            },
          },
        })
      ).json()
    ).result;
  const account = state.accounts.find(
    (a: { platform: { name: string } }) => a.platform.name === name,
  );
  const r = await request.post("/api/command", {
    data: {
      action: "transaction.create",
      input: {
        accountId: account.id,
        assetId: cash.id,
        type: "DEPOSIT",
        quantity: "12345.67",
        at: new Date().toISOString(),
      },
    },
  });
  expect(r.ok()).toBe(true);
  await page.goto("/wealth");
  await expect(page.getByText("CNY 12,345.67").first()).toBeVisible();
});
