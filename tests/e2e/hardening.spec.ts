import { test, expect, type APIRequestContext } from "@playwright/test";
import Papa from "papaparse";
async function post(
  request: APIRequestContext,
  action: string,
  input: unknown,
) {
  const r = await request.post("/api/command", { data: { action, input } });
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()).result;
}
async function account(request: APIRequestContext) {
  const p = await post(request, "platform.create", {
    name: `深验-${crypto.randomUUID()}`,
  });
  const a = await post(request, "account.create", {
    platformId: p.id,
    name: "验收账户",
    currency: "CNY",
  });
  const state = await (await request.get("/api/state")).json();
  const cash =
    state.assets.find((a: { code: string }) => a.code === "CASH:CNY") ??
    (await post(request, "asset.create", {
      code: "CASH:CNY",
      name: "人民币",
      assetClass: "CASH",
      currency: "CNY",
    }));
  return { a, cash };
}
test("非法金额和网络错误保留输入，纠正金额后可以保存", async ({
  page,
  request,
}) => {
  const { a, cash } = await account(request);
  await page.goto("/wealth/transactions");
  const form = page.locator("form").first();
  await form.locator("select[name=accountId]").selectOption(a.id);
  await form.locator("select[name=assetId]").selectOption(cash.id);
  await form.locator("input[name=quantity]").fill("abc");
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("十进制");
  await expect(form.locator("input[name=quantity]")).toHaveValue("abc");
  await form.locator("input[name=quantity]").fill("0.12");
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "0.12", exact: true }).first(),
  ).toBeVisible();
  await page.route("**/api/command", (route) => route.abort());
  await form.locator("select[name=accountId]").selectOption(a.id);
  await form.locator("select[name=assetId]").selectOption(cash.id);
  await form.locator("input[name=quantity]").fill("10");
  await form.getByRole("button", { name: "保存", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("无法连接本地服务");
  await expect(form.locator("input[name=quantity]")).toHaveValue("10");
  await page.unroute("**/api/command");
});
test("导出的负数调整CSV可映射导入，余额准确", async ({ page, request }) => {
  const source = await account(request),
    target = await account(request);
  await post(request, "transaction.create", {
    accountId: source.a.id,
    assetId: source.cash.id,
    type: "DEPOSIT",
    quantity: "100",
    at: "2025-01-01T00:00:00Z",
  });
  await post(request, "transaction.create", {
    accountId: source.a.id,
    assetId: source.cash.id,
    type: "ADJUSTMENT",
    quantity: "-20.01",
    at: "2025-01-02T00:00:00Z",
  });
  const csv = await (await request.get("/api/export")).text();
  const records: Record<string, string>[] = Papa.parse<Record<string, string>>(
    csv,
    {
      header: true,
      skipEmptyLines: true,
    },
  )
    .data.filter((r) => r.accountId === source.a.id)
    .map((r) => ({ ...r, accountId: target.a.id, externalId: `copy:${r.id}` }));
  expect(records.find((r) => r.type === "ADJUSTMENT")?.quantity).toBe("-20.01");
  await page.goto("/settings");
  await page.locator('input[accept=".csv,text/csv"]').setInputFiles({
    name: "negative.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(Papa.unparse(records)),
  });
  await page.getByRole("button", { name: "预览与校验" }).click();
  await expect(page.getByText("可导入2条 · 重复0条 · 错误0条")).toBeVisible();
  await page.getByRole("button", { name: "确认导入2条", exact: true }).click();
  await expect(page.getByText(/导入成功：2条/)).toBeVisible();
  const state = await (await request.get("/api/state")).json();
  expect(
    state.portfolio.rows.find(
      (r: { accountId: string; assetId: string }) =>
        r.accountId === target.a.id && r.assetId === target.cash.id,
    ).quantity,
  ).toBe("79.99");
});
test("历史快照使用填写时间，未来时间提示错误且保留输入", async ({
  page,
  request,
}) => {
  await page.goto("/wealth/history");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "保存历史快照", exact: true }),
  });
  await form.locator("input[name=at]").fill("2020-01-01T00:00");
  await form.getByRole("button", { name: "保存历史快照", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: /2020\/1\/1 00:00:00/ }),
  ).toBeVisible();
  const state = await (await request.get("/api/state")).json();
  expect(
    state.snapshots.some(
      (s: { at: string; assets: string }) =>
        s.at === "2019-12-31T16:00:00.000Z" && s.assets === "0",
    ),
  ).toBe(true);
  await form.locator("input[name=at]").fill("2099-01-01T00:00");
  await form.getByRole("button", { name: "保存历史快照", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("未来");
  await expect(form.locator("input[name=at]")).toHaveValue("2099-01-01T00:00");
});
test("持仓市值按Decimal小数正确排序", async ({ page, request }) => {
  const { a } = await account(request);
  for (const [label, q] of [
    ["九", "0.9"],
    ["十二", "0.12"],
  ]) {
    const asset = await post(request, "asset.create", {
      code: crypto.randomUUID(),
      name: `金额排序-${label}`,
      assetClass: "STOCK",
      currency: "CNY",
    });
    await post(request, "transaction.create", {
      accountId: a.id,
      assetId: asset.id,
      type: "DEPOSIT",
      quantity: q,
      price: "1",
      at: "2025-01-01T00:00:00Z",
    });
    await post(request, "price.create", {
      assetId: asset.id,
      price: "1",
      at: new Date().toISOString(),
    });
  }
  await page.goto("/wealth/assets");
  const panel = page.locator("section").filter({
    has: page.getByRole("heading", { name: "持仓明细", exact: true }),
  });
  await panel.getByPlaceholder("搜索名称、账户或标签…").fill("金额排序-");
  await panel.getByRole("button", { name: "市值", exact: true }).click();
  await expect(panel.locator("tbody tr").first()).toContainText(
    "金额排序-十二",
  );
  await panel.getByRole("button", { name: "市值 ↑", exact: true }).click();
  await expect(panel.locator("tbody tr").first()).toContainText("金额排序-九");
});
