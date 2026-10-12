import { z } from "zod";
import { D, canonical } from "@tradeos/core";
import {
  currency,
  date,
  decimal,
  nonnegative,
  text,
  id,
} from "@tradeos/core/validation";
import type { Sql, Statement } from "./sql";
import {
  transactionSchema,
  spotLedgerChanges,
} from "@tradeos/core/spot-ledger";
import { positive } from "@tradeos/core/validation";
import {
  assetTables,
  assetSchema,
  holdingSchema,
  assetEntrySchema,
  priceSchema,
  assetStateSchema,
  emptyAssets,
  insertRow,
  updatedHolding,
  type AssetState,
  type Holding,
} from "./assets";
import {
  TradingCommands,
  readTrading,
  tradingTables,
  emptyTrading,
  tradingStateSchema,
  validateTrading,
  type TradingState,
} from "./trading";
export const accountSchema = z.object({
  id,
  name: text,
  platform: text,
  currency,
  balance: decimal,
  sequence: z.number().int().nonnegative(),
});
export const entrySchema = z.object({
  id,
  accountId: id,
  type: z.enum(["DEPOSIT", "WITHDRAWAL", "ADJUSTMENT"]),
  amount: decimal,
  fee: nonnegative,
  delta: decimal,
  at: date.transform((d) => d.toISOString()),
  sequence: z.number().int().positive(),
  note: z.string().max(1000),
});
export type Account = z.infer<typeof accountSchema>;
export type Entry = z.infer<typeof entrySchema>;
export type State = { accounts: Account[]; entries: Entry[] } & AssetState &
  TradingState;
