import { Capacitor, registerPlugin } from "@capacitor/core";
const files = registerPlugin<{
  exportJson(v: {
    name: string;
    content: string;
  }): Promise<{ cancelled: boolean }>;
  importJson(): Promise<{ cancelled: boolean; content?: string }>;
  saveBefore(v: { content: string }): Promise<void>;
  readBefore(): Promise<{ content?: string }>;
}>("TradeFiles");
export async function exportJson(
  file: unknown,
  name = "tradeos-offline-prototype.json",
) {
  const content = JSON.stringify(file, null, 2);
  if (Capacitor.isNativePlatform()) return files.exportJson({ name, content });
  const href = URL.createObjectURL(
    new Blob([content], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
  URL.revokeObjectURL(href);
  return { cancelled: false };
}
export async function importJson(): Promise<unknown | null> {
  if (Capacitor.isNativePlatform()) {
    const r = await files.importJson();
    return r.cancelled ? null : JSON.parse(r.content!);
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.oncancel = () => resolve(null);
    input.onchange = async () => {
      try {
        const f = input.files?.[0];
        if (!f) return resolve(null);
        if (f.size > 10000000) throw new Error("备份最多10MB");
        resolve(JSON.parse(await f.text()));
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}
async function backupStore() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("tradeos-prototype-backups", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function saveBefore(file: unknown) {
  const content = JSON.stringify(file);
  if (Capacitor.isNativePlatform()) {
    await files.saveBefore({ content });
    return;
  }
  const db = await backupStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("files", "readwrite");
      t.objectStore("files").put(content, "latest");
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}
export async function readBefore() {
  if (Capacitor.isNativePlatform()) {
    const r = await files.readBefore();
    return r.content ? JSON.parse(r.content) : null;
  }
  const db = await backupStore();
  try {
    return await new Promise<unknown | null>((resolve, reject) => {
      const r = db.transaction("files").objectStore("files").get("latest");
      r.onsuccess = () => resolve(r.result ? JSON.parse(r.result) : null);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
