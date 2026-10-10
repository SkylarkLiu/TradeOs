import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { Ledger, digest } from "../src/ledger";
import type { Sql } from "../src/sql";
import { D, projectWealth } from "@tradeos/core";
import { portfolioGroups } from "../src/assets";
function setup() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const sql: Sql = {
    query: async (s, p = []) =>
      db.prepare(s).all(...p) as Record<string, unknown>[],
    batch: async (set) =>
      db.transaction(() => {
        for (const s of set) db.prepare(s.statement).run(...s.values);
      })(),
    close: async () => {
      db.close();
    },
  };
  return { ledger: new Ledger(sql), sql };
}
describe("安卓独立账本业务", () => {
  it("高精度存入取出和费用一致，余额不足整笔拒绝", async () => {
    const { ledger } = setup();
    await ledger.init();
    const a = await ledger.createAccount({
      platform: "银行",
      name: "现金",
      currency: "CNY",
    });
    await ledger.post({
      accountId: a.id,
      type: "DEPOSIT",
      amount: "100000000000000000.00000001",
      fee: "0",
      at: "2025-01-01T00:00:00Z",
    });
    await ledger.post({
      accountId: a.id,
      type: "ADJUSTMENT",
      amount: "0.00000002",
      at: "2025-01-02T00:00:00Z",
    });
    expect((await ledger.state()).accounts[0].balance).toBe(
      "100000000000000000.00000003",
    );
    await expect(
      ledger.post({
        accountId: a.id,
        type: "WITHDRAWAL",
        amount: "200000000000000000",
        at: "2025-01-03T00:00:00Z",
      }),
    ).rejects.toThrow("余额");
    expect((await ledger.state()).entries).toHaveLength(2);
  });
  it("交易时间倒序和未来拒绝，同一分钟保留顺序", async () => {
    const { ledger } = setup();
    await ledger.init();
    const a = await ledger.createAccount({
      platform: "银行",
      name: "现金",
      currency: "CNY",
    });
    for (const amount of ["100", "20"])
      await ledger.post({
        accountId: a.id,
        type: "DEPOSIT",
        amount,
        at: "2025-01-02T00:00:00Z",
      });
    await expect(
      ledger.post({
        accountId: a.id,
        type: "DEPOSIT",
        amount: "1",
        at: "2025-01-01T00:00:00Z",
      }),
    ).rejects.toThrow("早于");
    await expect(
      ledger.post({
        accountId: a.id,
        type: "DEPOSIT",
        amount: "1",
        at: new Date(Date.now() + 86400000).toISOString(),
      }),
    ).rejects.toThrow("未来");
    expect((await ledger.state()).accounts[0].sequence).toBe(2);
  });
  it("并发写入串行提交，不丢失余额", async () => {
    const { ledger } = setup();
    await ledger.init();
    const a = await ledger.createAccount({
      platform: "银行",
      name: "并发",
      currency: "CNY",
    });
    await Promise.all(
      Array.from({ length: 20 }, () =>
        ledger.post({
          accountId: a.id,
          type: "DEPOSIT",
          amount: "0.1",
          at: "2025-01-01T00:00:00Z",
        }),
      ),
    );
    expect((await ledger.state()).accounts[0].balance).toBe("2");
    expect((await ledger.state()).entries).toHaveLength(20);
  });
  it("SQLite批量写入发生唯一约束错误时回滚", async () => {
    const { ledger, sql } = setup();
    await ledger.init();
    const a = await ledger.createAccount({
      platform: "银行",
      name: "事务",
      currency: "CNY",
    });
    await ledger.post({
      accountId: a.id,
      type: "DEPOSIT",
      amount: "100",
      at: "2025-01-01T00:00:00Z",
    });
    await expect(
      sql.batch([
        {
          statement: "UPDATE FinancialAccount SET balance=? WHERE id=?",
          values: ["0", a.id],
        },
        {
          statement: "INSERT INTO CashLedger SELECT * FROM CashLedger",
          values: [],
        },
      ]),
    ).rejects.toThrow();
    expect((await ledger.state()).accounts[0].balance).toBe("100");
  });
  it("完整备份恢复，坏校验和及错误余额拒绝且原账本不变", async () => {
    const { ledger } = setup();
    await ledger.init();
    const a = await ledger.createAccount({
      platform: "银行",
      name: "备份",
      currency: "CNY",
    });
    await ledger.post({
      accountId: a.id,
      type: "DEPOSIT",
      amount: "100",
      fee: "1",
      at: "2025-01-01T00:00:00Z",
    });
    const file = await ledger.backup();
    const bad = structuredClone(file);
    bad.payload.accounts[0].balance = "1";
    await expect(ledger.restore(bad)).rejects.toThrow("校验和");
    bad.checksum = await digest(bad.payload);
    await expect(ledger.restore(bad)).rejects.toThrow("余额");
    await ledger.restore(file);
    expect((await ledger.state()).accounts[0].balance).toBe("99");
  });
  it("金额校验不泄露解析异常，预测使用共享Decimal引擎", async () => {
    const { ledger } = setup();
    await ledger.init();
    const a = await ledger.createAccount({
      platform: "银行",
      name: "校验",
      currency: "CNY",
    });
    await expect(
      ledger.post({
        accountId: a.id,
        type: "DEPOSIT",
        amount: "bad",
        at: "2025-01-01T00:00:00Z",
      }),
    ).rejects.toThrow("十进制");
    expect(projectWealth("100", "10", "0", "0", 12).at(-1)?.nominal).toBe(
      "220",
    );
    expect(D("0.1").plus(".2").toFixed()).toBe("0.3");
  });
});

