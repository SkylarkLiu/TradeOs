import { cp, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });
const standalone = path.join(root, ".next/standalone");
await access(path.join(standalone, "server.js"));
await cp(
  path.join(root, ".next/static"),
  path.join(standalone, ".next/static"),
  { recursive: true },
);
try {
  await access(path.join(root, "public"));
  await cp(path.join(root, "public"), path.join(standalone, "public"), {
    recursive: true,
  });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
// The standalone server changes cwd; retain the user's database in the project root.
const configured = process.env.DATABASE_URL ?? "file:./data/tradeos.db";
if (!configured.startsWith("file:"))
  throw new Error("DATABASE_URL必须为SQLite file路径");
const database = `file:${path.resolve(root, configured.slice(5))}`;
const child = spawn(process.execPath, [path.join(standalone, "server.js")], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: database,
    HOSTNAME: "127.0.0.1",
    PORT: process.env.PORT ?? "3000",
  },
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
