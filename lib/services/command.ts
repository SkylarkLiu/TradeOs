import { wealthCommand } from "./wealth";
import { importCommand } from "./imports";
import { tradingCommand } from "./trading";
import { reviewCommand } from "./analytics";
import { backtestCommand } from "./backtest";
import { fireCommand } from "./fire";
import { dataCommand } from "./data";
export async function command(action: string, input: unknown) {
  if (action === "fire.save") return fireCommand(input);
  if (
    ["backup.", "reconcile.", "ledger.", "setting."].some((p) =>
      action.startsWith(p),
    )
  )
    return dataCommand(action, input);
  if (action.startsWith("backtest.")) return backtestCommand(action, input);
  if (action.startsWith("review.")) return reviewCommand(action, input);
  if (
    ["strategy.", "plan.", "trade.", "fill.", "position.", "attachment."].some(
      (p) => action.startsWith(p),
    )
  )
    return tradingCommand(action, input);
  if (action.startsWith("import.")) return importCommand(action, input);
  return wealthCommand(action, input);
}