const schema = [
  `CREATE TABLE IF NOT EXISTS FinancialAccount(id TEXT PRIMARY KEY,name TEXT NOT NULL,platform TEXT NOT NULL,currency TEXT NOT NULL,balance TEXT NOT NULL DEFAULT '0',sequence INTEGER NOT NULL DEFAULT 0,UNIQUE(platform,name,currency));`,
  `CREATE TABLE IF NOT EXISTS CashLedger(id TEXT PRIMARY KEY,accountId TEXT NOT NULL REFERENCES FinancialAccount(id) ON DELETE RESTRICT,type TEXT NOT NULL,amount TEXT NOT NULL,fee TEXT NOT NULL,delta TEXT NOT NULL,at TEXT NOT NULL,sequence INTEGER NOT NULL,note TEXT NOT NULL,UNIQUE(accountId,sequence));`,
  `CREATE INDEX IF NOT EXISTS CashLedger_account_at ON CashLedger(accountId,at);`,
];
const accountInsert = (a: Account): Statement => ({
  statement:
    "INSERT INTO FinancialAccount(id,name,platform,currency,balance,sequence) VALUES(?,?,?,?,?,?)",
  values: [a.id, a.name, a.platform, a.currency, a.balance, a.sequence],
});
const entryInsert = (e: Entry): Statement => ({
  statement:
    "INSERT INTO CashLedger(id,accountId,type,amount,fee,delta,at,sequence,note) VALUES(?,?,?,?,?,?,?,?,?)",
  values: [
    e.id,
    e.accountId,
    e.type,
    e.amount,
    e.fee,
    e.delta,
    e.at,
    e.sequence,
    e.note,
  ],
});
export async function digest(payload: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function validateBackup(raw: unknown) {
  if (
    !raw ||
    typeof raw !== "object" ||
    !("kind" in raw) ||
    raw.kind !== "tradeos-android-prototype"
  )
    throw new Error(
      "当前样机只支持离线样机备份，电脑正式账本迁移将在后续版本开放。",
    );
  const basePayload = z.object({
    createdAt: date.transform((d) => d.toISOString()),
    accounts: z.array(accountSchema).max(1000),
    entries: z.array(entrySchema).max(100000),
  });
  const file = z
    .discriminatedUnion("version", [
      z.object({
        kind: z.literal("tradeos-android-prototype"),
        version: z.literal(1),
        payload: basePayload,
        checksum: z.string().regex(/^[a-f0-9]{64}$/),
      }),
      z.object({
        kind: z.literal("tradeos-android-prototype"),
        version: z.literal(2),
        payload: basePayload.extend(assetStateSchema.shape),
        checksum: z.string().regex(/^[a-f0-9]{64}$/),
      }),
      z.object({
        kind: z.literal("tradeos-android-prototype"),
        version: z.literal(3),
        payload: basePayload
          .extend(assetStateSchema.shape)
          .extend(tradingStateSchema.shape),
        checksum: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    ])
    .parse(raw);
  if (
    (await digest(z.object({ payload: z.unknown() }).parse(raw).payload)) !==
    file.checksum
  )
    throw new Error("备份校验和不一致");
  const payload = { ...emptyAssets(), ...emptyTrading(), ...file.payload };
  const accountIds = new Set(payload.accounts.map((a) => a.id));
  const assetIds = new Set(payload.assets.map((a) => a.id));
  const accountKeys = new Set(
    payload.accounts.map((a) =>
      JSON.stringify([a.platform, a.name, a.currency]),
    ),
  );
  if (
    accountIds.size !== payload.accounts.length ||
    accountKeys.size !== payload.accounts.length
  )
    throw new Error("备份账户重复");
  if (
    assetIds.size !== payload.assets.length ||
    new Set(payload.assets.map((a) => a.code)).size !== payload.assets.length
  )
    throw new Error("备份资产重复");
  const entries = [...payload.entries, ...payload.assetEntries];
  if (new Set(entries.map((e) => e.id)).size !== entries.length)
    throw new Error("备份流水ID重复");
  if (entries.some((e) => !accountIds.has(e.accountId)))
    throw new Error("备份关联账户不存在");
  const replayHoldings = new Map<string, Holding>();
  for (const a of payload.accounts) {
    let balance = D(0),
      sequence = 0,
      last = "";
    for (const e of entries
      .filter((e) => e.accountId === a.id)
      .sort((a, b) => a.sequence - b.sequence)) {
      if (
        e.sequence !== ++sequence ||
        e.at < last ||
        new Date(e.at) > new Date()
      )
        throw new Error("备份流水顺序或时间无效");
      if ("assetId" in e) {
        const asset = payload.assets.find((a) => a.id === e.assetId);
        if (!asset || asset.currency !== a.currency)
          throw new Error("备份资产不存在或结算币种不一致");
        const key = JSON.stringify([a.id, asset.id]);
        const old = replayHoldings.get(key) ?? {
          accountId: a.id,
          assetId: asset.id,
          quantity: "0",
          cost: "0",
          realized: "0",
        };
        const changes = spotLedgerChanges(
          transactionSchema.parse(e),
          false,
          old,
        );
        for (const [saved, expected] of [
          [e.quantityDelta, changes.quantity],
          [e.cashDelta, changes.cashDelta],
          [e.costDelta, changes.costDelta],
          [e.realizedDelta, changes.realizedDelta],
        ])
          if (!D(saved).eq(expected)) throw new Error("备份资产流水净额不一致");
        replayHoldings.set(key, updatedHolding(old, changes));
        balance = balance.plus(e.cashDelta);
      } else {
        const q = D(e.amount);
        if (q.eq(0) || (e.type !== "ADJUSTMENT" && q.lte(0)))
          throw new Error("备份流水数量无效");
        const expected = (e.type === "WITHDRAWAL" ? q.neg() : q).minus(e.fee);
        if (!expected.eq(e.delta)) throw new Error("备份流水净额不一致");
        balance = balance.plus(e.delta);
      }
      if (balance.lt(0)) throw new Error("备份出现负余额");
      last = e.at;
    }
    if (!balance.eq(a.balance) || sequence !== a.sequence)
      throw new Error("备份余额与流水不一致");
  }
  const keys = new Set<string>();
  for (const h of payload.holdings) {
    const key = JSON.stringify([h.accountId, h.assetId]);
    if (keys.has(key)) throw new Error("备份持仓重复");
    keys.add(key);
    const expected = replayHoldings.get(key);
    if (
      !expected ||
      !D(expected.quantity).eq(h.quantity) ||
      !D(expected.cost).eq(h.cost) ||
      !D(expected.realized).eq(h.realized)
    )
      throw new Error("备份持仓与流水不一致");
  }
  if (keys.size !== replayHoldings.size) throw new Error("备份缺少持仓");
  if (
    new Set(payload.prices.map((p) => p.id)).size !== payload.prices.length ||
    new Set(payload.prices.map((p) => JSON.stringify([p.assetId, p.at])))
      .size !== payload.prices.length
  )
    throw new Error("备份报价重复");
  if (
    payload.prices.some(
      (p) => !assetIds.has(p.assetId) || new Date(p.at) > new Date(),
    )
  )
    throw new Error("备份报价关联或时间无效");
  validateTrading(payload);
  return {
    kind: file.kind,
    version: 3 as const,
    payload,
    checksum: await digest(payload),
  };
}

export class Ledger {
  private pending: Promise<unknown> = Promise.resolve();
  private trading: TradingCommands;
  constructor(private db: Sql) {
    this.trading = new TradingCommands(db, (raw, reservation) =>
      this.prepareAsset(raw, reservation),
    );
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work);
    this.pending = result.catch(() => undefined);
    return result;
  }
  async init() {
    await this.db.batch(schema.map((statement) => ({ statement, values: [] })));
    await this.db.batch([
      {
        statement:
          "CREATE TABLE IF NOT EXISTS OfflineSchema(version INTEGER NOT NULL)",
        values: [],
      },
    ]);
    const current = await this.db.query("SELECT version FROM OfflineSchema");
    if (current.length > 1 || (current[0] && Number(current[0].version) > 3))
      throw new Error("账本由更新版本创建，请安装最新版本，数据未被修改。");
    if (!current[0] || Number(current[0].version) < 2)
      await this.db.batch([
        ...assetTables.map((statement) => ({ statement, values: [] })),
        { statement: "DELETE FROM OfflineSchema", values: [] },
        {
          statement: "INSERT INTO OfflineSchema(version) VALUES(2)",
          values: [],
        },
      ]);
    if (!current[0] || Number(current[0].version) < 3)
      await this.db.batch([
        ...tradingTables.map((statement) => ({ statement, values: [] })),
        { statement: "DELETE FROM OfflineSchema", values: [] },
        {
          statement: "INSERT INTO OfflineSchema(version) VALUES(3)",
          values: [],
        },
      ]);
  }

  private async read(): Promise<State> {
    return {
      ...(await readTrading(this.db)),
      assets: (await this.db.query("SELECT * FROM Asset ORDER BY code")).map(
        (a) => assetSchema.parse(a),
      ),
      holdings: (await this.db.query("SELECT * FROM AssetHolding")).map((a) =>
        holdingSchema.parse(a),
      ),
      assetEntries: (
        await this.db.query(
          "SELECT * FROM AssetLedger ORDER BY at DESC,sequence DESC",
        )
      ).map((a) => assetEntrySchema.parse(a)),
      prices: (
        await this.db.query("SELECT * FROM AssetPrice ORDER BY at DESC")
      ).map((a) => priceSchema.parse(a)),
      accounts: (
        await this.db.query(
          "SELECT * FROM FinancialAccount ORDER BY platform,name",
        )
      ).map((a) => accountSchema.parse(a)),
      entries: (
        await this.db.query(
          "SELECT * FROM CashLedger ORDER BY at DESC,sequence DESC",
        )
      ).map((e) => entrySchema.parse(e)),
    };
  }
  state() {
    return this.serial(() => this.read());
  }
  createAccount(raw: unknown) {
    return this.serial(async () => {
      const a = {
        ...z.object({ name: text, platform: text, currency }).parse(raw),
        id: crypto.randomUUID(),
        balance: "0",
        sequence: 0,
      };
      if (
        (
          await this.db.query(
            "SELECT id FROM FinancialAccount WHERE platform=? AND name=? AND currency=?",
            [a.platform, a.name, a.currency],
          )
        ).length
      )
        throw new Error("同平台、名称和币种的账户已存在，请调整账户名称。");
      await this.db.batch([accountInsert(a)]);
      return a;
    });
  }
  post(raw: unknown) {
    return this.serial(async () => {
      const input = z
        .object({
          accountId: id,
          type: z.enum(["DEPOSIT", "WITHDRAWAL", "ADJUSTMENT"]),
          amount: decimal,
          fee: nonnegative.default("0"),
          at: date.transform((d) => d.toISOString()),
          note: z.string().max(1000).default(""),
        })
        .parse(raw);
      if (new Date(input.at) > new Date()) throw new Error("不能记录未来时间");
      if (
        D(input.amount).eq(0) ||
        (input.type !== "ADJUSTMENT" && D(input.amount).lte(0))
      )
        throw new Error("金额必须大于零，调整可以填负数");
      const rawAccount = (
        await this.db.query("SELECT * FROM FinancialAccount WHERE id=?", [
          input.accountId,
        ])
      )[0];
      if (!rawAccount) throw new Error("账户不存在");
      const a = accountSchema.parse(rawAccount);
      const previous = (
        await this.db.query(
          "SELECT at FROM (SELECT at,sequence FROM CashLedger WHERE accountId=? UNION ALL SELECT at,sequence FROM AssetLedger WHERE accountId=?) ORDER BY sequence DESC LIMIT 1",
          [a.id, a.id],
        )
      )[0];
      if (previous && input.at < String(previous.at))
        throw new Error("流水不能早于上一笔记录");
      const delta = (
          input.type === "WITHDRAWAL" ? D(input.amount).neg() : D(input.amount)
        ).minus(input.fee),
        balance = D(a.balance).plus(delta);
      if (balance.lt(0)) throw new Error("可用余额不足");
      const e: Entry = {
        ...input,
        id: crypto.randomUUID(),
        delta: canonical(delta),
        sequence: a.sequence + 1,
      };
      await this.db.batch([
        entryInsert(e),
        {
          statement:
            "UPDATE FinancialAccount SET balance=?,sequence=? WHERE id=?",
          values: [canonical(balance), e.sequence, a.id],
        },
      ]);
      return e;
    });
  }
  createAsset(raw: unknown) {
    return this.serial(async () => {
      const input = assetSchema.omit({ id: true }).parse(raw);
      if (
        (await this.db.query("SELECT id FROM Asset WHERE code=?", [input.code]))
          .length
      )
        throw new Error("资产代码已存在");
      const asset = { id: crypto.randomUUID(), ...input };
      await this.db.batch([insertRow("Asset", asset)]);
      return asset;
    });
  }
  setPrice(raw: unknown) {
    return this.serial(async () => {
      const input = z
        .object({
          assetId: id,
          price: positive,
          at: date.transform((d) => d.toISOString()),
        })
        .parse(raw);
      if (new Date(input.at) > new Date())
        throw new Error("报价不能使用未来时间");
      if (
        !(
          await this.db.query("SELECT id FROM Asset WHERE id=?", [
            input.assetId,
          ])
        ).length
      )
        throw new Error("资产不存在");
      if (
        (
          await this.db.query(
            "SELECT id FROM AssetPrice WHERE assetId=? AND at=?",
            [input.assetId, input.at],
          )
        ).length
      )
        throw new Error("该时间已有报价，请选择不同时间");
      const row = { id: crypto.randomUUID(), ...input };
      await this.db.batch([insertRow("AssetPrice", row)]);
      return row;
    });
  }
  postAsset(raw: unknown) {
    return this.serial(async () => {
      const result = await this.prepareAsset(raw);
      await this.db.batch(result.statements);
      return result.entry;
    });
  }
  private async prepareAsset(
    raw: unknown,
    reservation?: { tradeId: string; quantity: string },
  ) {
    const input = transactionSchema
      .omit({ externalId: true, purpose: true })
      .parse(raw);
    if (input.at > new Date()) throw new Error("不能记录未来时间");
    const a = accountSchema.parse(
      (
        await this.db.query("SELECT * FROM FinancialAccount WHERE id=?", [
          input.accountId,
        ])
      )[0],
    );
    const asset = assetSchema.parse(
      (
        await this.db.query("SELECT * FROM Asset WHERE id=?", [input.assetId])
      )[0],
    );
    if (asset.currency !== a.currency)
      throw new Error("资产结算币种与账户不一致，请选择同币种账户");
    const previous = (
      await this.db.query(
        "SELECT at FROM (SELECT at,sequence FROM CashLedger WHERE accountId=? UNION ALL SELECT at,sequence FROM AssetLedger WHERE accountId=?) ORDER BY sequence DESC LIMIT 1",
        [a.id, a.id],
      )
    )[0];
    if (previous && input.at.toISOString() < String(previous.at))
      throw new Error("流水不能早于上一笔记录");
    const saved = (
      await this.db.query(
        "SELECT * FROM AssetHolding WHERE accountId=? AND assetId=?",
        [a.id, asset.id],
      )
    )[0];
    const old = saved
      ? holdingSchema.parse(saved)
      : {
          accountId: a.id,
          assetId: asset.id,
          quantity: "0",
          cost: "0",
          realized: "0",
        };
    const changes = spotLedgerChanges(
      { ...input, purpose: "LONG_TERM" },
      false,
      old,
    );
    const holding = updatedHolding(old, changes),
      balance = D(a.balance).plus(changes.cashDelta);
    if (balance.lt(0)) throw new Error("可用现金余额不足");
    const entry = {
      ...input,
      id: crypto.randomUUID(),
      at: input.at.toISOString(),
      sequence: a.sequence + 1,
      quantityDelta: changes.quantity,
      cashDelta: changes.cashDelta,
      costDelta: changes.costDelta,
      realizedDelta: changes.realizedDelta,
    };
    const reservedRows = await this.db.query(
      "SELECT id,quantity FROM Trade WHERE accountId=? AND assetId=? AND status='OPEN'",
      [a.id, asset.id],
    );
    const reserved = reservedRows.reduce(
      (total, t) =>
        total.plus(
          reservation && reservation.tradeId === t.id
            ? reservation.quantity
            : String(t.quantity),
        ),
      D(0),
    );
    if (D(holding.quantity).lt(reserved))
      throw new Error("资产已被未平仓交易占用，请从交易日志减仓或平仓");
    const statements: Statement[] = [
      {
        statement:
          "INSERT INTO AssetHolding(accountId,assetId,quantity,cost,realized) VALUES(?,?,?,?,?) ON CONFLICT(accountId,assetId) DO UPDATE SET quantity=excluded.quantity,cost=excluded.cost,realized=excluded.realized",
        values: [
          holding.accountId,
          holding.assetId,
          holding.quantity,
          holding.cost,
          holding.realized,
        ],
      },
      insertRow("AssetLedger", entry),
      {
        statement:
          "UPDATE FinancialAccount SET balance=?,sequence=? WHERE id=?",
        values: [canonical(balance), entry.sequence, a.id],
      },
    ];
    return { entry, statements };
  }
  createStrategy(raw: unknown) {
    return this.serial(() => this.trading.createStrategy(raw));
  }
  publishVersion(raw: unknown) {
    return this.serial(() => this.trading.publishVersion(raw));
  }
  archiveStrategy(raw: unknown) {
    return this.serial(() => this.trading.archiveStrategy(raw));
  }
  createPlan(raw: unknown) {
    return this.serial(() => this.trading.createPlan(raw));
  }
  createTrade(raw: unknown) {
    return this.serial(() => this.trading.createTrade(raw));
  }
  recordFill(raw: unknown) {
    return this.serial(() => this.trading.recordFill(raw));
  }
  recordEvent(raw: unknown) {
    return this.serial(() => this.trading.recordEvent(raw));
  }
  backup() {
    return this.serial(async () => {
      const s = await this.read();
      const payload = { createdAt: new Date().toISOString(), ...s };
      return {
        kind: "tradeos-android-prototype" as const,
        version: 3 as const,
        payload,
        checksum: await digest(payload),
      };
    });
  }
  restore(raw: unknown) {
    return this.serial(async () => {
      const file = await validateBackup(raw);
      await this.db.batch([
        ...[
          "PositionEvent",
          "TradeFill",
          "Trade",
          "TradingPlan",
          "StrategyVersion",
          "Strategy",
        ].map((table) => ({ statement: `DELETE FROM ${table}`, values: [] })),
        { statement: "DELETE FROM AssetLedger", values: [] },
        { statement: "DELETE FROM AssetHolding", values: [] },
        { statement: "DELETE FROM AssetPrice", values: [] },
        { statement: "DELETE FROM Asset", values: [] },
        { statement: "DELETE FROM CashLedger", values: [] },
        { statement: "DELETE FROM FinancialAccount", values: [] },
        ...file.payload.accounts.map(accountInsert),
        ...file.payload.assets.map((a) => insertRow("Asset", a)),
        ...file.payload.holdings.map((a) => insertRow("AssetHolding", a)),
        ...file.payload.prices.map((a) => insertRow("AssetPrice", a)),
        ...file.payload.assetEntries.map((a) => insertRow("AssetLedger", a)),
        ...file.payload.entries
          .sort((a, b) => a.sequence - b.sequence)
          .map(entryInsert),
        ...file.payload.strategies.map((s) => insertRow("Strategy", s)),
        ...file.payload.versions.map((s) => insertRow("StrategyVersion", s)),
        ...file.payload.plans.map((s) => insertRow("TradingPlan", s)),
        ...file.payload.trades.map((s) => insertRow("Trade", s)),
        ...file.payload.fills.map((s) => insertRow("TradeFill", s)),
        ...file.payload.events.map((s) => insertRow("PositionEvent", s)),
      ]);
    });
  }
}
