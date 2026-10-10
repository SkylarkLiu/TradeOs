import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { z } from "zod";
import { D, sum, projectWealth } from "@tradeos/core";
import { Ledger, validateBackup, type State } from "./ledger";
import { openSql } from "./sql";
import { exportJson, importJson, saveBefore, readBefore } from "./files";
import { runChecks } from "./checks";
import "./style.css";
import { emptyAssets } from "./assets";
import { AssetsView } from "./assets-view";
const localNow = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
const money = (v: string) => {
  const d = D(v);
  return d.abs().gt(0) && d.abs().lt(".01")
    ? d.toFixed()
    : d.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};
const message = (e: unknown) =>
  e instanceof SyntaxError
    ? "文件不是有效的JSON备份，请重新选择。"
    : e instanceof z.ZodError
      ? e.issues.map((i) => i.message).join("；")
      : e instanceof Error
        ? e.message.startsWith("[DecimalError]")
          ? "请输入十进制数，不要包含逗号或百分号。"
          : e.message
        : "操作失败";
let app: Ledger;
function App() {
  const [state, setState] = useState<State>({
      accounts: [],
      entries: [],
      ...emptyAssets(),
    }),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [tab, setTab] = useState("账本"),
    [pending, setPending] = useState<Awaited<
      ReturnType<typeof validateBackup>
    > | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [forecast, setForecast] = useState<{
      nominal: string;
      real: string;
    } | null>(null),
    [checks, setChecks] = useState<string[]>([]);
  const refresh = async () => setState(await app.state());
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        app = new Ledger(await openSql());
        await app.init();
        if (!cancelled) {
          await refresh();
          setReady(true);
        }
      } catch (e) {
        setError(message(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const groups = [...new Set(state.accounts.map((a) => a.currency))].map(
    (currency) => ({
      currency,
      total: sum(
        state.accounts
          .filter((a) => a.currency === currency)
          .map((a) => a.balance),
      ).toFixed(),
    }),
  );
  return (
    <div className="app">
      <header>
        <a className="brand" href="#">
          TradeOS <span>离线样机</span>
        </a>
        <span className="status">
          {Capacitor.isNativePlatform()
            ? "本机SQLite · 离线"
            : "浏览器验证存储"}
        </span>
      </header>
      <nav aria-label="工作台">
        {["账本", "资产", "预测", "备份", "离线检查"].map((t) => (
          <button
            key={t}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      <main>
        <p className="scope">
          安卓离线资产版 0.2.0 ·
          现金与现货持仓共用账本。策略交易、回测、复盘及电脑备份迁移仍在后续阶段。
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {!ready ? (
          <section>
            <h1>准备本机数据</h1>
            <p>首次启动将创建独立的离线验证账本。</p>
            {error && (
              <button onClick={() => location.reload()}>重新打开</button>
            )}
          </section>
        ) : (
          <>
            {tab === "账本" && (
              <>
                <div className="heading">
                  <h1>现金账本</h1>
                  <p>金额按原币种分别汇总；不假设美元与USDT等价。</p>
                </div>
                <div className="totals">
                  {groups.length ? (
                    groups.map((g) => (
                      <div key={g.currency}>
                        <span>{g.currency} 现金合计</span>
                        <strong>{money(g.total)}</strong>
                      </div>
                    ))
                  ) : (
                    <p>先创建一个验证账户，再录入期初现金。</p>
                  )}
                </div>
                <div className="columns">
                  <section>
                    <h2>创建账户</h2>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const data = Object.fromEntries(new FormData(form));
                        void act(async () => {
                          await app.createAccount(data);
                          form.reset();
                          setNotice("账户已保存到本机。");
                        });
                      }}
                    >
                      <label>
                        平台
                        <input
                          name="platform"
                          required
                          maxLength={300}
                          placeholder="银行 / 券商 / 交易平台"
                        />
                      </label>
                      <label>
                        账户名称
                        <input name="name" required maxLength={300} />
                      </label>
                      <label>
                        币种
                        <select
                          aria-label="币种"
                          name="currency"
                          defaultValue="CNY"
                        >
                          <option>CNY</option>
                          <option>USD</option>
                          <option>USDT</option>
                        </select>
                      </label>
                      <button disabled={busy}>保存账户</button>
                    </form>
                  </section>
                  <section>
                    <h2>录入现金流水</h2>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget;
                        const data = Object.fromEntries(new FormData(form));
                        void act(async () => {
                          await app.post({
                            ...data,
                            at: new Date(String(data.at)).toISOString(),
                          });
                          form.reset();
                          setNotice("流水与余额已一起保存。");
                        });
                      }}
                    >
                      <label>
                        账户
                        <select
                          aria-label="账户"
                          name="accountId"
                          required
                          defaultValue=""
                        >
                          <option value="">请选择</option>
                          {state.accounts.map((a) => (
                            <option value={a.id} key={a.id}>
                              {a.platform} / {a.name} · {a.currency}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="pair">
                        <label>
                          类型
                          <select aria-label="类型" name="type">
                            <option value="DEPOSIT">外部存入 / 期初</option>
                            <option value="WITHDRAWAL">外部取出</option>
                            <option value="ADJUSTMENT">人工调整</option>
                          </select>
                        </label>
                        <label>
                          金额
                          <input
                            name="amount"
                            required
                            inputMode="decimal"
                            placeholder="支持极小小数"
                          />
                        </label>
                      </div>
                      <div className="pair">
                        <label>
                          手续费
                          <input
                            name="fee"
                            defaultValue="0"
                            required
                            inputMode="decimal"
                          />
                        </label>
                        <label>
                          发生时间
                          <input
                            name="at"
                            type="datetime-local"
                            defaultValue={localNow()}
                            required
                          />
                        </label>
                      </div>
                      <label>
                        说明
                        <input name="note" maxLength={1000} />
                      </label>
                      <button disabled={busy || !state.accounts.length}>
                        保存流水
                      </button>
                    </form>
                  </section>
                </div>
                <section>
                  <h2>账户余额</h2>
                  <div className="table">
                    <table>
                      <thead>
                        <tr>
                          <th>平台 / 账户</th>
                          <th>币种</th>
                          <th>余额</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.accounts.map((a) => (
                          <tr key={a.id}>
                            <td>
                              {a.platform} / {a.name}
                            </td>
                            <td>{a.currency}</td>
                            <td className="number">{money(a.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!state.accounts.length && <p className="empty">暂无账户</p>}
                </section>
                <section>
                  <h2>最近50条现金流水</h2>
                  <div
                    className="table"
                    tabIndex={0}
                    aria-label="可横向滚动的流水"
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>时间</th>
                          <th>账户</th>
                          <th>类型</th>
                          <th>毛额</th>
                          <th>费用</th>
                          <th>净变化</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.entries.slice(0, 50).map((e) => (
                          <tr key={e.id}>
                            <td>
                              {new Date(e.at).toLocaleString("zh-CN", {
                                timeZone: "Asia/Shanghai",
                                hour12: false,
                              })}
                            </td>
                            <td>
                              {
                                state.accounts.find((a) => a.id === e.accountId)
                                  ?.name
                              }
                            </td>
                            <td>
                              {
                                {
                                  DEPOSIT: "存入",
                                  WITHDRAWAL: "取出",
                                  ADJUSTMENT: "调整",
                                }[e.type]
                              }
                            </td>
                            <td className="number">{e.amount}</td>
                            <td className="number">{e.fee}</td>
                            <td
                              className={
                                D(e.delta).lt(0)
                                  ? "negative number"
                                  : D(e.delta).gt(0)
                                    ? "positive number"
                                    : "number"
                              }
                            >
                              {e.delta}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}
            {tab === "资产" && (
              <AssetsView
                state={state}
                ledger={app}
                busy={busy}
                act={act}
                notice={setNotice}
              />
            )}
            {tab === "预测" && (
              <>
                <h1>财富增长计算验证</h1>
                <p>
                  固定假设下的名义资产与购买力，不是收益保证；金额单位由你统一选择。
                </p>
                <section>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      try {
                        const fd = new FormData(e.currentTarget);
                        const current = String(fd.get("current")),
                          monthly = String(fd.get("monthly")),
                          annual = D(String(fd.get("annual"))).div(100),
                          inflation = D(String(fd.get("inflation"))).div(100),
                          years = Number(fd.get("years"));
                        if (
                          D(current).lt(0) ||
                          D(monthly).lt(0) ||
                          annual.lte(-1) ||
                          annual.gt(2) ||
                          inflation.lte(-1) ||
                          inflation.gt(2) ||
                          !Number.isInteger(years) ||
                          years < 1 ||
                          years > 60
                        )
                          throw new Error(
                            "请填写有效资产、投入和1–60年的预测期限。年率须大于-100%且不超过200%。",
                          );
                        setForecast(
                          projectWealth(
                            current,
                            monthly,
                            annual.toFixed(),
                            inflation.toFixed(),
                            years * 12,
                          ).at(-1)!,
                        );
                        setError("");
                      } catch (e) {
                        setError(message(e));
                      }
                    }}
                  >
                    <div className="pair">
                      <label>
                        当前资产
                        <input
                          name="current"
                          defaultValue="100000"
                          required
                          inputMode="decimal"
                        />
                      </label>
                      <label>
                        每月投入
                        <input
                          name="monthly"
                          defaultValue="1000"
                          required
                          inputMode="decimal"
                        />
                      </label>
                      <label>
                        年收益假设（%）
                        <input
                          name="annual"
                          defaultValue="5"
                          required
                          inputMode="decimal"
                        />
                      </label>
                      <label>
                        年通胀假设（%）
                        <input
                          name="inflation"
                          defaultValue="2"
                          required
                          inputMode="decimal"
                        />
                      </label>
                    </div>
                    <label>
                      预测年数
                      <input
                        name="years"
                        defaultValue="10"
                        type="number"
                        min="1"
                        max="60"
                        required
                      />
                    </label>
                    <button>计算</button>
                  </form>
                  {forecast && (
                    <dl>
                      <dt>名义资产</dt>
                      <dd>{money(forecast.nominal)}</dd>
                      <dt>以当前购买力计</dt>
                      <dd>{money(forecast.real)}</dd>
                    </dl>
                  )}
                </section>
              </>
            )}
            {tab === "备份" && (
              <>
                <h1>本机备份与恢复</h1>
                <p>
                  样机备份格式独立。卸载或清除应用数据会删除账本，请提前导出到应用外。
                </p>
                <section>
                  <h2>导出数据</h2>
                  <div className="actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const r = await exportJson(await app.backup());
                          if (!r.cancelled) setNotice("备份已导出。");
                        })
                      }
                    >
                      导出完整JSON
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const file = await readBefore();
                          if (!file) throw new Error("还没有恢复前备份");
                          await exportJson(file, "tradeos-before-restore.json");
                        })
                      }
                    >
                      导出恢复前备份
                    </button>
                  </div>
                </section>
                <section>
                  <h2>从备份恢复</h2>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        setPending(null);
                        setConfirmed(false);
                        const raw = await importJson();
                        if (raw) {
                          setPending(await validateBackup(raw));
                          setNotice("校验通过，请核对内容后确认替换。");
                        }
                      })
                    }
                  >
                    选择JSON并预览
                  </button>
                  {pending && (
                    <>
                      <p>
                        账户 {pending.payload.accounts.length} 个 · 现金流水{" "}
                        {pending.payload.entries.length} 条 · 资产{" "}
                        {pending.payload.assets.length} 项 · 资产流水{" "}
                        {pending.payload.assetEntries.length} 条 · 报价{" "}
                        {pending.payload.prices.length} 条
                      </p>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={confirmed}
                          onChange={(e) => setConfirmed(e.target.checked)}
                        />
                        已核对，确认替换当前样机账本
                      </label>
                      <button
                        disabled={busy || !confirmed}
                        onClick={() =>
                          void act(async () => {
                            await saveBefore(await app.backup());
                            await app.restore(pending);
                            setPending(null);
                            setConfirmed(false);
                            setNotice("恢复成功，原账本已保存为恢复前备份。");
                          })
                        }
                      >
                        确认恢复
                      </button>
                    </>
                  )}
                </section>
              </>
            )}
            {tab === "离线检查" && (
              <>
                <h1>检测本机离线能力</h1>
                <p>
                  检查使用独立的验证数据库，不改变你录入的账户。你还可以开飞行模式、关闭应用并重开，核对账本是否保留。
                </p>
                <section>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        setChecks(await runChecks());
                        setNotice("离线能力检查通过。");
                      })
                    }
                  >
                    运行离线检查
                  </button>
                  <ul>
                    {checks.map((c) => (
                      <li key={c}>{c} · 通过</li>
                    ))}
                  </ul>
                </section>
              </>
            )}
          </>
        )}
      </main>
      <footer>
        TradeOS 安卓迁移验证版 · 数据保存在当前设备 · 尚未启用数据库加密
      </footer>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
