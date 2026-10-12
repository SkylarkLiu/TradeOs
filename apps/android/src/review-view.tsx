import React, { useState } from "react";
import { D } from "@tradeos/core";
import { scoreSummary, defaultScoreRules } from "@tradeos/core/review";
import { performance, type Review } from "./review";
import type { Ledger, State } from "./ledger";
type Props = {
  state: State;
  ledger: Ledger;
  busy: boolean;
  act: (work: () => Promise<void>) => Promise<void>;
  notice: (text: string) => void;
};
const localNow = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
const time = (at: string) =>
  new Date(at).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
const tradeName = (state: State, id: string | null) => {
  const t = state.trades.find((t) => t.id === id);
  return t
    ? `${state.assets.find((a) => a.id === t.assetId)?.code} / ${state.accounts.find((a) => a.id === t.accountId)?.name} · ${time(t.closedAt ?? t.openedAt)}`
    : "周期复盘";
};
function submit(
  e: React.FormEvent<HTMLFormElement>,
  p: Props,
  work: (d: Record<string, FormDataEntryValue>) => Promise<unknown>,
  notice: string,
) {
  e.preventDefault();
  const form = e.currentTarget,
    d = Object.fromEntries(new FormData(form));
  void p.act(async () => {
    await work(d);
    form.reset();
    p.notice(notice);
  });
}
const pct = (v: string | null) =>
  v === null ? "暂无" : `${D(v).mul(100).toFixed(2)}%`;
