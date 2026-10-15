import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3101", timezoneId: "Asia/Shanghai" },
  webServer: {
    env: {
      TICKFLOW_AUTO_SYNC: "false",
      TICKFLOW_API_KEY: "",
      SNAPSHOT_AUTO_SAVE: "false",
    },
    command:
      "npx tsx scripts/e2e-db.ts && DATABASE_URL=file:./data/e2e.db npm run db:setup && TRADEOS_BUILD_DIR=.next-e2e DATABASE_URL=file:./data/e2e.db npm run dev -- --port 3101",
    url: "http://127.0.0.1:3101",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
