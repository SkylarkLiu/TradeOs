import { z } from "zod";
import { D, canonical, positionSize, sum } from "@tradeos/core";
import {
  id,
  text,
  positive,
  nonnegative,
  decimal,
  date,
} from "@tradeos/core/validation";
import {
  rulesSchema,
  planSchema,
  tradeSchema,
  fillSchema,
  fillChanges,
} from "@tradeos/core/trading";
import { insertRow, type AssetEntry, type AssetState } from "./assets";
import type { Sql, Statement } from "./sql";
const iso = date.transform((d) => d.toISOString());
const flag = z.number().int().min(0).max(1);
export const strategySchema = z.object({
  id,
  name: text,
  archived: flag,
  createdAt: iso,
});
export const versionSchema = rulesSchema.extend({
  id,
  strategyId: id,
  version: z.number().int().positive(),
  published: flag,
  createdAt: iso,
});
export const storedPlanSchema = planSchema
  .omit({ strategyVersionId: true, direction: true })
  .extend({
    id,
    strategyVersionId: id.nullable(),
    direction: z.literal("LONG"),
    quantity: positive,
    createdAt: iso,
  });
export const storedTradeSchema = z.object({
  id,
  accountId: id,
  assetId: id,
  strategyVersionId: id.nullable(),
  planId: id.nullable(),
  direction: z.literal("LONG"),
  leverage: z.literal("1"),
  status: z.enum(["OPEN", "CLOSED"]),
  initialRisk: nonnegative,
  quantity: nonnegative,
  averageEntry: nonnegative,
  realized: decimal,
  fees: nonnegative,
  margin: z.literal("0"),
  openedAt: iso,
  closedAt: iso.nullable(),
  reason: z.string().max(3000),
  initialStop: positive.nullable(),
  initialTarget: positive.nullable(),
  stop: positive.nullable(),
  target: positive.nullable(),
  sequence: z.number().int().nonnegative(),
});
export const storedFillSchema = fillSchema.extend({
  id,
  transactionId: id,
  at: iso,
  sequence: z.number().int().positive(),
  pnl: decimal,
});
export const manualEventSchema = z.object({
  tradeId: id,
  type: z.enum([
    "STOP_ADJUSTMENT",
    "TARGET_ADJUSTMENT",
    "PLAN_DEVIATION",
    "MARKET_OBSERVATION",
  ]),
  detail: text,
  value: positive.optional(),
  at: date,
});
export const eventSchema = manualEventSchema
  .omit({ type: true, value: true, at: true })
  .extend({
    id,
    fillId: id.nullable(),
    type: z.enum([
      "ENTRY",
      "ADD_POSITION",
      "PARTIAL_EXIT",
      "EXIT",
      "STOP_ADJUSTMENT",
      "TARGET_ADJUSTMENT",
      "PLAN_DEVIATION",
      "MARKET_OBSERVATION",
    ]),
    value: positive.nullable(),
    at: iso,
    sequence: z.number().int().positive(),
  });
