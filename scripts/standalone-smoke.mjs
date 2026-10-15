import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const folder = await mkdtemp(path.join(root, "data/standalone-check-"));
let child;
try {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const env = {
    ...process.env,
    DATABASE_URL: `file:${path.join(folder, "check.db")}`,
    PORT: String(port),
    TICKFLOW_AUTO_SYNC: "false",
    TICKFLOW_API_KEY: "",
  };
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { cwd: root, env, stdio: "pipe" },
  );
  child = spawn(process.execPath, ["scripts/start.mjs"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      logs = (logs + chunk).slice(-4000);
    });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error(logs);
    try {
      const r = await fetch(`${base}/api/state`);
      if (r.ok) {
        assert.equal((await r.json()).accounts.length, 0);
        ready = true;
        break;
      }
    } catch {
      /* The child has not bound its port yet. */
    }
    await delay(100);
  }
  assert.ok(ready, logs);
  const post = async (action, input) => {
    const r = await fetch(`${base}/api/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, input }),
    });
    const result = await r.json();
    assert.ok(r.ok, result.error);
    return result.result;
  };
  const platform = await post("platform.create", { name: "独立运行验收" });
  const account = await post("account.create", {
    platformId: platform.id,
    name: "测试账户",
    currency: "CNY",
  });
  const asset = await post("asset.create", {
    code: "CASH:CNY",
    name: "人民币",
    assetClass: "CASH",
    currency: "CNY",
  });
  await post("transaction.create", {
    accountId: account.id,
    assetId: asset.id,
    type: "DEPOSIT",
    quantity: "100.01",
    at: new Date().toISOString(),
  });
  const backupResponse = await fetch(`${base}/api/backup`);
  assert.ok(backupResponse.ok);
  const file = await backupResponse.json();
  const restored = await post("backup.restore", {
    backup: file,
    checksum: file.checksum,
  });
  const before = path.join(folder, "backups", restored.beforeBackup);
  assert.deepEqual(
    JSON.parse(await readFile(before, "utf8")).payload.tables,
    file.payload.tables,
  );
  assert.equal((await stat(before)).mode & 0o777, 0o600);
  const sqliteResponse = await fetch(`${base}/api/backup?format=sqlite`);
  assert.ok(sqliteResponse.ok);
  const sqlite = Buffer.from(await sqliteResponse.arrayBuffer());
  assert.equal(sqlite.subarray(0, 16).toString(), "SQLite format 3\u0000");
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.portfolio.net, "100.01");
  const html = await (await fetch(`${base}/wealth`)).text();
  const script = html.match(/src="([^"]+\.js)"/);
  assert.ok(script);
  assert.equal((await fetch(base + script[1])).status, 200);
  console.log(
    "独立运行验收通过：静态资源、真实记账、JSON恢复、持久备份目录和SQLite备份。",
  );
} finally {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  }
  await rm(folder, { recursive: true, force: true });
}
