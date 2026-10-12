import React, { useState } from "react";
import { D, tradeMetrics } from "@tradeos/core";
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
const accountName = (s: State, id: string) => {
  const a = s.accounts.find((a) => a.id === id);
  return a ? `${a.platform} / ${a.name} · ${a.currency}` : "";
};
const assetName = (s: State, id: string) => {
  const a = s.assets.find((a) => a.id === id);
  return a ? `${a.code} / ${a.name}` : "";
};
const versionName = (s: State, id: string | null) => {
  const v = s.versions.find((v) => v.id === id);
  return v
    ? `${s.strategies.find((a) => a.id === v.strategyId)?.name} · v${v.version}`
    : "无策略";
};
const types: Record<string, string> = {
  ENTRY: "建仓",
  ADD_POSITION: "加仓",
  PARTIAL_EXIT: "减仓",
  EXIT: "平仓",
  STOP_ADJUSTMENT: "调整止损",
  TARGET_ADJUSTMENT: "调整止盈",
  PLAN_DEVIATION: "计划偏离",
  MARKET_OBSERVATION: "市场观察",
};
function submit(
  event: React.FormEvent<HTMLFormElement>,
  props: Props,
  work: (data: Record<string, FormDataEntryValue>) => Promise<unknown>,
  label: string,
) {
  event.preventDefault();
  const form = event.currentTarget,
    data = Object.fromEntries(new FormData(form));
  void props.act(async () => {
    await work(data);
    form.reset();
    props.notice(label);
  });
}
function StrategySelect({
  state,
  name = "strategyVersionId",
}: {
  state: State;
  name?: string;
}) {
  return (
    <label>
      关联策略
      <select aria-label="关联策略" name={name} defaultValue="">
        <option value="">无策略</option>
        {state.versions
          .filter(
            (v) =>
              v.published &&
              !state.strategies.find((s) => s.id === v.strategyId)?.archived,
          )
          .map((v) => (
            <option value={v.id} key={v.id}>
              {versionName(state, v.id)}
            </option>
          ))}
      </select>
    </label>
  );
}
function Instruments({ state }: { state: State }) {
  return (
    <div className="pair">
      <label>
        交易账户
        <select name="accountId" aria-label="交易账户" required defaultValue="">
          <option value="">请选择</option>
          {state.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {accountName(state, a.id)}
            </option>
          ))}
        </select>
      </label>
      <label>
        交易标的
        <select name="assetId" aria-label="交易标的" required defaultValue="">
          <option value="">请选择同币种资产</option>
          {state.assets.map((a) => (
            <option key={a.id} value={a.id}>
              {assetName(state, a.id)} · {a.currency}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
export function StrategyView(props: Props) {
  const { state, ledger, busy, act, notice } = props;
  return (
    <>
      <h1>策略版本</h1>
      <p>
        先保存规则，再发布使用。同名策略会创建新版本；已发布版本保留原规则，历史交易始终关联原版本。
      </p>
      <section>
        <h2>保存策略草稿</h2>
        <form
          aria-label="策略草稿"
          onSubmit={(e) =>
            submit(
              e,
              props,
              (d) => ledger.createStrategy(d),
              "策略草稿已保存，请核对规则后发布。",
            )
          }
        >
          <div className="pair">
            <label>
              策略名称
              <input name="name" required maxLength={300} />
            </label>
            <label>
              适用市场
              <input
                name="market"
                required
                maxLength={300}
                placeholder="如 A股现货"
              />
            </label>
            <label>
              交易周期
              <input
                name="timeframe"
                required
                maxLength={300}
                placeholder="如 日线"
              />
            </label>
            <label>
              适用环境
              <input name="environment" required maxLength={300} />
            </label>
          </div>
          <label>
            策略规则
            <textarea
              name="rules"
              required
              minLength={20}
              maxLength={50000}
              rows={6}
              placeholder="至少20字，填写入场、止损、止盈与失效条件。"
            />
          </label>
          <button disabled={busy}>保存策略版本</button>
        </form>
      </section>
      {state.strategies.map((s) => (
        <section key={s.id}>
          <div className="heading">
            <h2>
              {s.name}
              {s.archived ? " · 已归档" : ""}
            </h2>
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await ledger.archiveStrategy({
                    id: s.id,
                    archived: s.archived ? 0 : 1,
                  });
                  notice(
                    s.archived
                      ? "策略已恢复。"
                      : "策略已归档，已有交易可继续平仓。",
                  );
                })
              }
            >
              {s.archived ? "恢复策略" : "归档策略"}
            </button>
          </div>
          {state.versions
            .filter((v) => v.strategyId === s.id)
            .sort((a, b) => b.version - a.version)
            .map((v) => (
              <details key={v.id}>
                <summary>
                  v{v.version} · {v.published ? "已发布" : "草稿"} · {v.market}{" "}
                  / {v.timeframe}
                </summary>
                <p>环境：{v.environment}</p>
                <pre className="rules">{v.rules}</pre>
                {!v.published && (
                  <button
                    disabled={busy || !!s.archived}
                    onClick={() =>
                      void act(async () => {
                        await ledger.publishVersion({ id: v.id });
                        notice("策略版本已发布。");
                      })
                    }
                  >
                    发布 v{v.version}
                  </button>
                )}
              </details>
            ))}
        </section>
      ))}
      {!state.strategies.length && (
        <p className="empty">
          暂无策略。也可先记录计划外交易，后续再建立策略。
        </p>
      )}
    </>
  );
}
export function TradingView(props: Props) {
  const { state, ledger, busy } = props;
  const [mode, setMode] = useState("交易记录");
  const [selected, setSelected] = useState("");
  const trade = state.trades.find((t) => t.id === selected);
  const metrics = tradeMetrics(state.trades);
  return (
    <>
      <h1>现货交易日志</h1>
      <p>
        成交自动写入资产账本。这里跟踪每笔交易的成交均价和费用后损益；资产页按账户整体移动平均成本计算，两个口径可能不同。
      </p>
      <div className="actions">
        <button
          className={mode === "交易记录" ? "" : "secondary"}
          aria-pressed={mode === "交易记录"}
          onClick={() => setMode("交易记录")}
        >
          交易记录
        </button>
        <button
          className={mode === "风险计划" ? "" : "secondary"}
          aria-pressed={mode === "风险计划"}
          onClick={() => setMode("风险计划")}
        >
          风险计划
        </button>
      </div>
      {mode === "风险计划" ? (
        <>
          <section>
            <h2>制定风险计划</h2>
            <form
              aria-label="风险计划表单"
              onSubmit={(e) =>
                submit(
                  e,
                  props,
                  (d) =>
                    ledger.createPlan({
                      ...d,
                      strategyVersionId: d.strategyVersionId || undefined,
                      direction: "LONG",
                    }),
                  "计划已保存，建议数量已按风险预算计算。",
                )
              }
            >
              <Instruments state={state} />
              <StrategySelect state={state} />
              <div className="pair">
                <label>
                  计划入场价
                  <input name="entry" required inputMode="decimal" />
                </label>
                <label>
                  计划止损价
                  <input name="stop" required inputMode="decimal" />
                </label>
                <label>
                  计划止盈价
                  <input name="target" required inputMode="decimal" />
                </label>
                <label>
                  账户权益
                  <input name="equity" required inputMode="decimal" />
                </label>
                <label>
                  风险预算（%）
                  <input
                    name="riskPercent"
                    defaultValue="1"
                    required
                    inputMode="decimal"
                  />
                </label>
              </div>
              <label>
                计划理由
                <input name="reason" required maxLength={300} />
              </label>
              <label>
                失效条件
                <input name="invalidation" required maxLength={300} />
              </label>
              <p>
                当前仅支持现货做多。建议数量不代表已成交，记录成交后才会扣除现金。
              </p>
              <button
                disabled={
                  busy || !state.accounts.length || !state.assets.length
                }
              >
                保存风险计划
              </button>
            </form>
          </section>
          <section>
            <h2>已保存计划</h2>
            <p>宽表可左右滑动查看完整数据。</p>
            <div className="table" tabIndex={0} aria-label="风险计划明细">
              <table>
                <thead>
                  <tr>
                    <th>账户 / 标的</th>
                    <th>策略</th>
                    <th>入场</th>
                    <th>止损</th>
                    <th>止盈</th>
                    <th>建议数量</th>
                    <th>理由 / 失效条件</th>
                  </tr>
                </thead>
                <tbody>
                  {state.plans.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {accountName(state, p.accountId)}
                        <br />
                        {assetName(state, p.assetId)}
                      </td>
                      <td>{versionName(state, p.strategyVersionId)}</td>
                      <td className="number">{p.entry}</td>
                      <td className="number">{p.stop}</td>
                      <td className="number">{p.target}</td>
                      <td className="number">{p.quantity}</td>
                      <td>
                        {p.reason}
                        <br />
                        {p.invalidation}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!state.plans.length && <p className="empty">暂无计划</p>}
          </section>
        </>
      ) : (
        <>
          <section>
            <h2>建立交易</h2>
            <form
              aria-label="建立交易"
              onSubmit={(e) =>
                submit(
                  e,
                  props,
                  (d) =>
                    ledger.createTrade({
                      ...d,
                      planId: d.planId || undefined,
                      strategyVersionId: d.strategyVersionId || undefined,
                      direction: "LONG",
                      openedAt: new Date(String(d.openedAt)).toISOString(),
                    }),
                  "交易已建立，录入成交后才会改变现金和持仓。",
                )
              }
            >
              <Instruments state={state} />
              <StrategySelect state={state} />
              <label>
                关联计划
                <select aria-label="关联计划" name="planId" defaultValue="">
                  <option value="">计划外交易</option>
                  {state.plans.map((p) => (
                    <option value={p.id} key={p.id}>
                      {assetName(state, p.assetId)} ·{" "}
                      {accountName(state, p.accountId)} · {p.reason}
                    </option>
                  ))}
                </select>
              </label>
              <div className="pair">
                <label>
                  交易开始时间
                  <input
                    name="openedAt"
                    type="datetime-local"
                    defaultValue={localNow()}
                    required
                  />
                </label>
                <label>
                  初始风险金额
                  <input
                    name="initialRisk"
                    required
                    defaultValue="0"
                    inputMode="decimal"
                  />
                </label>
              </div>
              <label>
                入场理由
                <input name="reason" maxLength={3000} />
              </label>
              <p>
                关联计划时继承其策略版本、初始风险和止损止盈，账户及标的必须一致。计划外交易的初始风险为0时不计算R倍数。
              </p>
              <button
                disabled={
                  busy || !state.accounts.length || !state.assets.length
                }
              >
                保存交易
              </button>
            </form>
          </section>
          <section>
            <h2>选择交易并录入成交</h2>
            <label>
              当前交易
              <select
                aria-label="当前交易"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">请选择</option>
                {state.trades.map((t) => (
                  <option key={t.id} value={t.id}>
                    {assetName(state, t.assetId)} ·{" "}
                    {accountName(state, t.accountId)} · {time(t.openedAt)} ·{" "}
                    {t.status === "CLOSED" ? "已平仓" : "进行中"}
                  </option>
                ))}
              </select>
            </label>
            {trade ? (
              <>
                <dl>
                  <dt>持仓数量</dt>
                  <dd>{trade.quantity}</dd>
                  <dt>成交均价</dt>
                  <dd>{trade.averageEntry}</dd>
                  <dt>累计费用</dt>
                  <dd>{trade.fees}</dd>
                  <dt>费用后已实现损益</dt>
                  <dd>{trade.realized}</dd>
                  <dt>止损 / 止盈</dt>
                  <dd>
                    {trade.stop ?? "未设置"} / {trade.target ?? "未设置"}
                  </dd>
                </dl>
                {trade.status === "OPEN" ? (
                  <>
                    <form
                      aria-label="成交表单"
                      onSubmit={(e) =>
                        submit(
                          e,
                          props,
                          (d) =>
                            ledger.recordFill({
                              ...d,
                              tradeId: trade.id,
                              at: new Date(String(d.at)).toISOString(),
                            }),
                          "成交与交易、现金、持仓已一起保存。",
                        )
                      }
                    >
                      <div className="pair">
                        <label>
                          成交类型
                          <select name="action" aria-label="成交类型">
                            <option value="ENTRY">建仓 / 加仓</option>
                            <option value="EXIT">减仓 / 平仓</option>
                          </select>
                        </label>
                        <label>
                          成交数量
                          <input name="quantity" required inputMode="decimal" />
                        </label>
                        <label>
                          实际成交价
                          <input name="price" required inputMode="decimal" />
                        </label>
                        <label>
                          成交手续费
                          <input
                            name="fee"
                            required
                            defaultValue="0"
                            inputMode="decimal"
                          />
                        </label>
                      </div>
                      <label>
                        成交时间
                        <input
                          name="at"
                          type="datetime-local"
                          defaultValue={localNow()}
                          required
                        />
                      </label>
                      <p>
                        填写实际成交价，费用只扣一次。持仓不能通过资产页绕过交易日志卖出。
                      </p>
                      <button disabled={busy}>保存成交</button>
                    </form>
                    <details>
                      <summary>记录持仓事件</summary>
                      <form
                        aria-label="持仓事件表单"
                        onSubmit={(e) =>
                          submit(
                            e,
                            props,
                            (d) =>
                              ledger.recordEvent({
                                ...d,
                                tradeId: trade.id,
                                value: d.value || undefined,
                                at: new Date(String(d.at)).toISOString(),
                              }),
                            "持仓事件已保存。",
                          )
                        }
                      >
                        <label>
                          事件类型
                          <select name="type" aria-label="事件类型">
                            <option value="MARKET_OBSERVATION">市场观察</option>
                            <option value="PLAN_DEVIATION">计划偏离</option>
                            <option value="STOP_ADJUSTMENT">调整止损</option>
                            <option value="TARGET_ADJUSTMENT">调整止盈</option>
                          </select>
                        </label>
                        <label>
                          调整后价格
                          <input
                            name="value"
                            inputMode="decimal"
                            placeholder="调整止损或止盈时必填"
                          />
                        </label>
                        <label>
                          事件说明
                          <input name="detail" required maxLength={300} />
                        </label>
                        <label>
                          事件时间
                          <input
                            name="at"
                            type="datetime-local"
                            required
                            defaultValue={localNow()}
                          />
                        </label>
                        <button disabled={busy}>保存持仓事件</button>
                      </form>
                    </details>
                  </>
                ) : (
                  <p>交易已平仓，成交和持仓事件保留，只读。</p>
                )}
                <h3>成交明细</h3>
                <div className="table" tabIndex={0} aria-label="成交明细">
                  <table>
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>类型</th>
                        <th>数量</th>
                        <th>价格</th>
                        <th>费用</th>
                        <th>本次损益</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.fills
                        .filter((f) => f.tradeId === trade.id)
                        .map((f) => (
                          <tr key={f.id}>
                            <td>{time(f.at)}</td>
                            <td>{f.action === "ENTRY" ? "建仓" : "平仓"}</td>
                            <td className="number">{f.quantity}</td>
                            <td className="number">{f.price}</td>
                            <td className="number">{f.fee}</td>
                            <td className="number">{f.pnl}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <h3>持仓事件</h3>
                <ul>
                  {state.events
                    .filter((e) => e.tradeId === trade.id)
                    .map((e) => (
                      <li key={e.id}>
                        {time(e.at)} · {types[e.type]} · {e.detail}
                        {e.value ? ` · ${e.value}` : ""}
                      </li>
                    ))}
                </ul>
              </>
            ) : (
              <p className="empty">建立交易后选择它，录入第一笔成交。</p>
            )}
          </section>
          <section>
            <h2>交易列表</h2>
            <p>
              宽表可左右滑动查看完整数据。已平仓 {metrics.count} 笔 · 胜率{" "}
              {metrics.winRate
                ? D(metrics.winRate).mul(100).toFixed(2) + "%"
                : "暂无"}
              。损益保留原币种，跨币种不直接相加。
            </p>
            <div className="table" tabIndex={0} aria-label="交易列表">
              <table>
                <thead>
                  <tr>
                    <th>标的 / 账户</th>
                    <th>策略 / 计划</th>
                    <th>状态</th>
                    <th>数量</th>
                    <th>成交均价</th>
                    <th>已实现损益</th>
                    <th>累计费用</th>
                  </tr>
                </thead>
                <tbody>
                  {state.trades.map((t) => (
                    <tr key={t.id}>
                      <td>
                        {assetName(state, t.assetId)}
                        <br />
                        {accountName(state, t.accountId)}
                      </td>
                      <td>
                        {versionName(state, t.strategyVersionId)}
                        <br />
                        {t.planId ? "计划内" : "计划外"}
                      </td>
                      <td>{t.status === "CLOSED" ? "已平仓" : "进行中"}</td>
                      <td className="number">{t.quantity}</td>
                      <td className="number">{t.averageEntry}</td>
                      <td className="number">{t.realized}</td>
                      <td className="number">{t.fees}</td>
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
