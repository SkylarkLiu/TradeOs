import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3200", timezoneId: "Asia/Shanghai" },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3200",
    reuseExistingServer: false,
  },
});
