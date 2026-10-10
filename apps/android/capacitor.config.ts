import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "com.tradeos.offline.prototype",
  appName: "TradeOS 离线样机",
  loggingBehavior: "none",
  webDir: "dist",
  server: { androidScheme: "https" },
  android: { allowMixedContent: false },
  plugins: { CapacitorSQLite: { androidIsEncryption: false } },
};
export default config;
