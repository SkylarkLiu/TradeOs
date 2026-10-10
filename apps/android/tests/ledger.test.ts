import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { Ledger, digest } from "../src/ledger";
import type { Sql } from "../src/sql";
import { D, projectWealth } from "@tradeos/core";
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
