export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { startMarketScheduler } = await import("./lib/services/market");
    try {
      startMarketScheduler();
    } catch {
      console.error("TickFlow 配置无效，行情任务未启动；账本仍可正常使用");
    }
  }
}
