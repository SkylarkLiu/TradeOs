"use client";
import { useState, useEffect, useId } from "react";
import Link from "next/link";
import { Button } from "./ui/button";
import Markdown from "react-markdown";
import { Form } from "./form";
import { useWorkspace } from "./workspace";
import { Table } from "./table";
import { Heading, Metrics } from "./wealth-view";
import { Chart } from "./charts";
import type { AnalyticsResult } from "@/lib/services/analytics";
import { defaultScoreRules } from "@/lib/review-rules";
import { amount, pct, when, day } from "@/lib/utils";
import { D } from "@/lib/calculations/decimal";
export function ReviewView() {
  const { state: s, refresh } = useWorkspace();
  const setting = s.settings.find((r) => r.key === "scoreRules"),
    rules = JSON.parse(
      setting?.value ?? JSON.stringify(defaultScoreRules),
    ) as typeof defaultScoreRules;
  return (
    <>
      <Heading
        title="交易复盘"
        description="评价规则、风险与执行，不用盈利或亏损替代交易质量。"
      />
      <Form
        title="写下复盘"
        action="review.create"
        onDone={refresh}
        fields={[
          {
            name: "period",
            label: "复盘范围",
            value: "TRADE",
            options: [
              { value: "TRADE", label: "单笔交易" },
              { value: "WEEK", label: "周复盘" },
              { value: "MONTH", label: "月复盘" },
            ],
          },
          {
            name: "tradeId",
            label: "已平仓交易（单笔必选）",
            optional: true,
            options: s.trades
              .filter((t) => t.status === "CLOSED")
              .map((t) => ({
                value: t.id,
                label: `${t.asset.code} · ${when(t.closedAt!)}`,
              })),
          },
          { name: "at", label: "复盘时间", type: "datetime-local" },
          ...rules.map((r) => ({
            name: `score:${r.name}`,
            label: `${r.name}（0–${r.max}）`,
            type: "integer",
            value: "0",
          })),
          {
            name: "tags",
            label: "标签（逗号分隔）",
            optional: true,
            help: "FOMO、REVENGE_TRADING、OVERTRADING、EARLY_EXIT、LATE_ENTRY、STOP_LOSS_VIOLATION、PLAN_COMPLIANT、GOOD_EXECUTION",
          },
          {
            name: "content",
            label: "过程、偏差、经验和下一步（Markdown）",
            type: "textarea",
            wide: true,
          },
        ]}
        transform={(data) => {
          const scores = Object.fromEntries(
            rules.map((r) => [r.name, Number(data[`score:${r.name}`])]),
          );
          return {
            tradeId: data.tradeId,
            period: data.period,
            at: data.at,
            scores,
            tags: String(data.tags ?? "")
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
            content: data.content,
          };
        }}
      />
      <section className="panel">
        <h2>复盘记录</h2>
        {!s.reviews.length && (
          <div className="empty">
            平仓后完成第一篇复盘，也可以记录周/月总结。
          </div>
        )}
        <div className="record-list">
          {s.reviews.map((r) => {
            const score = JSON.parse(r.scores) as {
              values: Record<string, number>;
              rules: typeof rules;
            };
            const total =
              score.rules.reduce(
                (n, x) => n + (score.values[x.name] / x.max) * x.weight,
                0,
              ) / score.rules.reduce((n, x) => n + x.weight, 0);
            return (
              <article className="record" key={r.id}>
                <h3>
                  {r.trade?.asset.code ??
                    (r.period === "WEEK" ? "周复盘" : "月复盘")}{" "}
                  · {when(r.at)}{" "}
                  <span className="badge">
                    过程评分 {(total * 100).toFixed(0)} / 100
                  </span>
                </h3>
                <p className="detail">
                  {Object.entries(score.values)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(" · ")}{" "}
                  · {JSON.parse(r.tags).join(", ")}
                </p>
                <div className="markdown">
                  <Markdown>{r.content}</Markdown>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <Form
        title="自定义评分规则"
        action="review.rules"
        onDone={refresh}
        fields={[
          {
            name: "rules",
            label: "规则JSON：name、max、weight、compliance、threshold",
            type: "textarea",
            wide: true,
            value: JSON.stringify(rules, null, 2),
          },
        ]}
        transform={(d) => JSON.parse(String(d.rules))}
      />
      <p className="detail">
        新规则只影响后续复盘，历史评分保留当时的满分、权重和合规门槛。
      </p>
    </>
  );
}
type ReportFilters = Record<string, string>;
const reportTabs = [
  ["trades", "交易表现"],
  ["account", "账户收益"],
  ["sources", "增长来源"],
] as const;
type ReportTab = (typeof reportTabs)[number][0];
const cleanFilters = (filters: ReportFilters) =>
  Object.fromEntries(
    Object.entries(filters)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

export function AnalysisView({ wealth = false }: { wealth?: boolean }) {
  const { state: s, report } = useWorkspace(),
    id = useId(),
    [draft, setDraft] = useState<ReportFilters>({}),
    [applied, setApplied] = useState<ReportFilters>({}),
    [tab, setTab] = useState<ReportTab>(wealth ? "account" : "trades"),
    [revision, setRevision] = useState(0),
    [formError, setFormError] = useState(""),
    [response, setResponse] = useState<{
      query: string;
      revision: number;
      source: typeof s;
      result: AnalyticsResult | null;
      error: string;
      fetchedAt: string;
    } | null>(null);
  const query = new URLSearchParams({
      ...applied,
      currency: report,
    }).toString(),
    current =
      response?.query === query &&
      response.source === s &&
      response.revision === revision
        ? response
        : null,
    loading = current === null,
    result = current?.result,
    dirty =
      JSON.stringify(cleanFilters(draft)) !==
      JSON.stringify(cleanFilters(applied));

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/analytics?${query}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "报表加载失败，请重试。");
        return data as AnalyticsResult;
      })
      .then((result) => {
        if (!controller.signal.aborted)
          setResponse({
            query,
            revision,
            source: s,
            result,
            error: "",
            fetchedAt: new Date().toISOString(),
          });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResponse({
            query,
            revision,
            source: s,
            result: null,
            fetchedAt: "",
            error:
              error instanceof TypeError
                ? "无法连接本地服务，请确认 TradeOS 已启动后重试。"
                : error instanceof Error
                  ? error.message
                  : "报表加载失败，请重试。",
          });
      });
    return () => controller.abort();
  }, [query, revision, s]);

  const fields = [
    [
      "accountId",
      "账户",
      s.accounts.map((a) => ({ value: a.id, label: a.name })),
    ],
    [
      "assetId",
      "资产",
      s.assets.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
    ],
    [
      "strategyId",
      "策略",
      s.strategies.map((st) => ({ value: st.id, label: st.name })),
    ],
    [
      "strategyVersionId",
      "策略版本",
      s.strategies
        .filter((st) => !draft.strategyId || st.id === draft.strategyId)
        .flatMap((st) =>
          st.versions.map((v) => ({
            value: v.id,
            label: `${st.name} v${v.version}`,
          })),
        ),
    ],
    [
      "direction",
      "多空方向",
      [
        { value: "LONG", label: "做多" },
        { value: "SHORT", label: "做空" },
      ],
    ],
  ] as const;
  const updateDraft = (key: string, value: string) => {
    setDraft((previous) => ({
      ...previous,
      [key]: value,
      ...(key === "strategyId" ? { strategyVersionId: "" } : {}),
    }));
    setFormError("");
  };
  const selectField = ([key, label, options]: (typeof fields)[number]) => (
    <label className="field" key={key}>
      {label}
      <select
        name={key}
        value={draft[key] ?? ""}
        onChange={(e) => updateDraft(key, e.target.value)}
      >
        <option value="">全部</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const appliedSummary = [
    ...fields.flatMap(([key, label]) => {
      if (key === "accountId" || !applied[key]) return [];
      const options =
        key === "strategyVersionId"
          ? s.strategies.flatMap((st) =>
              st.versions.map((v) => ({
                value: v.id,
                label: `${st.name} v${v.version}`,
              })),
            )
          : fields.find(([field]) => field === key)![2];
      return [
        `${label}：${options.find((o) => o.value === applied[key])?.label ?? applied[key]}`,
      ];
    }),
    ...(
      [
        ["environment", "市场环境"],
        ["tag", "交易标签"],
      ] as const
    ).flatMap(([key, label]) =>
      applied[key] ? [`${label}：${applied[key]}`] : [],
    ),
  ];
  const accountName =
      s.accounts.find((a) => a.id === applied.accountId)?.name ?? "全部账户",
    dateRange =
      applied.start || applied.end
        ? `${applied.start ?? "最早记录"} 至 ${applied.end ?? "最新记录"}`
        : "全部已记录日期",
    tradeOnlyFilters = [
      "assetId",
      "strategyId",
      "strategyVersionId",
      "direction",
      "environment",
      "tag",
    ].some((key) => applied[key]);

  return (
    <>
      {wealth ? (
        <div className="report-section-heading">
          <h2>资产收益分析</h2>
          <p className="detail">分开查看交易表现、账户收益与资产增长来源。</p>
        </div>
      ) : (
        <Heading
          title="绩效分析"
          description="先确定范围，再分别查看交易表现、账户收益与增长来源。"
        >
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => setRevision((v) => v + 1)}
          >
            刷新报表
          </Button>
        </Heading>
      )}
      <form
        className="panel reports-filter"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.start && draft.end && draft.start > draft.end) {
            setFormError(
              "开始日期不能晚于结束日期，请调整日期后重新应用筛选。",
            );
            return;
          }
          setFormError("");
          setApplied(cleanFilters(draft));
          setRevision((v) => v + 1);
        }}
      >
        <div className="report-filter-heading">
          <h2>筛选范围</h2>
          <span className="detail">日期按北京时间，交易按平仓日期筛选</span>
        </div>
        <div className="form-grid">
          {selectField(fields[0])}
          {(
            [
              ["start", "开始日期"],
              ["end", "结束日期"],
            ] as const
          ).map(([key, label]) => (
            <label className="field" key={key}>
              {label}
              <input
                name={key}
                type="date"
                value={draft[key] ?? ""}
                aria-invalid={!!formError}
                aria-describedby={formError ? `${id}-filter-error` : undefined}
                onChange={(e) => updateDraft(key, e.target.value)}
              />
            </label>
          ))}
        </div>
        <details className="report-advanced">
          <summary>
            更多交易筛选
            {[
              "assetId",
              "strategyId",
              "strategyVersionId",
              "direction",
              "environment",
              "tag",
            ].some((key) => draft[key])
              ? " · 已设置"
              : ""}
          </summary>
          <div className="form-grid">
            {fields.slice(1).map(selectField)}
            {(
              [
                ["environment", "市场环境", 300],
                ["tag", "交易标签", 60],
              ] as const
            ).map(([key, label, maxLength]) => (
              <label className="field" key={key}>
                {label}
                <input
                  name={key}
                  maxLength={maxLength}
                  value={draft[key] ?? ""}
                  onChange={(e) => updateDraft(key, e.target.value)}
                />
              </label>
            ))}
          </div>
          <p className="detail">
            资产、策略、版本、方向、环境和标签只筛选已平仓交易；账户收益和增长来源只按账户与日期统计。
          </p>
        </details>
        <div className="report-filter-actions">
          <div className="actions">
            <Button type="submit" disabled={loading && !dirty}>
              应用筛选
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraft({});
                setApplied({});
                setFormError("");
                setRevision((v) => v + 1);
              }}
            >
              重置筛选
            </Button>
            {wealth && (
              <Button
                type="button"
                variant="ghost"
                disabled={loading}
                onClick={() => setRevision((v) => v + 1)}
              >
                刷新报表
              </Button>
            )}
          </div>
          <span className="detail" role="status">
            {dirty
              ? "筛选已修改，点击“应用筛选”后更新报表。"
              : "报表使用下方已应用范围。"}
          </span>
        </div>
        {formError && (
          <p className="error" role="alert" id={`${id}-filter-error`}>
            {formError}
          </p>
        )}
      </form>
      <div className="report-filter-summary">
        <div>
          <strong>已应用范围</strong>
          <p className="detail">
            {accountName} · {dateRange} · 报告币种 {report}
          </p>
        </div>
        {appliedSummary.length > 0 && (
          <div className="report-filter-chips" aria-label="已应用筛选">
            {appliedSummary.map((label) => (
              <span className="report-summary-chip" key={label}>
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="report-tabs" role="tablist" aria-label="报表类型">
        {reportTabs.map(([key, label], index) => (
          <button
            type="button"
            role="tab"
            className="button ghost"
            id={`${id}-${key}-tab`}
            aria-selected={tab === key}
            aria-controls={`${id}-${key}-panel`}
            tabIndex={tab === key ? 0 : -1}
            key={key}
            onClick={() => setTab(key)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % reportTabs.length
                  : event.key === "ArrowLeft"
                    ? (index + reportTabs.length - 1) % reportTabs.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? reportTabs.length - 1
                        : null;
              if (next !== null) {
                event.preventDefault();
                setTab(reportTabs[next][0]);
                event.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                  [next]?.focus();
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {reportTabs
        .filter(([key]) => key !== tab)
        .map(([key]) => (
          <section
            key={key}
            role="tabpanel"
            id={`${id}-${key}-panel`}
            aria-labelledby={`${id}-${key}-tab`}
            hidden
          />
        ))}
      <section
        role="tabpanel"
        id={`${id}-${tab}-panel`}
        aria-labelledby={`${id}-${tab}-tab`}
        aria-busy={loading}
        tabIndex={0}
      >
        {loading && (
          <div className="panel report-status" role="status">
            正在按已应用范围生成报表…
          </div>
        )}
        {current?.error && (
          <div className="notice report-status">
            <p className="error" role="alert">
              {current.error}
            </p>
            <Button variant="outline" onClick={() => setRevision((v) => v + 1)}>
              重试加载报表
            </Button>
          </div>
        )}
        {result && (
          <>
            <div className="report-scope">
              <p className="detail">
                {tab === "trades"
                  ? `交易口径：${result.totalClosed} 笔已平仓交易，${result.metrics.count} 笔可按 ${result.currency} 统计。`
                  : `账户口径：${accountName} · ${dateRange}；币种 ${result.currency}。${tradeOnlyFilters ? "更多交易筛选不影响此报表。" : ""}`}
              </p>
              <span className="detail">
                最近生成 {when(current!.fetchedAt)}
              </span>
            </div>
            {tab === "trades" && (
              <>
                {result.missingFx > 0 && (
                  <div className="notice">
                    {result.missingFx} 笔交易缺少平仓时的历史汇率，未计入{" "}
                    {result.currency}{" "}
                    交易指标及策略对比。规则遵守率仍覆盖当前范围内已复盘交易。
                  </div>
                )}
                {result.metrics.count === 0 && (
                  <div className="notice">
                    <strong>
                      {result.totalClosed
                        ? "当前交易缺少可换算的历史汇率"
                        : "当前范围没有已平仓交易"}
                    </strong>
                    <p className="detail">
                      {result.totalClosed
                        ? "补充平仓日期可用的历史汇率后，再刷新报表。"
                        : "先录入开仓与平仓成交，或调整筛选范围。未平仓持仓不纳入交易表现。"}
                    </p>
                    <div className="report-empty-actions">
                      <Link
                        className="button outline"
                        href={
                          result.totalClosed ? "/wealth/assets" : "/trading/log"
                        }
                      >
                        {result.totalClosed ? "维护历史汇率" : "查看交易日志"}
                      </Link>
                    </div>
                  </div>
                )}
                <Metrics
                  items={[
                    {
                      label: "胜率",
                      value: pct(result.metrics.winRate),
                      note: `有效样本 ${result.metrics.count} 笔`,
                    },
                    {
                      label: "盈亏因子",
                      value:
                        result.metrics.count === 0
                          ? "数据不足"
                          : result.metrics.profitFactor !== null
                            ? D(result.metrics.profitFactor).toFixed(2)
                            : "无有限值",
                      note: result.metrics.count
                        ? (result.metrics.profitFactorReason ?? undefined)
                        : "需要已平仓交易样本",
                    },
                    {
                      label: "每笔期望",
                      signed: result.metrics.expectancy,
                      value: amount(result.metrics.expectancy, result.currency),
                      note: "已实现净收益 ÷ 有效交易数",
                    },
                    {
                      label: "平均R",
                      value:
                        result.metrics.averageR !== null
                          ? D(result.metrics.averageR).toFixed(2)
                          : "数据不足",
                      note: result.metrics.count
                        ? "仅含已记录正初始风险的交易"
                        : "需要交易样本与初始风险",
                    },
                    {
                      label: "规则遵守率",
                      value: pct(result.compliance),
                      note: `当前范围已复盘 ${result.reviewed} 笔`,
                    },
                    {
                      label: "平均持仓时间",
                      value:
                        result.metrics.averageHoldingHours !== null
                          ? `${D(result.metrics.averageHoldingHours).toFixed(1)} 小时`
                          : "数据不足",
                      note: "从开仓到平仓",
                    },
                  ]}
                />
                <section className="panel">
                  <div className="report-section-heading">
                    <h2>策略版本对比</h2>
                    <p className="detail">
                      已平仓交易 · 金额 {result.currency} · 已扣成交费用
                    </p>
                  </div>
                  <Table
                    rows={result.byStrategy}
                    empty="当前范围没有可比较的策略交易。"
                    columns={[
                      { key: "name", label: "策略版本", value: (r) => r.name },
                      {
                        key: "count",
                        label: "交易数",
                        value: (r) => r.count,
                        sort: (r) => r.count,
                      },
                      {
                        key: "win",
                        label: "胜率",
                        value: (r) => pct(r.winRate),
                      },
                      {
                        key: "pnl",
                        label: `净收益（${result.currency}）`,
                        value: (r) => amount(r.net, result.currency),
                        sort: (r) => r.net,
                      },
                      {
                        key: "pf",
                        label: "盈亏因子",
                        value: (r) =>
                          r.profitFactor !== null
                            ? D(r.profitFactor).toFixed(2)
                            : "无有限值",
                      },
                      {
                        key: "r",
                        label: "平均R",
                        value: (r) =>
                          r.averageR !== null
                            ? D(r.averageR).toFixed(2)
                            : "数据不足",
                      },
                    ]}
                  />
                </section>
              </>
            )}
            {tab === "account" && (
              <>
                <Metrics
                  items={[
                    {
                      label: "账户TWR",
                      value: pct(result.account.twr),
                      note: "剔除资金流影响的区间收益率",
                    },
                    {
                      label: "账户XIRR",
                      value: pct(result.account.xirr),
                      note: "资金加权年化；求解域 [-99.99%,100000%]",
                    },
                    {
                      label: "区间投资损益",
                      signed: result.account.investmentPnl,
                      value: amount(
                        result.account.investmentPnl,
                        result.currency,
                      ),
                      note: "资产增减扣除净资金流",
                    },
                    {
                      label: "资产价值最大回撤",
                      value: pct(result.account.rawDrawdown),
                      note: "资产总值回落，受资金流影响",
                    },
                    {
                      label: "收益曲线最大回撤",
                      value: pct(result.account.returnDrawdown),
                      note: "按有效 TWR 收益曲线计算",
                    },
                    {
                      label: "区间资产峰值",
                      value: amount(result.account.peak, result.currency),
                      note: "当前范围内的已记录估值",
                    },
                  ]}
                />
                {(result.account.twrReason || result.account.xirrReason) && (
                  <div className="notice">
                    <strong>部分账户指标数据不足</strong>
                    {result.account.twrReason && (
                      <p className="detail">TWR：{result.account.twrReason}</p>
                    )}
                    {result.account.xirrReason && (
                      <p className="detail">
                        XIRR：{result.account.xirrReason}
                      </p>
                    )}
                    <Link className="button outline" href="/wealth/history">
                      录入历史估值
                    </Link>
                  </div>
                )}
                <p className="detail">
                  {result.account.from
                    ? `实际估值覆盖 ${day(result.account.from)} 至 ${day(result.account.to!)}，共 ${result.curve.length} 次记录。`
                    : "当前范围尚无可换算的历史估值。"}{" "}
                  图表与收益只反映已录入的区间。
                </p>
                <div className="equal-col">
                  <section className="panel">
                    <h2>账户资产轨迹</h2>
                    <p className="detail">
                      历史估值 · {result.currency} · 包含资金流带来的资产变化
                    </p>
                    <Chart
                      title="账户资产轨迹"
                      unit={result.currency}
                      labels={result.curve.map((r) => when(r.at))}
                      series={[
                        {
                          name: "资产价值",
                          values: result.curve.map((r) => r.value),
                        },
                      ]}
                    />
                  </section>
                  <section className="panel">
                    <h2>月度收益 · 已记录区间</h2>
                    <p className="detail">单位 % · 不代表完整自然月收益</p>
                    <Chart
                      title="月度收益 · 已记录区间"
                      unit="%"
                      type="bar"
                      labels={result.monthly.map((r) => r.month)}
                      series={[
                        {
                          name: "收益率",
                          values: result.monthly.map((r) =>
                            r.value === null
                              ? null
                              : D(r.value).mul(100).toFixed(),
                          ),
                        },
                      ]}
                    />
                    <p className="detail">
                      仅覆盖已录入的估值区间，不能视为完整自然月收益。
                    </p>
                  </section>
                </div>
              </>
            )}
            {tab === "sources" && (
              <section className="panel">
                <div className="report-section-heading">
                  <h2>资产增长来源</h2>
                  <p className="detail">
                    {result.account.from
                      ? `${day(result.account.from)} 至 ${day(result.account.to!)}`
                      : "需要至少两次有效估值"}{" "}
                    · 金额 {result.currency}
                  </p>
                </div>
                {Object.values(result.attribution).some(
                  (value) => value === null,
                ) && (
                  <p className="notice">
                    部分来源暂无法计算。请补充估值、资金流与历史汇率；“数据不足”不代表金额为零。
                  </p>
                )}
                <Table
                  searchable={false}
                  rows={[
                    ["external", "新增外部本金"],
                    ["longTerm", "非交易日志的已实现投资收益"],
                    ["trading", "Trading 净已实现收益"],
                    ["income", "利息与分红"],
                    ["fx", "汇率贡献"],
                    ["adjustments", "人工调整"],
                    ["residual", "未分类 / 未实现估值变化"],
                  ].map(([key, name]) => ({
                    name,
                    value:
                      result.attribution[
                        key as keyof typeof result.attribution
                      ],
                  }))}
                  columns={[
                    { key: "name", label: "来源", value: (r) => r.name },
                    {
                      key: "value",
                      label: `金额（${result.currency}）`,
                      value: (r) => amount(r.value, result.currency),
                    },
                  ]}
                />
                <p className="detail">
                  汇率贡献按汇率更新前持仓及更新时价格计算，价格与汇率同时变化时先归价格、再归汇率；合约或历史资料不足时保留未分类金额。以上
                  Trading 结果已扣成交费用。
                </p>
              </section>
            )}
          </>
        )}
      </section>
    </>
  );
}
