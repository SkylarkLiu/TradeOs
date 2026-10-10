"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { create } from "zustand";
import type { ClientState } from "@/lib/services/state";
import { Button } from "./ui/button";
import { mutate } from "./form";
import { WealthView } from "./wealth-view";
import { TradingView } from "./trading-view";
import { ReviewView, AnalysisView } from "./analysis-view";
import { BacktestView } from "./backtest-view";
import { FireView } from "./fire-view";
import { ReconciliationView, SettingsView } from "./data-view";
const Context = createContext<{
  state: ClientState;
  refresh: () => void;
  report: string;
}>({} as { state: ClientState; refresh: () => void; report: string });
export const useWorkspace = () => useContext(Context);
export function Action({
  action,
  input,
  label,
}: {
  action: string;
  input: unknown;
  label: string;
}) {
  const { refresh } = useWorkspace(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await mutate(action, input);
            refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "处理中…" : label}
      </Button>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
const useCurrency = create<{
  report: string;
  setReport: (report: string) => void;
}>((set) => ({ report: "CNY", setReport: (report) => set({ report }) }));
export function Workspace({
  path,
  filters,
}: {
  path: string;
  filters?: { accountId?: string; assetId?: string };
}) {
  const [state, setState] = useState<ClientState | null>(null),
    [error, setError] = useState("");
  const { report, setReport } = useCurrency();
  const sequence = useRef(0);
  const refresh = useCallback(() => {
    const requestId = ++sequence.current;
    fetch(`/api/state?currency=${report}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("加载失败，请检查本地数据库");
        return r.json();
      })
      .then((s) => {
        if (requestId === sequence.current) {
          setState(s);
          setError("");
        }
      })
      .catch((e) => {
        if (requestId === sequence.current) setError(e.message);
      });
  }, [report]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  if (!state)
    return (
      <div className="loading" role="status">
        {error || "正在读取本地账本…"}
        {error && <Button onClick={refresh}>重试</Button>}
      </div>
    );
  return (
    <Context.Provider value={{ state, refresh, report }}>
      <div className="table-tools">
        <span className="detail">
          统一账本 · {state.accounts.length}个账户
          {state.settings.find((s) => s.key === "demo")?.value === "true"
            ? " · 演示数据"
            : ""}
        </span>
        <label className="field">
          报告币种
          <select value={report} onChange={(e) => setReport(e.target.value)}>
            <option>CNY</option>
            <option>USD</option>
            <option>USDT</option>
          </select>
        </label>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {state.portfolio.currency !== report ? (
        <div className="loading">正在切换报告币种…</div>
      ) : path === "/settings" ? (
        <SettingsView />
      ) : path === "/wealth/reconciliation" ? (
        <ReconciliationView />
      ) : path.startsWith("/fire") ? (
        <FireView forecast={path === "/fire/forecast"} />
      ) : path === "/trading/backtest" ? (
        <BacktestView />
      ) : path === "/trading/reviews" ? (
        <ReviewView />
      ) : path === "/trading/analytics" ? (
        <AnalysisView />
      ) : path.startsWith("/trading") ? (
        <TradingView path={path} />
      ) : (
        <WealthView path={path} filters={filters} />
      )}
    </Context.Provider>
  );
}