describe("资产账本与升级", () => {
  it("无损升级旧SQLite结构且拒绝未来数据库版本", async () => {
    const { sql, ledger } = setup();
    await sql.batch([
      {
        statement:
          "CREATE TABLE FinancialAccount(id TEXT PRIMARY KEY,name TEXT NOT NULL,platform TEXT NOT NULL,currency TEXT NOT NULL,balance TEXT NOT NULL DEFAULT '0',sequence INTEGER NOT NULL DEFAULT 0,UNIQUE(platform,name,currency))",
        values: [],
      },
      {
        statement:
          "CREATE TABLE CashLedger(id TEXT PRIMARY KEY,accountId TEXT NOT NULL REFERENCES FinancialAccount(id),type TEXT NOT NULL,amount TEXT NOT NULL,fee TEXT NOT NULL,delta TEXT NOT NULL,at TEXT NOT NULL,sequence INTEGER NOT NULL,note TEXT NOT NULL,UNIQUE(accountId,sequence))",
        values: [],
      },
      {
        statement:
          "INSERT INTO FinancialAccount VALUES('old','旧现金','银行','CNY','1000.00000001',1)",
        values: [],
      },
      {
        statement:
          "INSERT INTO CashLedger VALUES('oldentry','old','DEPOSIT','1000.00000001','0','1000.00000001','2025-01-01T00:00:00.000Z',1,'')",
        values: [],
      },
    ]);
    await ledger.init();
    await ledger.init();
    expect((await ledger.state()).accounts[0].balance).toBe("1000.00000001");
    expect((await ledger.state()).entries[0].id).toBe("oldentry");
    await sql.batch([
      { statement: "UPDATE OfflineSchema SET version=99", values: [] },
    ]);
    await expect(ledger.init()).rejects.toThrow("更新版本");
    expect((await ledger.state()).accounts[0].balance).toBe("1000.00000001");
  });
  it("买卖与费用仅入账一次，混合流水顺序、超卖和不足现金整笔拒绝", async () => {
    const { ledger } = setup();
    await ledger.init();
    const account = await ledger.createAccount({
      platform: "券商",
      name: "现货",
      currency: "CNY",
    });
    await ledger.post({
      accountId: account.id,
      type: "DEPOSIT",
      amount: "1000",
      at: "2025-01-01T00:00:00Z",
    });
    const asset = await ledger.createAsset({
      code: "TEST",
      name: "虚拟股票",
      assetClass: "STOCK",
      currency: "CNY",
    });
    const input = {
      accountId: account.id,
      assetId: asset.id,
      type: "BUY",
      quantity: "10",
      price: "10",
      fee: "1",
      at: "2025-01-02T00:00:00Z",
    };
    await ledger.postAsset(input);
    expect((await ledger.state()).accounts[0].balance).toBe("899");
    await ledger.postAsset({
      ...input,
      type: "SELL",
      quantity: "4",
      price: "15",
      fee: "2",
      at: "2025-01-03T00:00:00Z",
    });
    const state = await ledger.state();
    expect(state.accounts[0].balance).toBe("957");
    expect(state.holdings[0]).toMatchObject({
      quantity: "6",
      cost: "60.6",
      realized: "17.6",
    });
    expect(state.accounts[0].sequence).toBe(3);
    await expect(
      ledger.postAsset({
        ...input,
        type: "SELL",
        quantity: "7",
        at: "2025-01-04T00:00:00Z",
      }),
    ).rejects.toThrow("持仓不足");
    await expect(
      ledger.postAsset({
        ...input,
        quantity: "1000",
        at: "2025-01-04T00:00:00Z",
      }),
    ).rejects.toThrow("现金余额不足");
    await expect(
      ledger.post({
        accountId: account.id,
        type: "DEPOSIT",
        amount: "1",
        at: "2025-01-02T00:00:00Z",
      }),
    ).rejects.toThrow("早于");
    expect(await ledger.state()).toEqual(state);
    await ledger.restore(await ledger.backup());
    expect(await ledger.state()).toEqual(state);
  });
  it("资产事务中途SQLite约束失败保留全部数据", async () => {
    const { ledger, sql } = setup();
    await ledger.init();
    const a = await ledger.createAccount({
      platform: "券商",
      name: "回滚",
      currency: "CNY",
    });
    const asset = await ledger.createAsset({
      code: "ROLLBACK",
      name: "回滚资产",
      assetClass: "STOCK",
      currency: "CNY",
    });
    await ledger.post({
      accountId: a.id,
      type: "DEPOSIT",
      amount: "100",
      at: "2025-01-01T00:00:00Z",
    });
    const before = await ledger.state();
    await sql.batch([
      {
        statement:
          "CREATE TRIGGER reject_asset BEFORE INSERT ON AssetLedger BEGIN SELECT RAISE(ABORT,'故障注入'); END",
        values: [],
      },
    ]);
    await expect(
      ledger.postAsset({
        accountId: a.id,
        assetId: asset.id,
        type: "BUY",
        quantity: "1",
        price: "10",
        at: "2025-01-02T00:00:00Z",
      }),
    ).rejects.toThrow("故障注入");
    expect(await ledger.state()).toEqual(before);
  });
  it("旧备份可升级，重算持仓拒绝篡改与缺失记录", async () => {
    const { ledger } = setup();
    await ledger.init();
    const a = await ledger.createAccount({
      platform: "券商",
      name: "旧备份",
      currency: "CNY",
    });
    await ledger.post({
      accountId: a.id,
      type: "DEPOSIT",
      amount: "100",
      at: "2025-01-01T00:00:00Z",
    });
    const saved = await ledger.backup();
    const payload = {
      createdAt: saved.payload.createdAt,
      accounts: saved.payload.accounts,
      entries: saved.payload.entries,
    };
    const v1 = {
      kind: saved.kind,
      version: 1,
      payload,
      checksum: await digest(payload),
    };
    const asset = await ledger.createAsset({
      code: "V2",
      name: "新持仓",
      assetClass: "FUND",
      currency: "CNY",
    });
    await ledger.postAsset({
      accountId: a.id,
      assetId: asset.id,
      type: "DEPOSIT",
      quantity: "1.00000001",
      price: "10",
      at: "2025-01-02T00:00:00Z",
    });
    const v2 = await ledger.backup();
    const bad = structuredClone(v2);
    bad.payload.holdings[0].cost = "1";
    bad.checksum = await digest(bad.payload);
    await expect(ledger.restore(bad)).rejects.toThrow("持仓");
    bad.payload.holdings = [];
    bad.checksum = await digest(bad.payload);
    await expect(ledger.restore(bad)).rejects.toThrow("缺少持仓");
    expect((await ledger.state()).holdings[0].quantity).toBe("1.00000001");
    await ledger.restore(v1);
    expect((await ledger.state()).accounts[0].balance).toBe("100");
    expect((await ledger.state()).assets).toHaveLength(0);
  });
});

