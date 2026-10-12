import { z } from "zod";
import { D, canonical, sum } from "@tradeos/core";
import {
  goalSchema,
  validateFireGoal,
  calculateFire,
} from "@tradeos/core/fire";
import {
  id,
  text,
  currency,
  positive,
  nonnegative,
  decimal,
  date,
} from "@tradeos/core/validation";
import { insertRow, type AssetEntry } from "./assets";
import type { Sql, Statement } from "./sql";
import type { State, Entry } from "./ledger";
const iso = date.transform((d) => d.toISOString()),
  flag = z.number().int().min(0).max(1);
export const fxSchema = z.object({
  id,
  from: currency,
  to: currency,
  rate: positive,
  at: iso,
});
export const liabilitySchema = z.object({
  id,
  name: text,
  currency,
  amount: nonnegative,
  investable: flag,
  at: iso,
});
export const liabilityBalanceSchema = z.object({
  id,
  liabilityId: id,
  amount: nonnegative,
  at: iso,
  sequence: z.number().int().positive(),
});
export const transferSchema = z.object({
  id,
  fromId: id,
  toId: id,
  assetId: id.nullable(),
  currency,
  quantity: positive,
  fee: nonnegative,
  price: positive,
  cost: nonnegative,
  at: iso,
  status: z.enum(["IN_TRANSIT", "COMPLETED"]),
  completedAt: iso.nullable(),
  sourceEntryId: id,
  destinationEntryId: id.nullable(),
});
export const storedGoalSchema = goalSchema
  .omit({ retirementDate: true, target: true })
  .extend({
    id,
    retirementDate: iso,
    target: positive.nullable(),
    savedAt: iso,
  });
const allocationSchema = z
  .array(z.object({ name: text, value: nonnegative }))
  .max(20);