export function ReviewView(p: Props) {
  const { state, ledger, busy, act, notice } = p;
  const [period, setPeriod] = useState("TRADE"),
    [mode, setMode] = useState("复盘记录");
  return (
    <>
      <h1>执行复盘与改进</h1>
      <p>
        把成交结果、执行纪律和下一次行动分开记录。单笔复盘仅用于已平仓交易；历史复盘及评分规则快照保留。
      </p>
      <div className="actions">
        <button
          aria-pressed={mode === "复盘记录"}
          className={mode === "复盘记录" ? "" : "secondary"}
          onClick={() => setMode("复盘记录")}
        >
          复盘记录
        </button>
        <button
          aria-pressed={mode === "评分规则"}
          className={mode === "评分规则" ? "" : "secondary"}
          onClick={() => setMode("评分规则")}
        >
          评分规则
        </button>
      </div>
      {mode === "评分规则" ? (
        <section>
          <h2>配置评分规则</h2>
          <p>
            每个项目设置满分、权重及纪律门槛。修改只影响以后保存的复盘。至少一个权重大于0；没有纪律项目时纪律率显示暂无。
          </p>
          <form
            aria-label="评分规则表单"
            key={JSON.stringify(state.scoreRules)}
            onSubmit={(e) =>
              submit(
                e,
                p,
                (d) =>
                  ledger.setScoreRules(
                    state.scoreRules.map((r, i) => ({
                      ...r,
                      max: Number(d[`max${i}`]),
                      weight: Number(d[`weight${i}`]),
                      threshold: Number(d[`threshold${i}`]),
                      compliance: d[`compliance${i}`] === "on",
                    })),
                  ),
                "评分规则已保存，历史评分保持不变。",
              )
            }
          >
            {state.scoreRules.map((r, i) => (
              <div key={r.name}>
                <h3>{r.name}</h3>
                <div className="pair">
                  <label>
                    满分 · {r.name}
                    <input
                      type="number"
                      name={`max${i}`}
                      min={1}
                      max={100}
                      defaultValue={r.max}
                      required
                    />
                  </label>
                  <label>
                    权重 · {r.name}
                    <input
                      type="number"
                      name={`weight${i}`}
                      min={0}
                      max={100}
                      step="0.1"
                      defaultValue={r.weight}
                      required
                    />
                  </label>
                  <label>
                    纪律门槛 · {r.name}
                    <input
                      type="number"
                      name={`threshold${i}`}
                      min={0}
                      max={100}
                      step="0.1"
                      defaultValue={r.threshold}
                      required
                    />
                  </label>
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    name={`compliance${i}`}
                    defaultChecked={r.compliance}
                  />
                  作为纪律达标项目 · {r.name}
                </label>
              </div>
            ))}
            <div className="actions">
              <button disabled={busy}>保存评分规则</button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await ledger.setScoreRules(defaultScoreRules);
                    notice("已恢复默认规则，历史评分保持不变。");
                  })
                }
              >
                恢复默认规则
              </button>
            </div>
          </form>
        </section>
      ) : (
        <>
          <section>
            <h2>保存一次复盘</h2>
            <form
              aria-label="复盘表单"
              key={JSON.stringify(state.scoreRules)}
              onSubmit={(e) =>
                submit(
                  e,
                  p,
                  (d) =>
                    ledger.saveReview({
                      tradeId: period === "TRADE" ? d.tradeId : undefined,
                      period,
                      at: new Date(String(d.at)).toISOString(),
                      scores: Object.fromEntries(
                        state.scoreRules.map((r) => [
                          r.name,
                          Number(d[`score:${r.name}`]),
                        ]),
                      ),
                      tags: [
                        ...new Set(
                          String(d.tags)
                            .split(/[,，]/)
                            .map((t) => t.trim())
                            .filter(Boolean),
                        ),
                      ],
                      content: d.content,
                      lessons: d.lessons,
                      nextAction: d.nextAction,
                    }),
                  "复盘已保存，评分规则快照与改进行动一起保留。",
                )
              }
            >
              <label>
                复盘周期
                <select
                  aria-label="复盘周期"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                >
                  <option value="TRADE">单笔交易</option>
                  <option value="WEEK">周复盘</option>
                  <option value="MONTH">月复盘</option>
                </select>
              </label>
              {period === "TRADE" && (
                <label>
                  复盘交易
                  <select
                    aria-label="复盘交易"
                    name="tradeId"
                    required
                    defaultValue=""
                  >
                    <option value="">请选择已平仓交易</option>
                    {state.trades
                      .filter((t) => t.status === "CLOSED")
                      .map((t) => (
                        <option value={t.id} key={t.id}>
                          {tradeName(state, t.id)}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                复盘时间
                <input
                  name="at"
                  type="datetime-local"
                  required
                  defaultValue={localNow()}
                />
              </label>
              <div className="pair">
                {state.scoreRules.map((r) => (
                  <label key={r.name}>
                    {r.name}（满分 {r.max}）
                    <input
                      aria-label={`评分：${r.name}`}
                      name={`score:${r.name}`}
                      type="number"
                      required
                      min={0}
                      max={r.max}
                      step="0.1"
                    />
                  </label>
                ))}
              </div>
              <label>
                复盘标签
                <input
                  name="tags"
                  maxLength={1900}
                  placeholder="如 追涨，止损拖延，按计划执行"
                />
              </label>
              <label>
                复盘内容
                <textarea
                  name="content"
                  required
                  minLength={10}
                  maxLength={50000}
                  rows={5}
                  placeholder="至少10字，记录计划与实际执行的差异，以及原因。"
                />
              </label>
              <label>
                经验教训
                <textarea name="lessons" required maxLength={3000} rows={3} />
              </label>
              <label>
                下一次执行动作
                <textarea
                  name="nextAction"
                  required
                  maxLength={3000}
                  rows={3}
                  placeholder="写一个可检查的行动，如入场前核对止损与仓位。"
                />
              </label>
              <button
                disabled={
                  busy ||
                  (period === "TRADE" &&
                    !state.trades.some((t) => t.status === "CLOSED"))
                }
              >
                保存复盘
              </button>
            </form>
          </section>
          <section>
            <h2>复盘历史</h2>
            {!state.reviews.length && (
              <p className="empty">
                完成一笔交易后保存复盘，也可先记录周/月总结。
              </p>
            )}
            {[...state.reviews]
              .sort(
                (a, b) => b.at.localeCompare(a.at) || b.sequence - a.sequence,
              )
              .map((r) => (
                <ReviewRecord key={r.id} review={r} props={p} />
              ))}
          </section>
        </>
      )}
    </>
  );
}
function ReviewRecord({
  review: r,
  props: p,
}: {
  review: Review;
  props: Props;
}) {
  const { state, ledger, busy } = p;
  const scores = scoreSummary(JSON.parse(r.scores)),
    trade = state.trades.find((t) => t.id === r.tradeId),
    source = state.versions.find((v) => v.id === trade?.strategyVersionId),
    link = state.improvements.find((i) => i.reviewId === r.id),
    improved = state.versions.find((v) => v.id === link?.versionId);
  return (
    <details>
      <summary>
        {time(r.at)} ·{" "}
        {r.period === "TRADE"
          ? tradeName(state, r.tradeId)
          : r.period === "WEEK"
            ? "周复盘"
            : "月复盘"}{" "}
        · 评分 {D(scores.score).toFixed(1)} / 100 ·{" "}
        {scores.compliant === null
          ? "未设置纪律项目"
          : scores.compliant
            ? "纪律达标"
            : "纪律未达标"}
      </summary>
      <p>标签：{JSON.parse(r.tags).join("、") || "无"}</p>
      <h3>复盘内容</h3>
      <p className="rules">{r.content}</p>
      <h3>经验教训</h3>
      <p className="rules">{r.lessons}</p>
      <h3>下一次行动</h3>
      <p className="rules">{r.nextAction}</p>
      <details>
        <summary>当时的评分与规则</summary>
        <div className="table" tabIndex={0} aria-label="历史评分明细">
          <table>
            <thead>
              <tr>
                <th>项目</th>
                <th>得分 / 满分</th>
                <th>权重</th>
                <th>纪律门槛</th>
              </tr>
            </thead>
            <tbody>
              {JSON.parse(r.scores).rules.map(
                (rule: {
                  name: string;
                  max: number;
                  weight: number;
                  compliance: boolean;
                  threshold: number;
                }) => (
                  <tr key={rule.name}>
                    <td>{rule.name}</td>
                    <td>
                      {JSON.parse(r.scores).values[rule.name]} / {rule.max}
                    </td>
                    <td>{rule.weight}</td>
                    <td>{rule.compliance ? rule.threshold : "非纪律项目"}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </details>
      {improved ? (
        <p>
          已生成改进版本 v{improved.version} ·{" "}
          {improved.published ? "已发布" : "草稿，请到策略页核对并发布"}
          。原交易仍关联原版本。
        </p>
      ) : source ? (
        <details>
          <summary>根据本次复盘生成策略改进草稿</summary>
          <p>
            原规则保留，仅新增同策略草稿版本。参考上面的下一次行动，明确写出要改变的规则，再到策略页核对并发布。
          </p>
          <form
            aria-label="改进策略表单"
            onSubmit={(e) =>
              submit(
                e,
                p,
                (d) => ledger.improveStrategy({ ...d, reviewId: r.id }),
                "改进草稿已生成，请到策略页核对后发布。",
              )
            }
          >
            <div className="pair">
              <label>
                改进市场
                <input
                  name="market"
                  defaultValue={source.market}
                  required
                  maxLength={300}
                />
              </label>
              <label>
                改进周期
                <input
                  name="timeframe"
                  defaultValue={source.timeframe}
                  required
                  maxLength={300}
                />
              </label>
            </div>
            <label>
              改进环境
              <input
                name="environment"
                defaultValue={source.environment}
                required
                maxLength={300}
              />
            </label>
            <label>
              改进规则
              <textarea
                name="rules"
                defaultValue={source.rules}
                required
                minLength={20}
                maxLength={50000}
                rows={5}
              />
            </label>
            <button disabled={busy}>生成改进草稿</button>
          </form>
        </details>
      ) : (
        <p>该复盘未关联策略版本，可先在策略页建立策略。</p>
      )}
    </details>
  );
}
export function PerformanceView({ state }: Props) {
  const currencies = [...new Set(state.accounts.map((a) => a.currency))];
  const [filters, setFilters] = useState({
    currency: currencies[0] ?? "CNY",
    accountId: "",
    assetId: "",
    strategyVersionId: "",
    tag: "",
    start: "",
    end: "",
  });
  const change = (k: keyof typeof filters, v: string) =>
    setFilters((s) => ({ ...s, [k]: v }));
  let report: ReturnType<typeof performance> | undefined,
    error = "";
  try {
    report = performance(
      state,
      Object.fromEntries(
        Object.entries(filters).map(([k, v]) => [k, v || undefined]),
      ),
    );
  } catch (e) {
    error = e instanceof Error ? e.message : "筛选无效";
  }
  const net = (v: string | null) => (v === null ? "暂无" : D(v).toFixed(2));
  return (
    <>
      <h1>交易绩效与执行纪律</h1>
      <p>
        按平仓时间筛选，仅统计已平仓交易的完整成交周期。金额保持所选币种，不混算美元与USDT；未平仓浮盈亏和账户投资收益率不在本页口径内。
      </p>
      <section>
        <h2>筛选范围</h2>
        <div className="pair">
          <label>
            绩效币种
            <select
              aria-label="绩效币种"
              value={filters.currency}
              onChange={(e) => {
                setFilters((s) => ({
                  ...s,
                  currency: e.target.value,
                  accountId: "",
                  assetId: "",
                }));
              }}
            >
              {currencies.length ? (
                currencies.map((c) => <option key={c}>{c}</option>)
              ) : (
                <option>CNY</option>
              )}
            </select>
          </label>
          <label>
            绩效账户
            <select
              aria-label="绩效账户"
              value={filters.accountId}
              onChange={(e) => change("accountId", e.target.value)}
            >
              <option value="">全部账户</option>
              {state.accounts
                .filter((a) => a.currency === filters.currency)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.platform} / {a.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            绩效标的
            <select
              aria-label="绩效标的"
              value={filters.assetId}
              onChange={(e) => change("assetId", e.target.value)}
            >
              <option value="">全部标的</option>
              {state.assets
                .filter((a) => a.currency === filters.currency)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} / {a.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            绩效策略版本
            <select
              aria-label="绩效策略版本"
              value={filters.strategyVersionId}
              onChange={(e) => change("strategyVersionId", e.target.value)}
            >
              <option value="">全部策略</option>
              {state.versions.map((v) => (
                <option value={v.id} key={v.id}>
                  {state.strategies.find((s) => s.id === v.strategyId)?.name} v
                  {v.version}
                </option>
              ))}
            </select>
          </label>
          <label>
            绩效标签
            <input
              value={filters.tag}
              maxLength={60}
              onChange={(e) => change("tag", e.target.value)}
            />
          </label>
          <label>
            开始日期
            <input
              type="date"
              value={filters.start}
              onChange={(e) => change("start", e.target.value)}
            />
          </label>
          <label>
            结束日期
            <input
              type="date"
              value={filters.end}
              onChange={(e) => change("end", e.target.value)}
            />
          </label>
        </div>
      </section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {report && (
        <>
          <section>
            <h2>结果与纪律</h2>
            <dl>
              <dt>已平仓交易</dt>
              <dd>{report.metrics.count} 笔</dd>
              <dt>费用后净损益 · {filters.currency}</dt>
              <dd data-testid="performance-net">{net(report.net)}</dd>
              <dt>累计费用 · {filters.currency}</dt>
              <dd>{net(report.fees)}</dd>
              <dt>胜率</dt>
              <dd>{pct(report.metrics.winRate)}</dd>
              <dt>盈亏因子</dt>
              <dd>
                {report.metrics.profitFactor
                  ? net(report.metrics.profitFactor)
                  : (report.metrics.profitFactorReason ?? "暂无")}
              </dd>
              <dt>每笔期望损益 · {filters.currency}</dt>
              <dd>{net(report.metrics.expectancy)}</dd>
              <dt>平均R倍数</dt>
              <dd>
                {net(report.metrics.averageR)}（有效风险样本 {report.rSample}{" "}
                笔）
              </dd>
              <dt>平均持有时间</dt>
              <dd>{net(report.metrics.averageHoldingHours)} 小时</dd>
              <dt>已复盘 / 复盘覆盖率</dt>
              <dd>
                {report.reviewed} 笔 / {pct(report.reviewCoverage)}
              </dd>
              <dt>纪律达标率</dt>
              <dd>
                {pct(report.compliance)}（适用样本 {report.complianceSample}{" "}
                笔）
              </dd>
              <dt>平均复盘评分</dt>
              <dd>{net(report.averageScore)} / 100</dd>
              <dt>最长连续亏损</dt>
              <dd>{report.maxLossRun} 笔</dd>
            </dl>
            <p>
              每笔交易取最新单笔复盘判断纪律，标签保留历次复盘记录。无初始风险的交易不计R；没有亏损样本时盈亏因子无有限值。
            </p>
          </section>
          <section>
            <h2>已平仓累计损益与回撤</h2>
            <p>
              累计净损益从0开始，相同平仓时间合并。最大回撤金额{" "}
              {net(report.drawdown)} {filters.currency}
              ，表示该曲线从峰值到后续低点的最大下降，不代表账户净值回撤率。
            </p>
            {report.points.length ? (
              <>
                <PnlChart points={report.points} />
                <details>
                  <summary>查看曲线数据</summary>
                  <div className="table" tabIndex={0} aria-label="累计损益数据">
                    <table>
                      <thead>
                        <tr>
                          <th>平仓时间</th>
                          <th>累计净损益 · {filters.currency}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.points.map((point) => (
                          <tr key={point.at}>
                            <td>{time(point.at)}</td>
                            <td className="number">{point.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            ) : (
              <p className="empty">当前筛选没有已平仓交易。</p>
            )}
          </section>
          <section>
            <h2>策略版本归因</h2>
            <p>宽表可左右滑动查看完整数据。</p>
            <div className="table" tabIndex={0} aria-label="策略归因">
              <table>
                <thead>
                  <tr>
                    <th>策略版本</th>
                    <th>交易数</th>
                    <th>净损益 · {filters.currency}</th>
                    <th>胜率</th>
                    <th>平均R</th>
                  </tr>
                </thead>
                <tbody>
                  {report.groups.map((g) => (
                    <tr key={g.name}>
                      <td>{g.name}</td>
                      <td>{g.count}</td>
                      <td className="number">{g.net}</td>
                      <td>{pct(g.winRate)}</td>
                      <td>{net(g.averageR)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <h2>按平仓月份汇总</h2>
            <p>这是筛选内已平仓交易损益，不是完整自然月的账户收益率。</p>
            <div className="table">
              <table>
                <thead>
                  <tr>
                    <th>月份</th>
                    <th>交易数</th>
                    <th>净损益 · {filters.currency}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.months.map((m) => (
                    <tr key={m.month}>
                      <td>{m.month}</td>
                      <td>{m.count}</td>
                      <td className="number">{m.net}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
function PnlChart({ points }: { points: { at: string; value: string }[] }) {
  const values = [D(0), ...points.map((p) => D(p.value))],
    min = values.reduce((a, b) => (b.lt(a) ? b : a)),
    max = values.reduce((a, b) => (b.gt(a) ? b : a)),
    range = max.minus(min),
    y = (v: ReturnType<typeof D>) =>
      range.eq(0) ? 100 : 180 - v.minus(min).div(range).mul(160).toNumber(),
    line = values
      .map((v, i) => `${20 + (i * 680) / (values.length - 1)},${y(v)}`)
      .join(" ");
  return (
    <svg
      viewBox="0 0 720 200"
      role="img"
      aria-label="已平仓交易累计净损益曲线，数据可在下方展开查看"
      className="pnl-chart"
    >
      <line x1="20" x2="700" y1={y(D(0))} y2={y(D(0))} stroke="var(--line)" />
      <polyline
        points={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.5"
      />
    </svg>
  );
}
