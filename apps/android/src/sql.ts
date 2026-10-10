import { Capacitor } from "@capacitor/core";
import { CapacitorSQLite, SQLiteConnection } from "@capacitor-community/sqlite";
import initSqlJs from "sql.js";
import wasm from "sql.js/dist/sql-wasm.wasm?url";
export type Statement = {
  statement: string;
  values: (string | number | null)[];
};
export interface Sql {
  query(
    sql: string,
    values?: (string | number | null)[],
  ): Promise<Record<string, unknown>[]>;
  batch(statements: Statement[]): Promise<void>;
  close(): Promise<void>;
}
const connections = new SQLiteConnection(CapacitorSQLite);
export async function nativeSql(name = "tradeos_prototype"): Promise<Sql> {
  const connection = await connections.createConnection(
    name,
    false,
    "no-encryption",
    1,
    false,
  );
  await connection.open();
  await connection.execute("PRAGMA foreign_keys=ON;");
  return {
    query: async (sql, values = []) =>
      (await connection.query(sql, values)).values ?? [],
    batch: async (set) => {
      await connection.executeSet(set, true);
    },
    close: async () => {
      await connections.closeConnection(name, false);
    },
  };
}
function indexed(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("tradeos-prototype-browser", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("sqlite");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function browserSql(name = "tradeos_prototype"): Promise<Sql> {
  const store = await indexed();
  const bytes = await new Promise<Uint8Array | undefined>((resolve, reject) => {
    const r = store.transaction("sqlite").objectStore("sqlite").get(name);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const SQL = await initSqlJs({ locateFile: () => wasm });
  let db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.run("PRAGMA foreign_keys=ON;");
  const save = () =>
    new Promise<void>((resolve, reject) => {
      const t = store.transaction("sqlite", "readwrite");
      t.objectStore("sqlite").put(db.export(), name);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  return {
    query: async (sql, values = []) => {
      const q = db.prepare(sql);
      try {
        q.bind(values);
        const result: Record<string, unknown>[] = [];
        while (q.step()) result.push(q.getAsObject());
        return result;
      } finally {
        q.free();
      }
    },
    batch: async (set) => {
      const previous = db.export();
      try {
        db.run("BEGIN");
        for (const r of set) db.run(r.statement, r.values);
        db.run("COMMIT");
        await save();
      } catch (e) {
        try {
          db.run("ROLLBACK");
        } catch {
          /* COMMIT may have completed before IndexedDB failed. */
        }
        db.close();
        db = new SQL.Database(previous);
        db.run("PRAGMA foreign_keys=ON;");
        throw new Error(
          `本地写入失败，请关闭后重新打开应用；${e instanceof Error ? e.message : "事务失败"}。未持久化数据不会在重启后保留。`,
        );
      }
    },
    close: async () => {
      db.close();
      store.close();
    },
  };
}
export const openSql = () =>
  Capacitor.isNativePlatform() ? nativeSql() : browserSql();