export const snapshotSchema = z.object({
  id,
  currency,
  at: iso,
  assets: nonnegative,
  liabilities: nonnegative,
  net: decimal,
  investableAssets: nonnegative,
  investableDebt: nonnegative,
  investable: decimal,
  allocation: z
    .string()
    .max(100000)
    .refine((s) => {
      try {
        allocationSchema.parse(JSON.parse(s));
        return true;
      } catch {
        return false;
      }
    }, "资产配置快照无效"),
});
export const wealthStateSchema = z.object({
  fxRates: z.array(fxSchema).max(100000),
  liabilities: z.array(liabilitySchema).max(10000),
  liabilityBalances: z.array(liabilityBalanceSchema).max(100000),
  transfers: z.array(transferSchema).max(100000),
  accountConfig: z
    .array(z.object({ accountId: id, investable: flag }))
    .max(1000),
  assetConfig: z.array(z.object({ assetId: id, investable: flag })).max(10000),
  goals: z.array(storedGoalSchema).max(1000),
  snapshots: z.array(snapshotSchema).max(100000),
  valuationMaxDays: z.number().int().min(1).max(3650),
});
export type WealthState = z.infer<typeof wealthStateSchema>;
export const emptyWealth = (): WealthState => ({
  fxRates: [],
  liabilities: [],
  liabilityBalances: [],
  transfers: [],
  accountConfig: [],
  assetConfig: [],
  goals: [],
  snapshots: [],
  valuationMaxDays: 7,
});
export const wealthTables = [
  "CREATE TABLE IF NOT EXISTS WealthSettings(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS WealthAccountConfig(accountId TEXT PRIMARY KEY REFERENCES FinancialAccount(id),investable INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS WealthAssetConfig(assetId TEXT PRIMARY KEY REFERENCES Asset(id),investable INTEGER NOT NULL)",
  'CREATE TABLE IF NOT EXISTS FXRate(id TEXT PRIMARY KEY,"from" TEXT NOT NULL,"to" TEXT NOT NULL,rate TEXT NOT NULL,at TEXT NOT NULL,UNIQUE("from","to",at))',
  "CREATE TABLE IF NOT EXISTS Liability(id TEXT PRIMARY KEY,name TEXT NOT NULL,currency TEXT NOT NULL,amount TEXT NOT NULL,investable INTEGER NOT NULL,at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS LiabilityBalance(id TEXT PRIMARY KEY,liabilityId TEXT NOT NULL REFERENCES Liability(id),amount TEXT NOT NULL,at TEXT NOT NULL,sequence INTEGER NOT NULL,UNIQUE(liabilityId,sequence))",
  "CREATE TABLE IF NOT EXISTS InternalTransfer(id TEXT PRIMARY KEY,fromId TEXT NOT NULL REFERENCES FinancialAccount(id),toId TEXT NOT NULL REFERENCES FinancialAccount(id),assetId TEXT REFERENCES Asset(id),currency TEXT NOT NULL,quantity TEXT NOT NULL,fee TEXT NOT NULL,price TEXT NOT NULL,cost TEXT NOT NULL,at TEXT NOT NULL,status TEXT NOT NULL,completedAt TEXT,sourceEntryId TEXT NOT NULL UNIQUE,destinationEntryId TEXT UNIQUE)",
  "CREATE TABLE IF NOT EXISTS FinancialGoal(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,age INTEGER NOT NULL,retirementAge INTEGER NOT NULL,retirementDate TEXT NOT NULL,monthlyContribution TEXT NOT NULL,monthlyExpense TEXT NOT NULL,inflation TEXT NOT NULL,conservative TEXT NOT NULL,baseReturn TEXT NOT NULL,optimistic TEXT NOT NULL,withdrawalRate TEXT NOT NULL,target TEXT,currency TEXT NOT NULL,savedAt TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS WealthSnapshot(id TEXT PRIMARY KEY,currency TEXT NOT NULL,at TEXT NOT NULL,assets TEXT NOT NULL,liabilities TEXT NOT NULL,net TEXT NOT NULL,investableAssets TEXT NOT NULL,investableDebt TEXT NOT NULL,investable TEXT NOT NULL,allocation TEXT NOT NULL,UNIQUE(currency,at))",
];
export const valuationSetting = (days: number) => ({
  statement:
    "INSERT INTO WealthSettings(key,value) VALUES('valuationMaxDays',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  values: [String(days)],
});
export async function readWealth(db: Sql): Promise<WealthState> {
  const maps = {
    fxRates: ["FXRate", fxSchema],
    liabilities: ["Liability", liabilitySchema],
    liabilityBalances: ["LiabilityBalance", liabilityBalanceSchema],
    transfers: ["InternalTransfer", transferSchema],
    accountConfig: [
      "WealthAccountConfig",
      wealthStateSchema.shape.accountConfig.element,
    ],
    assetConfig: [
      "WealthAssetConfig",
      wealthStateSchema.shape.assetConfig.element,
    ],
    goals: ["FinancialGoal", storedGoalSchema],
    snapshots: ["WealthSnapshot", snapshotSchema],
  } as const;
  const state = emptyWealth();
  for (const [key, [table, schema]] of Object.entries(maps))
    (state as Record<string, unknown>)[key] = (
      await db.query(`SELECT * FROM ${table} ORDER BY rowid`)
    ).map((r) => schema.parse(r));
  const setting = (
    await db.query(
      "SELECT value FROM WealthSettings WHERE key='valuationMaxDays'",
    )
  )[0];
  state.valuationMaxDays = wealthStateSchema.shape.valuationMaxDays.parse(
    setting ? Number(setting.value) : 7,
  );
  return state;
}
export type Prepared<T> = { entry: T; statements: Statement[] };
export class WealthCommands {
  constructor(
    private db: Sql,
    private prepareCash: (raw: unknown) => Promise<Prepared<Entry>>,
    private prepareAsset: (raw: unknown) => Promise<Prepared<AssetEntry>>,
    private read: () => Promise<State>,
  ) {}
  async setFx(raw: unknown) {
    const input = fxSchema.omit({ id: true }).parse(raw);
    if (input.from === input.to || new Date(input.at) > new Date())
      throw new Error("汇率币种须不同，时间不能在未来");
    if (
      (
        await this.db.query(
          'SELECT id FROM FXRate WHERE at=? AND (("from"=? AND "to"=?) OR ("from"=? AND "to"=?))',
          [input.at, input.from, input.to, input.to, input.from],
        )
      ).length
    )
      throw new Error("同一时间该币种对已有汇率，请选择不同时间");
    const row = { id: crypto.randomUUID(), ...input };
    await this.db.batch([insertRow("FXRate", row)]);
    return row;
  }
  async createLiability(raw: unknown) {
    const input = liabilitySchema.omit({ id: true }).parse(raw);
    if (new Date(input.at) > new Date()) throw new Error("负债时间不能在未来");
    const row = { id: crypto.randomUUID(), ...input };
    await this.db.batch([
      insertRow("Liability", row),
      insertRow("LiabilityBalance", {
        id: crypto.randomUUID(),
        liabilityId: row.id,
        amount: row.amount,
        at: row.at,
        sequence: 1,
      }),
    ]);
    return row;
  }
  async updateLiability(raw: unknown) {
    const input = z
      .object({ id, amount: nonnegative, at: iso, investable: flag })
      .parse(raw);
    const old = liabilitySchema.parse(
      (
        await this.db.query("SELECT * FROM Liability WHERE id=?", [input.id])
      )[0],
    );
    if (input.at < old.at || new Date(input.at) > new Date())
      throw new Error("负债记录不能早于上一笔或使用未来时间");
    const last = (
      await this.db.query(
        "SELECT sequence FROM LiabilityBalance WHERE liabilityId=? ORDER BY sequence DESC LIMIT 1",
        [input.id],
      )
    )[0];
    await this.db.batch([
      {
        statement: "UPDATE Liability SET amount=?,at=?,investable=? WHERE id=?",
        values: [input.amount, input.at, input.investable, input.id],
      },
      insertRow("LiabilityBalance", {
        id: crypto.randomUUID(),
        liabilityId: input.id,
        amount: input.amount,
        at: input.at,
        sequence: Number(last?.sequence ?? 0) + 1,
      }),
    ]);
  }
  async configure(raw: unknown) {
    const input = z
      .object({ kind: z.enum(["ACCOUNT", "ASSET"]), id, investable: flag })
      .parse(raw);
    const account = input.kind === "ACCOUNT",
      table = account ? "FinancialAccount" : "Asset",
      config = account ? "WealthAccountConfig" : "WealthAssetConfig",
      field = account ? "accountId" : "assetId";
    if (
      !(await this.db.query(`SELECT id FROM ${table} WHERE id=?`, [input.id]))
        .length
    )
      throw new Error("账户或资产不存在");
    await this.db.batch([
      {
        statement: `INSERT INTO ${config}(${field},investable) VALUES(?,?) ON CONFLICT(${field}) DO UPDATE SET investable=excluded.investable`,
        values: [input.id, input.investable],
      },
    ]);
  }
  async setWindow(raw: unknown) {
    const input = z
      .object({ days: wealthStateSchema.shape.valuationMaxDays })
      .parse(raw);
    await this.db.batch([valuationSetting(input.days)]);
  }
  async createTransfer(raw: unknown) {
    const input = z
      .object({
        fromId: id,
        toId: id,
        assetId: id.optional(),
        quantity: positive,
        fee: nonnegative.default("0"),
        at: iso,
      })
      .parse(raw);
    if (input.fromId === input.toId) throw new Error("转出与转入账户不能相同");
    const from = (
        await this.db.query(
          "SELECT currency FROM FinancialAccount WHERE id=?",
          [input.fromId],
        )
      )[0],
      to = (
        await this.db.query(
          "SELECT currency FROM FinancialAccount WHERE id=?",
          [input.toId],
        )
      )[0];
    if (!from || !to || from.currency !== to.currency)
      throw new Error("划转账户须存在且币种相同；汇率折算不等于换汇成交");
    const transferId = crypto.randomUUID();
    let prepared: Prepared<Entry> | Prepared<AssetEntry>,
      price = "1",
      cost = input.quantity;
    if (input.assetId) {
      const h = (
        await this.db.query(
          "SELECT quantity,cost FROM AssetHolding WHERE accountId=? AND assetId=?",
          [input.fromId, input.assetId],
        )
      )[0];
      if (!h || D(String(h.quantity)).lt(input.quantity))
        throw new Error("可用持仓不足");
      price = canonical(D(String(h.cost)).div(String(h.quantity)));
      prepared = await this.prepareAsset({
        accountId: input.fromId,
        assetId: input.assetId,
        type: "WITHDRAWAL",
        quantity: input.quantity,
        price,
        fee: input.fee,
        at: input.at,
        note: `内部划转 ${transferId} 转出`,
      });
      cost = canonical(D((prepared.entry as AssetEntry).costDelta).neg());
    } else
      prepared = await this.prepareCash({
        accountId: input.fromId,
        type: "WITHDRAWAL",
        amount: input.quantity,
        fee: input.fee,
        at: input.at,
        note: `内部划转 ${transferId} 转出`,
      });
    const transfer = {
      ...input,
      id: transferId,
      assetId: input.assetId ?? null,
      currency: String(from.currency),
      price,
      cost,
      status: "IN_TRANSIT" as const,
      completedAt: null,
      sourceEntryId: prepared.entry.id,
      destinationEntryId: null,
    };
    await this.db.batch([
      ...prepared.statements,
      insertRow("InternalTransfer", transfer),
    ]);
    return transfer;
  }
  async completeTransfer(raw: unknown) {
    const input = z.object({ id, at: iso }).parse(raw),
      t = transferSchema.parse(
        (
          await this.db.query("SELECT * FROM InternalTransfer WHERE id=?", [
            input.id,
          ])
        )[0],
      );
    if (t.status !== "IN_TRANSIT")
      throw new Error("划转已经到账，不能重复确认");
    if (input.at < t.at || new Date(input.at) > new Date())
      throw new Error("到账不能早于转出或使用未来时间");
    const prepared = t.assetId
      ? await this.prepareAsset({
          accountId: t.toId,
          assetId: t.assetId,
          type: "DEPOSIT",
          quantity: t.quantity,
          price: t.price,
          fee: "0",
          at: input.at,
          note: `内部划转 ${t.id} 到账`,
        })
      : await this.prepareCash({
          accountId: t.toId,
          type: "DEPOSIT",
          amount: t.quantity,
          fee: "0",
          at: input.at,
          note: `内部划转 ${t.id} 到账`,
        });
    await this.db.batch([
      ...prepared.statements,
      {
        statement:
          "UPDATE InternalTransfer SET status='COMPLETED',completedAt=?,destinationEntryId=? WHERE id=?",
        values: [input.at, prepared.entry.id, t.id],
      },
    ]);
  }
  async saveGoal(raw: unknown) {
    const input = goalSchema.parse(raw),
      now = new Date();
    validateFireGoal(input, now);
    const old = (
      await this.db.query("SELECT id FROM FinancialGoal WHERE name=?", [
        input.name,
      ])
    )[0];
    const goal = {
      ...input,
      id: old ? String(old.id) : crypto.randomUUID(),
      retirementDate: input.retirementDate.toISOString(),
      target: input.target ?? null,
      savedAt: now.toISOString(),
    };
    await this.db.batch([
      ...(old
        ? [
            {
              statement: "DELETE FROM FinancialGoal WHERE id=?",
              values: [goal.id],
            },
          ]
        : []),
      insertRow("FinancialGoal", goal),
    ]);
    return goal;
  }
  async snapshot(raw: unknown) {
    const input = z.object({ currency }).parse(raw),
      now = new Date(),
      p = wealthPortfolio(await this.read(), input.currency, now);
    if (!p.complete)
      throw new Error("估值缺失或过期，请补齐报价和汇率后保存完整快照");
    const row = {
      id: crypto.randomUUID(),
      currency: input.currency,
      at: now.toISOString(),
      assets: p.assets,
      liabilities: p.liabilities,
      net: p.net,
      investableAssets: p.investableAssets,
      investableDebt: p.investableDebt,
      investable: p.investable,
      allocation: JSON.stringify(p.allocation),
    };
    await this.db.batch([insertRow("WealthSnapshot", row)]);
    return row;
  }
}
export function fxValue(
  state: WealthState,
  from: string,
  to: string,
  at: Date,
) {
  if (from === to) return { rate: "1", at: null, issue: null };
  const rates = state.fxRates
    .filter(
      (r) =>
        ((r.from === from && r.to === to) ||
          (r.from === to && r.to === from)) &&
        new Date(r.at) <= at,
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  const r = rates[0];
  if (!r) return { rate: null, at: null, issue: `缺少汇率 ${from} → ${to}` };
  if (
    at.getTime() - new Date(r.at).getTime() >
    state.valuationMaxDays * 86400000
  )
    return { rate: null, at: r.at, issue: `汇率过期 ${from} → ${to}` };
  return {
    rate: r.from === from ? r.rate : canonical(D(1).div(r.rate)),
    at: r.at,
    issue: null,
  };
}
export function wealthPortfolio(state: State, report = "CNY", at = new Date()) {
  currency.parse(report);
  const rows: {
      name: string;
      account: string;
      currency: string;
      assetClass: string;
      quantity: string;
      value: string | null;
      issue: string | null;
      priceAt: string | null;
      fxAt: string | null;
      investable: boolean;
    }[] = [],
    alloc = new Map<string, ReturnType<typeof D>>();
  let investableAssets = D(0),
    debt = D(0),
    investableDebt = D(0),
    complete = true;
  const accountEligible = (id: string) =>
    state.accountConfig.find((c) => c.accountId === id)?.investable !== 0;
  const assetEligible = (id: string) => {
    const a = state.assets.find((a) => a.id === id)!;
    return (
      (state.assetConfig.find((c) => c.assetId === id)?.investable ??
        (a.assetClass === "REAL_ESTATE" ? 0 : 1)) === 1
    );
  };
  const add = (
    name: string,
    account: string,
    code: string,
    assetClass: string,
    quantity: string,
    assetId: string | null,
    eligible: boolean,
  ) => {
    if (D(quantity).eq(0)) return;
    const fx = fxValue(state, code, report, at),
      price = assetId
        ? state.prices
            .filter((p) => p.assetId === assetId && new Date(p.at) <= at)
            .sort((a, b) => b.at.localeCompare(a.at))[0]
        : null;
    let issue = fx.issue;
    if (
      assetId &&
      (!price ||
        at.getTime() - new Date(price.at).getTime() >
          state.valuationMaxDays * 86400000)
    )
      issue = price ? "价格过期" : "缺少报价";
    const value = issue
      ? null
      : canonical(
          D(quantity)
            .mul(price?.price ?? "1")
            .mul(fx.rate!),
        );
    if (value !== null) {
      alloc.set(assetClass, (alloc.get(assetClass) ?? D(0)).plus(value));
      if (eligible) investableAssets = investableAssets.plus(value);
    } else complete = false;
    rows.push({
      name,
      account,
      currency: code,
      assetClass,
      quantity,
      value,
      issue,
      priceAt: price?.at ?? null,
      fxAt: fx.at,
      investable: eligible,
    });
  };
  for (const a of state.accounts)
    add(
      `${a.currency}现金`,
      `${a.platform} / ${a.name}`,
      a.currency,
      "CASH",
      a.balance,
      null,
      accountEligible(a.id),
    );
  for (const h of state.holdings) {
    const asset = state.assets.find((a) => a.id === h.assetId)!,
      a = state.accounts.find((a) => a.id === h.accountId)!;
    add(
      asset.name,
      `${a.platform} / ${a.name}`,
      asset.currency,
      asset.assetClass,
      h.quantity,
      asset.id,
      accountEligible(a.id) && assetEligible(asset.id),
    );
  }
  for (const t of state.transfers.filter((t) => t.status === "IN_TRANSIT")) {
    const asset = state.assets.find((a) => a.id === t.assetId);
    add(
      `${asset?.name ?? t.currency + "现金"}（在途）`,
      `${state.accounts.find((a) => a.id === t.fromId)?.name} → ${state.accounts.find((a) => a.id === t.toId)?.name}`,
      t.currency,
      "IN_TRANSIT",
      t.quantity,
      t.assetId,
      accountEligible(t.toId) && (!t.assetId || assetEligible(t.assetId)),
    );
  }
  const liabilityRows = state.liabilities.map((l) => {
    const fx = fxValue(state, l.currency, report, at),
      value = D(l.amount).eq(0)
        ? "0"
        : fx.rate
          ? canonical(D(l.amount).mul(fx.rate))
          : null;
    if (value !== null) {
      debt = debt.plus(value);
      if (l.investable) investableDebt = investableDebt.plus(value);
    } else complete = false;
    return { ...l, value, issue: value === null ? fx.issue : null };
  });
  const allocation = [...alloc].map(([name, value]) => ({
      name,
      value: canonical(value),
    })),
    assets = sum(allocation.map((a) => a.value));
  return {
    currency: report,
    assets: canonical(assets),
    liabilities: canonical(debt),
    net: canonical(assets.minus(debt)),
    investableAssets: canonical(investableAssets),
    investableDebt: canonical(investableDebt),
    investable: canonical(investableAssets.minus(investableDebt)),
    complete,
    rows,
    liabilityRows,
    allocation,
    inTransit: state.transfers.filter((t) => t.status === "IN_TRANSIT").length,
  };
}
export function fireProjection(state: State, goalId: string, now = new Date()) {
  const stored = state.goals.find((g) => g.id === goalId);
  if (!stored) return null;
  const p = wealthPortfolio(state, stored.currency, now);
  const goal = {
    ...stored,
    retirementDate: new Date(stored.retirementDate),
    target: stored.target ?? undefined,
  };
  return {
    ...calculateFire(
      goal,
      p.investable,
      p.complete && D(p.investable).gte(0),
      now,
    ),
    portfolio: p,
  };
}
export function validateWealth(state: State) {
  for (const [key, items] of Object.entries({
    fx: state.fxRates,
    liabilities: state.liabilities,
    liabilityBalances: state.liabilityBalances,
    transfers: state.transfers,
    goals: state.goals,
    snapshots: state.snapshots,
  }))
    if (new Set(items.map((x) => x.id)).size !== items.length)
      throw new Error(`备份${key}ID重复`);
  const pair = (r: z.infer<typeof fxSchema>) =>
    JSON.stringify([[r.from, r.to].sort(), r.at]);
  if (
    new Set(state.fxRates.map(pair)).size !== state.fxRates.length ||
    state.fxRates.some((r) => r.from === r.to || new Date(r.at) > new Date())
  )
    throw new Error("备份汇率币种/时间无效或重复");
  for (const [configs, field, ids] of [
    [state.accountConfig, "accountId", state.accounts.map((a) => a.id)],
    [state.assetConfig, "assetId", state.assets.map((a) => a.id)],
  ] as const) {
    const keys = configs.map((c) =>
      field in c ? String(c[field as keyof typeof c]) : "",
    );
    if (
      new Set(keys).size !== keys.length ||
      keys.some((k) => !ids.includes(k))
    )
      throw new Error("备份投资配置关联无效");
  }
  for (const l of state.liabilities) {
    const events = state.liabilityBalances
      .filter((e) => e.liabilityId === l.id)
      .sort((a, b) => a.sequence - b.sequence);
    let last = "";
    for (const [i, e] of events.entries()) {
      if (e.sequence !== i + 1 || e.at < last || new Date(e.at) > new Date())
        throw new Error("备份负债历史无效");
      last = e.at;
    }
    const e = events.at(-1);
    if (!e || !D(e.amount).eq(l.amount) || e.at !== l.at)
      throw new Error("备份负债余额与历史不一致");
  }
  if (
    state.liabilityBalances.some(
      (e) => !state.liabilities.some((l) => l.id === e.liabilityId),
    )
  )
    throw new Error("备份负债历史孤立");
  const used = new Set<string>();
  for (const t of state.transfers) {
    const from = state.accounts.find((a) => a.id === t.fromId),
      to = state.accounts.find((a) => a.id === t.toId),
      asset = state.assets.find((a) => a.id === t.assetId);
    if (
      !from ||
      !to ||
      from.id === to.id ||
      from.currency !== to.currency ||
      from.currency !== t.currency ||
      (t.assetId && (!asset || asset.currency !== t.currency))
    )
      throw new Error("备份划转账户/资产关联无效");
    const all = t.assetId ? state.assetEntries : state.entries;
    const source = all.find((e) => e.id === t.sourceEntryId),
      dest = t.destinationEntryId
        ? all.find((e) => e.id === t.destinationEntryId)
        : null;
    const match = (e: Entry | AssetEntry | undefined | null, out: boolean) =>
      !!e &&
      e.accountId === (out ? t.fromId : t.toId) &&
      e.type === (out ? "WITHDRAWAL" : "DEPOSIT") &&
      e.at === (out ? t.at : t.completedAt) &&
      D("amount" in e ? e.amount : e.quantity).eq(t.quantity) &&
      D(e.fee).eq(out ? t.fee : 0) &&
      ("assetId" in e
        ? e.assetId === t.assetId &&
          D(e.price).eq(t.price) &&
          D(e.costDelta).eq(out ? D(t.cost).neg() : t.cost)
        : t.assetId === null && D(t.price).eq(1) && D(t.cost).eq(t.quantity));
    if (!match(source, true) || new Date(t.at) > new Date())
      throw new Error("备份划转与转出流水不一致");
    if (t.status === "COMPLETED") {
      if (
        !t.completedAt ||
        t.completedAt < t.at ||
        new Date(t.completedAt) > new Date() ||
        !match(dest, false)
      )
        throw new Error("备份划转与到账流水不一致");
    } else if (t.completedAt !== null || t.destinationEntryId !== null)
      throw new Error("备份在途划转状态不一致");
    for (const key of [t.sourceEntryId, t.destinationEntryId])
      if (key) {
        if (used.has(key)) throw new Error("备份划转重复关联流水");
        used.add(key);
      }
  }
  if (new Set(state.goals.map((g) => g.name)).size !== state.goals.length)
    throw new Error("备份财务目标名称重复");
  for (const g of state.goals) {
    if (new Date(g.savedAt) > new Date())
      throw new Error("备份目标保存时间无效");
    validateFireGoal(
      {
        ...g,
        retirementDate: new Date(g.retirementDate),
        target: g.target ?? undefined,
      },
      new Date(g.savedAt),
    );
  }
  if (
    new Set(state.snapshots.map((s) => JSON.stringify([s.currency, s.at])))
      .size !== state.snapshots.length
  )
    throw new Error("备份快照重复");
  for (const s of state.snapshots) {
    const a = allocationSchema.parse(JSON.parse(s.allocation));
    if (
      new Date(s.at) > new Date() ||
      new Set(a.map((x) => x.name)).size !== a.length ||
      !sum(a.map((x) => x.value)).eq(s.assets) ||
      !D(s.assets).minus(s.liabilities).eq(s.net) ||
      !D(s.investableAssets).minus(s.investableDebt).eq(s.investable) ||
      D(s.investableAssets).gt(s.assets) ||
      D(s.investableDebt).gt(s.liabilities)
    )
      throw new Error("备份快照金额或时间不一致");
  }
}