it("结算币种不混用，缺报价不虚构市值，未来报价拒绝", async () => {
  const { ledger } = setup();
  await ledger.init();
  const a = await ledger.createAccount({
    platform: "国际券商",
    name: "美元",
    currency: "USD",
  });
  await ledger.post({
    accountId: a.id,
    type: "DEPOSIT",
    amount: "100",
    at: "2025-01-01T00:00:00Z",
  });
  const usd = await ledger.createAsset({
    code: "USDTEST",
    name: "美元现货",
    assetClass: "STOCK",
    currency: "USD",
  });
  const cny = await ledger.createAsset({
    code: "CNYTEST",
    name: "人民币现货",
    assetClass: "STOCK",
    currency: "CNY",
  });
  const input = {
    accountId: a.id,
    assetId: usd.id,
    type: "DEPOSIT",
    quantity: "1",
    price: "10",
    at: "2025-01-02T00:00:00Z",
  };
  await expect(ledger.postAsset({ ...input, assetId: cny.id })).rejects.toThrow(
    "币种",
  );
  await ledger.postAsset(input);
  let state = await ledger.state();
  expect(portfolioGroups(state.accounts, state)).toEqual([
    { currency: "USD", value: "100", missing: 1 },
  ]);
  await expect(
    ledger.setPrice({
      assetId: usd.id,
      price: "20",
      at: new Date(Date.now() + 86400000).toISOString(),
    }),
  ).rejects.toThrow("未来");
  await ledger.setPrice({
    assetId: usd.id,
    price: "20",
    at: "2025-01-03T00:00:00Z",
  });
  state = await ledger.state();
  expect(portfolioGroups(state.accounts, state)).toEqual([
    { currency: "USD", value: "120", missing: 0 },
  ]);
});
