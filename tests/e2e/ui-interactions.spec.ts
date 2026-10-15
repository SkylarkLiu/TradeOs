import { test, expect } from "@playwright/test";

test("手机和平板导航可退出，键盘焦点和当前页面清晰", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto("/wealth");
  const menu = page.getByRole("button", { name: "展开导航", exact: true });
  await menu.click();
  const dialog = page.getByRole("dialog", { name: "应用导航" });
  await expect(dialog).toBeVisible();
  await expect(page.locator(".main")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(menu).toBeFocused();
  await menu.click();
  await page
    .getByRole("button", { name: "关闭导航遮罩" })
    .click({ position: { x: 800, y: 20 } });
  await expect(dialog).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await menu.click();
  await dialog.getByRole("link", { name: "资产明细", exact: true }).click();
  await expect(page).toHaveURL(/\/wealth\/assets$/);
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await expect(page.locator("#main-content")).toBeFocused();
  await expect(
    page.getByRole("navigation", { name: "当前位置" }),
  ).toContainText("资产明细");
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("浅色主题刷新保留，桌面导航标明当前页面", async ({ page }) => {
  await page.goto("/wealth/accounts");
  await expect(
    page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("link", { name: "平台与账户" }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "切换主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("tradeos-theme"))).toBe(
    "light",
  );
});

test("报表筛选需应用，口径分组、日期校验和切币种保留条件", async ({ page }) => {
  let requests = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/analytics?")) requests++;
  });
  await page.goto("/trading/analytics");
  await expect(page.locator(".report-definitions > summary")).toBeVisible();
  const initial = requests;
  await page.getByText("更多交易筛选", { exact: true }).click();
  await page.getByLabel("交易标签", { exact: true }).fill("界面验收标签");
  await expect(page.getByText("筛选未应用", { exact: true })).toBeVisible();
  expect(requests).toBe(initial);
  await expect(page.locator(".report-filter-summary")).not.toContainText(
    "界面验收标签",
  );
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect(page.locator(".report-filter-summary")).toContainText(
    "交易标签：界面验收标签",
  );
  await expect(page.locator(".report-definitions > summary")).toBeVisible();
  await page.getByRole("tab", { name: "账户收益", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "账户收益" })).toContainText(
    "账户TWR",
  );
  const definitions = page.locator(".report-definitions");
  await expect(definitions).not.toHaveAttribute("open", "");
  await definitions.locator("summary").click();
  await expect(definitions).toContainText(
    "账户收益和增长来源只按账户与日期统计",
  );
  await page.getByLabel("开始日期", { exact: true }).fill("2026-10-10");
  await page.getByLabel("结束日期", { exact: true }).fill("2026-10-01");
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect(page.locator("#main-content").getByRole("alert")).toContainText(
    "开始日期不能晚于结束日期",
  );
  await expect(page.getByLabel("开始日期", { exact: true })).toHaveValue(
    "2026-10-10",
  );
  await page.getByLabel("开始日期", { exact: true }).fill("");
  await page.getByLabel("结束日期", { exact: true }).fill("");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/state?currency=USD", async (route) => {
    await gate;
    await route.continue();
  });
  await page.getByLabel("报告币种", { exact: true }).selectOption("USD");
  await expect(page.getByText(/正在切换为 USD/)).toBeVisible();
  await expect(page.locator(".report-filter-summary")).toContainText(
    "报告币种 CNY",
  );
  release();
  await expect(page.locator(".report-filter-summary")).toContainText(
    "报告币种 USD",
  );
  await expect(
    page.getByRole("tab", { name: "账户收益", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("交易标签", { exact: true })).toHaveValue(
    "界面验收标签",
  );
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  await expect(page.locator(".report-filter-summary")).not.toContainText(
    "界面验收标签",
  );
});

test("报表加载失败能重试，旧范围不伪装成新报表", async ({ page }) => {
  let failing = true;
  await page.route("**/api/analytics?**", (route) => {
    if (failing) return route.abort();
    return route.continue();
  });
  await page.goto("/trading/analytics");
  await expect(page.locator("#main-content").getByRole("alert")).toContainText(
    "无法连接本地服务",
  );
  failing = false;
  await page.getByRole("button", { name: "重试加载报表" }).click();
  await expect(page.locator(".report-definitions > summary")).toBeVisible();
  await expect(page.locator("#main-content").getByRole("alert")).toHaveCount(0);
});