export const tradingStateSchema = z.object({
  strategies: z.array(strategySchema).max(10000),
  versions: z.array(versionSchema).max(10000),
  plans: z.array(storedPlanSchema).max(100000),
  trades: z.array(storedTradeSchema).max(100000),
  fills: z.array(storedFillSchema).max(100000),
  events: z.array(eventSchema).max(100000),
});
export type TradingState = z.infer<typeof tradingStateSchema>;
export type Trade = z.infer<typeof storedTradeSchema>;
export const emptyTrading = (): TradingState => ({
  strategies: [],
  versions: [],
  plans: [],
  trades: [],
  fills: [],
  events: [],
});
export const tradingTables = [
  "CREATE TABLE IF NOT EXISTS Strategy(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,archived INTEGER NOT NULL,createdAt TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS StrategyVersion(id TEXT PRIMARY KEY,strategyId TEXT NOT NULL REFERENCES Strategy(id),version INTEGER NOT NULL,published INTEGER NOT NULL,createdAt TEXT NOT NULL,market TEXT NOT NULL,timeframe TEXT NOT NULL,environment TEXT NOT NULL,rules TEXT NOT NULL,UNIQUE(strategyId,version))",
  "CREATE TABLE IF NOT EXISTS TradingPlan(id TEXT PRIMARY KEY,accountId TEXT NOT NULL REFERENCES FinancialAccount(id),assetId TEXT NOT NULL REFERENCES Asset(id),strategyVersionId TEXT REFERENCES StrategyVersion(id),direction TEXT NOT NULL,entry TEXT NOT NULL,stop TEXT NOT NULL,target TEXT NOT NULL,equity TEXT NOT NULL,riskPercent TEXT NOT NULL,reason TEXT NOT NULL,invalidation TEXT NOT NULL,quantity TEXT NOT NULL,createdAt TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS Trade(id TEXT PRIMARY KEY,accountId TEXT NOT NULL REFERENCES FinancialAccount(id),assetId TEXT NOT NULL REFERENCES Asset(id),strategyVersionId TEXT REFERENCES StrategyVersion(id),planId TEXT REFERENCES TradingPlan(id),direction TEXT NOT NULL,leverage TEXT NOT NULL,status TEXT NOT NULL,initialRisk TEXT NOT NULL,quantity TEXT NOT NULL,averageEntry TEXT NOT NULL,realized TEXT NOT NULL,fees TEXT NOT NULL,margin TEXT NOT NULL,openedAt TEXT NOT NULL,closedAt TEXT,reason TEXT NOT NULL,initialStop TEXT,initialTarget TEXT,stop TEXT,target TEXT,sequence INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS TradeFill(id TEXT PRIMARY KEY,tradeId TEXT NOT NULL REFERENCES Trade(id),transactionId TEXT NOT NULL UNIQUE REFERENCES AssetLedger(id),action TEXT NOT NULL,quantity TEXT NOT NULL,price TEXT NOT NULL,fee TEXT NOT NULL,slippage TEXT NOT NULL,at TEXT NOT NULL,sequence INTEGER NOT NULL,pnl TEXT NOT NULL,UNIQUE(tradeId,sequence))",
  "CREATE TABLE IF NOT EXISTS PositionEvent(id TEXT PRIMARY KEY,tradeId TEXT NOT NULL REFERENCES Trade(id),fillId TEXT UNIQUE REFERENCES TradeFill(id),type TEXT NOT NULL,detail TEXT NOT NULL,value TEXT,at TEXT NOT NULL,sequence INTEGER NOT NULL,UNIQUE(tradeId,sequence))",
];
export async function readTrading(db: Sql): Promise<TradingState> {
  const schemas = {
    strategies: ["Strategy", strategySchema],
    versions: ["StrategyVersion", versionSchema],
    plans: ["TradingPlan", storedPlanSchema],
    trades: ["Trade", storedTradeSchema],
    fills: ["TradeFill", storedFillSchema],
    events: ["PositionEvent", eventSchema],
  } as const;
  const state = emptyTrading();
  for (const [key, [table, schema]] of Object.entries(schemas))
    (state as Record<string, unknown>)[key] = (
      await db.query(`SELECT * FROM ${table} ORDER BY rowid`)
    ).map((r) => schema.parse(r));
  return state;
}
export function initialTrade(input: {
  openedAt: string;
  stop: string | null;
  target: string | null;
}) {
  return {
    quantity: "0",
    averageEntry: "0",
    realized: "0",
    fees: "0",
    margin: "0" as const,
    status: "OPEN" as const,
    closedAt: null as string | null,
    sequence: 0,
    initialStop: input.stop,
    initialTarget: input.target,
    stop: input.stop,
    target: input.target,
  };
}
export const fillEventType = (
  oldQuantity: string,
  action: string,
  nextQuantity: string,
) =>
  action === "ENTRY"
    ? D(oldQuantity).eq(0)
      ? "ENTRY"
      : "ADD_POSITION"
    : D(nextQuantity).eq(0)
      ? "EXIT"
      : "PARTIAL_EXIT";
