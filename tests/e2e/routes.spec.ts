import { test, expect } from "@playwright/test";
test("所有工作台页面可访问且显示正确标题", async ({ page }) => {
  for (const [route, title] of [
    ["/wealth", "总资产"],
    ["/wealth/platforms", "平台与账户"],
    ["/wealth/accounts", "平台与账户"],
    ["/wealth/assets", "资产明细"],
    ["/wealth/transactions", "资金流水"],
    ["/wealth/transfers", "内部转账"],
    ["/wealth/allocation", "资产配置"],
    ["/wealth/history", "历史表现"],
    ["/wealth/reconciliation", "数据对账"],
    ["/trading/dashboard", "交易总览"],
    ["/trading/strategies", "策略库"],
    ["/trading/plans", "交易计划"],
    ["/trading/trades", "交易日志"],
    ["/trading/positions", "当前持仓"],
    ["/trading/backtest", "手动历史回测"],
    ["/trading/reviews", "交易复盘"],
    ["/trading/analytics", "绩效分析"],
    ["/fire", "财务自由目标"],
    ["/fire/forecast", "财富预测"],
    ["/settings", "设置与数据管理"],
  ]) {
    await page.goto(route);
    await expect(
      page.getByRole("heading", { name: title, exact: true }).first(),
    ).toBeVisible();
  }
});
test("手机表格提示横滑，资产链接保留筛选上下文", async ({ page, request }) => {
  let state = await (await request.get("/api/state")).json();
  if (!state.portfolio.rows.length) {
    const post = async (action: string, input: unknown) => {
        const r = await request.post("/api/command", {
          data: { action, input },
        });
        expect(r.ok(), await r.text()).toBe(true);
        return (await r.json()).result;
      },
      p = await post("platform.create", { name: `移动验收${Date.now()}` }),
      a = await post("account.create", {
        platformId: p.id,
        name: "移动账户",
        currency: "CNY",
      });
    let cash = state.assets.find(
      (a: { code: string }) => a.code === "CASH:CNY",
    );
    if (!cash)
      cash = await post("asset.create", {
        name: "人民币",
        code: "CASH:CNY",
        assetClass: "CASH",
        currency: "CNY",
      });
    await post("transaction.create", {
      accountId: a.id,
      assetId: cash.id,
      type: "DEPOSIT",
      quantity: "50",
      at: new Date().toISOString(),
    });
    state = await (await request.get("/api/state")).json();
  }
  const row = state.portfolio.rows[0];
  expect(row).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/wealth");
  await page
    .getByRole("button", {
      name: `${row.platform} / ${row.account}`,
      exact: true,
    })
    .click();
  await expect(
    page.getByText("左右滑动查看市值、盈亏及估值状态"),
  ).toBeVisible();
  await page
    .locator(
      `a[href="/wealth/transactions?accountId=${row.accountId}&assetId=${row.assetId}"]`,
    )
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`accountId=${row.accountId}`));
  await expect(page.getByText("当前筛选：", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "现金变化", exact: true }),
  ).toBeVisible();
});
