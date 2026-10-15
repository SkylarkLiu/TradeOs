"use client";
import { useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { MarketSyncResult } from "@/lib/services/market";
import { Button } from "./ui/button";
import { mutate } from "./form";
import { useWorkspace } from "./workspace";
export function HoldingQuoteUpdate({
  assetIds,
  label = "更新持仓行情",
  name,
}: {
  assetIds?: string[];
  label?: string;
  name?: string;
}) {
  const { state, refresh } = useWorkspace();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState<MarketSyncResult | null>(null);
  const lock = useRef(false);
  const eligible = new Set(
    state.assets
      .filter(
        (a) =>
          ["STOCK", "ETF"].includes(a.assetClass) && a.instrument === "SPOT",
      )
      .map((a) => a.id),
  );
  const ids = [
    ...new Set(
      (assetIds ?? state.portfolio.rows.map((r) => r.assetId)).filter((id) =>
        eligible.has(id),
      ),
    ),
  ];
  return (
    <div className="holding-quote-update">
      <Button
        variant="outline"
        disabled={busy || !ids.length}
        aria-label={name ? `更新${name}行情` : label}
        title={!ids.length ? "暂无可自动更新的股票或ETF持仓" : undefined}
        onClick={async () => {
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError("");
          setResult(null);
          try {
            const data = (await mutate("market.sync", {
              assetIds: ids,
            })) as MarketSyncResult;
            setResult(data);
            refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "更新失败，请重试");
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <RefreshCw size={14} aria-hidden="true" />
        {busy ? "更新中…" : label}
      </Button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {result && (
        <div className="detail" role="status">
          {result.retained?.length
            ? `已拉取行情 · ${result.retained.length}项手动估值优先`
            : result.updated + result.unchanged > 0
              ? `行情已拉取 · 写入 ${result.updated} · 未变 ${result.unchanged}`
              : "没有可更新的行情"}
          {result.failed.length > 0 && ` · 失败 ${result.failed.length}`}
          {(result.failed.length > 0 || result.skipped.length > 0) && (
            <details className="calculation-notes">
              <summary>查看原因</summary>
              {[...result.failed, ...result.skipped].map((item, i) => (
                <p key={`${item.code}-${i}`}>
                  {item.code} · {item.message}
                </p>
              ))}
            </details>
          )}
        </div>
      )}
    </div>
  );
}