export class TradingCommands {
  constructor(
    private db: Sql,
    private prepareAsset: (
      raw: unknown,
      reservation: { tradeId: string; quantity: string },
    ) => Promise<{ entry: AssetEntry; statements: Statement[] }>,
  ) {}
  private async published(versionId: string) {
    const v = versionSchema.parse(
      (
        await this.db.query("SELECT * FROM StrategyVersion WHERE id=?", [
          versionId,
        ])
      )[0],
    );
    const s = strategySchema.parse(
      (
        await this.db.query("SELECT * FROM Strategy WHERE id=?", [v.strategyId])
      )[0],
    );
    if (!v.published || s.archived)
      throw new Error("请选择活跃策略的已发布版本");
  }
  private async instruments(accountId: string, assetId: string) {
    const a = (
        await this.db.query(
          "SELECT currency FROM FinancialAccount WHERE id=?",
          [accountId],
        )
      )[0],
      asset = (
        await this.db.query("SELECT currency FROM Asset WHERE id=?", [assetId])
      )[0];
    if (!a || !asset) throw new Error("账户或资产不存在");
    if (a.currency !== asset.currency)
      throw new Error("账户与资产结算币种不一致");
  }
  async prepareStrategy(raw: unknown) {
    const { name, ...rules } = rulesSchema.extend({ name: text }).parse(raw);
    const saved = (
      await this.db.query("SELECT * FROM Strategy WHERE name=?", [name])
    )[0];
    const strategy = saved
      ? strategySchema.parse(saved)
      : {
          id: crypto.randomUUID(),
          name,
          archived: 0,
          createdAt: new Date().toISOString(),
        };
    if (strategy.archived) throw new Error("策略已归档，请先恢复策略");
    const latest = (
      await this.db.query(
        "SELECT version FROM StrategyVersion WHERE strategyId=? ORDER BY version DESC LIMIT 1",
        [strategy.id],
      )
    )[0];
    const version = {
      id: crypto.randomUUID(),
      strategyId: strategy.id,
      version: Number(latest?.version ?? 0) + 1,
      published: 0,
      createdAt: new Date().toISOString(),
      ...rules,
    };
    return {
      version,
      statements: [
        ...(saved ? [] : [insertRow("Strategy", strategy)]),
        insertRow("StrategyVersion", version),
      ],
    };
  }
  async createStrategy(raw: unknown) {
    const prepared = await this.prepareStrategy(raw);
    await this.db.batch(prepared.statements);
    return prepared.version;
  }