test("报表与表单按需显示说明，默认简洁且标签仍能聚焦输入", async ({ page }) => {
  await page.goto("/trading/analytics");
  const definitions = page.locator(".report-definitions");
  await expect(definitions.locator("summary")).toBeVisible();
  await expect(page.locator(".page-heading .subtitle")).toHaveCount(0);
  await expect(
    page.getByText("报表使用下方已应用范围。", { exact: true }),
  ).toHaveCount(0);
  const intervalHelp = definitions.getByText(/月度收益不代表完整自然月收益/);
  await expect(intervalHelp).not.toBeVisible();
  await definitions.locator("summary").click();
  await expect(intervalHelp).toBeVisible();
  await definitions.locator("summary").click();
  await expect(intervalHelp).not.toBeVisible();

  await page.getByRole("tab", { name: "账户收益", exact: true }).click();
  const metricHelp = page.getByLabel("账户TWR说明", { exact: true });
  const metricDefinition = page.getByText("剔除资金流影响的区间收益率", {
    exact: true,
  });
  await expect(page.getByText("账户TWR", { exact: true })).toBeVisible();
  await expect(metricHelp).toBeVisible();
  await expect(metricDefinition).not.toBeVisible();
  await metricHelp.click();
  await expect(metricDefinition).toBeVisible();
  await metricHelp.click();
  await expect(metricDefinition).not.toBeVisible();

  await page.goto("/wealth/assets");
  const form = page.getByRole("form", { name: "登记资产", exact: true });
  const code = form.getByLabel("唯一代码", { exact: true });
  const fieldHelp = form.getByLabel("唯一代码说明", { exact: true });
  const fieldDefinition = form.getByText(
    "建议带市场，如NASDAQ:AAPL；现金自动使用CASH:币种",
    { exact: true },
  );
  await expect(fieldDefinition).not.toBeVisible();
  await expect(code).not.toHaveAttribute("aria-describedby", /.+/);
  await fieldHelp.click();
  await expect(fieldDefinition).toBeVisible();
  await expect(code).toHaveAttribute("aria-describedby", /.+/);
  await form.getByText("唯一代码", { exact: true }).click();
  await expect(code).toBeFocused();
  await code.fill("UI:HELP");
  await fieldHelp.click();
  await expect(fieldDefinition).not.toBeVisible();
  await expect(code).not.toHaveAttribute("aria-describedby", /.+/);
  await expect(code).toHaveValue("UI:HELP");
});

test("表单保存锁定输入并防重复，成功反馈清晰", async ({ page }) => {
  await page.goto("/wealth/platforms");
  const form = page.getByRole("form", { name: "创建平台", exact: true });
  await form
    .getByLabel("平台名称", { exact: true })
    .fill(`界面反馈-${Date.now()}`);
  let calls = 0,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/command", async (route) => {
    calls++;
    await gate;
    await route.continue();
  });
  await form.evaluate((node: HTMLFormElement) => {
    node.requestSubmit();
    node.requestSubmit();
  });
  await expect(form.getByLabel("平台名称", { exact: true })).toBeDisabled();
  await expect(
    form.getByRole("button", { name: "保存中…", exact: true }),
  ).toBeDisabled();
  expect(calls).toBe(1);
  release();
  await expect(form.getByRole("status")).toContainText("保存成功");
  await expect(form.getByLabel("平台名称", { exact: true })).toHaveValue("");
  await form.getByLabel("平台名称", { exact: true }).fill("继续录入");
  await expect(form.getByRole("status")).toHaveText("");
});

test("搜索无匹配可清除，搜索分页与精确排序并存", async ({ page, request }) => {
  const prefix = `查找验收-${Date.now()}`;
  for (let i = 0; i < 17; i++) {
    const response = await request.post("/api/command", {
      data: {
        action: "platform.create",
        input: { name: `${prefix}-${String(i).padStart(2, "0")}` },
      },
    });
    expect(response.ok()).toBe(true);
  }
  await page.goto("/wealth/platforms");
  const panel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "平台", exact: true }) });
  const search = panel.getByPlaceholder("搜索名称、账户或标签…");
  await search.fill(prefix);
  await expect(panel.locator("tbody tr")).toHaveCount(15);
  await panel.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(panel.locator("tbody tr")).toHaveCount(2);
  await search.fill("不存在的搜索词");
  await expect(
    panel.getByText("没有匹配的记录", { exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "清除搜索", exact: true }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  await expect(panel.locator("tbody tr")).toHaveCount(15);
});

