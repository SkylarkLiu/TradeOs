"use client";
import { TickFlowSettings } from "./tickflow-settings";
import { useState } from "react";
import { useWorkspace } from "./workspace";
import { Form, mutate } from "./form";
import { Button } from "./ui/button";
import { Heading } from "./wealth-view";
import { Table } from "./table";
import { amount, when } from "@/lib/utils";
import { Importer } from "./importer";
type Check = {
  system: string;
  actual: string;
  difference: string | null;
  complete: boolean;
  note: string;
  ledger: {
    accountId: string;
    assetId: string;
    recorded: string;
    expected: string;
    status: string;
  }[];
};
export function ReconciliationView() {
  const { state: s, refresh } = useWorkspace(),
    [result, setResult] = useState<Check | null>(null),
    [error, setError] = useState("");
  return (
    <>
      <Heading title="数据对账" />
      <Form
        title="录入实际账户估值"
        action="reconcile.check"
        onDone={refresh}
        fields={[
          {
            name: "accountId",
            label: "账户",
            options: s.accounts.map((a) => ({
              value: a.id,
              label: `${a.platform.name} / ${a.name}`,
            })),
          },
          { name: "value", label: "平台实际估值" },
          { name: "currency", label: "估值币种", value: "CNY" },
          { name: "at", label: "对账时间", type: "datetime-local" },
        ]}
      />
      <section className="panel">
        <h2>与最近实际估值核对</h2>
        <div className="actions">
          {s.valuations.slice(0, 10).map((v) => (
            <Button
              variant="outline"
              key={v.id}
              onClick={async () => {
                try {
                  setResult(
                    await mutate("reconcile.check", {
                      accountId: v.accountId,
                      value: v.value,
                      currency: v.currency,
                      at: v.at,
                    }),
                  );
                  setError("");
                  refresh();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {s.accounts.find((a) => a.id === v.accountId)?.name} ·{" "}
              {amount(v.value, v.currency)}
            </Button>
          ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <>
            <p className="notice">
              系统估值 {result.system} · 实际 {result.actual} · 差额{" "}
              {result.difference ?? "不可直接比较"}
              <br />
              {result.note}
            </p>
            <LedgerTable rows={result.ledger} />
          </>
        )}
      </section>
      <LedgerChecker />
    </>
  );
}
function LedgerTable({ rows }: { rows: Check["ledger"] }) {
  const { state: s } = useWorkspace();
  return (
    <Table
      rows={rows}
      columns={[
        {
          key: "account",
          label: "账户",
          value: (r) =>
            s.accounts.find((a) => a.id === r.accountId)?.name ?? r.accountId,
        },
        {
          key: "asset",
          label: "资产",
          value: (r) =>
            s.assets.find((a) => a.id === r.assetId)?.code ?? r.assetId,
        },
        { key: "recorded", label: "余额表数量", value: (r) => r.recorded },
        { key: "expected", label: "流水推导数量", value: (r) => r.expected },
        {
          key: "status",
          label: "数量 / 成本 / 已实现对账",
          value: (r) => (r.status === "MATCH" ? "一致" : "存在差异"),
        },
      ]}
    />
  );
}
export function LedgerChecker() {
  const [rows, setRows] = useState<Check["ledger"] | null>(null),
    [error, setError] = useState("");
  return (
    <section className="panel">
      <h2>账本与余额一致性</h2>
      <Button
        variant="outline"
        onClick={async () => {
          try {
            setRows(await mutate("ledger.check", {}));
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        重新推导并检查
      </Button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {rows && <LedgerTable rows={rows} />}
    </section>
  );
}
export function SettingsView() {
  const { state: s, refresh } = useWorkspace(),
    [file, setFile] = useState<unknown>(null),
    [preview, setPreview] = useState<{
      checksum: string;
      createdAt: string;
      counts: { table: string; count: number }[];
    } | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Heading title="设置与数据管理" />
      <TickFlowSettings />
      <section className="panel">
        <h2>备份与恢复</h2>
        <div className="actions">
          <a className="button primary" href="/api/backup" download>
            下载完整JSON备份
          </a>
          <a
            className="button outline"
            href="/api/backup?format=sqlite"
            download
          >
            下载SQLite数据库备份
          </a>
        </div>
        <label className="field" style={{ marginTop: 20 }}>
          选择JSON备份，先校验并预览
          <input
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              setPreview(null);
              setConfirmed(false);
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(true);
              try {
                const parsed = JSON.parse(await f.text()),
                  r = await mutate("backup.preview", parsed);
                setFile(parsed);
                setPreview(r);
                setMessage("校验通过，请核对各表记录数量。");
              } catch (e) {
                setFile(null);
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {preview && (
          <>
            <p className="detail">备份时间 {when(preview.createdAt)}</p>
            <Table
              rows={preview.counts}
              columns={[
                { key: "table", label: "数据表", value: (r) => r.table },
                { key: "count", label: "记录数量", value: (r) => r.count },
              ]}
            />
            <label className="field">
              已核对备份内容，确认替换当前本地数据
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
            </label>
            <Button
              disabled={!confirmed || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await mutate("backup.restore", {
                    backup: file,
                    checksum: preview.checksum,
                  });
                  setMessage(`恢复成功，恢复前备份已保存：${r.beforeBackup}`);
                  setPreview(null);
                  setConfirmed(false);
                  refresh();
                } catch (e) {
                  setMessage(`恢复失败，原数据保留：${(e as Error).message}`);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "恢复中…" : "确认恢复（自动保存当前数据）"}
            </Button>
          </>
        )}
        {message && <p role="status">{message}</p>}
        <p className="detail">备份包含个人财务数据和附件，请妥善保存。</p>
        <details className="calculation-notes">
          <summary>备份说明</summary>
          <p>
            JSON包含账本、策略、回测和图片，恢复前校验，失败自动回滚。SQLite备份可在关闭服务后替换数据库文件。
          </p>
        </details>
      </section>
      <Form
        title="估值有效期"
        action="setting.save"
        onDone={refresh}
        transform={(d) => ({ key: "priceStaleDays", value: d.value })}
        fields={[
          {
            name: "value",
            label: "价格与汇率最长有效天数（1–365）",
            value:
              s.settings.find((r) => r.key === "priceStaleDays")?.value ?? "7",
          },
        ]}
      />
      <Importer refresh={refresh} />
      <LedgerChecker />
      <section className="panel">
        <h2>最近100条审计记录</h2>
        <Table
          rows={s.audits}
          columns={[
            { key: "at", label: "时间", value: (r) => when(r.at) },
            { key: "action", label: "操作", value: (r) => r.action },
            { key: "entity", label: "记录ID", value: (r) => r.entityId },
            { key: "detail", label: "说明", value: (r) => r.detail },
          ]}
        />
      </section>
    </>
  );
}
