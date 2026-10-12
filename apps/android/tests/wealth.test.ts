import { it, expect } from "vitest";
import { setup } from "./sql";
import { Ledger, digest, validateBackup } from "../src/ledger";
import { wealthPortfolio, fireProjection, fxValue } from "../src/wealth";
import { D } from "@tradeos/core";
const at = "2025-01-01T00:00:00Z",
  current = () => new Date().toISOString();
async function book(currency = "CNY") {
  const b = setup();
  await b.ledger.init();
  const a = await b.ledger.createAccount({
      name: "来源",
      platform: "验证",
      currency,
    }),
    to = await b.ledger.createAccount({
      name: "目标",
      platform: "验证",
      currency,
    });
  await b.ledger.post({ accountId: a.id, type: "DEPOSIT", amount: "1000", at });
  return { ...b, a, to };
}
const goal = () => {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 10);
  return {
    name: "退休",
    age: 35,
    retirementAge: 45,
    retirementDate: date.toISOString(),
    currency: "CNY",
    monthlyContribution: "1000",
    monthlyExpense: "5000",
    inflation: "0.02",
    conservative: "0.02",
    baseReturn: "0.05",
    optimistic: "0.08",
    withdrawalRate: "0.04",
  };
};
it("现金在途和到账只计一次，手续费扣减，余额精度和重复到账保护", async () => {
  const b = await book();
  const t = await b.ledger.createTransfer({
    fromId: b.a.id,
    toId: b.to.id,
    quantity: "200.00000001",
    fee: "1",
    at,
  });
  let s = await b.ledger.state();
  const p = wealthPortfolio(s);
  expect(p.net).toBe("999");
  expect(p.inTransit).toBe(1);
  expect(s.accounts.find((a) => a.id === b.a.id)?.balance).toBe("798.99999999");
  await b.ledger.completeTransfer({ id: t.id, at });
  s = await b.ledger.state();
  expect(wealthPortfolio(s).net).toBe("999");
  expect(s.accounts.find((a) => a.id === b.to.id)?.balance).toBe(
    "200.00000001",
  );
  await expect(b.ledger.completeTransfer({ id: t.id, at })).rejects.toThrow(
    "已经到账",
  );
  await b.ledger.restore(await b.ledger.backup());
  expect(await b.ledger.state()).toEqual(s);
});
it("同币种、现金余额、时间、账户关联拒绝后均不写账", async () => {
  const b = await book(),
    usd = await b.ledger.createAccount({
      name: "美元",
      platform: "验证",
      currency: "USD",
    }),
    before = await b.ledger.state();
  for (const input of [
    { toId: b.a.id },
    { toId: usd.id },
    { quantity: "1001" },
    { toId: "missing" },
    { at: "2024-01-01T00:00:00Z" },
    { at: new Date(Date.now() + 86400000).toISOString() },
  ])
    await expect(
      b.ledger.createTransfer({
        fromId: b.a.id,
        toId: b.to.id,
        quantity: "100",
        fee: "0",
        at,
        ...input,
      }),
    ).rejects.toThrow();
  expect(await b.ledger.state()).toEqual(before);
});
it("资产划转保留成本和损益，交易占用持仓不可转出", async () => {
  const b = await book(),
    a = await b.ledger.createAsset({
      code: "ST",
      name: "股票",
      assetClass: "STOCK",
      currency: "CNY",
    });
  await b.ledger.postAsset({
    accountId: b.a.id,
    assetId: a.id,
    type: "BUY",
    quantity: "3",
    price: "10",
    fee: "1",
    at,
  });
  await b.ledger.setPrice({ assetId: a.id, price: "12", at: current() });
  const before = wealthPortfolio(await b.ledger.state()).net,
    t = await b.ledger.createTransfer({
      fromId: b.a.id,
      toId: b.to.id,
      assetId: a.id,
      quantity: "1",
      fee: "1",
      at,
    });
  expect(wealthPortfolio(await b.ledger.state()).net).toBe(
    D(before).minus(1).toFixed(),
  );
  await b.ledger.completeTransfer({ id: t.id, at });
  let s = await b.ledger.state();
  expect(s.holdings.map((h) => h.realized)).toEqual(["0", "0"]);
  expect(D(s.holdings[0].cost).plus(s.holdings[1].cost).toFixed()).toBe("31");
  await validateBackup(await b.ledger.backup());
  const trade = await b.ledger.createTrade({
    accountId: b.a.id,
    assetId: a.id,
    direction: "LONG",
    openedAt: at,
  });
  await b.ledger.recordFill({
    tradeId: trade.id,
    action: "ENTRY",
    quantity: "2",
    price: "10",
    fee: "0",
    at,
  });
  s = await b.ledger.state();
  await expect(
    b.ledger.createTransfer({
      fromId: b.a.id,
      toId: b.to.id,
      assetId: a.id,
      quantity: "3",
      at,
    }),
  ).rejects.toThrow("占用");
  expect(await b.ledger.state()).toEqual(s);
});
it("转出/到账元数据写入失败事务回滚，目标流水冲突不丢在途", async () => {
  const b = await book();
  await b.sql.batch([
    {
      statement:
        "CREATE TRIGGER fail_transfer BEFORE INSERT ON InternalTransfer BEGIN SELECT RAISE(ABORT,'划转故障'); END",
      values: [],
    },
  ]);
  const before = await b.ledger.state();
  await expect(
    b.ledger.createTransfer({
      fromId: b.a.id,
      toId: b.to.id,
      quantity: "100",
      at,
    }),
  ).rejects.toThrow("故障");
  expect(await b.ledger.state()).toEqual(before);
  await b.sql.batch([{ statement: "DROP TRIGGER fail_transfer", values: [] }]);
  const t = await b.ledger.createTransfer({
    fromId: b.a.id,
    toId: b.to.id,
    quantity: "100",
    at,
  });
  await b.sql.batch([
    {
      statement:
        "CREATE TRIGGER fail_complete BEFORE UPDATE ON InternalTransfer BEGIN SELECT RAISE(ABORT,'到账故障'); END",
      values: [],
    },
  ]);
  const transit = await b.ledger.state();
  await expect(b.ledger.completeTransfer({ id: t.id, at })).rejects.toThrow(
    "故障",
  );
  expect(await b.ledger.state()).toEqual(transit);
});
it("跨币种缺失、反向汇率、过期和缺失价格不伪造完整估值", async () => {
  const b = await book("USD");
  const p = wealthPortfolio(await b.ledger.state());
  expect(p.complete).toBe(false);
  expect(p.assets).toBe("0");
  await expect(
    b.ledger.saveWealthSnapshot({ currency: "CNY" }),
  ).rejects.toThrow("估值");
  const g = await b.ledger.saveGoal(goal());
  expect(fireProjection(await b.ledger.state(), g.id)?.progress).toBeNull();
  const time = current();
  await b.ledger.setFx({ from: "CNY", to: "USD", rate: "0.125", at: time });
  let s = await b.ledger.state();
  expect(fxValue(s, "USD", "CNY", new Date()).rate).toBe("8");
  expect(wealthPortfolio(s).assets).toBe("8000");
  await expect(
    b.ledger.setFx({ from: "USD", to: "CNY", rate: "8", at: time }),
  ).rejects.toThrow("已有");
  expect(
    wealthPortfolio(s, "CNY", new Date(Date.now() + 8 * 86400000)).complete,
  ).toBe(false);
  const a = await b.ledger.createAsset({
    code: "P",
    name: "基金",
    assetClass: "FUND",
    currency: "USD",
  });
  await b.ledger.postAsset({
    accountId: b.a.id,
    assetId: a.id,
    type: "BUY",
    quantity: "1",
    price: "10",
    at,
  });
  s = await b.ledger.state();
  expect(wealthPortfolio(s).complete).toBe(false);
  await b.ledger.setPrice({ assetId: a.id, price: "10", at });
  expect(
    wealthPortfolio(await b.ledger.state()).rows.find((r) => r.name === "基金")
      ?.issue,
  ).toBe("价格过期");
  await b.ledger.setPrice({ assetId: a.id, price: "12", at: current() });
  expect(wealthPortfolio(await b.ledger.state()).assets).toBe("8016");
});
it("负债余额历史不修改现金，排除储备/房产，负可投资净资产无达标结论", async () => {
  const b = await book(),
    l = await b.ledger.createLiability({
      name: "欠款",
      currency: "CNY",
      amount: "100",
      investable: 1,
      at,
    });
  let s = await b.ledger.state();
  expect(wealthPortfolio(s).net).toBe("900");
  expect(s.accounts.find((a) => a.id === b.a.id)?.balance).toBe("1000");
  await b.ledger.updateLiability({ id: l.id, amount: "50", investable: 1, at });
  expect((await b.ledger.state()).liabilityBalances).toHaveLength(2);
  await b.ledger.configureWealth({
    kind: "ACCOUNT",
    id: b.a.id,
    investable: 0,
  });
  s = await b.ledger.state();
  expect(wealthPortfolio(s).net).toBe("950");
  expect(wealthPortfolio(s).investable).toBe("-50");
  const g = await b.ledger.saveGoal(goal());
  expect(fireProjection(await b.ledger.state(), g.id)?.complete).toBe(false);
  const home = await b.ledger.createAsset({
    code: "HOME",
    name: "房产",
    currency: "CNY",
    assetClass: "REAL_ESTATE",
  });
  await b.ledger.postAsset({
    accountId: b.to.id,
    assetId: home.id,
    type: "DEPOSIT",
    quantity: "1",
    price: "10000",
    at,
  });
  await b.ledger.setPrice({ assetId: home.id, price: "10000", at: current() });
  s = await b.ledger.state();
  expect(wealthPortfolio(s).investable).toBe("-50");
  expect(wealthPortfolio(s).net).toBe("10950");
  await b.ledger.configureWealth({ kind: "ASSET", id: home.id, investable: 1 });
  expect(wealthPortfolio(await b.ledger.state()).investable).toBe("9950");
});
it("完整快照保存固定金额，FIRE情景和月投入共享公式，目标校验", async () => {
  const b = await book(),
    g = await b.ledger.saveGoal(goal()),
    snapshot = await b.ledger.saveWealthSnapshot({ currency: "CNY" });
  const f = fireProjection(await b.ledger.state(), g.id)!;
  expect(f.complete).toBe(true);
  expect(f.scenarios).toHaveLength(3);
  expect(f.scenarios[0].retirement.points).toHaveLength(360);
  expect(D(f.target).gt("1500000")).toBe(true);
  expect(D(f.requiredMonthly!).gt("1000")).toBe(true);
  await b.ledger.post({
    accountId: b.a.id,
    type: "DEPOSIT",
    amount: "100",
    at,
  });
  expect((await b.ledger.state()).snapshots[0].assets).toBe(snapshot.assets);
  expect(wealthPortfolio(await b.ledger.state()).assets).toBe("1100");
  await expect(
    b.ledger.saveGoal({ ...goal(), conservative: "0.10" }),
  ).rejects.toThrow("递增");
  await expect(
    b.ledger.saveGoal({ ...goal(), retirementAge: 60 }),
  ).rejects.toThrow("年龄");
  const updated = await b.ledger.saveGoal({
    ...goal(),
    monthlyContribution: "2000",
  });
  expect(updated.id).toBe(g.id);
  expect((await b.ledger.state()).goals).toHaveLength(1);
  await b.ledger.restore(await b.ledger.backup());
  expect((await b.ledger.state()).snapshots[0].assets).toBe("1000");
});
it("升级v4保留旧账，旧备份补默认配置，篡改关联/余额/快照拒绝恢复", async () => {
  const b = await book();
  await b.sql.batch([
    { statement: "UPDATE OfflineSchema SET version=4", values: [] },
  ]);
  await new Ledger(b.sql).init();
  expect(
    (await b.sql.query("SELECT version FROM OfflineSchema"))[0].version,
  ).toBe(6);
  const t = await b.ledger.createTransfer({
    fromId: b.a.id,
    toId: b.to.id,
    quantity: "100",
    at,
  });
  await b.ledger.createLiability({
    name: "负债",
    currency: "CNY",
    amount: "10",
    investable: 1,
    at,
  });
  await b.ledger.saveWealthSnapshot({ currency: "CNY" });
  const original = await b.ledger.backup(),
    before = await b.ledger.state();
  for (const mutate of [
    (s: typeof before) => {
      s.transfers[0].quantity = "200";
    },
    (s: typeof before) => {
      s.liabilities[0].amount = "11";
    },
    (s: typeof before) => {
      s.snapshots[0].net = "9999";
    },
    (s: typeof before) => {
      s.accountConfig = [{ accountId: "missing", investable: 1 }];
    },
  ]) {
    const f = structuredClone(original);
    mutate(f.payload);
    f.checksum = await digest(f.payload);
    await expect(b.ledger.restore(f)).rejects.toThrow("备份");
    expect(await b.ledger.state()).toEqual(before);
  }
  await b.ledger.completeTransfer({ id: t.id, at });
  const payload = await (await book()).ledger.backup();
  const raw = {
    kind: payload.kind,
    version: 4,
    payload: payload.payload,
    checksum: await digest(payload.payload),
  };
  await b.ledger.restore(raw);
  expect((await b.ledger.state()).transfers).toHaveLength(0);
  expect(wealthPortfolio(await b.ledger.state()).assets).toBe("1000");
});
