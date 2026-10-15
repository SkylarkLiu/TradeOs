import { afterEach, expect, it, vi } from "vitest";
import { db } from "@/lib/repositories/db";
import { wealthCommand } from "@/lib/services/wealth";
import {
  dailySnapshotTick,
  snapshotScheduleStatus,
} from "@/lib/services/snapshots";
import { dayBounds } from "@/lib/schedule";

let accountId = "",
  platformId = "",
  assetId = "";
afterEach(async () => {
  const snapshots = await db.portfolioSnapshot.findMany({
    where: {
      at: {
        gte: new Date("2010-01-01T00:00:00+08:00"),
        lt: new Date("2010-01-05T00:00:00+08:00"),
      },
    },
  });
  await db.assetAllocationSnapshot.deleteMany({
    where: { snapshotId: { in: snapshots.map((s) => s.id) } },
  });
  await db.portfolioSnapshot.deleteMany({
    where: { id: { in: snapshots.map((s) => s.id) } },
  });
  await db.systemSetting.deleteMany({ where: { key: "snapshot.daily" } });
  if (accountId) {
    await db.accountCashFlow.deleteMany({ where: { accountId } });
    await db.assetTransaction.deleteMany({ where: { accountId } });
    await db.assetBalance.deleteMany({ where: { accountId } });
    await db.account.delete({ where: { id: accountId } });
    await db.platform.delete({ where: { id: platformId } });
  }
  if (assetId) {
    await db.assetPrice.deleteMany({ where: { assetId } });
    await db.asset.delete({ where: { id: assetId } });
  }
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("08点保存、同日覆盖和配置持久去重；不完整估值保留旧值并重试，跨北京时间日期保留历史", async () => {
  if (!process.env.DATABASE_URL?.includes("/unit"))
    throw new Error("必须使用测试账本");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2010-01-01T07:00:00+08:00"));
  vi.stubEnv("SNAPSHOT_AUTO_SAVE", "true");
  const platform = await wealthCommand("platform.create", {
    name: `快照测试-${crypto.randomUUID()}`,
  });
  const account = await wealthCommand("account.create", {
    platformId: platform.id,
    name: "快照账户",
    currency: "CNY",
  });
  accountId = account.id;
  platformId = platform.id;
  let cash = await db.asset.findUnique({ where: { code: "CASH:CNY" } });
  if (!cash)
    cash = await db.asset.create({
      data: {
        code: "CASH:CNY",
        name: "现金",
        currency: "CNY",
        assetClass: "CASH",
      },
    });
  await wealthCommand("transaction.create", {
    accountId: account.id,
    assetId: cash.id,
    type: "DEPOSIT",
    quantity: "100",
    at: new Date().toISOString(),
  });
  const today = () =>
    db.portfolioSnapshot.findMany({
      where: { currency: "CNY", at: dayBounds(new Date()) },
      include: { allocations: true },
    });
  await dailySnapshotTick();
  expect(await today()).toHaveLength(0);
  vi.setSystemTime(new Date("2010-01-01T08:00:00+08:00"));
  await dailySnapshotTick();
  const first = (await today())[0];
  expect(first.assets).toBe("100");
  await dailySnapshotTick();
  expect(await today()).toHaveLength(1);
  vi.setSystemTime(new Date("2010-01-01T09:00:00+08:00"));
  await wealthCommand("transaction.create", {
    accountId: account.id,
    assetId: cash.id,
    type: "DEPOSIT",
    quantity: "20",
    at: new Date().toISOString(),
  });
  // Simulate an old backup with multiple intraday snapshots and allocations.
  await db.portfolioSnapshot.create({
    data: {
      currency: "CNY",
      at: new Date("2010-01-01T07:30:00+08:00"),
      assets: "90",
      net: "90",
      liabilities: "0",
      investable: "90",
      complete: true,
      allocations: { create: { assetClass: "CASH", value: "90" } },
    },
  });
  await wealthCommand("snapshot.create", { currency: "CNY" });
  expect(await today()).toHaveLength(1);
  expect((await today())[0]).toMatchObject({
    id: first.id,
    assets: "120",
    net: "120",
    allocations: [expect.objectContaining({ value: "120" })],
  });
  await dailySnapshotTick();
  expect((await today())[0].at.toISOString()).toBe(new Date().toISOString());
  vi.setSystemTime(new Date("2010-01-02T08:00:00+08:00"));
  await dailySnapshotTick();
  expect(await today()).toHaveLength(1);
  expect(
    await db.portfolioSnapshot.findUnique({ where: { id: first.id } }),
  ).not.toBeNull();
  vi.setSystemTime(new Date("2010-01-03T06:00:00+08:00"));
  const safe = await wealthCommand("snapshot.create", { currency: "CNY" });
  const asset = await wealthCommand("asset.create", {
    code: `SNAPSHOT:${crypto.randomUUID()}`,
    name: "缺失净值",
    assetClass: "MUTUAL_FUND",
    currency: "CNY",
  });
  assetId = asset.id;
  vi.setSystemTime(new Date("2010-01-03T07:00:00+08:00"));
  await wealthCommand("transaction.create", {
    accountId: account.id,
    assetId: asset.id,
    type: "DEPOSIT",
    quantity: "1",
    price: "2",
    at: new Date().toISOString(),
  });
  vi.setSystemTime(new Date("2010-01-03T08:00:00+08:00"));
  await dailySnapshotTick();
  expect((await snapshotScheduleStatus()).last).toMatchObject({
    complete: false,
    error: expect.stringContaining("缺失或过期"),
  });
  expect((await today())[0]).toMatchObject({ id: safe.id, assets: "120" });
  await wealthCommand("price.create", {
    assetId: asset.id,
    price: "2",
    at: new Date().toISOString(),
  });
  vi.setSystemTime(new Date("2010-01-03T08:29:00+08:00"));
  await dailySnapshotTick();
  expect((await today())[0].assets).toBe("120");
  vi.setSystemTime(new Date("2010-01-03T08:30:00+08:00"));
  await dailySnapshotTick();
  expect((await today())[0]).toMatchObject({ id: safe.id, assets: "122" });
  expect((await snapshotScheduleStatus()).last?.complete).toBe(true);
  vi.setSystemTime(new Date("2010-01-03T16:00:00Z")); // Shanghai next day.
  await dailySnapshotTick();
  expect(await today()).toHaveLength(0);
  await wealthCommand("snapshot.create", { currency: "CNY" });
  expect(await today()).toHaveLength(1);
  expect(
    await db.portfolioSnapshot.findUnique({ where: { id: safe.id } }),
  ).not.toBeNull();
});