  async publishVersion(raw: unknown) {
    const input = z.object({ id }).parse(raw);
    const v = versionSchema.parse(
      (
        await this.db.query("SELECT * FROM StrategyVersion WHERE id=?", [
          input.id,
        ])
      )[0],
    );
    const s = strategySchema.parse(
      (
        await this.db.query("SELECT * FROM Strategy WHERE id=?", [v.strategyId])
      )[0],
    );
    if (s.archived || v.published) throw new Error("策略已归档或版本已发布");
    if (v.rules.replace(/^#+.*$/gm, "").trim().length < 20)
      throw new Error("请填写至少20字的具体规则后再发布");
    await this.db.batch([
      {
        statement: "UPDATE StrategyVersion SET published=1 WHERE id=?",
        values: [v.id],
      },
    ]);
  }
  async archiveStrategy(raw: unknown) {
    const input = z.object({ id, archived: flag }).parse(raw);
    if (
      !(await this.db.query("SELECT id FROM Strategy WHERE id=?", [input.id]))
        .length
    )
      throw new Error("策略不存在");
    await this.db.batch([
      {
        statement: "UPDATE Strategy SET archived=? WHERE id=?",
        values: [input.archived, input.id],
      },
    ]);
  }
  async createPlan(raw: unknown) {
    const input = planSchema.parse(raw);
    if (input.direction !== "LONG") throw new Error("本阶段仅支持现货做多");
    await this.instruments(input.accountId, input.assetId);
    if (input.strategyVersionId) await this.published(input.strategyVersionId);
    if (D(input.target).lte(input.entry)) throw new Error("止盈必须高于入场价");
    const size = positionSize({ ...input, instrument: "SPOT" });
    const plan = {
      ...input,
      id: crypto.randomUUID(),
      strategyVersionId: input.strategyVersionId ?? null,
      quantity: size.quantity,
      createdAt: new Date().toISOString(),
    };
    await this.db.batch([insertRow("TradingPlan", plan)]);
    return plan;
  }
  async createTrade(raw: unknown) {
    const input = tradeSchema.parse(raw);
    if (input.direction !== "LONG" || input.leverage !== "1")
      throw new Error("本阶段仅支持无杠杆的现货做多");
    if (input.openedAt > new Date()) throw new Error("交易不能使用未来时间");
    await this.instruments(input.accountId, input.assetId);
    let strategyVersionId = input.strategyVersionId ?? null,
      initialRisk = input.initialRisk,
      stop = input.stop ?? null,
      target = input.target ?? null;
    if (input.planId) {
      const p = storedPlanSchema.parse(
        (
          await this.db.query("SELECT * FROM TradingPlan WHERE id=?", [
            input.planId,
          ])
        )[0],
      );
      if (p.accountId !== input.accountId || p.assetId !== input.assetId)
        throw new Error("交易与计划的账户、资产必须一致");
      strategyVersionId = p.strategyVersionId;
      initialRisk = canonical(D(p.equity).mul(p.riskPercent).div(100));
      stop = p.stop;
      target = p.target;
    }
    if (strategyVersionId) await this.published(strategyVersionId);
    const trade = {
      id: crypto.randomUUID(),
      accountId: input.accountId,
      assetId: input.assetId,
      strategyVersionId,
      planId: input.planId ?? null,
      direction: "LONG" as const,
      leverage: "1" as const,
      initialRisk,
      reason: input.reason,
      openedAt: input.openedAt.toISOString(),
      ...initialTrade({ openedAt: input.openedAt.toISOString(), stop, target }),
    };
    await this.db.batch([insertRow("Trade", trade)]);
    return trade;
  }
  async recordFill(raw: unknown) {
    const input = fillSchema.parse(raw);
    const trade = storedTradeSchema.parse(
      (
        await this.db.query("SELECT * FROM Trade WHERE id=?", [input.tradeId])
      )[0],
    );
    if (trade.status !== "OPEN") throw new Error("已平仓交易不可追加成交");
    const last = (
      await this.db.query(
        "SELECT at,sequence FROM PositionEvent WHERE tradeId=? ORDER BY sequence DESC LIMIT 1",
        [trade.id],
      )
    )[0];
    if (
      input.at > new Date() ||
      input.at.toISOString() < trade.openedAt ||
      (last && input.at.toISOString() < String(last.at))
    )
      throw new Error("成交时间不能使用未来时间或早于开仓、上次成交及持仓事件");
    const { pnl, ...changes } = fillChanges(trade, input, {
      instrument: "SPOT",
      multiplier: "1",
    });
    const prepared = await this.prepareAsset(
      {
        accountId: trade.accountId,
        assetId: trade.assetId,
        type: input.action === "ENTRY" ? "BUY" : "SELL",
        quantity: input.quantity,
        price: input.price,
        fee: input.fee,
        at: input.at.toISOString(),
        note: `交易 ${trade.id}`,
      },
      { tradeId: trade.id, quantity: changes.quantity },
    );
    const fill = {
      ...input,
      id: crypto.randomUUID(),
      at: input.at.toISOString(),
      sequence: trade.sequence + 1,
      transactionId: prepared.entry.id,
      pnl,
    };
    const event = {
      id: crypto.randomUUID(),
      tradeId: trade.id,
      fillId: fill.id,
      type: fillEventType(trade.quantity, input.action, changes.quantity),
      detail: input.action === "ENTRY" ? "记录建仓成交" : "记录平仓成交",
      value: null,
      at: fill.at,
      sequence: Number(last?.sequence ?? 0) + 1,
    };
    await this.db.batch([
      ...prepared.statements,
      {
        statement:
          "UPDATE Trade SET quantity=?,averageEntry=?,realized=?,fees=?,status=?,closedAt=?,sequence=? WHERE id=?",
        values: [
          changes.quantity,
          changes.averageEntry,
          changes.realized,
          changes.fees,
          changes.status,
          changes.closedAt?.toISOString() ?? null,
          fill.sequence,
          trade.id,
        ],
      },
      insertRow("TradeFill", fill),
      insertRow("PositionEvent", event),
    ]);
    return fill;
  }
  async recordEvent(raw: unknown) {
    const input = manualEventSchema.parse(raw),
      trade = storedTradeSchema.parse(
        (
          await this.db.query("SELECT * FROM Trade WHERE id=?", [input.tradeId])
        )[0],
      );
    if (trade.status !== "OPEN") throw new Error("已平仓交易不能追加持仓事件");
    const last = (
      await this.db.query(
        "SELECT at,sequence FROM PositionEvent WHERE tradeId=? ORDER BY sequence DESC LIMIT 1",
        [trade.id],
      )
    )[0];
    if (
      input.at > new Date() ||
      input.at.toISOString() < trade.openedAt ||
      (last && input.at.toISOString() < String(last.at))
    )
      throw new Error("事件时间不能使用未来时间或早于上次成交及事件");
    const field =
      input.type === "STOP_ADJUSTMENT"
        ? "stop"
        : input.type === "TARGET_ADJUSTMENT"
          ? "target"
          : null;
    if (field && !input.value) throw new Error("请输入调整后的价格");
    const event = {
      ...input,
      id: crypto.randomUUID(),
      fillId: null,
      value: field ? input.value! : null,
      at: input.at.toISOString(),
      sequence: Number(last?.sequence ?? 0) + 1,
    };
    await this.db.batch([
      ...(field
        ? [
            {
              statement: `UPDATE Trade SET ${field}=? WHERE id=?`,
              values: [input.value!, trade.id],
            },
          ]
        : []),
      insertRow("PositionEvent", event),
    ]);
    return event;
  }
}

export function validateTrading(
  state: TradingState &
    AssetState & { accounts: { id: string; currency: string }[] },
) {
  const { strategies, versions, plans, trades, fills, events } = state;
  const unique = (items: { id: string }[], name: string) => {
    if (new Set(items.map((x) => x.id)).size !== items.length)
      throw new Error(`备份${name}ID重复`);
  };
  for (const [name, items] of Object.entries({
    strategies,
    versions,
    plans,
    trades,
    fills,
    events,
  }))
    unique(items, name);
  if (new Set(strategies.map((s) => s.name)).size !== strategies.length)
    throw new Error("备份策略名称重复");
  if (
    new Set(versions.map((v) => JSON.stringify([v.strategyId, v.version])))
      .size !== versions.length
  )
    throw new Error("备份策略版本重复");
  for (const v of versions)
    if (
      !strategies.some((s) => s.id === v.strategyId) ||
      new Date(v.createdAt) > new Date() ||
      (v.published && v.rules.replace(/^#+.*$/gm, "").trim().length < 20)
    )
      throw new Error("备份策略版本无效");
  for (const s of strategies) {
    if (new Date(s.createdAt) > new Date()) throw new Error("备份策略时间无效");
    const vs = versions
      .filter((v) => v.strategyId === s.id)
      .sort((a, b) => a.version - b.version);
    if (!vs.length || vs.some((v, i) => v.version !== i + 1))
      throw new Error("备份策略版本顺序无效");
  }
  const links = (r: {
    accountId: string;
    assetId: string;
    strategyVersionId: string | null;
  }) => {
    const a = state.accounts.find((a) => a.id === r.accountId),
      asset = state.assets.find((a) => a.id === r.assetId);
    if (!a || !asset || a.currency !== asset.currency)
      throw new Error("备份交易账户或资产关联无效");
    if (
      r.strategyVersionId &&
      !versions.some((v) => v.id === r.strategyVersionId && v.published)
    )
      throw new Error("备份交易策略版本未发布或不存在");
  };
  for (const p of plans) {
    links(p);
    if (
      new Date(p.createdAt) > new Date() ||
      D(p.target).lte(p.entry) ||
      !D(positionSize({ ...p, instrument: "SPOT" }).quantity).eq(p.quantity)
    )
      throw new Error("备份风险计划无效");
  }
  const usedTransactions = new Set<string>(),
    usedFills = new Set<string>();
  const nextPositions = new Map<
    string,
    { tradeId: string; quantity: string }
  >();
  for (const t of trades) {
    links(t);
    if (new Date(t.openedAt) > new Date()) throw new Error("备份交易时间无效");
    if (t.planId) {
      const p = plans.find((p) => p.id === t.planId);
      if (
        !p ||
        p.accountId !== t.accountId ||
        p.assetId !== t.assetId ||
        p.strategyVersionId !== t.strategyVersionId ||
        !D(t.initialRisk).eq(D(p.equity).mul(p.riskPercent).div(100)) ||
        t.initialStop !== p.stop ||
        t.initialTarget !== p.target
      )
        throw new Error("备份交易与计划不一致");
    }
    let current: Trade = {
        ...t,
        ...initialTrade({
          openedAt: t.openedAt,
          stop: t.initialStop,
          target: t.initialTarget,
        }),
      },
      last = t.openedAt,
      fillSequence = 0,
      eventSequence = 0;
    const tf = fills
      .filter((f) => f.tradeId === t.id)
      .sort((a, b) => a.sequence - b.sequence);
    for (const e of events
      .filter((e) => e.tradeId === t.id)
      .sort((a, b) => a.sequence - b.sequence)) {
      if (
        e.sequence !== ++eventSequence ||
        e.at < last ||
        new Date(e.at) > new Date() ||
        current.status !== "OPEN"
      )
        throw new Error("备份持仓事件顺序无效");
      if (e.fillId) {
        const f = tf[fillSequence];
        if (
          !f ||
          f.id !== e.fillId ||
          f.sequence !== ++fillSequence ||
          f.at !== e.at ||
          usedFills.has(f.id)
        )
          throw new Error("备份成交与持仓事件不一致");
        const transaction = state.assetEntries.find(
          (x) => x.id === f.transactionId,
        );
        if (
          !transaction ||
          usedTransactions.has(f.transactionId) ||
          transaction.accountId !== t.accountId ||
          transaction.assetId !== t.assetId ||
          transaction.type !== (f.action === "ENTRY" ? "BUY" : "SELL") ||
          transaction.at !== f.at ||
          ![
            [transaction.quantity, f.quantity],
            [transaction.price, f.price],
            [transaction.fee, f.fee],
          ].every(([a, b]) => D(a).eq(b))
        )
          throw new Error("备份成交与资产流水不一致");
        const { pnl, ...changes } = fillChanges(current, fillSchema.parse(f), {
          instrument: "SPOT",
          multiplier: "1",
        });
        if (
          !D(pnl).eq(f.pnl) ||
          e.value !== null ||
          e.type !== fillEventType(current.quantity, f.action, changes.quantity)
        )
          throw new Error("备份成交损益或事件类型不一致");
        current = {
          ...current,
          ...changes,
          margin: "0",
          closedAt: changes.closedAt?.toISOString() ?? null,
          sequence: fillSequence,
        };
        nextPositions.set(transaction.id, {
          tradeId: t.id,
          quantity: current.quantity,
        });
        usedTransactions.add(f.transactionId);
        usedFills.add(f.id);
      } else {
        if (
          ![
            "STOP_ADJUSTMENT",
            "TARGET_ADJUSTMENT",
            "PLAN_DEVIATION",
            "MARKET_OBSERVATION",
          ].includes(e.type)
        )
          throw new Error("备份自动事件缺少成交关联");
        if (e.type === "STOP_ADJUSTMENT" || e.type === "TARGET_ADJUSTMENT") {
          if (!e.value) throw new Error("备份价格事件缺少价格");
          current[e.type === "STOP_ADJUSTMENT" ? "stop" : "target"] = e.value;
        } else if (e.value !== null)
          throw new Error("备份观察事件存在无效价格");
      }
      last = e.at;
    }
    if (tf.length !== fillSequence) throw new Error("备份成交缺少对应事件");
    for (const k of ["quantity", "averageEntry", "realized", "fees"] as const)
      if (!D(current[k]).eq(t[k])) throw new Error("备份交易汇总与成交不一致");
    if (
      t.sequence !== fillSequence ||
      t.status !== current.status ||
      t.closedAt !== current.closedAt ||
      t.stop !== current.stop ||
      t.target !== current.target
    )
      throw new Error("备份交易状态与事件不一致");
  }
  if (
    usedFills.size !== fills.length ||
    events.some((e) => !trades.some((t) => t.id === e.tradeId))
  )
    throw new Error("备份孤立成交或持仓事件");
  const positions = new Map<string, string>(),
    quantities = new Map<string, string>();
  for (const account of state.accounts) {
    for (const e of state.assetEntries
      .filter((e) => e.accountId === account.id)
      .sort((a, b) => a.sequence - b.sequence)) {
      const key = JSON.stringify([e.accountId, e.assetId]);
      quantities.set(
        key,
        canonical(D(quantities.get(key) ?? "0").plus(e.quantityDelta)),
      );
      const fill = nextPositions.get(e.id);
      if (fill) positions.set(fill.tradeId, fill.quantity);
      const reserved = sum(
        trades
          .filter((t) => t.accountId === e.accountId && t.assetId === e.assetId)
          .map((t) => positions.get(t.id) ?? "0"),
      );
      if (D(quantities.get(key)!).lt(reserved))
        throw new Error("备份流水动用了交易占用持仓");
    }
  }
}
