import "dotenv/config";
import { defineConfig } from "prisma/config";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
const file = path.resolve(
  (process.env.DATABASE_URL ?? "file:./data/tradeos.db").replace(/^file:/, ""),
);
mkdirSync(path.dirname(file), { recursive: true });
if (!existsSync(file)) new Database(file).close();
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: `file:${file}` },
});
