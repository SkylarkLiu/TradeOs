import React, { useState } from "react";
import { D } from "@tradeos/core";
import { portfolioGroups } from "./assets";
import type { Ledger, State } from "./ledger";
const localNow = () =>
  new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
const types: Record<string, string> = {
  BUY: "买入",
  SELL: "卖出",
  DEPOSIT: "期初 / 外部存入",
  WITHDRAWAL: "外部取出",
  DIVIDEND: "分红 / 赠送份额",
  INTEREST: "利息份额",
  ADJUSTMENT: "持仓调整",
};
export function AssetsView({
  state,
  ledger,
  busy,
  act,
  notice,
}: {
  state: State;
  ledger: Ledger;
  busy: boolean;
  act: (work: () => Promise<void>) => Promise<void>;
  notice: (text: string) => void;
}) {
  const [accountId, setAccountId] = useState("");
  const account = state.accounts.find((a) => a.id === accountId);
  const choices = state.assets.filter(
    (a) => !account || a.currency === account.currency,
  );
  const submit = (
    event: React.FormEvent<HTMLFormElement>,
    work: (data: Record<string, FormDataEntryValue>) => Promise<unknown>,
    label: string,
  ) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    void act(async () => {
      await work(data);
      form.reset();
      setAccountId("");
      notice(label);
    });
  };
  return (
    <>
      <div className="heading">
        <h1>现货资产账本</h1>
        <p>
          买卖同步更新现金、持仓、成本和已实现损益。当前按原币种汇总，账户须与资产结算币种一致。
        </p>
      </div>
      <div className="totals">
        {portfolioGroups(state.accounts, state).map((g) => (
          <div key={g.currency}>
            <span>
              {g.currency} {g.missing ? "已知资产小计" : "资产合计"}
            </span>
            <strong>{D(g.value).toFixed(2)}</strong>
            {g.missing > 0 && (
              <p>另有 {g.missing} 项持仓缺少报价，未计入合计。</p>
            )}
          </div>
        ))}
      </div>
      <div className="columns">
        <section>
          <h2>创建资产</h2>
          <form
            onSubmit={(e) =>
              submit(e, (d) => ledger.createAsset(d), "资产已保存。")
            }
          >
            <label>
              资产代码
              <input
                name="code"
                required
                maxLength={300}
                placeholder="如 600000 / AAPL / BTC"
              />
            </label>
            <label>
              资产名称
              <input name="name" required maxLength={300} />
            </label>
            <div className="pair">
              <label>
                资产类别
                <select name="assetClass" aria-label="资产类别">
                  <option value="STOCK">股票</option>
                  <option value="FUND">基金</option>
                  <option value="CRYPTO">加密资产</option>
                  <option value="OTHER">其他现货</option>
                </select>
              </label>
              <label>
                结算币种
                <input
                  name="currency"
                  defaultValue="CNY"
                  required
                  maxLength={12}
                  pattern="[A-Z][A-Z0-9]{1,11}"
                />
              </label>
            </div>
            <button disabled={busy}>保存资产</button>
          </form>
        </section>
        <section>
          <h2>录入持仓与买卖</h2>
          <form
            onSubmit={(e) =>
              submit(
                e,
                (d) =>
                  ledger.postAsset({
                    ...d,
                    at: new Date(String(d.at)).toISOString(),
                  }),
                "现金、持仓和资产流水已一起保存。",
              )
            }
          >
            <label>
              资产账户
              <select
                aria-label="资产账户"
                name="accountId"
                required
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
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
              交易资产
              <select
                key={accountId}
                aria-label="交易资产"
                name="assetId"
                required
                defaultValue=""
              >
                <option value="">请选择同币种资产</option>
                {choices.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} / {a.name} · {a.currency}
                  </option>
                ))}
              </select>
            </label>
            <div className="pair">
              <label>
                资产流水类型
                <select aria-label="资产流水类型" name="type">
                  {Object.entries(types).map(([v, t]) => (
                    <option value={v} key={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                数量
                <input name="quantity" required inputMode="decimal" />
              </label>
            </div>
            <div className="pair">
              <label>
                单价
                <input name="price" required inputMode="decimal" />
              </label>
              <label>
                资产手续费
                <input
                  name="fee"
                  required
                  defaultValue="0"
                  inputMode="decimal"
                />
              </label>
            </div>
            <label>
              资产发生时间
              <input
                name="at"
                type="datetime-local"
                required
                defaultValue={localNow()}
              />
            </label>
            <label>
              资产说明
              <input name="note" maxLength={3000} />
            </label>
            <p>
              期初持仓用“期初 /
              外部存入”，不会扣除买入本金；买入会扣本金与费用，卖出会增加净回款。此处的分红指资产份额，现金分红收入的独立分类将在后续阶段开放。
            </p>
            <button
              disabled={busy || !state.accounts.length || !state.assets.length}
            >
              保存资产流水
            </button>
          </form>
        </section>
      </div>
      <section>
        <h2>持仓与估值</h2>
        <p>宽表可左右滑动查看完整数据。</p>
        <div className="table" tabIndex={0} aria-label="可横向滚动的持仓">
          <table>
            <thead>
              <tr>
                <th>账户</th>
                <th>资产</th>
                <th>数量</th>
                <th>成本</th>
                <th>最近报价</th>
                <th>市值</th>
                <th>浮动损益</th>
                <th>已实现损益</th>
              </tr>
            </thead>
            <tbody>
              {state.holdings.map((h) => {
                const asset = state.assets.find((a) => a.id === h.assetId)!;
                const price = state.prices.find((p) => p.assetId === h.assetId);
                const value = price ? D(h.quantity).mul(price.price) : null;
                return (
                  <tr key={h.accountId + ":" + h.assetId}>
                    <td>
                      {state.accounts.find((a) => a.id === h.accountId)?.name}
                    </td>
                    <td>
                      {asset.code} · {asset.currency}
                    </td>
                    <td className="number">{h.quantity}</td>
                    <td className="number">{h.cost}</td>
                    <td>
                      {price ? (
                        <>
                          {price.price}
                          <br />
                          <small>
                            {new Date(price.at).toLocaleString("zh-CN", {
                              timeZone: "Asia/Shanghai",
                              hour12: false,
                            })}
                          </small>
                        </>
                      ) : (
                        "缺少报价"
                      )}
                    </td>
                    <td className="number">{value?.toFixed() ?? "待报价"}</td>
                    <td className="number">
                      {value?.minus(h.cost).toFixed() ?? "待报价"}
                    </td>
                    <td className="number">{h.realized}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!state.holdings.length && (
          <p className="empty">先在现金账本创建账户，再录入期初持仓或买入。</p>
        )}
      </section>
      <section>
        <h2>更新报价</h2>
        <form
          onSubmit={(e) =>
            submit(
              e,
              (d) =>
                ledger.setPrice({
                  ...d,
                  at: new Date(String(d.at)).toISOString(),
                }),
              "报价已保存，估值已更新。",
            )
          }
        >
          <div className="pair">
            <label>
              报价资产
              <select
                aria-label="报价资产"
                name="assetId"
                required
                defaultValue=""
              >
                <option value="">请选择</option>
                {state.assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} / {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              报价
              <input name="price" required inputMode="decimal" />
            </label>
          </div>
          <label>
            报价时间
            <input
              name="at"
              type="datetime-local"
              required
              defaultValue={localNow()}
            />
          </label>
          <button disabled={busy || !state.assets.length}>保存报价</button>
        </form>
      </section>
      <section>
        <h2>最近50条资产流水</h2>
        <p>宽表可左右滑动查看完整数据。</p>
        <div className="table" tabIndex={0} aria-label="可横向滚动的资产流水">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>账户</th>
                <th>资产</th>
                <th>类型</th>
                <th>数量</th>
                <th>单价</th>
                <th>费用</th>
                <th>现金变化</th>
              </tr>
            </thead>
            <tbody>
              {state.assetEntries.slice(0, 50).map((e) => (
                <tr key={e.id}>
                  <td>
                    {new Date(e.at).toLocaleString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                      hour12: false,
                    })}
                  </td>
                  <td>
                    {state.accounts.find((a) => a.id === e.accountId)?.name}
                  </td>
                  <td>{state.assets.find((a) => a.id === e.assetId)?.code}</td>
                  <td>{types[e.type]}</td>
                  <td className="number">{e.quantity}</td>
                  <td className="number">{e.price}</td>
                  <td className="number">{e.fee}</td>
                  <td className="number">{e.cashDelta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!state.assetEntries.length && <p className="empty">暂无资产流水</p>}
      </section>
    </>
  );
}
