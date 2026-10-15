"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { MarketSyncResult, MarketStatus } from "@/lib/services/market";
import type {
  MarketInstrument,
  MarketQuote,
} from "@/lib/integrations/tickflow";
import { when } from "@/lib/utils";
import { mutate } from "./form";
import { Button } from "./ui/button";
import { useWorkspace } from "./workspace";
type Lookup = MarketInstrument & { quote: MarketQuote | null; warning: string };
export function MarketData() {
  const { state, refresh } = useWorkspace();
  const [status, setStatus] = useState<MarketStatus | null>(null),
    [symbol, setSymbol] = useState(""),
    [found, setFound] = useState<Lookup | null>(null),
    [added, setAdded] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/market", { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        return data as MarketStatus;
      })
      .then((value) => {
        if (!controller.signal.aborted) setStatus(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("无法读取行情状态，请刷新重试");
      });
    return () => controller.abort();
  }, [state]);
  async function run(name: string, work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(name);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  return (
    <section
      className="panel"
      id="market-data"
      aria-labelledby="market-data-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="market-data-title">TickFlow行情</h2>
          <span className="detail">
            TickFlow ·{" "}
            {status
              ? status.configured
                ? status.automatic
                  ? `每日 ${(status.times ?? [status.time]).join("、")}（北京时间）`
                  : "自动更新已暂停"
                : "未配置密钥"
              : "读取中…"}
          </span>
        </div>
        <div className="actions">
          <Link className="button outline" href="/settings#tickflow">
            行情设置
          </Link>
          <Button
            variant="outline"
            disabled={!!busy || !status?.configured}
            onClick={() =>
              run("sync", async () => {
                const result = (await mutate(
                  "market.sync",
                  {},
                )) as MarketSyncResult;
                setStatus((previous) =>
                  previous ? { ...previous, last: result } : previous,
                );
                setMessage(
                  `更新 ${result.updated} 项，未变 ${result.unchanged} 项，失败 ${result.failed.length} 项。`,
                );
                refresh();
              })
            }
          >
            {busy === "sync" ? "更新中…" : "立即更新"}
          </Button>
        </div>
      </div>
      {status?.last && (
        <div className="detail">
          上次 {when(status.last.at)} · 更新 {status.last.updated} · 未变{" "}
          {status.last.unchanged}
          {(status.last.failed.length > 0 ||
            status.last.skipped.length > 0 ||
            (status.last.retained?.length ?? 0) > 0) && (
            <details className="calculation-notes">
              <summary>
                失败 {status.last.failed.length} · 跳过{" "}
                {status.last.skipped.length}
                {(status.last.retained?.length ?? 0) > 0 &&
                  ` · 手动估值优先 ${status.last.retained.length}`}
              </summary>
              {[
                ...status.last.failed,
                ...status.last.skipped,
                ...(status.last.retained ?? []),
              ].map((item, i) => (
                <p key={`${item.code}-${i}`}>
                  {item.code} · {item.message}
                </p>
              ))}
            </details>
          )}
        </div>
      )}
      <form
        aria-label="查询证券"
        onSubmit={(e) => {
          e.preventDefault();
          void run("lookup", async () => {
            setFound(null);
            setAdded("");
            const r = await fetch(
              `/api/market?${new URLSearchParams({ symbol: symbol.trim() })}`,
              { cache: "no-store" },
            );
            const data = await r.json();
            if (!r.ok) throw new Error(data.error);
            setFound(data);
          });
        }}
      >
        <fieldset className="form-fields" disabled={!!busy}>
          <div className="market-search">
            <label className="field" htmlFor="market-symbol">
              股票 / ETF代码
              <input
                id="market-symbol"
                required
                maxLength={40}
                placeholder="600000 / 510300.SH / AAPL.US"
                value={symbol}
                onChange={(e) => {
                  setSymbol(e.target.value);
                  setFound(null);
                  setAdded("");
                  setError("");
                }}
              />
            </label>
            <Button type="submit" disabled={!status?.configured}>
              {busy === "lookup" ? "查询中…" : "查询"}
            </Button>
          </div>
        </fieldset>
      </form>
      {found && (
        <div className="market-found">
          <div>
            <strong>{found.name}</strong>
            <div className="detail">
              {found.symbol} · {found.assetClass === "ETF" ? "ETF" : "股票"} ·{" "}
              {found.currency}
            </div>
            {found.quote && (
              <div>
                {found.currency} {found.quote.price}{" "}
                <span className="detail">{when(found.quote.at)}</span>
              </div>
            )}
          </div>
          {added ? (
            <Link
              className="button primary"
              href={`/wealth/transactions?assetId=${encodeURIComponent(added)}`}
            >
              录入持仓
            </Link>
          ) : (
            <Button
              disabled={!!busy}
              onClick={() =>
                run("import", async () => {
                  const result = (await mutate("market.import", {
                    symbol: found.symbol,
                  })) as { assetId: string; warning: string };
                  setAdded(result.assetId);
                  setMessage(
                    result.warning
                      ? `资产已添加。${result.warning}`
                      : "资产已添加，可录入持仓。",
                  );
                  refresh();
                })
              }
            >
              {busy === "import" ? "添加中…" : "添加资产"}
            </Button>
          )}
          {found.warning && <p className="notice">{found.warning}</p>}
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <details className="calculation-notes">
        <summary>更新说明</summary>
        <p>
          服务运行时每日更新，重启补更；失败后每{status?.retryMinutes ?? 30}
          分钟重试，最多{status?.maxAttempts ?? 3}
          次。仅更新已登记股票和ETF的行情快照，保留原始报价时间。持仓、成本与汇率不变；其他资产仍可手动维护。
        </p>
      </details>
    </section>
  );
}
