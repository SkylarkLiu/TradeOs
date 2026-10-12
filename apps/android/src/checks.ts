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
      ...[
        "ReviewImprovement",
        "TradeReview",
        "ReviewSettings",
        "PositionEvent",
        "TradeFill",
        "Trade",
        "TradingPlan",
        "StrategyVersion",
        "Strategy",
        "AssetLedger",
        "AssetHolding",
        "AssetPrice",
        "Asset",
      ].map((table) => ({ statement: `DELETE FROM ${table}`, values: [] })),
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
    const legacyPayload = {
      createdAt: new Date().toISOString(),
      accounts: s.accounts,
      entries: s.entries,
    };
    const legacy = {
      kind: "tradeos-android-prototype",
      version: 1,
      payload: legacyPayload,
      checksum: await digest(legacyPayload),
    };
    const asset = await ledger.createAsset({
      code: "VERIFY",
      name: "独立股票检查",
      currency: "CNY",
      assetClass: "STOCK",
    });
    await ledger.postAsset({
      accountId: a.id,
      assetId: asset.id,
      type: "BUY",
      quantity: "2",
      price: "10",
      fee: "1",
      at: "2020-01-03T00:00:00Z",
    });
    await ledger.postAsset({
      accountId: a.id,
      assetId: asset.id,
      type: "SELL",
      quantity: "1",
      price: "15",
      fee: "1",
      at: "2020-01-04T00:00:00Z",
    });
    const current = await ledger.state();
    check(
      current.holdings[0].quantity === "1" &&
        current.holdings[0].cost === "10.5" &&
        current.holdings[0].realized === "3.5",
      "现货买卖、成本和损益一致",
    );
    const assetBackup = await ledger.backup();
    await ledger.restore(assetBackup);
    check((await ledger.state()).assetEntries.length === 2, "资产完整备份恢复");
    await ledger.restore(legacy);
    const upgraded = await ledger.state();
    check(
      upgraded.accounts[0].balance === s.accounts[0].balance &&
        !upgraded.assetEntries.length &&
        !upgraded.assets.length,
      "旧版备份兼容升级",
    );
    const v = await ledger.createStrategy({
      name: "隔离策略",
      market: "现货",
      timeframe: "日线",
      environment: "验证环境",
      rules:
        "价格突破后入场，回落到止损价退出，到达目标后止盈，所有成交必须记录。",
    });
    await ledger.publishVersion({ id: v.id });
    const tradedAsset = await ledger.createAsset({
      code: "CHECKTRADE",
      name: "隔离交易",
      assetClass: "STOCK",
      currency: "CNY",
    });
    const plan = await ledger.createPlan({
      accountId: a.id,
      assetId: tradedAsset.id,
      strategyVersionId: v.id,
      direction: "LONG",
      entry: "10",
      stop: "5",
      target: "15",
      equity: "1000",
      riskPercent: "1",
      reason: "隔离验证",
      invalidation: "跌破止损",
    });
    const trade = await ledger.createTrade({
      accountId: a.id,
      assetId: tradedAsset.id,
      planId: plan.id,
      direction: "LONG",
      openedAt: "2020-01-03T00:00:00Z",
    });
    await ledger.recordFill({
      tradeId: trade.id,
      action: "ENTRY",
      quantity: "2",
      price: "10",
      fee: "1",
      at: "2020-01-03T00:00:00Z",
    });
    let protectedHolding = false;
    try {
      await ledger.postAsset({
        accountId: a.id,
        assetId: tradedAsset.id,
        type: "SELL",
        quantity: "1",
        price: "15",
        at: "2020-01-04T00:00:00Z",
      });
    } catch {
      protectedHolding = true;
    }
    check(
      protectedHolding && (await ledger.state()).fills.length === 1,
      "交易成交与占用持仓保护",
    );
    await ledger.recordFill({
      tradeId: trade.id,
      action: "EXIT",
      quantity: "2",
      price: "15",
      fee: "1",
      at: "2020-01-04T00:00:00Z",
    });
    await ledger.restore(await ledger.backup());
    const closed = (await ledger.state()).trades[0];
    check(
      closed.status === "CLOSED" &&
        closed.realized === "8" &&
        closed.initialRisk === "10",
      "策略交易备份重算恢复",
    );
    const grade = await ledger.saveReview({
      tradeId: trade.id,
      period: "TRADE",
      at: "2020-01-05T00:00:00Z",
      scores: Object.fromEntries(
        (await ledger.state()).scoreRules.map((r) => [r.name, r.max]),
      ),
      tags: ["隔离"],
      content: "本次按计划完成交易，下一次入场前再次检查风险和止损。",
      lessons: "核对风险",
      nextAction: "入场前复核止损与仓位",
    });
    check((await ledger.state()).reviews.length === 1, "复盘及评分快照保存");
    await ledger.improveStrategy({
      reviewId: grade.id,
      market: "现货",
      timeframe: "日线",
      environment: "验证环境",
      rules:
        "价格突破后入场，回落到止损价退出，到达目标后止盈，新增入场前复核风险预算。",
    });
    await ledger.restore(await ledger.backup());
    check(
      (await ledger.state()).improvements.length === 1 &&
        (await ledger.state()).versions.length === 2,
      "策略改进及完整备份恢复",
    );
    return checks;
  } finally {
    await db.close();
  }
}
