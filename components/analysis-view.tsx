"use client";
import { useState, useEffect } from "react";
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
export function AnalysisView({ wealth = false }: { wealth?: boolean }) {
  const { state: s, report } = useWorkspace(),
    [filters, setFilters] = useState<Record<string, string>>({}),
    [result, setResult] = useState<AnalyticsResult | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ ...filters, currency: report });
    fetch(`/api/analytics?${params}`, { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        return data;
      })
      .then((r) => {
        if (active) {
          setResult(r);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [filters, report, s]);
  const fields = [
    [
      "accountId",
      "账户",
      s.accounts.map((a) => ({ value: a.id, label: a.name })),
    ],
    ["assetId", "资产", s.assets.map((a) => ({ value: a.id, label: a.code }))],
    [
      "strategyId",
      "策略",
      s.strategies.map((st) => ({ value: st.id, label: st.name })),
    ],
    [
      "strategyVersionId",
      "策略版本",
      s.strategies.flatMap((st) =>
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
  return (
    <>
      {wealth ? (
        <h2>资产收益分析</h2>
      ) : (
        <Heading
          title="绩效分析"
          description="交易结果与账户收益分别统计；缺少数据时显示原因。"
        />
      )}
      <section className="panel">
        <h2>筛选范围</h2>
        <div className="form-grid">
          {fields.map(([key, label, options]) => (
            <label className="field" key={key}>
              {label}
              <select
                value={filters[key] ?? ""}
                onChange={(e) => {
                  setFilters({ ...filters, [key]: e.target.value });
                  setResult(null);
                }}
              >
                <option value="">全部</option>
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {[
            ["start", "开始日期", "date"],
            ["end", "结束日期", "date"],
            ["environment", "市场环境", "text"],
            ["tag", "交易标签", "text"],
          ].map(([key, label, type]) => (
            <label className="field" key={key}>
              {label}
              <input
                type={type}
                value={filters[key] ?? ""}
                onChange={(e) => {
                  setFilters({ ...filters, [key]: e.target.value });
                  setResult(null);
                }}
              />
            </label>
          ))}
        </div>
        <p className="detail">
          策略、资产、方向、环境和标签筛选作用于已平仓交易；账户收益只由账户和日期筛选决定。
        </p>
      </section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {result && (
        <>
          {result.missingFx > 0 && (
            <div className="notice">
              {result.missingFx}笔交易缺少历史汇率，未计入以{report}
              汇总的货币指标。
            </div>
          )}
          <Metrics
            items={[
              {
                label: "胜率",
                value: pct(result.metrics.winRate),
                note: `有效样本${result.metrics.count}笔`,
              },
              {
                label: "盈亏因子",
                value: result.metrics.profitFactor
                  ? D(result.metrics.profitFactor).toFixed(2)
                  : "无有限值",
                note: result.metrics.profitFactorReason ?? undefined,
              },
              {
                label: "每笔期望",
                signed: result.metrics.expectancy,
                value: amount(result.metrics.expectancy, report),
              },
              {
                label: "平均R",
                value: result.metrics.averageR
                  ? D(result.metrics.averageR).toFixed(2)
                  : "缺少初始风险",
              },
            ]}
          />
          <Metrics
            items={[
              {
                label: "规则遵守率",
                value: pct(result.compliance),
                note: `已复盘${result.reviewed}笔`,
              },
              {
                label: "平均持仓时间",
                value: result.metrics.averageHoldingHours
                  ? `${D(result.metrics.averageHoldingHours).toFixed(1)}小时`
                  : "数据不足",
              },
              { label: "账户TWR", value: pct(result.account.twr) },
              {
                label: "账户XIRR",
                value: pct(result.account.xirr),
                note: "年化；求解域[-99.99%,100000%]",
              },
            ]}
          />
          {result.account.twrReason && (
            <p className="notice">TWR：{result.account.twrReason}</p>
          )}
          {result.account.xirrReason && (
            <p className="notice">XIRR：{result.account.xirrReason}</p>
          )}
          <Metrics
            items={[
              {
                label: "资产价值最大回撤",
                value: pct(result.account.rawDrawdown),
              },
              {
                label: "收益曲线最大回撤",
                value: pct(result.account.returnDrawdown),
              },
              {
                label: "历史总资产峰值",
                value: amount(result.account.peak, report),
              },
              {
                label: "区间投资损益",
                value: amount(result.account.investmentPnl, report),
                note: result.account.from
                  ? `${day(result.account.from)} 至 ${day(result.account.to!)}`
                  : "需要历史估值",
              },
            ]}
          />
          <div className="equal-col">
            <section className="panel">
              <h2>账户资产轨迹</h2>
              <Chart
                labels={result.curve.map((r) => day(r.at))}
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
              <Chart
                type="bar"
                labels={result.monthly.map((r) => r.month)}
                series={[
                  {
                    name: "收益率（%）",
                    values: result.monthly.map((r) =>
                      r.value === null ? null : D(r.value).mul(100).toFixed(),
                    ),
                  },
                ]}
              />
              <p className="detail">
                仅覆盖已录入的估值区间，不能视为完整自然月收益。
              </p>
            </section>
          </div>
          <section className="panel">
            <h2>策略版本对比</h2>
            <Table
              rows={result.byStrategy}
              columns={[
                { key: "name", label: "策略版本", value: (r) => r.name },
                { key: "count", label: "交易数", value: (r) => r.count },
                { key: "win", label: "胜率", value: (r) => pct(r.winRate) },
                {
                  key: "pnl",
                  label: "净收益",
                  value: (r) => amount(r.net, report),
                },
                {
                  key: "pf",
                  label: "盈亏因子",
                  value: (r) =>
                    r.profitFactor ? D(r.profitFactor).toFixed(2) : "无有限值",
                },
                {
                  key: "r",
                  label: "平均R",
                  value: (r) =>
                    r.averageR ? D(r.averageR).toFixed(2) : "数据不足",
                },
              ]}
            />
          </section>
          <section className="panel">
            <h2>资产增长来源</h2>
            <Table
              rows={[
                ["external", "新增外部本金"],
                ["longTerm", "非交易日志的已实现投资收益"],
                ["trading", "Trading净已实现收益"],
                ["income", "利息与分红"],
                ["fx", "汇率贡献"],
                ["adjustments", "人工调整"],
                ["residual", "未分类 / 未实现估值变化"],
              ].map(([key, name]) => ({
                name,
                value:
                  result.attribution[key as keyof typeof result.attribution],
              }))}
              columns={[
                { key: "name", label: "来源", value: (r) => r.name },
                {
                  key: "value",
                  label: "金额",
                  value: (r) => amount(r.value, report),
                },
              ]}
            />
            <p className="detail">
              汇率贡献按汇率更新前持仓及更新时价格计算，价格与汇率同时变化时先归价格、再归汇率；合约或历史资料不足时保留未分类金额。以上Trading结果已扣成交费用。
            </p>
          </section>
        </>
      )}
    </>
  );
}
