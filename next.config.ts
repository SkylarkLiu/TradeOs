import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  distDir: process.env.TRADEOS_BUILD_DIR ?? ".next",
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3"],
};
export default config;
