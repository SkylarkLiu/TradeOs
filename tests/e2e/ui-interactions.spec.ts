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
  await expect(page.locator(".report-scope")).toBeVisible();
  const initial = requests;
  await page.getByText("更多交易筛选", { exact: true }).click();
  await page.getByLabel("交易标签", { exact: true }).fill("界面验收标签");
  await expect(
    page.getByText("筛选已修改，点击“应用筛选”后更新报表。"),
  ).toBeVisible();
  expect(requests).toBe(initial);
  await expect(page.locator(".report-filter-summary")).not.toContainText(
    "界面验收标签",
  );
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect(page.locator(".report-filter-summary")).toContainText(
    "交易标签：界面验收标签",
  );
  await expect(page.locator(".report-scope")).toBeVisible();
  await page.getByRole("tab", { name: "账户收益", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "账户收益" })).toContainText(
    "账户TWR",
  );
  await expect(page.getByRole("tabpanel", { name: "账户收益" })).toContainText(
    "更多交易筛选不影响此报表",
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
  await expect(page.locator(".report-scope")).toBeVisible();
  await expect(page.locator("#main-content").getByRole("alert")).toHaveCount(0);
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
  await trend.getByText("查看图表数据 · CNY", { exact: true }).click();
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
