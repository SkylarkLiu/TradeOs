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
export type State = { accounts: Account[]; entries: Entry[] };
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
  const file = z
    .object({
      kind: z.literal("tradeos-android-prototype"),
      version: z.literal(1),
      payload: z.object({
        createdAt: date.transform((d) => d.toISOString()),
        accounts: z.array(accountSchema).max(1000),
        entries: z.array(entrySchema).max(100000),
      }),
      checksum: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .parse(raw);
  if ((await digest(file.payload)) !== file.checksum)
    throw new Error("备份校验和不一致");
  const ids = new Set<string>();
  const entryIds = new Set<string>();
  for (const a of file.payload.accounts) {
    if (ids.has(a.id)) throw new Error("备份账户ID重复");
    ids.add(a.id);
    let balance = D(0),
      sequence = 0,
      last = "";
    for (const e of file.payload.entries
      .filter((e) => e.accountId === a.id)
      .sort((a, b) => a.sequence - b.sequence)) {
      if (
        e.sequence !== ++sequence ||
        e.at < last ||
        new Date(e.at) > new Date()
      )
        throw new Error("备份流水顺序或时间无效");
      const q = D(e.amount);
      if (q.eq(0) || (e.type !== "ADJUSTMENT" && q.lte(0)))
        throw new Error("备份流水数量无效");
      const expected = (e.type === "WITHDRAWAL" ? q.neg() : q).minus(e.fee);
      if (!expected.eq(e.delta)) throw new Error("备份流水净额不一致");
      balance = balance.plus(e.delta);
      if (balance.lt(0)) throw new Error("备份出现负余额");
      last = e.at;
    }
    if (!balance.eq(a.balance) || sequence !== a.sequence)
      throw new Error("备份余额与流水不一致");
  }
  for (const e of file.payload.entries) {
    if (!ids.has(e.accountId) || entryIds.has(e.id))
      throw new Error("备份关联账户不存在或流水ID重复");
    entryIds.add(e.id);
  }
  return file;
}
export class Ledger {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private db: Sql) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.pending.then(work);
    this.pending = result.catch(() => undefined);
    return result;
  }
  async init() {
    await this.db.batch(schema.map((statement) => ({ statement, values: [] })));
  }
  private async read(): Promise<State> {
    return {
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
          "SELECT at FROM CashLedger WHERE accountId=? ORDER BY sequence DESC LIMIT 1",
          [a.id],
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
  backup() {
    return this.serial(async () => {
      const s = await this.read();
      const payload = { createdAt: new Date().toISOString(), ...s };
      return {
        kind: "tradeos-android-prototype" as const,
        version: 1 as const,
        payload,
        checksum: await digest(payload),
      };
    });
  }
  restore(raw: unknown) {
    return this.serial(async () => {
      const file = await validateBackup(raw);
      await this.db.batch([
        { statement: "DELETE FROM CashLedger", values: [] },
        { statement: "DELETE FROM FinancialAccount", values: [] },
        ...file.payload.accounts.map(accountInsert),
        ...file.payload.entries
          .sort((a, b) => a.sequence - b.sequence)
          .map(entryInsert),
      ]);
    });
  }
}
