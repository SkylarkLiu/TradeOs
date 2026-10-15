"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CircleCheck,
  CircleAlert,
} from "lucide-react";
import { Button } from "./ui/button";
import { Form, type Field } from "./form";
import { Table } from "./table";
import { Chart } from "./charts";
import { useWorkspace, Action } from "./workspace";
import { amount, when, pct, day, signedClass } from "@/lib/utils";
import { D, sum } from "@/lib/calculations/decimal";
import { Importer } from "./importer";
import { AnalysisView } from "./analysis-view";
import { MarketData } from "./market-data";
import { HoldingQuoteUpdate } from "./holding-quote-update";
export function Heading({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <h1>{title}</h1>
      {children}
    </div>
  );
}
export function Metrics({
  items,
  className = "",
}: {
  className?: string;
  items: {
    label: string;
    value: string;
    note?: string;
    href?: string;
    signed?: string | null;
  }[];
}) {
  return (
    <div
      className={`${items.length === 6 ? "metrics secondary" : "metrics"} ${className}`}
    >
      {items.map((i) => (
        <div className="metric" key={i.label}>
          {i.note ? (
            <details className="metric-definition">
              <summary className="metric-label" aria-label={`${i.label}说明`}>
                {i.label} <CircleHelp size={13} aria-hidden="true" />
              </summary>
              <p className="metric-note">{i.note}</p>
            </details>
          ) : (
            <div className="metric-label">{i.label}</div>
          )}
          <div className={`metric-value ${signedClass(i.signed)}`}>
            {i.href ? (
              <Link href={i.href} aria-label={`${i.label}，查看明细`}>
                {i.value}
                <ChevronRight
                  className="metric-detail-icon"
                  size={14}
                  aria-hidden="true"
                />
              </Link>
            ) : (
              i.value
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
export function WealthView({
  path,
  filters = {},
}: {
  path: string;
  filters?: { accountId?: string; assetId?: string };
}) {
  const { state: s, refresh, report } = useWorkspace(),
    p = s.portfolio;
  const [range, setRange] = useState("all");
  const cutoff = new Date();
  if (range === "quarter") cutoff.setMonth(cutoff.getMonth() - 3);
  else if (range === "year") cutoff.setFullYear(cutoff.getFullYear() - 1);
  const snapshots = s.snapshots.filter(
    (v) => range === "all" || new Date(v.at) >= cutoff,
  );
  const assetLabels: Record<string, string> = {
    CASH: "现金",
    STOCK: "股票",
    ETF: "ETF",
    MUTUAL_FUND: "公募基金",
    CRYPTO: "加密资产",
    BOND: "债券",
    GOLD: "黄金",
    REAL_ESTATE: "房产",
    OTHER: "其他",
    IN_TRANSIT: "在途资产",
    DERIVATIVE_PNL: "合约浮动盈亏",
  };
  const allocation = p.allocation
    .filter((a) => D(a.value).gt(0))
    .map((a) => ({ ...a, name: assetLabels[a.name] ?? a.name }));
  const missing = p.rows.filter((r) => r.status === "MISSING").length,
    stale = p.rows.filter((r) => r.status === "STALE").length;
  const selectedAsset = s.assets.find((a) => a.id === filters.assetId);
  const filteredTransactions = s.transactions.filter(
    (t) =>
      (!filters.accountId || t.accountId === filters.accountId) &&
      (!filters.assetId ||
        t.assetId === filters.assetId ||
        (selectedAsset?.assetClass === "CASH" &&
          t.currency === selectedAsset.currency &&
          !D(t.cashDelta).eq(0))),
  );
  const accounts = s.accounts
      .filter((a) => !a.archived)
      .map((a) => ({ value: a.id, label: `${a.platform.name} / ${a.name}` })),
    assets = s.assets.map((a) => ({
      value: a.id,
      label: `${a.code} · ${a.name}`,
    }));
  const aField: Field = { name: "accountId", label: "账户", options: accounts },
    assetField: Field = { name: "assetId", label: "资产", options: assets },
    atField: Field = { name: "at", label: "发生时间", type: "datetime-local" };
  if (path === "/wealth/platforms" || path === "/wealth/accounts")
    return (
      <>
        <Heading title="平台与账户" />
        <div className="equal-col">
          <Form
            title="创建平台"
            action="platform.create"
            onDone={refresh}
            fields={[
              { name: "name", label: "平台名称" },
              {
                name: "template",
                label: "平台模板",
                value: "Other",
                options: [
                  "Binance",
                  "OKX",
                  "IBKR",
                  "Futu",
                  "Alipay",
                  "Bank",
                  "Other",
                ].map((v) => ({ value: v, label: v })),
              },
            ]}
          />
          <Form
            title="创建账户"
            action="account.create"
            onDone={refresh}
            fields={[
              {
                name: "platformId",
                label: "所属平台",
                options: s.platforms.map((p) => ({
                  value: p.id,
                  label: p.name,
                })),
              },
              { name: "name", label: "账户名称" },
              { name: "currency", label: "默认币种", value: "CNY" },
            ]}
          />
        </div>
        <section className="panel">
          <h2>全部账户</h2>
          <Table
            rows={s.accounts}
            columns={[
              {
                key: "name",
                label: "账户",
                value: (r) => r.name,
                sort: (r) => r.name,
              },
              { key: "platform", label: "平台", value: (r) => r.platform.name },
              { key: "currency", label: "默认币种", value: (r) => r.currency },
              {
                key: "id",
                label: "导入用ID",
                value: (r) => <span className="mono">{r.id}</span>,
              },
              {
                key: "status",
                label: "状态",
                value: (r) => (r.archived ? "已归档" : "活跃"),
              },
              {
                key: "action",
                label: "操作",
                value: (r) => (
                  <Action
                    action="account.archive"
                    input={{ id: r.id, archived: !r.archived }}
                    label={r.archived ? "恢复" : "归档"}
                  />
                ),
              },
            ]}
            empty="先创建平台，再添加账户"
          />
        </section>
        <section className="panel">
          <h2>平台</h2>
          <Table
            rows={s.platforms}
            columns={[
              { key: "name", label: "名称", value: (r) => r.name },
              { key: "template", label: "模板", value: (r) => r.template },
            ]}
          />
        </section>
      </>
    );
  if (path === "/wealth/assets")
    return (
      <>
        <Heading title="资产明细" />
        <MarketData />
        <Form
          title="登记资产"
          action="asset.create"
          onDone={refresh}
          transform={(d) => ({
            ...d,
            investable: d.assetClass !== "REAL_ESTATE",
          })}
          fields={[
            {
              name: "code",
              label: "唯一代码",
              help: "建议带市场，如NASDAQ:AAPL；现金自动使用CASH:币种",
            },
            { name: "name", label: "资产名称" },
            {
              name: "assetClass",
              label: "资产类别",
              value: "STOCK",
              options: [
                "CASH",
                "STOCK",
                "ETF",
                "MUTUAL_FUND",
                "CRYPTO",
                "BOND",
                "GOLD",
                "REAL_ESTATE",
                "OTHER",
              ].map((v) => ({ value: v, label: v })),
            },
            { name: "currency", label: "计价/结算币种", value: "CNY" },
            {
              name: "instrument",
              label: "品种规则",
              value: "SPOT",
              options: [
                { value: "SPOT", label: "现货" },
                { value: "LINEAR", label: "线性合约" },
                { value: "INVERSE", label: "反向合约" },
              ],
            },
            { name: "multiplier", label: "合约乘数", value: "1" },
          ]}
        />
        <div className="equal-col">
          <Form
            title="更新资产价格"
            id="asset-price"
            retain={["assetId"]}
            action="price.create"
            onDone={refresh}
            fields={[
              { ...assetField, value: selectedAsset?.id },
              { name: "price", label: "最新价格" },
              atField,
              { name: "source", label: "价格来源", value: "MANUAL" },
            ]}
          />
          <Form
            title="更新汇率"
            retain={["from", "to"]}
            action="fx.create"
            onDone={refresh}
            fields={[
              { name: "from", label: "原币种", value: "USD" },
              { name: "to", label: "目标币种", value: "CNY" },
              { name: "rate", label: "1单位原币种兑换数量" },
              atField,
              { name: "source", label: "来源", value: "MANUAL" },
            ]}
          />
        </div>
        <section className="panel" id="holdings">
          <div className="section-heading">
            <h2>持仓明细</h2>
            <HoldingQuoteUpdate />
          </div>
          <BalanceTable />
        </section>
        <section className="panel">
          <h2>跨账户合并持仓</h2>
          <CombinedAssets />
        </section>
        <section className="panel">
          <h2>资产目录</h2>
          <Table
            rows={s.assets}
            columns={[
              {
                key: "code",
                label: "代码",
                value: (r) => r.code,
                sort: (r) => r.code,
              },
              { key: "name", label: "名称", value: (r) => r.name },
              {
                key: "class",
                label: "类别 / 品种",
                value: (r) => `${r.assetClass} / ${r.instrument}`,
              },
              { key: "currency", label: "币种", value: (r) => r.currency },
              {
                key: "price",
                label: "最新价格",
                value: (r) =>
                  r.prices[0]
                    ? `${r.currency} ${r.prices[0].price}`
                    : "数据不足",
              },
              {
                key: "priceAt",
                label: "来源 / 时间",
                value: (r) =>
                  r.prices[0] ? (
                    <>
                      {r.prices[0].source}
                      <div className="detail">{when(r.prices[0].at)}</div>
                    </>
                  ) : (
                    "—"
                  ),
              },
              {
                key: "id",
                label: "导入用ID",
                value: (r) => <span className="mono">{r.id}</span>,
              },
              {
                key: "investable",
                label: "纳入FIRE",
                value: (r) => (
                  <Action
                    action="asset.configure"
                    input={{ id: r.id, investable: !r.investable }}
                    label={r.investable ? "已纳入 · 排除" : "已排除 · 纳入"}
                  />
                ),
              },
            ]}
          />
        </section>
      </>
    );
  if (path === "/wealth/transactions")
    return (
      <>
        <Heading title="资金流水">
          <Link className="button outline" href="/wealth/assets#market-data">
            添加资产
          </Link>
        </Heading>
        {!s.assets.length && (
          <p className="notice">资产目录为空，请先添加资产。</p>
        )}
        <Form
          title="录入流水 / 期初余额"
          retain={["accountId", "assetId"]}
          action="transaction.create"
          onDone={refresh}
          fields={[
            {
              ...aField,
              value:
                filters.accountId ??
                (accounts.length === 1 ? accounts[0].value : undefined),
            },
            { ...assetField, value: filters.assetId },
            {
              name: "type",
              label: "流水类型",
              value: "DEPOSIT",
              options: [
                ["DEPOSIT", "外部存入 / 期初"],
                ["WITHDRAWAL", "外部取出"],
                ["BUY", "买入"],
                ["SELL", "卖出"],
                ["DIVIDEND", "分红"],
                ["INTEREST", "利息"],
                ["FEE", "费用"],
                ["ADJUSTMENT", "人工调整"],
              ].map(([value, label]) => ({ value, label })),
            },
            {
              name: "quantity",
              label: "数量",
              help: "现金为金额；调整可填负数",
            },
            { name: "price", label: "价格 / 流入估值", value: "1" },
            { name: "fee", label: "手续费（计价币种）", value: "0" },
            atField,
            {
              name: "purpose",
              label: "投资目的",
              value: "LONG_TERM",
              options: ["LONG_TERM", "TRADING", "CASH_RESERVE", "OTHER"].map(
                (v) => ({ value: v, label: v }),
              ),
            },
            { name: "note", label: "说明", optional: true, wide: true },
          ]}
        />
        <section className="panel">
          <h2>流水记录</h2>
          {(filters.accountId || filters.assetId) && (
            <p className="notice">
              当前筛选：
              {s.accounts.find((a) => a.id === filters.accountId)?.name ??
                "全部账户"}{" "}
              / {selectedAsset?.code ?? "全部资产"}{" "}
              <Link className="button outline" href="/wealth/transactions">
                清除筛选
              </Link>
            </p>
          )}
          <Table
            rows={filteredTransactions}
            columns={[
              {
                key: "at",
                label: "时间",
                value: (r) => when(r.at),
                sort: (r) => r.at,
              },
              { key: "account", label: "账户", value: (r) => r.account.name },
              { key: "asset", label: "资产", value: (r) => r.asset.code },
              {
                key: "type",
                label: "类型",
                value: (r) => <span className="badge">{r.type}</span>,
              },
              {
                key: "qty",
                label: "数量变化",
                value: (r) => <span className="mono">{r.quantity}</span>,
              },
              {
                key: "price",
                label: "价格",
                value: (r) =>
                  r.price == null ? "数据不足" : `${r.currency} ${r.price}`,
              },
              {
                key: "fee",
                label: "费用",
                value: (r) => amount(r.fee, r.currency),
              },
              {
                key: "cashDelta",
                label: "现金变化",
                value: (r) => amount(r.cashDelta, r.currency),
              },
              {
                key: "fill",
                label: "关联成交",
                value: (r) => r.fill?.tradeId ?? "—",
              },
              { key: "note", label: "说明", value: (r) => r.note },
            ]}
          />
        </section>
        <Form
          title="冲销最后一笔独立流水"
          action="transaction.reverse"
          onDone={refresh}
          fields={[
            {
              name: "id",
              label: "流水",
              options: s.transactions
                .filter((t) => !t.fill && !t.transferId && !t.reversalOf)
                .map((t) => ({
                  value: t.id,
                  label: `${t.account.name} / ${t.type} / ${when(t.at)}`,
                })),
            },
            atField,
            { name: "note", label: "冲销原因" },
          ]}
        />
        <Importer refresh={refresh} />
      </>
    );
  if (path === "/wealth/transfers")
    return (
      <>
        <Heading title="内部转账" />
        <Form
          title="记录转出"
          action="transfer.create"
          onDone={refresh}
          fields={[
            { ...aField, name: "fromId", label: "转出账户" },
            { ...aField, name: "toId", label: "转入账户" },
            assetField,
            { name: "quantity", label: "到账数量" },
            { name: "fee", label: "手续费（资产计价币种）", value: "0" },
            atField,
          ]}
        />
        <section className="panel">
          <h2>转账记录</h2>
          <Table
            rows={s.transfers}
            columns={[
              { key: "at", label: "转出时间", value: (r) => when(r.at) },
              { key: "from", label: "转出", value: (r) => r.fromAccount.name },
              { key: "to", label: "转入", value: (r) => r.toAccount.name },
              {
                key: "asset",
                label: "资产",
                value: (r) => s.assets.find((a) => a.id === r.assetId)?.code,
              },
              { key: "qty", label: "数量", value: (r) => r.quantity },
              { key: "fee", label: "费用", value: (r) => r.fee },
              {
                key: "status",
                label: "状态",
                value: (r) => (r.status === "IN_TRANSIT" ? "在途" : "已到账"),
              },
              {
                key: "action",
                label: "确认",
                value: (r) =>
                  r.status === "IN_TRANSIT" ? (
                    <Action
                      action="transfer.complete"
                      input={{ id: r.id, at: new Date().toISOString() }}
                      label="确认到账"
                    />
                  ) : (
                    when(r.completedAt!)
                  ),
              },
            ]}
          />
        </section>
      </>
    );
  if (path === "/wealth/allocation")
    return (
      <>
        <Heading title="资产配置" />
        <div className="equal-col">
          {[
            ["资产类别", p.allocation],
            ["平台分布", group(p.rows, "platform")],
            ["币种分布", group(p.rows, "currency")],
          ].map(([title, data]) => (
            <section className="panel" key={title as string}>
              <h2>{title as string}</h2>
              {(data as { name: string; value: string }[]).length ? (
                <Chart
                  pie={(data as { name: string; value: string }[]).filter((r) =>
                    D(r.value).gt(0),
                  )}
                />
              ) : (
                <div className="empty">暂无可估值资产</div>
              )}
            </section>
          ))}
        </div>
        <section className="panel">
          <h2>配置历史</h2>
          <Table
            rows={s.snapshots.flatMap((v) =>
              v.allocations.map((a) => ({ ...a, at: v.at })),
            )}
            columns={[
              { key: "at", label: "时间", value: (r) => when(r.at) },
              { key: "class", label: "类别", value: (r) => r.assetClass },
              {
                key: "value",
                label: "市值",
                value: (r) => amount(r.value, report),
              },
            ]}
          />
        </section>
      </>
    );
  if (path === "/wealth/history")
    return (
      <>
        <Heading title="历史表现">
          <Action
            action="snapshot.create"
            input={{ currency: report }}
            label="保存当前快照"
          />
        </Heading>
        <Form
          title="保存指定时间快照"
          action="snapshot.create"
          onDone={refresh}
          transform={(d) => ({ ...d, currency: report })}
          submit="保存历史快照"
          fields={[
            {
              ...atField,
              help: "按该时点账本、报价和负债记录重建；零点快照可用于今日、月初及年初指标。",
            },
          ]}
        />
        <section className="panel">
          <h2>资产与净资产</h2>
          <p className="detail">
            {report} · 按已保存时点展示；未完整估值的时点留空。
          </p>
          <Chart
            title="资产与净资产"
            unit={report}
            labels={s.snapshots.map((v) => when(v.at))}
            series={[
              {
                name: "总资产",
                values: s.snapshots.map((v) => (v.complete ? v.assets : null)),
              },
              {
                name: "净资产",
                values: s.snapshots.map((v) => (v.complete ? v.net : null)),
              },
            ]}
          />
        </section>
        <section className="panel">
          <Table
            rows={s.snapshots}
            columns={[
              {
                key: "at",
                label: "估值时间",
                value: (r) => when(r.at),
                sort: (r) => r.at,
              },
              {
                key: "assets",
                label: "总资产",
                value: (r) => amount(r.assets, report),
              },
              {
                key: "debt",
                label: "负债",
                value: (r) => amount(r.liabilities, report),
              },
              {
                key: "net",
                label: "净资产",
                value: (r) => amount(r.net, report),
              },
              {
                key: "valid",
                label: "估值完整",
                value: (r) => (r.complete ? "是" : "否"),
              },
            ]}
          />
        </section>
        <AnalysisView wealth />
        <Form
          title="录入平台实际账户估值"
          action="valuation.create"
          onDone={refresh}
          fields={[
            aField,
            { name: "value", label: "实际估值" },
            { name: "currency", label: "币种", value: report },
            atField,
            { name: "source", label: "来源", value: "MANUAL" },
          ]}
        />
      </>
    );
  if (path === "/settings")
    return (
      <>
        <Heading title="设置与数据管理" />
        <Importer refresh={refresh} />
        <section className="panel">
          <h2>审计记录</h2>
          <Table
            rows={s.audits}
            columns={[
              { key: "at", label: "时间", value: (r) => when(r.at) },
              { key: "action", label: "操作", value: (r) => r.action },
              { key: "entity", label: "记录", value: (r) => r.entityId },
              { key: "detail", label: "内容", value: (r) => r.detail },
            ]}
          />
        </section>
      </>
    );
  return (
    <>
      <Heading title="总资产">
        <div className="actions">
          <Link href="/wealth/transactions" className="button primary">
            录入资金 <ArrowRight size={15} aria-hidden="true" />
          </Link>
          <Action
            action="snapshot.create"
            input={{ currency: report }}
            label="保存估值快照"
          />
        </div>
      </Heading>
      <div
        className={`valuation-strip ${p.complete ? "valuation-complete" : "valuation-incomplete"}`}
      >
        {p.complete ? (
          <CircleCheck size={17} aria-hidden="true" />
        ) : (
          <CircleAlert size={17} aria-hidden="true" />
        )}
        <div>
          <strong>{p.complete ? "当前估值完整" : "当前估值不完整"}</strong>
          <span>
            {p.complete
              ? `${p.rows.length} 项持仓${p.inTransit ? ` · ${p.inTransit} 笔在途` : ""}`
              : missing || stale
                ? `账户持仓中 ${missing} 项缺失、${stale} 项价格过期；金额为已知估值。`
                : "请核对负债、在途及合约的价格与汇率；已知估值不能代表完整净资产。"}
          </span>
        </div>
        {!p.complete && (
          <Link href="/wealth/assets" className="text-action">
            补齐价格与汇率 <ArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
        {p.complete && (
          <Link href="/wealth/reconciliation" className="text-action">
            核对账本 <ArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
      </div>
      <Metrics
        className="wealth-metrics"
        items={[
          {
            label: p.complete ? "净资产" : "已知净资产估值",
            href: "/wealth/assets",
            value: amount(p.net, report),
            note: "总资产 − 总负债",
          },
          {
            label: p.complete ? "总资产" : "已知资产估值",
            href: "/wealth/assets",
            value: amount(p.assets, report),
            note: p.inTransit ? `含 ${p.inTransit} 笔在途转账` : undefined,
          },
          {
            label: p.complete ? "总负债" : "已知负债估值",
            value: amount(p.liabilities, report),
            href: "#liabilities",
          },
          {
            label: p.complete ? "可投资净资产" : "已知可投资净资产",
            href: "/wealth/assets",
            value: amount(p.investable, report),
            note: "按资产与负债配置筛选",
          },
        ]}
      />
      <div className="section-heading">
        <h2>收益与资金变化</h2>
        <Link href="/wealth/history" className="text-action">
          查看历史报表 <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
      <Metrics
        className="performance-metrics"
        items={[
          {
            label: "今日资产变化",
            href: "/wealth/transactions",
            signed: s.summary.todayChange,
            value: amount(s.summary.todayChange, report),
            note: "包含资金进出；需完整估值及今日零点快照",
          },
          {
            label: "本月投资损益",
            href: "/wealth/history",
            signed: s.summary.monthlyPnl,
            value: amount(s.summary.monthlyPnl, report),
            note: "扣除外部本金变化；需完整估值及月初快照",
          },
          {
            label: "年初至今TWR",
            href: "/wealth/history",
            value: pct(s.summary.ytd),
            note: "剔除外部资金进出影响；需完整估值边界",
          },
        ]}
      />
      <details className="risk-details">
        <summary>
          <span>风险与目标</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <Metrics
          className="performance-metrics"
          items={[
            {
              label: "历史净资产峰值",
              href: "/wealth/history",
              value: amount(s.summary.peak, report),
            },
            {
              label: "当前资产回撤",
              href: "/wealth/history",
              value: pct(s.summary.currentDrawdown),
              note: "相对已记录的净资产峰值",
            },
            {
              label: "财务自由进度",
              href: "/fire",
              value: pct(s.summary.fireProgress),
              note: "可投资净资产 / 当前财务自由目标",
            },
          ]}
        />
      </details>
      <div className="two-col">
        <section className="panel" id="wealth-trend">
          <div className="section-heading">
            <div>
              <h2>财富轨迹</h2>
              <p className="detail">{snapshots.length} 个快照</p>
            </div>
            <div
              className="segmented"
              role="group"
              aria-label="财富轨迹时间范围"
            >
              {[
                ["quarter", "近三月"],
                ["year", "近一年"],
                ["all", "全部"],
              ].map(([key, label]) => (
                <Button
                  key={key}
                  variant="ghost"
                  aria-pressed={range === key}
                  onClick={() => setRange(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          {snapshots.length ? (
            <>
              <Chart
                title="财富轨迹"
                unit={report}
                labels={snapshots.map((v) => when(v.at))}
                series={[
                  {
                    name: "总资产",
                    values: snapshots.map((v) =>
                      v.complete ? v.assets : null,
                    ),
                  },
                  {
                    name: "净资产",
                    values: snapshots.map((v) => (v.complete ? v.net : null)),
                  },
                ]}
              />
              <p className="chart-caption">
                {day(snapshots[0].at)} 至 {day(snapshots.at(-1)!.at)}
                {snapshots.some((v) => !v.complete) && " · 不完整估值已留空"}
              </p>
            </>
          ) : (
            <div className="empty">
              <strong>
                {s.snapshots.length
                  ? "所选范围还没有快照"
                  : p.rows.length
                    ? "已有持仓，尚未保存快照"
                    : "从第一笔资产开始"}
              </strong>
              {s.snapshots.length
                ? "可查看全部快照。"
                : p.rows.length
                  ? "保存当前估值，开始记录财富轨迹。"
                  : "录入资产后保存快照。"}
              <div className="form-actions empty-actions">
                {s.snapshots.length ? (
                  <Button variant="outline" onClick={() => setRange("all")}>
                    查看全部快照
                  </Button>
                ) : p.rows.length ? (
                  <Action
                    action="snapshot.create"
                    input={{ currency: report }}
                    label="保存当前快照"
                  />
                ) : (
                  <>
                    <Link href="/wealth/platforms" className="button primary">
                      创建平台与账户
                    </Link>
                    <Link
                      href="/wealth/transactions"
                      className="button outline"
                    >
                      录入期初余额
                    </Link>
                  </>
                )}
              </div>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>资产分布</h2>
              {!p.complete && <p className="detail">已知估值</p>}
            </div>
            <Link className="text-action" href="/wealth/allocation">
              配置明细 <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
          {allocation.length ? (
            <Chart title="资产分布图" unit={report} pie={allocation} />
          ) : (
            <div className="empty">暂无可估值的正值资产</div>
          )}
          <details className="calculation-notes">
            <summary>统计口径</summary>
            <p>仅展示正值资产分类，负债单独统计。</p>
          </details>
        </section>
      </div>
      <AccountHoldings />
      <section className="panel" id="liabilities">
        <div className="section-heading">
          <h2>负债明细</h2>
          <span className="badge">{s.liabilities.length} 项负债</span>
        </div>
        <Table
          rows={s.liabilities}
          columns={[
            { key: "name", label: "名称", value: (r) => r.name },
            {
              key: "amount",
              label: "余额",
              value: (r) => amount(r.amount, r.currency),
            },
            {
              key: "investable",
              label: "从投资净资产扣除",
              value: (r) => (r.investable ? "是" : "否"),
            },
          ]}
          empty="尚未登记负债"
        />
        <details className="disclosure-form">
          <summary>
            登记或更新负债 <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <p className="detail">
            登记负债只更新欠款余额；实际借款和还款需另记资金流水。
          </p>
          <div className="equal-col">
            <Form
              title="登记负债"
              action="liability.create"
              onDone={refresh}
              fields={[
                { name: "name", label: "负债名称" },
                { name: "amount", label: "余额" },
                { name: "currency", label: "币种", value: "CNY" },
                {
                  name: "investable",
                  label: "从可投资净资产扣除",
                  type: "checkbox",
                  value: "true",
                },
              ]}
            />
            <Form
              title="更新负债余额"
              action="liability.update"
              onDone={refresh}
              fields={[
                {
                  name: "id",
                  label: "负债",
                  options: s.liabilities.map((l) => ({
                    value: l.id,
                    label: l.name,
                  })),
                },
                { name: "amount", label: "最新余额" },
              ]}
            />
          </div>
        </details>
      </section>
    </>
  );
}
function group(
  rows: ReturnType<typeof useWorkspace>["state"]["portfolio"]["rows"],
  key: "platform" | "currency",
) {
  const names = [...new Set(rows.map((r) => r[key]))];
  return names.map((name) => ({
    name,
    value: sum(
      rows.filter((r) => r[key] === name).map((r) => r.value ?? "0"),
    ).toFixed(),
  }));
}
function AccountHoldings() {
  const { state, report } = useWorkspace();
  const [accountId, setAccountId] = useState<string | null>(null);
  const accounts = state.accounts.filter(
    (a) =>
      !a.archived || state.portfolio.rows.some((r) => r.accountId === a.id),
  );
  const selected = accounts.find((a) => a.id === accountId);
  const rows = state.portfolio.rows.filter((r) => r.accountId === selected?.id);
  return (
    <section className="panel" id="account-holdings">
      <div className="section-heading">
        <h2>账户资产</h2>
        <Link className="text-action" href="/wealth/assets">
          管理资产 <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
      <div className="account-selector" role="group" aria-label="选择持仓账户">
        {accounts.map((a) => {
          const holdings = state.portfolio.rows.filter(
            (r) => r.accountId === a.id,
          );
          const complete = holdings.every((r) => r.status === "VALID");
          const value = sum(holdings.map((r) => r.value ?? "0")).toFixed();
          const pnl = holdings.some((r) => r.unrealized === null)
            ? null
            : sum(holdings.map((r) => r.unrealized!)).toFixed();
          return (
            <button
              type="button"
              className="account-choice"
              key={a.id}
              aria-label={`${a.platform.name} / ${a.name}`}
              aria-pressed={selected?.id === a.id}
              aria-controls="selected-account-holdings"
              onClick={() => setAccountId(a.id)}
            >
              <span className="account-choice-name">
                {a.platform.name} / {a.name}
              </span>
              <strong>{amount(value, report)}</strong>
              <span className="detail">
                {holdings.length} 项持仓{!complete && " · 已知估值"}
              </span>
              <span className={signedClass(pnl)}>
                持仓盈亏 {amount(pnl, report)}
              </span>
            </button>
          );
        })}
      </div>
      {selected ? (
        <div
          id="selected-account-holdings"
          role="region"
          aria-label={`${selected.name}持仓`}
        >
          <div className="section-heading account-holdings-heading">
            <h3>{selected.name}</h3>
            {rows.some((r) => ["STOCK", "ETF"].includes(r.assetClass)) ? (
              <HoldingQuoteUpdate
                key={selected.id}
                assetIds={rows.map((r) => r.assetId)}
              />
            ) : rows.some((r) => r.assetClass === "MUTUAL_FUND") ? (
              <Link
                className="button outline"
                href="/wealth/assets#asset-price"
              >
                录入基金净值
              </Link>
            ) : null}
          </div>
          <BalanceTable key={selected.id} accountId={selected.id} />
        </div>
      ) : (
        <div className="empty">选择账户查看持仓及盈亏</div>
      )}
    </section>
  );
}
export function BalanceTable({ accountId }: { accountId?: string } = {}) {
  const { state, report } = useWorkspace();
  const openingNote = (row: (typeof state.portfolio.rows)[number]) =>
    state.transactions.find(
      (t) =>
        t.accountId === row.accountId &&
        t.assetId === row.assetId &&
        t.note.startsWith("截图期初录入"),
    )?.note;
  return (
    <Table
      rows={state.portfolio.rows.filter(
        (r) => !accountId || r.accountId === accountId,
      )}
      scrollHint="左右滑动查看市值、盈亏及估值状态"
      columns={[
        {
          key: "name",
          label: "资产",
          value: (r) => (
            <>
              <Link
                href={`/wealth/transactions?accountId=${encodeURIComponent(r.accountId)}&assetId=${encodeURIComponent(r.assetId)}`}
              >
                <strong>{r.name}</strong>
                <div className="detail">
                  {r.code} · <span className="asset-detail-link">查看流水</span>
                </div>
              </Link>
              {openingNote(r) && (
                <details className="calculation-notes">
                  <summary>录入依据</summary>
                  <p>{openingNote(r)}</p>
                </details>
              )}
            </>
          ),
          sort: (r) => r.name,
        },
        {
          key: "account",
          label: "平台 / 账户",
          value: (r) => `${r.platform} / ${r.account}`,
        },
        {
          key: "qty",
          label: "数量",
          value: (r) =>
            r.code.startsWith("MANUAL:") ? (
              "按金额估值"
            ) : (
              <>
                <span className="mono" title={r.quantity}>
                  {openingNote(r)?.includes("份额为推算值")
                    ? `≈ ${D(r.quantity).toFixed(4)}`
                    : r.quantity}
                </span>
                {openingNote(r)?.includes("份额为推算值") && (
                  <div className="detail">推算份额</div>
                )}
              </>
            ),
          sort: (r) => r.quantity,
        },
        {
          key: "cost",
          label: "总成本",
          value: (r) => amount(r.cost, r.currency),
          sort: (r) => r.cost,
        },
        {
          key: "price",
          label: "价格",
          value: (r) =>
            r.price == null ? "数据不足" : `${r.currency} ${r.price}`,
        },
        {
          key: "value",
          label: "市值",
          value: (r) => <span className="mono">{amount(r.value, report)}</span>,
          sort: (r) => r.value ?? "",
        },
        {
          key: "pnl",
          label: "未实现盈亏",
          sort: (r) => r.unrealized ?? "",
          value: (r) => (
            <span className={signedClass(r.unrealized)}>
              {amount(r.unrealized, report)}
            </span>
          ),
        },
        {
          key: "return",
          label: "持仓收益率",
          value: (r) => {
            const cost =
              r.value !== null && r.unrealized !== null
                ? D(r.value).minus(r.unrealized)
                : null;
            return (
              <span className={signedClass(r.unrealized)}>
                {pct(cost?.gt(0) ? D(r.unrealized!).div(cost).toFixed() : null)}
              </span>
            );
          },
        },
        {
          key: "status",
          label: "估值状态",
          value: (r) => (
            <span
              className={`badge valuation-status ${r.status === "VALID" ? "is-valid" : "is-incomplete"}`}
            >
              {r.status === "VALID"
                ? "有效"
                : r.status === "STALE"
                  ? "过期"
                  : "缺失"}
            </span>
          ),
        },
        {
          key: "time",
          label: "估值来源 / 时间",
          value: (r) => (
            <>
              {r.source === "PUBLIC_NAV_REFERENCE"
                ? "公开参考净值"
                : r.source === "SCREENSHOT_AMOUNT"
                  ? "截图估值"
                  : r.source}
              <div className="detail">
                {r.priceAt ? when(r.priceAt) : "现金单位价值"}
              </div>
            </>
          ),
        },
        {
          key: "refresh",
          label: "行情",
          value: (r) =>
            ["STOCK", "ETF"].includes(r.assetClass) &&
            state.assets.find((a) => a.id === r.assetId)?.instrument ===
              "SPOT" ? (
              <HoldingQuoteUpdate
                assetIds={[r.assetId]}
                label="更新"
                name={r.name}
              />
            ) : r.assetClass === "MUTUAL_FUND" ? (
              <Link
                className="button outline"
                href={`/wealth/assets?assetId=${encodeURIComponent(r.assetId)}#asset-price`}
                aria-label={`录入${r.name}净值`}
              >
                录入净值
              </Link>
            ) : (
              "—"
            ),
        },
      ]}
      empty="还没有持仓，请先录入期初余额"
    />
  );
}

function CombinedAssets() {
  const { state, report } = useWorkspace(),
    rows = [...new Set(state.portfolio.rows.map((r) => r.assetId))].map(
      (id) => {
        const list = state.portfolio.rows.filter((r) => r.assetId === id);
        return {
          name: list[0].name,
          code: list[0].code,
          currency: list[0].currency,
          accounts: list.length,
          quantity: sum(list.map((r) => r.quantity)).toFixed(),
          cost: sum(list.map((r) => r.cost)).toFixed(),
          realized: sum(list.map((r) => r.realized)).toFixed(),
          value: list.every((r) => r.status === "VALID")
            ? sum(list.map((r) => r.value!)).toFixed()
            : null,
        };
      },
    );
  return (
    <Table
      rows={rows}
      columns={[
        {
          key: "code",
          label: "资产",
          value: (r) => `${r.code} / ${r.name}`,
          sort: (r) => r.code,
        },
        { key: "accounts", label: "账户数", value: (r) => r.accounts },
        { key: "quantity", label: "合计数量", value: (r) => r.quantity },
        {
          key: "cost",
          label: "合计成本",
          value: (r) => amount(r.cost, r.currency),
        },
        {
          key: "value",
          label: "合计市值",
          value: (r) => amount(r.value, report),
        },
        {
          key: "realized",
          label: "已实现收益",
          value: (r) => amount(r.realized, r.currency),
        },
      ]}
    />
  );
}
