import { test, expect } from "@playwright/test";

test("持仓批量与单项更新定向关联，刷新价格市值且保留数量成本", async ({
  page,
  request,
}) => {
  const backup = await (await request.get("/api/backup")).json();
  const post = async (action: string, input: unknown) => {
    const r = await request.post("/api/command", { data: { action, input } });
    const data = await r.json();
    expect(r.ok(), data.error).toBe(true);
    return data.result;
  };
  try {
    const now = Date.now(),
      at = (offset: number) => new Date(now - offset).toISOString();
    const platform = await post("platform.create", { name: `持仓行情-${now}` });
    const account = await post("account.create", {
      platformId: platform.id,
      name: "行情测试账户",
      currency: "CNY",
    });
    const asset = await post("asset.create", {
      code: "600888.SH",
      name: "持仓行情测试股票",
      assetClass: "STOCK",
      currency: "CNY",
    });
    const unheld = await post("asset.create", {
      code: "600889.SH",
      name: "未持有的股票",
      assetClass: "STOCK",
      currency: "CNY",
    });
    await post("transaction.create", {
      accountId: account.id,
      assetId: asset.id,
      type: "DEPOSIT",
      quantity: "3",
      price: "8",
      at: at(240000),
    });
    await post("price.create", {
      assetId: asset.id,
      price: "10",
      at: at(120000),
      source: "MANUAL",
    });
    let calls = 0,
      retained = false,
      failure = false;
    await page.route("**/api/command", async (route) => {
      const data = route.request().postDataJSON();
      if (data.action !== "market.sync") return route.continue();
      expect(data.input.assetIds).toContain(asset.id);
      expect(data.input.assetIds).not.toContain(unheld.id);
      calls++;
      if (failure)
        return route.fulfill({
          status: 400,
          json: { error: "TickFlow 连接失败或超时，请稍后重试" },
        });
      if (calls === 1)
        await post("price.create", {
          assetId: asset.id,
          price: "12.345",
          at: at(60000),
          source: "TICKFLOW",
        });
      await route.fulfill({
        json: {
          result: {
            at: at(0),
            updated: calls === 1 ? 1 : 0,
            unchanged: calls === 1 ? 0 : 1,
            failed: [],
            skipped: [],
            retained: retained
              ? [
                  {
                    code: asset.code,
                    message: "手动估值时间不早于行情，保留当前价格",
                  },
                ]
              : [],
          },
        },
      });
    });
    await page.goto("/wealth/assets#holdings");
    const holdings = page.locator("#holdings");
    const row = holdings
      .getByRole("row")
      .filter({ hasText: "持仓行情测试股票" });
    await expect(row).toContainText("CNY 30.00");
    await expect(row).toContainText("CNY 24.00");
    await holdings
      .getByRole("button", { name: "更新持仓行情", exact: true })
      .click();
    await expect(row).toContainText("CNY 12.345");
    await expect(row).toContainText("CNY 37.04");
    await expect(row).toContainText("CNY 13.04");
    await expect(row).toContainText("TICKFLOW");
    await expect(row).toContainText("CNY 24.00");
    await expect(
      row.getByRole("cell", { name: "3", exact: true }),
    ).toBeVisible();
    await row
      .getByRole("button", { name: "更新持仓行情测试股票行情", exact: true })
      .click();
    await expect(row.getByRole("status")).toContainText("未变 1");
    expect(calls).toBe(2);
    await post("price.create", {
      assetId: asset.id,
      price: "20",
      at: at(30000),
      source: "MANUAL",
    });
    retained = true;
    await page.reload();
    await row
      .getByRole("button", { name: "更新持仓行情测试股票行情", exact: true })
      .click();
    await expect(row.getByRole("status")).toContainText("手动估值优先");
    await expect(row).toContainText("CNY 20");
    failure = true;
    await row
      .getByRole("button", { name: "更新持仓行情测试股票行情", exact: true })
      .click();
    await expect(row.getByRole("alert")).toContainText("连接失败");
    await expect(row).toContainText("CNY 20");
    await page.goto("/wealth");
    await page
      .getByRole("button", {
        name: `${platform.name} / 行情测试账户`,
        exact: true,
      })
      .click();
    await expect(
      page
        .locator("#account-holdings")
        .getByRole("button", { name: "更新持仓行情", exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/wealth/assets#holdings");
    await expect(
      holdings.getByRole("button", { name: "更新持仓行情", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    const preview = await post("backup.preview", backup);
    await post("backup.restore", { backup, checksum: preview.checksum });
  }
});
