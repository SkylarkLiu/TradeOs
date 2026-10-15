"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
  type UTCTimestamp,
  type SeriesMarker,
} from "lightweight-charts";
import type { BacktestState } from "@/lib/services/backtest";
import { useWorkspace } from "./workspace";
import { Form, mutate } from "./form";
import { Heading, Metrics } from "./wealth-view";
import { Table } from "./table";
import { Button } from "./ui/button";
import { Chart } from "./charts";
import { amount, pct, day } from "@/lib/utils";
export function BacktestView() {
  const { state: s, refresh } = useWorkspace(),
    [sessionId, setSessionId] = useState(""),
    [data, setData] = useState<BacktestState | null>(null),
    [csv, setCsv] = useState(""),
    [gaps, setGaps] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1000);
  const lock = useRef(false);
  const load = useCallback(async () => {
    if (!sessionId) return;
    const r = await fetch(`/api/backtest?id=${sessionId}`, {
        cache: "no-store",
      }),
      value = await r.json();
    if (!r.ok) throw new Error(value.error);
    return value as BacktestState;
  }, [sessionId]);
  useEffect(() => {
    let active = true;
    load()
      .then((v) => {
        if (active && v) setData(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [load, s]);
  const execute = useCallback(
    async (action: string, input: unknown) => {
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      try {
        await mutate(action, input);
        const v = await load();
        if (v) setData(v);
        setError("");
      } catch (e) {
        setError((e as Error).message);
        setPlaying(false);
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [load],
  );
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => execute("backtest.step", { sessionId, direction: "NEXT" }),
      speed,
    );
    return () => clearInterval(timer);
  }, [playing, speed, sessionId, execute]);
  const versions = s.strategies
    .filter((st) => !st.archived)
    .flatMap((st) =>
      st.versions
        .filter((v) => v.published)
        .map((v) => ({ value: v.id, label: `${st.name} v${v.version}` })),
    );
  return (
    <>
      <Heading title="手动历史回测" />
      <p className="detail">模拟回测 · 不计入真实账本</p>
      <Form
        title="创建回测任务"
        action="backtest.create"
        onDone={refresh}
        fields={[
          { name: "name", label: "任务名称" },
          {
            name: "assetId",
            label: "交易品种",
            options: s.assets
              .filter((a) => a.assetClass !== "CASH")
              .map((a) => ({ value: a.id, label: a.code })),
          },
          {
            name: "strategyVersionId",
            label: "已发布策略版本",
            options: versions,
          },
          {
            name: "timeframe",
            label: "K线周期",
            value: "1d",
            options: ["1m", "5m", "15m", "1h", "4h", "1d", "1w"].map((v) => ({
              value: v,
              label: v,
            })),
          },
          {
            name: "initialCapital",
            label: "初始模拟资金（结算币种）",
            value: "100000",
          },
          {
            name: "adjustment",
            label: "输入数据复权规则",
            value: "RAW",
            options: [
              { value: "RAW", label: "不复权" },
              { value: "FORWARD", label: "前复权（输入数据已处理）" },
              { value: "BACKWARD", label: "后复权（输入数据已处理）" },
            ],
          },
          { name: "feeRate", label: "手续费率（0.001=0.1%）", value: "0.001" },
          { name: "slippageBps", label: "滑点（基点，1=0.01%）", value: "0" },
        ]}
      />
      <section className="panel">
        <h2>回测任务</h2>
        <label className="field">
          选择任务
          <select
            value={sessionId}
            onChange={(e) => {
              setSessionId(e.target.value);
              setData(null);
              setPlaying(false);
              setCsv("");
              setError("");
            }}
          >
            <option value="">请选择</option>
            {s.sessions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.asset.code} · {t._count.candles}根
              </option>
            ))}
          </select>
        </label>
      </section>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {sessionId && data && (
        <>
          {data.session._count.candles === 0 ? (
            <section className="panel">
              <h2>导入历史OHLCV</h2>
              <p className="detail">
                CSV字段为at,open,high,low,close,volume。时间使用含时区ISO或Unix秒/毫秒，必须严格递增。复权声明为
                {data.session.adjustment}
                ，系统不会重新复权；输入数据需避免使用未来信息生成指标。
              </p>
              <label className="field">
                历史数据CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setCsv(await f.text());
                  }}
                />
              </label>
              <label className="field">
                确认并允许休市 / 时间缺口
                <input
                  type="checkbox"
                  checked={gaps}
                  onChange={(e) => setGaps(e.target.checked)}
                />
              </label>
              <Button
                disabled={!csv || busy}
                onClick={() =>
                  execute("backtest.import", {
                    sessionId,
                    csv,
                    allowGaps: gaps,
                  })
                }
              >
                校验并导入
              </Button>
            </section>
          ) : (
            <>
              <Metrics
                items={[
                  {
                    label: "当前进度",
                    value: `${data.session.cursor + 1} / ${data.session._count.candles}`,
                    note: `分支${data.session.branch}`,
                  },
                  {
                    label: "模拟权益",
                    value: amount(data.report.equity, data.session.currency),
                  },
                  { label: "累计收益", value: pct(data.report.totalReturn) },
                  { label: "最大回撤", value: pct(data.report.drawdown) },
                ]}
              />
              <section className="panel">
                <h2>{data.session.asset.code} · 历史回放</h2>
                <div className="actions">
                  <Button
                    variant="outline"
                    disabled={busy || data.session.cursor === 0 || playing}
                    onClick={() =>
                      execute("backtest.step", {
                        sessionId,
                        direction: "PREVIOUS",
                      })
                    }
                  >
                    上一根 · 新分支
                  </Button>
                  <Button
                    disabled={
                      busy ||
                      data.session.cursor + 1 >= data.session._count.candles ||
                      playing
                    }
                    onClick={() =>
                      execute("backtest.step", { sessionId, direction: "NEXT" })
                    }
                  >
                    下一根
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      data.session.cursor + 1 >= data.session._count.candles
                    }
                    onClick={() => setPlaying(!playing)}
                  >
                    {playing ? "暂停" : "播放"}
                  </Button>
                  <label className="field">
                    播放间隔
                    <select
                      value={speed}
                      onChange={(e) => setSpeed(Number(e.target.value))}
                    >
                      <option value={2000}>2秒</option>
                      <option value={1000}>1秒</option>
                      <option value={500}>0.5秒</option>
                    </select>
                  </label>
                </div>
                <CandleChart data={data} />
                <p className="detail">
                  仅显示已回放K线；信号在当前收盘决定，止损/止盈从下一根生效。同根触发两者先按止损，跳空止损按更差开盘价，再计滑点和费用。
                </p>
              </section>
              <div className="equal-col">
                <Form
                  title="标记模拟入场"
                  action="backtest.entry"
                  onDone={() => {
                    load()
                      .then((v) => {
                        if (v) setData(v);
                      })
                      .catch((e) => setError(e.message));
                    refresh();
                  }}
                  transform={(d) => ({ ...d, sessionId })}
                  fields={[
                    {
                      name: "direction",
                      label: "方向",
                      value: "LONG",
                      options: [
                        { value: "LONG", label: "做多" },
                        { value: "SHORT", label: "做空（合约）" },
                      ],
                    },
                    { name: "quantity", label: "数量" },
                    { name: "stop", label: "止损价" },
                    { name: "target", label: "止盈价" },
                  ]}
                />
                <Form
                  title="添加图表标注"
                  action="backtest.annotation"
                  onDone={() => {
                    load()
                      .then((v) => {
                        if (v) setData(v);
                      })
                      .catch((e) => setError(e.message));
                  }}
                  transform={(d) => ({ ...d, sessionId })}
                  fields={[
                    { name: "price", label: "标注价格" },
                    { name: "label", label: "观察记录" },
                  ]}
                />
              </div>
              <section className="panel">
                <h2>当前分支模拟交易</h2>
                <Table
                  rows={data.trades}
                  columns={[
                    { key: "dir", label: "方向", value: (r) => r.direction },
                    {
                      key: "entry",
                      label: "入场 / 止损 / 止盈",
                      value: (r) => `${r.entry} / ${r.stop} / ${r.target}`,
                    },
                    { key: "qty", label: "数量", value: (r) => r.quantity },
                    {
                      key: "exit",
                      label: "出场",
                      value: (r) => r.exit ?? "持仓中",
                    },
                    {
                      key: "fee",
                      label: "入场 / 出场费",
                      value: (r) => `${r.fee} / ${r.exitFee}`,
                    },
                    {
                      key: "pnl",
                      label: "净已实现",
                      value: (r) => amount(r.realized, data.session.currency),
                    },
                    {
                      key: "action",
                      label: "操作",
                      value: (r) =>
                        !r.exit ? (
                          <Button
                            variant="outline"
                            disabled={busy || playing}
                            onClick={() =>
                              execute("backtest.exit", {
                                sessionId,
                                tradeId: r.id,
                              })
                            }
                          >
                            当前收盘价平仓
                          </Button>
                        ) : (
                          "已平仓"
                        ),
                    },
                  ]}
                />
              </section>
              <Metrics
                items={[
                  { label: "已平仓交易", value: String(data.report.count) },
                  { label: "胜率", value: pct(data.report.winRate) },
                  {
                    label: "盈亏因子",
                    value: data.report.profitFactor ?? "无有限值",
                  },
                  { label: "平均R", value: data.report.averageR ?? "数据不足" },
                ]}
              />
              <section className="panel">
                <h2>模拟权益曲线</h2>
                <Chart
                  labels={data.equity.map((p) => day(p.at))}
                  series={[
                    {
                      name: "模拟权益",
                      values: data.equity.map((p) => p.value),
                    },
                  ]}
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    const url = URL.createObjectURL(
                      new Blob(
                        [
                          JSON.stringify(
                            {
                              session: data.session,
                              report: data.report,
                              trades: data.trades,
                              equity: data.equity,
                            },
                            null,
                            2,
                          ),
                        ],
                        { type: "application/json" },
                      ),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `backtest-${data.session.id}-branch-${data.session.branch}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  导出当前分支报告
                </Button>
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
function CandleChart({ data }: { data: BacktestState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !data.candles.length) return;
    const css = getComputedStyle(document.documentElement),
      bg = css.getPropertyValue("--panel").trim(),
      text = css.getPropertyValue("--muted").trim(),
      line = css.getPropertyValue("--line").trim();
    const chart = createChart(ref.current, {
        height: 380,
        autoSize: true,
        layout: { background: { color: bg }, textColor: text },
        grid: { vertLines: { color: line }, horzLines: { color: line } },
        timeScale: { timeVisible: true },
      }),
      series = chart.addSeries(CandlestickSeries, {
        upColor: "#64d4b1",
        downColor: "#e68791",
        wickUpColor: "#64d4b1",
        wickDownColor: "#e68791",
        borderVisible: false,
      });
    const time = (index: number) =>
      Math.floor(
        new Date(data.candles[index].at).getTime() / 1000,
      ) as UTCTimestamp;
    series.setData(
      data.candles.map((c, i) => ({
        time: time(i),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      })),
    );
    const markers: SeriesMarker<UTCTimestamp>[] = [];
    for (const t of data.trades) {
      markers.push({
        time: time(t.entryIndex),
        position: t.direction === "LONG" ? "belowBar" : "aboveBar",
        shape: t.direction === "LONG" ? "arrowUp" : "arrowDown",
        color: "#64d4b1",
        text: `入场 ${t.quantity}`,
      });
      if (t.exitIndex !== null)
        markers.push({
          time: time(t.exitIndex),
          position: "aboveBar",
          shape: "circle",
          color: "#e68791",
          text: "平仓",
        });
      else {
        series.createPriceLine({
          price: Number(t.stop),
          color: "#e68791",
          lineWidth: 1,
          title: "止损",
        });
        series.createPriceLine({
          price: Number(t.target),
          color: "#64d4b1",
          lineWidth: 1,
          title: "止盈",
        });
      }
    }
    for (const a of data.annotations) {
      series.createPriceLine({
        price: Number(a.price),
        color: "#6f9fd8",
        lineWidth: 1,
        title: a.label,
      });
    }
    createSeriesMarkers(
      series,
      markers.sort((a, b) => Number(a.time) - Number(b.time)),
    );
    chart.timeScale().fitContent();
    const syncTheme = () => {
      const css = getComputedStyle(document.documentElement),
        light = document.documentElement.dataset.theme === "light";
      chart.applyOptions({
        layout: {
          background: { color: css.getPropertyValue("--panel").trim() },
          textColor: css.getPropertyValue("--muted").trim(),
        },
        grid: {
          vertLines: { color: css.getPropertyValue("--line").trim() },
          horzLines: { color: css.getPropertyValue("--line").trim() },
        },
      });
      series.applyOptions({
        upColor: light ? "#14795c" : "#64d4b1",
        downColor: light ? "#a73d50" : "#e68791",
        wickUpColor: light ? "#14795c" : "#64d4b1",
        wickDownColor: light ? "#a73d50" : "#e68791",
      });
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [data]);
  return (
    <>
      <div
        ref={ref}
        style={{ height: 380, marginTop: 20 }}
        role="img"
        aria-label="仅含已回放数据的历史K线图"
      />
      <a
        href="https://www.tradingview.com/"
        target="_blank"
        rel="noreferrer"
        className="detail"
      >
        图表由TradingView Lightweight Charts提供
      </a>
    </>
  );
}
