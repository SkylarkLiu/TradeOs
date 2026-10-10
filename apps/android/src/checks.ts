import { Ledger, digest } from "./ledger";
import { Capacitor } from "@capacitor/core";
import { nativeSql, browserSql } from "./sql";
export async function runChecks() {
  const open = () =>
    Capacitor.isNativePlatform()
      ? nativeSql("tradeos_isolated_checks")
      : browserSql("tradeos_isolated_checks");
  let db = await open();
  let ledger = new Ledger(db);
  const checks: string[] = [];
  const check = (condition: boolean, label: string) => {
    if (!condition) throw new Error(`检查未通过：${label}`);
    checks.push(label);
  };
  try {
    await ledger.init();
    await db.batch([
      { statement: "DELETE FROM CashLedger", values: [] },
      { statement: "DELETE FROM FinancialAccount", values: [] },
    ]);
    const a = await ledger.createAccount({
      name: "精度检查",
      platform: "独立验证账户",
      currency: "CNY",
    });
    await ledger.post({
      accountId: a.id,
      type: "DEPOSIT",
      amount: "100000000000000000.00000001",
      at: "2020-01-01T00:00:00Z",
    });
    await ledger.post({
      accountId: a.id,
      type: "ADJUSTMENT",
      amount: "0.00000002",
      at: "2020-01-02T00:00:00Z",
    });
    let s = await ledger.state();
    check(
      s.accounts[0].balance === "100000000000000000.00000003",
      "大额与极小小数精度",
    );
    try {
      await ledger.post({
        accountId: a.id,
        type: "WITHDRAWAL",
        amount: "200000000000000000",
        at: "2020-01-03T00:00:00Z",
      });
    } catch {
      /* Expected insufficient balance. */
    }
    check(
      (await ledger.state()).entries.length === 2,
      "余额不足拒绝且不增加流水",
    );
    try {
      await db.batch([
        {
          statement: "UPDATE FinancialAccount SET balance=? WHERE id=?",
          values: ["0", a.id],
        },
        {
          statement: "INSERT INTO CashLedger SELECT * FROM CashLedger LIMIT 1",
          values: [],
        },
      ]);
    } catch {
      /* Duplicate primary key must roll back the UPDATE. */
    }
    check(
      (await ledger.state()).accounts[0].balance === s.accounts[0].balance,
      "多语句事务失败回滚",
    );
    const file = await ledger.backup();
    await ledger.restore(file);
    check(
      (await ledger.state()).accounts[0].balance === s.accounts[0].balance,
      "完整JSON恢复",
    );
    const bad = structuredClone(file);
    bad.payload.accounts[0].balance = "1";
    bad.checksum = await digest(bad.payload);
    let rejected = false;
    try {
      await ledger.restore(bad);
    } catch {
      rejected = true;
    }
    check(
      rejected &&
        (await ledger.state()).accounts[0].balance === s.accounts[0].balance,
      "不一致备份拒绝且保留原数据",
    );
    await db.close();
    db = await open();
    ledger = new Ledger(db);
    await ledger.init();
    s = await ledger.state();
    check(
      s.accounts[0].balance === "100000000000000000.00000003",
      "关闭连接后重新打开仍保留数据",
    );
    return checks;
  } finally {
    await db.close();
  }
}
