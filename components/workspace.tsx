"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { create } from "zustand";
import { RefreshCw } from "lucide-react";
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
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  return (
    <>
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          setSuccess("");
          try {
            await mutate(action, input);
            refresh();
            setSuccess(`${label}完成。`);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "处理中…" : label}
      </Button>
      {success && (
        <span role="status" className="success action-feedback">
          {success}
        </span>
      )}
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
  const { report, setReport } = useCurrency();
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    state: ClientState | null;
    error: string;
    readAt: string;
  } | null>(null);
  const key = `${report}:${revision}`;
  const state = loaded?.state ?? null,
    error = loaded?.error ?? "",
    readAt = loaded?.readAt ?? "",
    loading = loaded?.key !== key;
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/state?currency=${report}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("加载失败，请检查本地服务与数据库");
        return r.json() as Promise<ClientState>;
      })
      .then((state) => {
        if (!controller.signal.aborted)
          setLoaded({
            key,
            state,
            error: "",
            readAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
          });
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setLoaded((previous) => ({
            key,
            state: previous?.state ?? null,
            readAt: previous?.readAt ?? "",
            error: e instanceof Error ? e.message : "无法读取本地账本",
          }));
      });
    return () => controller.abort();
  }, [report, key]);
  if (!state)
    return (
      <div className="workspace-load">
        <p role={error ? "alert" : "status"}>{error || "正在读取本地账本…"}</p>
        {error ? (
          <Button onClick={refresh}>重新读取账本</Button>
        ) : (
          <div className="skeleton-grid" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
    );
  const switching = state.portfolio.currency !== report;
  return (
    <Context.Provider
      value={{ state, refresh, report: state.portfolio.currency }}
    >
      <div className="workspace-toolbar">
        <div className="workspace-summary">
          <span className="detail">
            统一账本 · {state.accounts.length} 个账户
          </span>
          {state.settings.find((s) => s.key === "demo")?.value === "true" && (
            <span className="demo-label">演示账本</span>
          )}
          <span className="detail">读取于 {readAt}</span>
        </div>
        <div className="workspace-controls">
          <label className="field">
            报告币种
            <select
              aria-label="报告币种"
              value={report}
              onChange={(e) => setReport(e.target.value)}
            >
              <option>CNY</option>
              <option>USD</option>
              <option>USDT</option>
            </select>
          </label>
          <Button
            variant="ghost"
            aria-label="刷新账本"
            disabled={loading}
            onClick={refresh}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>
      {loading && (
        <p className="notice" role="status">
          {switching
            ? `正在切换为 ${report}，以下为上次读取的 ${state.portfolio.currency} 报告…`
            : "正在刷新，以下为上次读取的账本结果…"}
        </p>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}。当前仍显示上次读取的 {state.portfolio.currency} 结果。
          <Button variant="outline" onClick={refresh} disabled={loading}>
            重新读取
          </Button>
        </div>
      )}
      <div aria-busy={loading} inert={switching || undefined}>
        {path === "/settings" ? (
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
      </div>
    </Context.Provider>
  );
}
