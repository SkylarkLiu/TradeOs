"use client";
import { useState } from "react";
import Markdown from "react-markdown";
import { Form, type Field } from "./form";
import { useWorkspace, Action } from "./workspace";
import { Table } from "./table";
import { Heading, Metrics } from "./wealth-view";
import { Attachments } from "./attachments";
import { amount, when, pct, signedClass } from "@/lib/utils";
import {
  D,
  Decimal,
  contractPnl,
  positionSize,
  tradeMetrics,
} from "@/lib/calculations/decimal";
export const rulesDefault =
  "## 入场规则\n\n## 出场规则\n\n## 止损规则\n\n## 仓位管理\n\n## 失效条件\n\n## 策略假设\n\n## 历史验证结果";
export function TradingView({ path }: { path: string }) {
  const { state: s, refresh } = useWorkspace(),
    [detailId, setDetailId] = useState(""),
    [versionId, setVersionId] = useState("");
  const accounts = s.accounts
      .filter((a) => !a.archived)
      .map((a) => ({ value: a.id, label: `${a.platform.name} / ${a.name}` })),
    assets = s.assets
      .filter((a) => a.assetClass !== "CASH")
      .map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
    versions = s.strategies.flatMap((st) =>
      st.versions
        .filter((v) => v.published && !st.archived)
        .map((v) => ({ value: v.id, label: `${st.name} v${v.version}` })),
    ),
    allVersions = s.strategies.flatMap((st) =>
      st.versions.map((v) => ({ ...v, name: st.name })),
    ),
    selectedVersion = allVersions.find((v) => v.id === versionId),
    selectedTrade = s.trades.find((t) => t.id === detailId);
  const aField: Field = {
      name: "accountId",
      label: "所属账户",
      options: accounts,
    },
    assetField: Field = { name: "assetId", label: "交易标的", options: assets },
    vField: Field = {
      name: "strategyVersionId",
      label: "策略版本",
      options: versions,
      optional: true,
    },
    dirField: Field = {
      name: "direction",
      label: "多空方向",
      value: "LONG",
      options: [
        { value: "LONG", label: "做多" },
        { value: "SHORT", label: "做空（合约）" },
      ],
    },
    atField: Field = { name: "at", label: "成交时间", type: "datetime-local" };
  const ruleFields: Field[] = [
    { name: "market", label: "适用市场", value: "股票" },
    { name: "timeframe", label: "交易周期", value: "日线" },
    { name: "environment", label: "市场环境", value: "趋势" },
    {
      name: "rules",
      label: "完整策略规则（Markdown）",
      type: "textarea",
      wide: true,
      value: rulesDefault,
    },
  ];
  if (path === "/trading/strategies")
    return (
      <>
        <Heading
          title="策略库"
          description="先写规则，再验证；发布后规则与附件锁定，历史交易保留原版本。"
        />
        <Form
          title="创建策略与首个草稿"
          action="strategy.create"
          onDone={refresh}
          fields={[{ name: "name", label: "策略名称" }, ...ruleFields]}
        />
        <section className="panel">
          <h2>策略与版本</h2>
          <Table
            rows={allVersions}
            columns={[
              { key: "name", label: "策略", value: (r) => r.name },
              { key: "version", label: "版本", value: (r) => `v${r.version}` },
              {
                key: "market",
                label: "市场 / 周期",
                value: (r) => `${r.market} / ${r.timeframe}`,
              },
              {
                key: "status",
                label: "发布状态",
                value: (r) => (r.published ? "已发布" : "草稿"),
              },
              {
                key: "action",
                label: "操作",
                value: (r) => (
                  <div className="actions">
                    <button
                      className="button outline"
                      onClick={() => setVersionId(r.id)}
                    >
                      查看 / 编辑
                    </button>
                    {!r.published && (
                      <Action
                        action="strategy.publish"
                        input={{ id: r.id }}
                        label="发布版本"
                      />
                    )}
                  </div>
                ),
              },
            ]}
            empty="创建第一套策略"
          />
          {s.strategies.map((st) => (
            <div className="form-actions" key={st.id}>
              <span>{st.name}</span>
              <Action
                action="strategy.archive"
                input={{ id: st.id, archived: !st.archived }}
                label={st.archived ? "恢复策略" : "归档策略"}
              />
            </div>
          ))}
        </section>
        {selectedVersion && (
          <section className="panel">
            <h2>
              {selectedVersion.name} · v{selectedVersion.version}
            </h2>
            <div className="markdown">
              <Markdown>{selectedVersion.rules}</Markdown>
            </div>
            <Attachments
              strategyVersionId={selectedVersion.id}
              rows={selectedVersion.attachments}
              locked={selectedVersion.published}
            />
            {!selectedVersion.published && (
              <Form
                key={selectedVersion.id}
                title="编辑草稿"
                action="strategy.edit"
                onDone={refresh}
                transform={(d) => ({ ...d, id: selectedVersion.id })}
                fields={ruleFields.map((f) => ({
                  ...f,
                  value:
                    selectedVersion[
                      f.name as "market" | "timeframe" | "environment" | "rules"
                    ],
                }))}
              />
            )}
          </section>
        )}
        <Form
          title="创建下一版本草稿"
          action="strategy.version"
          onDone={refresh}
          fields={[
            {
              name: "strategyId",
              label: "策略",
              options: s.strategies
                .filter((st) => !st.archived)
                .map((st) => ({ value: st.id, label: st.name })),
            },
            ...ruleFields,
          ]}
        />
      </>
    );
  if (path === "/trading/plans")
    return (
      <>
        <Heading
          title="交易计划"
          description="以止损风险确定参考仓位；不同合约使用对应的结算规则。"
        />
        <Form
          title="制定交易计划"
          action="plan.create"
          onDone={refresh}
          fields={[
            aField,
            assetField,
            vField,
            dirField,
            { name: "entry", label: "计划入场价" },
            { name: "stop", label: "初始止损价" },
            { name: "target", label: "计划止盈价" },
            { name: "equity", label: "账户权益（标的结算币种）" },
            { name: "riskPercent", label: "风险预算（%）", value: "1" },
            { name: "reason", label: "入场理由", wide: true },
            { name: "invalidation", label: "失效条件", wide: true },
          ]}
          preview={(data) => {
            try {
              const a = s.assets.find((a) => a.id === data.assetId);
              if (
                !a ||
                !data.entry ||
                !data.stop ||
                !data.equity ||
                !data.riskPercent
              )
                return null;
              const size = positionSize({
                ...data,
                direction: data.direction || "LONG",
                entry: data.entry,
                stop: data.stop,
                equity: data.equity,
                riskPercent: data.riskPercent,
                instrument: a.instrument,
                multiplier: a.multiplier,
              });
              const rr = data.target
                ? contractPnl(
                    a.instrument,
                    data.direction || "LONG",
                    "1",
                    data.entry,
                    data.target,
                    a.multiplier,
                  )
                    .abs()
                    .div(
                      contractPnl(
                        a.instrument,
                        data.direction || "LONG",
                        "1",
                        data.entry,
                        data.stop,
                        a.multiplier,
                      ).abs(),
                    )
                    .toFixed(2)
                : "—";
              return (
                <p className="notice">
                  风险金额 {amount(size.risk, a.currency)} · 参考仓位{" "}
                  {D(size.quantity).toFixed(8)} · 计划收益/风险 {rr}
                </p>
              );
            } catch {
              return (
                <p className="detail">填写有效价格与止损方向后计算仓位。</p>
              );
            }
          }}
        />
        <section className="panel">
          <Table
            rows={s.plans}
            columns={[
              { key: "asset", label: "标的", value: (r) => r.asset.code },
              { key: "account", label: "账户", value: (r) => r.account.name },
              {
                key: "strategy",
                label: "策略版本",
                value: (r) =>
                  r.strategyVersion
                    ? `${r.strategyVersion.strategy.name} v${r.strategyVersion.version}`
                    : "未关联",
              },
              { key: "dir", label: "方向", value: (r) => r.direction },
              {
                key: "entry",
                label: "入场 / 止损 / 止盈",
                value: (r) => `${r.entry} / ${r.stop} / ${r.target}`,
              },
              {
                key: "qty",
                label: "参考仓位",
                value: (r) => D(r.quantity).toFixed(8),
              },
              {
                key: "risk",
                label: "风险金额",
                value: (r) =>
                  amount(
                    D(r.equity).mul(r.riskPercent).div(100).toFixed(),
                    r.asset.currency,
                  ),
              },
              {
                key: "reason",
                label: "理由 / 失效",
                value: (r) => `${r.reason} / ${r.invalidation}`,
              },
            ]}
          />
        </section>
      </>
    );
  if (path === "/trading/trades")
    return (
      <>
        <Heading
          title="交易日志"
          description="记录真实决策与成交；每次成交同步资产账本，未关联计划标记UNPLANNED。"
        />
        <Form
          title="创建交易记录"
          action="trade.create"
          onDone={refresh}
          transform={(d) => ({
            ...d,
            tags: String(d.tags ?? "")
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean),
          })}
          fields={[
            aField,
            assetField,
            dirField,
            vField,
            {
              name: "planId",
              label: "交易计划（可选）",
              optional: true,
              options: s.plans.map((p) => ({
                value: p.id,
                label: `${p.asset.code} · ${p.entry} / ${p.stop}`,
              })),
            },
            { name: "openedAt", label: "开仓时间", type: "datetime-local" },
            { name: "initialRisk", label: "初始风险金额（固定）", value: "0" },
            { name: "leverage", label: "合约杠杆参数", value: "1" },
            { name: "stop", label: "初始止损", optional: true },
            { name: "target", label: "计划止盈", optional: true },
            { name: "environment", label: "市场环境", optional: true },
            { name: "emotion", label: "情绪记录", optional: true },
            { name: "tags", label: "标签（逗号分隔）", optional: true },
            {
              name: "reason",
              label: "交易理由",
              type: "textarea",
              optional: true,
              wide: true,
            },
          ]}
        />
        <Form
          title="录入实际成交"
          action="fill.create"
          onDone={refresh}
          fields={[
            {
              name: "tradeId",
              label: "交易",
              options: s.trades
                .filter((t) => t.status === "OPEN")
                .map((t) => ({
                  value: t.id,
                  label: `${t.asset.code} / ${t.account.name} / ${when(t.openedAt)}`,
                })),
            },
            {
              name: "action",
              label: "成交动作",
              value: "ENTRY",
              options: [
                { value: "ENTRY", label: "入场 / 加仓" },
                { value: "EXIT", label: "减仓 / 平仓" },
              ],
            },
            { name: "quantity", label: "成交数量" },
            { name: "price", label: "实际成交价" },
            { name: "fee", label: "成交手续费", value: "0" },
            {
              name: "slippage",
              label: "滑点（已含于成交价，仅记录）",
              value: "0",
            },
            atField,
          ]}
        />
        <section className="panel">
          <h2>全部交易</h2>
          <TradeTable onSelect={setDetailId} />
        </section>
        {selectedTrade && <TradeDetail id={selectedTrade.id} />}
      </>
    );
  if (path === "/trading/positions")
    return (
      <>
        <Heading
          title="当前持仓"
          description="观察仓位、止损与资金敞口，所有调整保留事件历史。"
        />
        <section className="panel">
          <Table
            rows={s.trades.filter(
              (t) => t.status === "OPEN" && D(t.quantity).gt(0),
            )}
            columns={[
              {
                key: "asset",
                label: "标的 / 账户",
                value: (r) => `${r.asset.code} / ${r.account.name}`,
              },
              {
                key: "qty",
                label: "数量 / 均价",
                value: (r) => `${r.quantity} / ${D(r.averageEntry).toFixed(6)}`,
              },
              {
                key: "pnl",
                label: "未实现盈亏",
                value: (r) => {
                  const p = s.assets.find((a) => a.id === r.assetId)?.prices[0];
                  return p &&
                    Date.now() - new Date(p.at).getTime() <=
                      Number(
                        s.settings.find((x) => x.key === "priceStaleDays")
                          ?.value ?? 7,
                      ) *
                        86400000
                    ? amount(
                        contractPnl(
                          r.asset.instrument,
                          r.direction,
                          r.quantity,
                          r.averageEntry,
                          p.price,
                          r.asset.multiplier,
                        ).toFixed(),
                        r.asset.currency,
                      )
                    : "估值缺失";
                },
              },
              {
                key: "stop",
                label: "当前止损",
                value: (r) => r.stop ?? "未设置",
              },
              {
                key: "risk",
                label: "止损风险（成本口径）",
                value: (r) =>
                  r.stop
                    ? amount(
                        Decimal.max(
                          0,
                          contractPnl(
                            r.asset.instrument,
                            r.direction,
                            r.quantity,
                            r.averageEntry,
                            r.stop,
                            r.asset.multiplier,
                          ).neg(),
                        ).toFixed(),
                        r.asset.currency,
                      )
                    : "未设置",
              },
              {
                key: "margin",
                label: "保证金占用",
                value: (r) => amount(r.margin, r.asset.currency),
              },
              {
                key: "time",
                label: "开仓时间",
                value: (r) => when(r.openedAt),
              },
              {
                key: "strategy",
                label: "策略",
                value: (r) => r.strategyVersion?.strategy.name ?? "未关联",
              },
            ]}
          />
        </section>
        <Form
          title="记录持仓事件"
          action="position.event"
          onDone={refresh}
          fields={[
            {
              name: "tradeId",
              label: "交易",
              options: s.trades
                .filter((t) => t.status === "OPEN")
                .map((t) => ({
                  value: t.id,
                  label: `${t.asset.code} / ${t.account.name}`,
                })),
            },
            {
              name: "type",
              label: "事件类型",
              value: "MARKET_OBSERVATION",
              options: [
                "STOP_ADJUSTMENT",
                "TARGET_ADJUSTMENT",
                "PLAN_DEVIATION",
                "MARKET_OBSERVATION",
              ].map((v) => ({ value: v, label: v })),
            },
            { name: "value", label: "新止损 / 止盈价格", optional: true },
            { name: "detail", label: "说明", wide: true },
            { name: "at", label: "事件时间", type: "datetime-local" },
          ]}
        />
      </>
    );
  const stats = tradeMetrics(s.trades);
  return (
    <>
      <Heading title="交易总览" description="先看风险与执行，再看交易结果。" />
      <Metrics
        items={[
          {
            label: "当前持仓",
            value: String(
              s.trades.filter((t) => t.status === "OPEN" && D(t.quantity).gt(0))
                .length,
            ),
          },
          { label: "已平仓交易", value: String(stats.count) },
          { label: "胜率", value: pct(stats.winRate) },
          {
            label: "平均R",
            value: stats.averageR ? D(stats.averageR).toFixed(2) : "数据不足",
          },
        ]}
      />
      <section className="panel">
        <h2>最近交易</h2>
        <TradeTable onSelect={setDetailId} />
      </section>
      {selectedTrade && <TradeDetail id={selectedTrade.id} />}
    </>
  );
}
export function TradeTable({ onSelect }: { onSelect?: (id: string) => void }) {
  const { state: s } = useWorkspace();
  return (
    <Table
      rows={s.trades}
      columns={[
        {
          key: "asset",
          label: "标的",
          value: (r) => <strong>{r.asset.code}</strong>,
          sort: (r) => r.asset.code,
        },
        { key: "account", label: "账户", value: (r) => r.account.name },
        {
          key: "strategy",
          label: "策略版本",
          value: (r) =>
            r.strategyVersion
              ? `${r.strategyVersion.strategy.name} v${r.strategyVersion.version}`
              : "未关联",
        },
        { key: "dir", label: "方向", value: (r) => r.direction },
        {
          key: "status",
          label: "状态",
          value: (r) =>
            r.status === "CLOSED"
              ? "已平仓"
              : D(r.quantity).eq(0)
                ? "待成交"
                : "持仓中",
        },
        {
          key: "pnl",
          label: "净已实现盈亏",
          value: (r) => (
            <span className={signedClass(r.realized)}>
              {amount(r.realized, r.asset.currency)}
            </span>
          ),
        },
        {
          key: "r",
          label: "R倍数",
          value: (r) =>
            D(r.initialRisk).gt(0)
              ? D(r.realized).div(r.initialRisk).toFixed(2)
              : "缺少风险",
        },
        {
          key: "tags",
          label: "标签",
          value: (r) => JSON.parse(r.tags).join(", "),
        },
        {
          key: "time",
          label: "开仓时间",
          value: (r) => when(r.openedAt),
          sort: (r) => r.openedAt,
        },
        {
          key: "detail",
          label: "详情",
          value: (r) =>
            onSelect ? (
              <button className="button outline" onClick={() => onSelect(r.id)}>
                查看
              </button>
            ) : (
              "—"
            ),
        },
      ]}
    />
  );
}
export function TradeDetail({ id }: { id: string }) {
  const { state: s } = useWorkspace(),
    t = s.trades.find((t) => t.id === id)!;
  return (
    <section className="panel">
      <h2>{t.asset.code} · 交易详情</h2>
      <p className="detail">
        理由 {t.reason || "未填写"} · 情绪 {t.emotion || "未填写"} · 初始风险{" "}
        {amount(t.initialRisk, t.asset.currency)}
      </p>
      <Table
        rows={t.fills}
        columns={[
          { key: "at", label: "成交时间", value: (r) => when(r.at) },
          { key: "action", label: "动作", value: (r) => r.action },
          { key: "qty", label: "数量", value: (r) => r.quantity },
          {
            key: "price",
            label: "价格",
            value: (r) => amount(r.price, t.asset.currency),
          },
          {
            key: "fee",
            label: "费用",
            value: (r) => amount(r.fee, t.asset.currency),
          },
          { key: "ledger", label: "关联流水", value: (r) => r.transactionId },
        ]}
      />
      <h3>持仓事件</h3>
      <Table
        rows={t.events}
        columns={[
          { key: "at", label: "时间", value: (r) => when(r.at) },
          { key: "type", label: "事件", value: (r) => r.type },
          { key: "detail", label: "内容", value: (r) => r.detail },
        ]}
      />
      <h3>交易截图</h3>
      <Attachments tradeId={id} rows={t.attachments} />
    </section>
  );
}
