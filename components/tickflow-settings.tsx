"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { MarketStatus, MarketSyncResult } from "@/lib/services/market";
import type { TickFlowSettings as Settings } from "@/lib/integrations/tickflow-config";
import { Button } from "./ui/button";
import { mutate } from "./form";
import { useWorkspace } from "./workspace";
import { when } from "@/lib/utils";
type Draft = Settings & { apiKey: string };
const fields = (s: MarketStatus): Draft => ({
  base: s.base,
  time: s.time,
  times: s.times ?? [s.time],
  automatic: s.automatic,
  retryMinutes: s.retryMinutes,
  maxAttempts: s.maxAttempts,
  apiKey: "",
});
export function TickFlowSettings() {
  const { refresh } = useWorkspace();
  const [status, setStatus] = useState<MarketStatus | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(""),
    [revision, setRevision] = useState(0);
  const lock = useRef(false),
    form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/market", { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        return data as MarketStatus;
      })
      .then((s) => {
        if (!controller.signal.aborted) {
          setStatus(s);
          setDraft(fields(s));
          setError("");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "无法读取行情设置");
      });
    return () => controller.abort();
  }, [revision]);
  const dirty =
    !!draft &&
    !!status &&
    (draft.apiKey.trim() !== "" ||
      JSON.stringify({ ...draft, apiKey: "" }) !==
        JSON.stringify(fields(status)));
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
      setBusy("");
      lock.current = false;
    }
  }
  return (
    <section
      className="panel"
      id="tickflow"
      aria-labelledby="tickflow-settings-title"
    >
      <div className="section-heading">
        <h2 id="tickflow-settings-title">TickFlow设置</h2>
        <Link className="text-action" href="/wealth/assets#market-data">
          查询与添加资产
        </Link>
      </div>
      {!draft || !status ? (
        <>
          <p
            role={error ? "alert" : "status"}
            className={error ? "error" : "detail"}
          >
            {error || "正在读取设置…"}
          </p>
          {error && (
            <Button variant="outline" onClick={() => setRevision((v) => v + 1)}>
              重新读取设置
            </Button>
          )}
        </>
      ) : (
        <>
          <form
            ref={form}
            aria-label="TickFlow设置"
            onChange={() => {
              setMessage("");
              setError("");
            }}
            onInvalid={(event) => {
              if (event.target instanceof HTMLInputElement) {
                const details = event.target.closest("details");
                if (details) details.open = true;
              }
            }}
            onSubmit={(e) => {
              e.preventDefault();
              void run("save", async () => {
                const saved = (await mutate(
                  "market.settings",
                  draft,
                )) as MarketStatus;
                setStatus(saved);
                setDraft(fields(saved));
                setMessage("已保存，设置即时生效。");
                refresh();
              });
            }}
          >
            <fieldset className="form-fields" disabled={!!busy}>
              <div className="form-grid">
                <label className="field">
                  自动拉取行情
                  <input
                    type="checkbox"
                    checked={draft.automatic}
                    onChange={(e) =>
                      setDraft({ ...draft, automatic: e.target.checked })
                    }
                  />
                </label>
                <div className="field wide">
                  <span>每日拉取时间（北京时间）</span>
                  <div className="actions">
                    {draft.times.map((time, index) => (
                      <div className="actions" key={index}>
                        <label className="field">
                          <span className="sr-only">拉取时间 {index + 1}</span>
                          <input
                            type="time"
                            required
                            value={time}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                times: draft.times.map((t, i) =>
                                  i === index ? e.target.value : t,
                                ),
                              })
                            }
                          />
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={draft.times.length === 1}
                          aria-label={`删除拉取时间 ${index + 1}`}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              times: draft.times.filter((_, i) => i !== index),
                            })
                          }
                        >
                          删除
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={draft.times.length >= 24}
                      onClick={() =>
                        setDraft({ ...draft, times: [...draft.times, ""] })
                      }
                    >
                      添加时间
                    </Button>
                  </div>
                </div>
                <label className="field">
                  服务节点
                  <select
                    value={draft.base}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        base: e.target.value as Settings["base"],
                      })
                    }
                  >
                    <option value="https://api.tickflow.org">默认节点</option>
                    <option value="https://hk-api.tickflow.org">
                      香港节点
                    </option>
                  </select>
                </label>
                <label className="field wide">
                  API Key{" "}
                  <span className="detail">
                    {status.configured ? "已配置" : "未配置"}
                  </span>
                  <input
                    type="password"
                    aria-label="API Key"
                    autoComplete="new-password"
                    maxLength={300}
                    placeholder={
                      status.configured
                        ? "留空保留现有密钥"
                        : "输入 TickFlow API Key"
                    }
                    value={draft.apiKey}
                    onChange={(e) =>
                      setDraft({ ...draft, apiKey: e.target.value })
                    }
                  />
                </label>
              </div>
              <details className="calculation-notes">
                <summary>重试设置</summary>
                <div className="form-grid">
                  <label className="field">
                    失败重试间隔（分钟）
                    <input
                      type="number"
                      min={5}
                      max={180}
                      required
                      value={
                        Number.isNaN(draft.retryMinutes)
                          ? ""
                          : draft.retryMinutes
                      }
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          retryMinutes: e.target.valueAsNumber,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    每轮最多尝试次数
                    <input
                      type="number"
                      min={1}
                      max={5}
                      required
                      value={
                        Number.isNaN(draft.maxAttempts) ? "" : draft.maxAttempts
                      }
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          maxAttempts: e.target.valueAsNumber,
                        })
                      }
                    />
                  </label>
                </div>
              </details>
              <div className="form-actions">
                <Button type="submit">
                  {busy === "save" ? "保存中…" : "保存设置"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!status.configured && !draft.apiKey.trim()}
                  onClick={() => {
                    if (!form.current?.reportValidity()) return;
                    void run("test", async () => {
                      await mutate("market.test", draft);
                      setMessage(
                        dirty ? "连接正常，修改尚未保存。" : "连接正常。",
                      );
                    });
                  }}
                >
                  {busy === "test" ? "测试中…" : "测试连接"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!status.configured || dirty}
                  onClick={() =>
                    run("sync", async () => {
                      const result = (await mutate(
                        "market.sync",
                        {},
                      )) as MarketSyncResult;
                      setStatus({ ...status, last: result });
                      setMessage(
                        `更新 ${result.updated} 项，未变 ${result.unchanged} 项，失败 ${result.failed.length} 项。`,
                      );
                      refresh();
                    })
                  }
                >
                  {busy === "sync" ? "拉取中…" : "立即拉取"}
                </Button>
                {dirty && (
                  <span className="detail" role="status">
                    有未保存修改
                  </span>
                )}
              </div>
            </fieldset>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <div className="report-filter-summary">
            <span>
              下次定时：{status.nextRunAt ? when(status.nextRunAt) : "未启用"}
            </span>
            <span>
              上次拉取：{status.last ? when(status.last.at) : "尚无记录"}
            </span>
          </div>
          {status.last && (
            <details className="calculation-notes">
              <summary>
                上次结果 · 更新 {status.last.updated} · 未变{" "}
                {status.last.unchanged} · 失败 {status.last.failed.length}
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
              {!status.last.failed.length &&
                !status.last.skipped.length &&
                !status.last.retained?.length && <p>本轮无异常。</p>}
            </details>
          )}
          <details className="calculation-notes">
            <summary>使用说明</summary>
            <p>
              保存后生效，无需重启。重复时间会合并并排序。服务运行时拉取行情，重启仅补最近到期时点。查询并添加资产后，再到资金流水录入账户与持仓。
            </p>
            <p>
              报价保留原始时间；较新的手动估值仍优先显示。密钥仅在本机保存，备份不包含密钥。
            </p>
          </details>
        </>
      )}
    </section>
  );
}
