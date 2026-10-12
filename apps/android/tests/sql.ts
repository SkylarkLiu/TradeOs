import Database from "better-sqlite3";
import { Ledger } from "../src/ledger";
import type { Sql } from "../src/sql";
export function setup() {
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
