import React, { useState } from "react";
import { D } from "@tradeos/core";
import type { Ledger, State } from "./ledger";
import { wealthPortfolio, fireProjection } from "./wealth";
type Props = {
  state: State;
  ledger: Ledger;
  busy: boolean;
  act: (work: () => Promise<void>) => Promise<void>;
  notice: (s: string) => void;
};
const now = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
const iso = (v: FormDataEntryValue) => new Date(String(v)).toISOString();
const money = (v: string | null) => (v === null ? "待补齐" : D(v).toFixed(2));
const classes: Record<string, string> = {
  CASH: "现金",
  STOCK: "股票",
  FUND: "基金",
  CRYPTO: "加密资产",
  BOND: "债券",
  GOLD: "黄金",
  REAL_ESTATE: "房产",
  OTHER: "其他",
  IN_TRANSIT: "在途",
};
function submit(
  p: Props,
  e: React.FormEvent<HTMLFormElement>,
  work: (d: Record<string, FormDataEntryValue>) => Promise<unknown>,
  message: string,
) {
  e.preventDefault();
  const form = e.currentTarget,
    d = Object.fromEntries(new FormData(form));
  void p.act(async () => {
    await work(d);
    p.notice(message);
  });
}
function Amount({
  label,
  name,
  value = "0",
  required = true,
}: {
  label: string;
  name: string;
  value?: string;
  required?: boolean;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        defaultValue={value}
        required={required}
        inputMode="decimal"
      />
    </label>
  );
}
function Time({
  label = "记录时间",
  name = "at",
}: {
  label?: string;
  name?: string;
}) {
  return (
    <label>
      {label}
      <input name={name} type="datetime-local" defaultValue={now()} required />
    </label>
  );
}
export function WealthView(p: Props) {
  const { state, ledger, busy } = p,
    [report, setReport] = useState("CNY"),
    [view, setView] = useState("总览");
  const result = wealthPortfolio(state, report);
  return (
    <>
      <div className="heading">
        <h1>财富与负债</h1>
        <p>
          按手动报价和汇率估值。在途资产计入一次；财富快照记录保存时点，变化不等于投资收益。
        </p>
      </div>
      <div className="actions" aria-label="财富页面">
        {["总览", "负债", "汇率", "可投资范围", "快照"].map((v) => (
          <button
            className={v === view ? "" : "secondary"}
            aria-pressed={v === view}
            key={v}
            onClick={() => setView(v)}
          >
            {v}
          </button>
        ))}
      </div>
      <label className="report-currency">
        报告币种
        <select value={report} onChange={(e) => setReport(e.target.value)}>
          {[
            ...new Set([
              "CNY",
              "USD",
              "USDT",
              ...state.accounts.map((a) => a.currency),
              ...state.liabilities.map((a) => a.currency),
              ...state.goals.map((a) => a.currency),
            ]),
          ].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {view === "总览" && (
        <>
          <p className={result.complete ? "notice" : "error"}>
            {result.complete
              ? `当前估值完整 · ${report} · ${result.inTransit} 笔在途`
              : `估值未完整：以下金额为已知小计。请补齐或更新报价与汇率（有效期 ${state.valuationMaxDays} 天）。`}
          </p>
          <div className="totals">
            {[
              ["总资产", result.assets],
              ["总负债", result.liabilities],
              ["净资产", result.net],
              ["可投资净资产", result.investable],
            ].map(([label, value]) => (
              <div key={label}>
                <span>
                  {label}
                  {result.complete ? "" : "（已知）"}
                </span>
                <strong
                  data-testid={label === "净资产" ? "wealth-net" : undefined}
                >
                  {money(value)}
                </strong>
              </div>
            ))}
          </div>
          <section>
            <h2>资产配置{result.complete ? "" : " · 已知部分"}</h2>
            {result.allocation.length ? (
              <ul>
                {result.allocation.map((a) => (
                  <li key={a.name}>
                    {classes[a.name] ?? a.name} · {money(a.value)} {report} ·{" "}
                    {D(result.assets).gt(0)
                      ? D(a.value).div(result.assets).mul(100).toFixed(1)
                      : "0"}
                    %
                  </li>
                ))}
              </ul>
            ) : (
              <p>尚无可估值资产。先在账本中录入现金或持仓。</p>
            )}
            <div className="table" tabIndex={0} aria-label="财富明细">
              <table>
                <thead>
                  <tr>
                    {[
                      "资产 / 账户",
                      "数量",
                      "估值",
                      "状态 / 估值日期",
                      "FIRE范围",
                    ].map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={i}>
                      <td>
                        {r.name}
                        <br />
                        {r.account}
                      </td>
                      <td>{r.quantity}</td>
                      <td>
                        {money(r.value)} {report}
                      </td>
                      <td>
                        {r.issue ?? "已估值"}
                        <br />
                        {r.priceAt && `价格 ${r.priceAt.slice(0, 10)} `}
                        {r.fxAt && `汇率 ${r.fxAt.slice(0, 10)}`}
                      </td>
                      <td>{r.investable ? "计入" : "排除"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {view === "负债" && (
        <>
          <section>
            <h2>新增负债</h2>
            <p>
              只维护欠款余额，不自动修改现金。借款到账、实际还款请在现金账本另记流水。
            </p>
            <form
              aria-label="新增负债"
              onSubmit={(e) =>
                submit(
                  p,
                  e,
                  (d) =>
                    ledger.createLiability({
                      ...d,
                      at: iso(d.at),
                      investable: d.investable ? 1 : 0,
                    }),
                  "负债及余额历史已保存。",
                )
              }
            >
              <label>
                负债名称
                <input name="name" required maxLength={300} />
              </label>
              <label>
                负债币种
                <input
                  name="currency"
                  defaultValue="CNY"
                  required
                  pattern="[A-Z][A-Z0-9]{1,11}"
                  maxLength={12}
                />
              </label>
              <Amount label="欠款余额" name="amount" />
              <Time label="负债时间" />
              <label className="check">
                <input name="investable" type="checkbox" defaultChecked />
                从可投资资产中扣除
              </label>
              <button disabled={busy}>保存负债</button>
            </form>
          </section>
          {result.liabilityRows.map((l) => (
            <section key={l.id}>
              <h2>
                {l.name} · {l.currency}
              </h2>
              <p>
                当前欠款 {l.amount} · 报告估值 {money(l.value)} {report}{" "}
                {l.issue ?? ""}
              </p>
              <form
                aria-label={`更新负债 ${l.name}`}
                onSubmit={(e) =>
                  submit(
                    p,
                    e,
                    (d) =>
                      ledger.updateLiability({
                        id: l.id,
                        amount: d.amount,
                        at: iso(d.at),
                        investable: d.investable ? 1 : 0,
                      }),
                    "负债余额已更新。",
                  )
                }
              >
                <Amount label="新欠款余额" name="amount" value={l.amount} />
                <Time label="余额更新时间" />
                <label className="check">
                  <input
                    name="investable"
                    type="checkbox"
                    defaultChecked={!!l.investable}
                  />
                  从可投资资产中扣除
                </label>
                <button disabled={busy}>更新负债</button>
              </form>
              <details>
                <summary>余额历史</summary>
                <ul>
                  {state.liabilityBalances
                    .filter((e) => e.liabilityId === l.id)
                    .map((e) => (
                      <li key={e.id}>
                        {new Date(e.at).toLocaleString()} · {e.amount}{" "}
                        {l.currency}
                      </li>
                    ))}
                </ul>
              </details>
            </section>
          ))}
        </>
      )}
      {view === "汇率" && (
        <div className="columns">
          <section>
            <h2>记录汇率</h2>
            <p>
              填写 1
              单位原币对应的目标币数量。支持直接与反向折算；没有汇率时不会按 1:1
              假定。这里的记录不代表换汇成交。
            </p>
            <form
              aria-label="汇率表单"
              onSubmit={(e) =>
                submit(
                  p,
                  e,
                  (d) => ledger.setFx({ ...d, at: iso(d.at) }),
                  "手动汇率已保存。",
                )
              }
            >
              <div className="pair">
                <label>
                  原币
                  <input
                    name="from"
                    required
                    defaultValue="USD"
                    pattern="[A-Z][A-Z0-9]{1,11}"
                  />
                </label>
                <label>
                  目标币
                  <input
                    name="to"
                    required
                    defaultValue="CNY"
                    pattern="[A-Z][A-Z0-9]{1,11}"
                  />
                </label>
              </div>
              <Amount label="汇率" name="rate" value="" />
              <Time label="汇率时间" />
              <button disabled={busy}>保存汇率</button>
            </form>
            <details>
              <summary>汇率历史</summary>
              <ul>
                {[...state.fxRates].reverse().map((r) => (
                  <li key={r.id}>
                    1 {r.from} = {r.rate} {r.to} ·{" "}
                    {new Date(r.at).toLocaleString()}
                  </li>
                ))}
              </ul>
            </details>
          </section>
          <section>
            <h2>估值有效期</h2>
            <p>
              超过有效期的价格或汇率会退出完整估值。此设置同时影响财富快照和财务自由计算。
            </p>
            <form
              onSubmit={(e) =>
                submit(
                  p,
                  e,
                  (d) => ledger.setValuationWindow({ days: Number(d.days) }),
                  "估值有效期已保存。",
                )
              }
            >
              <label>
                有效天数
                <input
                  key={state.valuationMaxDays}
                  type="number"
                  name="days"
                  defaultValue={state.valuationMaxDays}
                  min={1}
                  max={3650}
                  required
                />
              </label>
              <button disabled={busy}>保存有效期</button>
            </form>
          </section>
        </div>
      )}
      {view === "可投资范围" && (
        <section>
          <h2>财务自由计算范围</h2>
          <p>
            总资产仍包含所有项目。应急储备可按账户排除；房产默认排除，请只将可用于退休支出的资产计入。
          </p>
          <h3>账户</h3>
          {state.accounts.map((a) => (
            <label className="check" key={a.id}>
              <input
                type="checkbox"
                checked={
                  state.accountConfig.find((c) => c.accountId === a.id)
                    ?.investable !== 0
                }
                disabled={busy}
                onChange={(e) => {
                  const value = e.target.checked ? 1 : 0;
                  void p.act(async () => {
                    await ledger.configureWealth({
                      kind: "ACCOUNT",
                      id: a.id,
                      investable: value,
                    });
                    p.notice("账户范围已保存。");
                  });
                }}
              />
              {a.platform} / {a.name} · {a.currency}
            </label>
          ))}
          <h3>资产</h3>
          {state.assets.map((a) => (
            <label className="check" key={a.id}>
              <input
                type="checkbox"
                checked={
                  (state.assetConfig.find((c) => c.assetId === a.id)
                    ?.investable ??
                    (a.assetClass === "REAL_ESTATE" ? 0 : 1)) === 1
                }
                disabled={busy}
                onChange={(e) => {
                  const value = e.target.checked ? 1 : 0;
                  void p.act(async () => {
                    await ledger.configureWealth({
                      kind: "ASSET",
                      id: a.id,
                      investable: value,
                    });
                    p.notice("资产范围已保存。");
                  });
                }}
              />
              {a.code} / {a.name} · {classes[a.assetClass]}
            </label>
          ))}
        </section>
      )}
      {view === "快照" && (
        <section>
          <h2>财富快照</h2>
          <p>
            保存当前完整估值和资产配置。历史快照不会随新报价改变；日期为实际保存时间。
          </p>
          <button
            disabled={busy || !result.complete}
            onClick={() =>
              void p.act(async () => {
                await ledger.saveWealthSnapshot({ currency: report });
                p.notice("完整财富快照已保存。");
              })
            }
          >
            保存当前快照
          </button>
          {!result.complete && <p>缺失或过期数据补齐后可保存。</p>}
          <div className="table" tabIndex={0} aria-label="财富快照">
            <table>
              <thead>
                <tr>
                  <th>保存时间</th>
                  <th>币种</th>
                  <th>资产</th>
                  <th>负债</th>
                  <th>净资产</th>
                  <th>可投资净资产</th>
                  <th>配置</th>
                </tr>
              </thead>
              <tbody>
                {[...state.snapshots]
                  .reverse()
                  .filter((s) => s.currency === report)
                  .map((s) => (
                    <tr key={s.id}>
                      <td>{new Date(s.at).toLocaleString()}</td>
                      <td>{s.currency}</td>
                      <td>{money(s.assets)}</td>
                      <td>{money(s.liabilities)}</td>
                      <td>{money(s.net)}</td>
                      <td>{money(s.investable)}</td>
                      <td>
                        {(
                          JSON.parse(s.allocation) as {
                            name: string;
                            value: string;
                          }[]
                        )
                          .map(
                            (a) =>
                              `${classes[a.name] ?? a.name} ${money(a.value)}`,
                          )
                          .join(" / ")}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!state.snapshots.some((s) => s.currency === report) && (
            <p>该币种尚未保存快照。</p>
          )}
        </section>
      )}
    </>
  );
}
export function TransferView(p: Props) {
  const { state, ledger, busy } = p,
    [fromId, setFrom] = useState("");
  const from = state.accounts.find((a) => a.id === fromId),
    choices = state.holdings.filter(
      (h) => h.accountId === fromId && D(h.quantity).gt(0),
    );
  return (
    <>
      <h1>账户内部划转</h1>
      <p>
        同币种现金或现货先转出、再确认到账。在途资产持续计入财富，手续费减少净资产，划转不会产生交易利润。
      </p>
      <section>
        <h2>发起划转</h2>
        <form
          aria-label="划转表单"
          onSubmit={(e) =>
            submit(
              p,
              e,
              (d) =>
                ledger.createTransfer({
                  ...d,
                  assetId: d.assetId || undefined,
                  at: iso(d.at),
                }),
              "划转已转出，资产在途。请到账后确认。",
            )
          }
        >
          <label>
            转出账户
            <select
              aria-label="转出账户"
              name="fromId"
              required
              value={fromId}
              onChange={(e) => setFrom(e.target.value)}
            >
              <option value="">请选择</option>
              {state.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.platform} / {a.name} · {a.currency}
                </option>
              ))}
            </select>
          </label>
          <label>
            转入账户
            <select aria-label="转入账户" name="toId" required key={fromId}>
              <option value="">请选择同币种账户</option>
              {state.accounts
                .filter(
                  (a) =>
                    a.id !== fromId && (!from || a.currency === from.currency),
                )
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.platform} / {a.name} · {a.currency}
                  </option>
                ))}
            </select>
          </label>
          <label>
            划转资产
            <select aria-label="划转资产" name="assetId" key={fromId}>
              <option value="">现金{from ? ` · ${from.currency}` : ""}</option>
              {choices.map((h) => {
                const a = state.assets.find((a) => a.id === h.assetId)!;
                return (
                  <option key={a.id} value={a.id}>
                    {a.code} / {a.name} · 持仓 {h.quantity}
                  </option>
                );
              })}
            </select>
          </label>
          <div className="pair">
            <Amount label="划转数量" name="quantity" value="" />
            <Amount label="划转手续费（账户币种）" name="fee" />
          </div>
          <Time label="转出时间" />
          <button disabled={busy || state.accounts.length < 2}>
            转出并记录在途
          </button>
        </form>
        {state.accounts.length < 2 && <p>先创建两个同币种账户。</p>}
      </section>
      <section>
        <h2>划转记录</h2>
        {!state.transfers.length && <p>尚无内部划转。</p>}
        {[...state.transfers].reverse().map((t) => (
          <div className="transfer-record" key={t.id}>
            <h3>
              {state.accounts.find((a) => a.id === t.fromId)?.name} →{" "}
              {state.accounts.find((a) => a.id === t.toId)?.name}
            </h3>
            <p>
              {state.assets.find((a) => a.id === t.assetId)?.name ?? "现金"} ·{" "}
              {t.quantity} {t.assetId ? "单位" : t.currency} · 手续费 {t.fee}{" "}
              {t.currency} · {t.status === "IN_TRANSIT" ? "在途" : "已到账"}
              <br />
              转出 {new Date(t.at).toLocaleString()}
              {t.completedAt &&
                ` · 到账 ${new Date(t.completedAt).toLocaleString()}`}
            </p>
            {t.status === "IN_TRANSIT" && (
              <form
                aria-label={`确认到账 ${t.id}`}
                onSubmit={(e) =>
                  submit(
                    p,
                    e,
                    (d) => ledger.completeTransfer({ id: t.id, at: iso(d.at) }),
                    "划转已到账，目标账户已更新。",
                  )
                }
              >
                <Time label="到账时间" />
                <button disabled={busy}>确认到账</button>
              </form>
            )}
          </div>
        ))}
      </section>
    </>
  );
}
export function FireView(p: Props) {
  const { state, ledger, busy } = p,
    [selected, setSelected] = useState("");
  const goal = state.goals.find((g) => g.id === selected) ?? state.goals[0],
    projection = goal ? fireProjection(state, goal.id) : null;
  const defaultDate = new Date();
  defaultDate.setFullYear(defaultDate.getFullYear() + 10);
  return (
    <>
      <h1>财务自由规划</h1>
      <p>
        以财富账本中的可投资净资产为起点。收益和通胀为手动假设，按月投入，退休后按月支出并模拟
        30 年提取。
      </p>
      <section>
        <h2>目标与假设</h2>
        {state.goals.length > 0 && (
          <label>
            已保存目标
            <select
              value={goal?.id ?? ""}
              onChange={(e) => setSelected(e.target.value)}
            >
              {state.goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} · {g.currency}
                </option>
              ))}
            </select>
          </label>
        )}
        <form
          key={goal?.id ?? "new"}
          aria-label="财务自由目标"
          onSubmit={(e) =>
            submit(
              p,
              e,
              async (d) => {
                const g = await ledger.saveGoal({
                  ...d,
                  age: Number(d.age),
                  retirementAge: Number(d.retirementAge),
                  retirementDate: new Date(
                    `${d.retirementDate}T12:00:00`,
                  ).toISOString(),
                  target: d.target || undefined,
                  ...Object.fromEntries(
                    [
                      "inflation",
                      "conservative",
                      "baseReturn",
                      "optimistic",
                      "withdrawalRate",
                    ].map((k) => [k, D(String(d[k])).div(100).toFixed()]),
                  ),
                });
                setSelected(g.id);
              },
              "财务自由目标已保存。",
            )
          }
        >
          <label>
            目标名称
            <input
              name="name"
              defaultValue={goal?.name ?? "我的财务自由目标"}
              required
              maxLength={300}
            />
          </label>
          <p>使用新名称可增加目标；相同名称更新现有目标。</p>
          <div className="pair">
            <label>
              当前年龄
              <input
                name="age"
                type="number"
                min={18}
                max={100}
                defaultValue={goal?.age ?? 35}
                required
              />
            </label>
            <label>
              退休年龄
              <input
                name="retirementAge"
                type="number"
                min={18}
                max={130}
                defaultValue={goal?.retirementAge ?? 45}
                required
              />
            </label>
            <label>
              退休日期
              <input
                name="retirementDate"
                type="date"
                defaultValue={
                  goal?.retirementDate.slice(0, 10) ??
                  defaultDate.toISOString().slice(0, 10)
                }
                required
              />
            </label>
            <label>
              目标币种
              <input
                name="currency"
                defaultValue={goal?.currency ?? "CNY"}
                required
                pattern="[A-Z][A-Z0-9]{1,11}"
                maxLength={12}
              />
            </label>
            <Amount
              label="每月投入"
              name="monthlyContribution"
              value={goal?.monthlyContribution ?? "1000"}
            />
            <Amount
              label="当前每月支出"
              name="monthlyExpense"
              value={goal?.monthlyExpense ?? "5000"}
            />
            {[
              ["年通胀（%）", "inflation", "2"],
              ["保守收益（%）", "conservative", "2"],
              ["基准收益（%）", "baseReturn", "5"],
              ["乐观收益（%）", "optimistic", "8"],
              ["年提取率（%）", "withdrawalRate", "4"],
            ].map(([label, name, fallback]) => (
              <Amount
                key={name}
                label={label}
                name={name}
                value={
                  goal
                    ? D(goal[name as "inflation"])
                        .mul(100)
                        .toFixed()
                    : fallback
                }
              />
            ))}
            <Amount
              label="指定退休目标金额（可留空）"
              name="target"
              required={false}
              value={goal?.target ?? ""}
            />
          </div>
          <p>
            留空时，目标金额 = 通胀调整后的年支出 ÷
            年提取率；指定金额按退休时名义币值处理。
          </p>
          <button disabled={busy}>保存财务目标</button>
        </form>
      </section>
      {projection && (
        <section>
          <h2>
            {goal!.name} · {goal!.currency}
          </h2>
          <p>
            距退休约 {projection.months} 个月
            {projection.months === 0 ? " · 目标日期已到，请更新目标" : ""}
          </p>
          <dl>
            <dt>退休目标（名义）</dt>
            <dd>{money(projection.target)}</dd>
            <dt>按当前购买力</dt>
            <dd>{money(projection.targetReal)}</dd>
            <dt>可投资净资产{projection.complete ? "" : "（已知）"}</dt>
            <dd>{money(projection.current)}</dd>
          </dl>
          {!projection.complete ? (
            <p className="error">
              暂不显示达标预测：请补齐或更新价格、汇率，并确认可投资净资产不为负数。
            </p>
          ) : (
            <>
              <dl>
                <dt>当前进度</dt>
                <dd>{D(projection.progress!).mul(100).toFixed(1)}%</dd>
                <dt>目标缺口</dt>
                <dd>{money(projection.gap)}</dd>
                <dt>基准情景所需每月投入</dt>
                <dd>
                  {projection.requiredMonthly === null
                    ? "期限不足，无法计算"
                    : money(projection.requiredMonthly)}
                </dd>
              </dl>
              <div className="table" tabIndex={0} aria-label="财务自由情景">
                <table>
                  <thead>
                    <tr>
                      {[
                        "情景",
                        "假设年收益",
                        "退休资产",
                        "当前购买力",
                        "目标",
                        "退休后30年支出",
                      ].map((x) => (
                        <th key={x}>{x}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {projection.scenarios.map((s) => (
                      <tr key={s.name}>
                        <td>{s.name}</td>
                        <td>{D(s.rate).mul(100).toFixed(1)}%</td>
                        <td>{money(s.final)}</td>
                        <td>{money(s.realFinal)}</td>
                        <td>{s.meetsTarget ? "达到" : "未达到"}</td>
                        <td>
                          {s.retirement.shortfall
                            ? `第 ${s.retirement.shortfall} 月出现缺口`
                            : "模拟期内无缺口"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details>
                <summary>查看逐年路径</summary>
                <div
                  className="table"
                  tabIndex={0}
                  aria-label="财务自由逐年路径"
                >
                  <table>
                    <thead>
                      <tr>
                        <th>情景</th>
                        <th>退休前月份</th>
                        <th>名义资产</th>
                        <th>当前购买力</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projection.scenarios.flatMap((s) =>
                        s.points
                          .filter(
                            (x) =>
                              x.month % 12 === 0 ||
                              x.month === projection.months,
                          )
                          .map((x) => (
                            <tr key={`${s.name}-${x.month}`}>
                              <td>{s.name}</td>
                              <td>{x.month}</td>
                              <td>{money(x.nominal)}</td>
                              <td>{money(x.real)}</td>
                            </tr>
                          )),
                      )}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </section>
      )}
    </>
  );
}
