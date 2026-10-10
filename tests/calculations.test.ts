import { describe, it, expect } from "vitest";
import {
  D,
  canonical,
  positionSize,
  contractPnl,
  maxDrawdown,
  tradeMetrics,
  twr,
  xirr,
  projectWealth,
  requiredContribution,
} from "@/lib/calculations/decimal";
describe("金融计算", () => {
  it("保留极小金额与大额小数", () => {
    expect(canonical(D("100000000000000000.00000001").plus("0.00000002"))).toBe(
      "100000000000000000.00000003",
    );
    expect(canonical(D("0.1").plus("0.2"))).toBe("0.3");
  });
  it("按止损计算现货及反向合约仓位", () => {
    expect(
      positionSize({
        instrument: "SPOT",
        direction: "LONG",
        entry: "100",
        stop: "90",
        equity: "10000",
        riskPercent: "1",
      }).quantity,
    ).toBe("10");
    expect(
      contractPnl("INVERSE", "LONG", "100", "10000", "20000").toFixed(),
    ).toBe("0.005");
    expect(() =>
      positionSize({
        instrument: "SPOT",
        direction: "LONG",
        entry: "100",
        stop: "110",
        equity: "10000",
        riskPercent: "1",
      }),
    ).toThrow();
  });
  it("指标处理零亏损及缺失风险", () => {
    const m = tradeMetrics([
      {
        realized: "100",
        initialRisk: "0",
        openedAt: "2026-01-01",
        closedAt: "2026-01-02",
      },
    ]);
    expect(m.profitFactor).toBeNull();
    expect(m.averageR).toBeNull();
    expect(m.winRate).toBe("1");
  });
  it("回撤及剔除期末现金流的TWR", () => {
    expect(maxDrawdown(["100", "120", "90", "130"])).toBe("0.25");
    expect(twr([{ begin: "100", end: "160", flowAtEnd: "50" }])).toBe("0.1");
    expect(twr([])).toBeNull();
  });
  it("XIRR真实日期与输入不足", () => {
    const r = xirr([
      { amount: "-100", at: "2025-01-01" },
      { amount: "110", at: "2026-01-01" },
    ]);
    expect(D(r.value!).minus("0.1").abs().lt("0.00000001")).toBe(true);
    expect(xirr([{ amount: "1", at: "2026-01-01" }]).value).toBeNull();
  });
  it("零收益FIRE与投入缺口", () => {
    expect(projectWealth("100", "10", "0", "0", 12).at(-1)?.nominal).toBe(
      "220",
    );
    expect(requiredContribution("100", "220", "0", 12)).toBe("10");
  });
});

import { decimal } from "@/lib/validation/common";
import { compareValues } from "@/lib/utils";
it("非法金额返回校验报告，不抛Decimal解析异常", () => {
  for (const value of [
    "abc",
    "'\u002d20.01",
    "1e4",
    "1,000",
    "",
    "Infinity",
    "=1+1",
  ])
    expect(decimal.safeParse(value).success).toBe(false);
});
it("金额排序保留符号、小数和超出Number精度的差异", () => {
  const values = [
    "0.9",
    "-2",
    "0.12",
    "-10",
    "100000000000000000.00000002",
    "100000000000000000.00000001",
  ];
  expect([...values].sort(compareValues)).toEqual([
    "-10",
    "-2",
    "0.12",
    "0.9",
    "100000000000000000.00000001",
    "100000000000000000.00000002",
  ]);
});