test("已有持仓时可直接保存首个财富快照，空范围可恢复", async ({
  page,
  request,
}) => {
  const state = await (await request.get("/api/state")).json();
  state.snapshots = [];
  state.portfolio.rows = [];
  await page.route("**/api/state?currency=CNY", (route) =>
    route.fulfill({ json: state }),
  );
  await page.goto("/wealth");
  const trend = page.locator("#wealth-trend");
  await expect(
    trend.getByText("从第一笔资产开始", { exact: true }),
  ).toBeVisible();
  state.portfolio.rows = [
    {
      accountId: "snapshot-account",
      assetId: "snapshot-cash",
      name: "人民币",
      code: "CASH:CNY",
      assetClass: "CASH",
      platform: "银行",
      account: "现金",
      currency: "CNY",
      quantity: "100",
      cost: "100",
      price: "1",
      value: "100",
      unrealized: "0",
      status: "VALID",
      source: "MANUAL",
      priceAt: null,
    },
  ];
  await page.reload();
  await trend.getByRole("button", { name: "近三月", exact: true }).click();
  await expect(
    trend.getByText("已有持仓，尚未保存快照", { exact: true }),
  ).toBeVisible();
  await expect(trend.getByRole("link", { name: "创建平台与账户" })).toHaveCount(
    0,
  );
  await page.route("**/api/command", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      action: "snapshot.create",
      input: { currency: "CNY" },
    });
    state.snapshots = [
      {
        id: "first-snapshot",
        at: new Date().toISOString(),
        currency: "CNY",
        assets: "100",
        net: "100",
        liabilities: "0",
        investable: "100",
        complete: true,
        allocations: [],
      },
    ];
    await route.fulfill({ json: { result: state.snapshots[0] } });
  });
  await trend
    .getByRole("button", { name: "保存当前快照", exact: true })
    .click();
  await expect(
    trend.getByRole("img", { name: "财富轨迹，单位 CNY", exact: true }),
  ).toBeVisible();
  await trend.getByText("图表数据", { exact: true }).click();
  await expect(
    trend.getByRole("cell", { name: "100", exact: true }),
  ).toHaveCount(2);
  state.snapshots[0].at = "2020-01-01T00:00:00.000Z";
  await page.reload();
  await trend.getByRole("button", { name: "近三月", exact: true }).click();
  await expect(
    trend.getByText("所选范围还没有快照", { exact: true }),
  ).toBeVisible();
  await trend
    .getByRole("button", { name: "查看全部快照", exact: true })
    .click();
  await expect(trend.getByText("1 个快照", { exact: true })).toBeVisible();
});

test("总览区分不完整估值，图表保留缺口与快照具体时间", async ({
  page,
  request,
}) => {
  const state = await (await request.get("/api/state")).json();
  state.portfolio = { ...state.portfolio, complete: false, rows: [] };
  state.snapshots = [
    {
      id: "ui-gap",
      at: "2026-10-01T00:00:00.000Z",
      assets: "999",
      net: "999",
      liabilities: "0",
      complete: false,
      allocations: [],
    },
    {
      id: "ui-valid",
      at: "2026-10-01T06:30:00.000Z",
      assets: "12000.123456789",
      net: "11000.123456789",
      liabilities: "1000",
      complete: true,
      allocations: [],
    },
  ];
  await page.route("**/api/state?currency=CNY", (route) =>
    route.fulfill({ json: state }),
  );
  await page.goto("/wealth");
  await expect(page.getByText("当前估值不完整", { exact: true })).toBeVisible();
  await expect(page.getByText(/请核对负债、在途及合约/)).toBeVisible();
  const trend = page.locator("#wealth-trend");
  await trend.getByText("图表数据", { exact: true }).click();
  const data = trend.getByRole("region", { name: "财富轨迹数据", exact: true });
  await expect(
    data.getByRole("cell", { name: "数据不足", exact: true }),
  ).toHaveCount(2);
  await expect(
    data.getByRole("rowheader", { name: "2026/10/1 14:30:00", exact: true }),
  ).toBeVisible();
  await expect(
    data.getByRole("cell", { name: "12000.123456789", exact: true }),
  ).toBeVisible();
  await page.locator(".risk-details > summary").click();
  await expect(page.getByText("历史净资产峰值", { exact: true })).toBeVisible();
});
