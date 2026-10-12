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
  await expect(page.locator("li")).toHaveCount(11);
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

test("策略发布、风险计划、分批成交及备份预览完整流程", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByLabel("平台", { exact: true }).fill("交易验收");
  await page.getByLabel("账户名称", { exact: true }).fill("交易账户");
  await page.getByRole("button", { name: "保存账户", exact: true }).click();
  await page
    .getByLabel("账户", { exact: true })
    .selectOption({ label: "交易验收 / 交易账户 · CNY" });
  await page.getByLabel("金额", { exact: true }).fill("1000");
  await page.getByLabel("发生时间", { exact: true }).fill("2025-01-01T08:00");
  await page.getByRole("button", { name: "保存流水", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("流水与余额已一起保存。");
  await page.getByRole("button", { name: "资产", exact: true }).click();
  await page.getByLabel("资产代码", { exact: true }).fill("TRADE");
  await page.getByLabel("资产名称", { exact: true }).fill("交易股票");
  await page.getByRole("button", { name: "保存资产", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("资产已保存。");
  await page.getByRole("button", { name: "策略", exact: true }).click();
  await page.getByLabel("策略名称", { exact: true }).fill("日线突破");
  await page.getByLabel("适用市场", { exact: true }).fill("股票现货");
  await page.getByLabel("交易周期", { exact: true }).fill("日线");
  await page.getByLabel("适用环境", { exact: true }).fill("上涨");
  await page
    .getByLabel("策略规则", { exact: true })
    .fill("突破最近二十日高点入场，回落至止损位置退出，达到目标分批止盈。");
  await page.getByRole("button", { name: "保存策略版本", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("策略草稿已保存");
  await page.getByText("v1 · 草稿", { exact: false }).click();
  await page.getByRole("button", { name: "发布 v1", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("策略版本已发布。");
  await page.getByRole("button", { name: "交易", exact: true }).click();
  await page.getByRole("button", { name: "风险计划", exact: true }).click();
  const plan = page.getByRole("form", { name: "风险计划表单", exact: true });
  await plan
    .getByLabel("交易账户", { exact: true })
    .selectOption({ label: "交易验收 / 交易账户 · CNY" });
  await plan
    .getByLabel("交易标的", { exact: true })
    .selectOption({ label: "TRADE / 交易股票 · CNY" });
  await plan
    .getByLabel("关联策略", { exact: true })
    .selectOption({ label: "日线突破 · v1" });
  await plan.getByLabel("计划入场价", { exact: true }).fill("10");
  await plan.getByLabel("计划止损价", { exact: true }).fill("8");
  await plan.getByLabel("计划止盈价", { exact: true }).fill("20");
  await plan.getByLabel("账户权益", { exact: true }).fill("1000");
  await plan.getByLabel("计划理由", { exact: true }).fill("突破确认");
  await plan.getByLabel("失效条件", { exact: true }).fill("跌破支撑");
  await page.getByRole("button", { name: "保存风险计划", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("计划已保存");
  await page.getByRole("button", { name: "交易记录", exact: true }).click();
  const create = page.getByRole("form", { name: "建立交易", exact: true });
  await create
    .getByLabel("交易账户", { exact: true })
    .selectOption({ label: "交易验收 / 交易账户 · CNY" });
  await create
    .getByLabel("交易标的", { exact: true })
    .selectOption({ label: "TRADE / 交易股票 · CNY" });
  await create
    .getByLabel("关联计划", { exact: true })
    .selectOption({
      label: "TRADE / 交易股票 · 交易验收 / 交易账户 · CNY · 突破确认",
    });
  await create
    .getByLabel("交易开始时间", { exact: true })
    .fill("2025-01-02T08:00");
  await page.getByRole("button", { name: "保存交易", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("交易已建立");
  const options = await page
    .getByLabel("当前交易", { exact: true })
    .locator("option")
    .allTextContents();
  await page
    .getByLabel("当前交易", { exact: true })
    .selectOption({ label: options[1] });
  const fills = page.getByRole("form", { name: "成交表单", exact: true });
  await fills.getByLabel("成交数量", { exact: true }).fill("2");
  await fills.getByLabel("实际成交价", { exact: true }).fill("10");
  await fills.getByLabel("成交手续费", { exact: true }).fill("1");
  await fills.getByLabel("成交时间", { exact: true }).fill("2025-01-02T08:00");
  await page.getByRole("button", { name: "保存成交", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "成交与交易、现金、持仓已一起保存。",
  );
  await page.getByText("记录持仓事件", { exact: true }).click();
  const events = page.getByRole("form", { name: "持仓事件表单", exact: true });
  await events
    .getByLabel("事件类型", { exact: true })
    .selectOption("STOP_ADJUSTMENT");
  await events.getByLabel("调整后价格", { exact: true }).fill("9");
  await events.getByLabel("事件说明", { exact: true }).fill("收紧止损");
  await events.getByLabel("事件时间", { exact: true }).fill("2025-01-03T08:00");
  await page.getByRole("button", { name: "保存持仓事件", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("持仓事件已保存。");
  await fills.getByLabel("成交类型", { exact: true }).selectOption("EXIT");
  await fills.getByLabel("成交数量", { exact: true }).fill("2");
  await fills.getByLabel("实际成交价", { exact: true }).fill("15");
  await fills.getByLabel("成交手续费", { exact: true }).fill("1");
  await fills.getByLabel("成交时间", { exact: true }).fill("2025-01-04T08:00");
  await page.getByRole("button", { name: "保存成交", exact: true }).click();
  await expect(
    page.getByText("交易已平仓，成交和持仓事件保留，只读。", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../../artifacts/android/trading-tablet-0.3.0.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../../artifacts/android/trading-mobile-0.3.0.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "交易", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "已平仓", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "账本", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "1,008.00", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "备份", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整JSON", exact: true }).click();
  const file = await download;
  const path = await file.path();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "选择JSON并预览", exact: true })
    .click();
  await (await chooser).setFiles(path!);
  await expect(page.getByRole("status")).toContainText("校验通过");
  await expect(
    page.getByText(/策略 1 项 · 交易 1 笔 · 成交 2 条/),
  ).toBeVisible();
});
