"use client";
import Papa from "papaparse";
import { useState } from "react";
import { Button } from "./ui/button";
import { mutate } from "./form";
import { Table } from "./table";
type Preview = {
  rows: {
    row: number;
    data: Record<string, unknown> | null;
    error: string | null;
    duplicate: boolean;
  }[];
  count: number;
  errors: number;
  duplicates: number;
};
export function Importer({ refresh }: { refresh: () => void }) {
  const [csv, setCsv] = useState(""),
    [headers, setHeaders] = useState<string[]>([]),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<Preview | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const targets = [
    "accountId",
    "assetId",
    "type",
    "quantity",
    "price",
    "fee",
    "at",
    "note",
    "externalId",
  ];
  return (
    <section className="panel">
      <h2>导入资产流水</h2>
      <p className="detail">
        先预览，再确认导入。账户和资产使用ID；时间包含时区；非现金资产需要价格。导入采用整批事务，任何业务错误均不写入。
      </p>
      <label className="field">
        选择CSV
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const value = await file.text(),
              parsed = Papa.parse(value, { header: true });
            const fields = parsed.meta.fields ?? [];
            setCsv(value);
            setHeaders(fields);
            setMapping(
              Object.fromEntries(
                targets.map((t) => [t, fields.includes(t) ? t : ""]),
              ),
            );
            setPreview(null);
            setMessage("");
          }}
        />
      </label>
      {headers.length > 0 && (
        <>
          <div className="form-grid" style={{ marginTop: 16 }}>
            {targets.map((t) => (
              <label className="field" key={t}>
                {t}
                <select
                  value={mapping[t] ?? ""}
                  onChange={(e) => {
                    setMapping({ ...mapping, [t]: e.target.value });
                    setPreview(null);
                  }}
                >
                  <option value="">未映射</option>
                  {headers.map((h) => (
                    <option key={h}>{h}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="form-actions">
            <Button
              disabled={busy}
              variant="outline"
              onClick={async () => {
                setBusy(true);
                try {
                  setPreview(await mutate("import.preview", { csv, mapping }));
                  setMessage("");
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              预览与校验
            </Button>
          </div>
        </>
      )}
      {preview && (
        <>
          <p className="notice">
            可导入{preview.count}条 · 重复{preview.duplicates}条 · 错误
            {preview.errors}条
          </p>
          <Table
            rows={preview.rows}
            columns={[
              { key: "row", label: "CSV行", value: (r) => r.row },
              {
                key: "data",
                label: "内容",
                value: (r) => JSON.stringify(r.data),
              },
              {
                key: "status",
                label: "校验结果",
                value: (r) =>
                  r.error ?? (r.duplicate ? "重复，将跳过" : "格式通过"),
              },
            ]}
            empty="没有可导入数据"
          />
          <Button
            variant="outline"
            onClick={() => {
              const text = Papa.unparse(
                  preview.rows.map((r) => ({
                    row: r.row,
                    status: r.error
                      ? "ERROR"
                      : r.duplicate
                        ? "DUPLICATE"
                        : "VALID",
                    detail: r.error ?? "",
                  })),
                  { escapeFormulae: true },
                ),
                url = URL.createObjectURL(
                  new Blob(["\uFEFF" + text], {
                    type: "text/csv;charset=utf-8",
                  }),
                ),
                a = document.createElement("a");
              a.href = url;
              a.download = "tradeos-import-report.csv";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            下载校验报告
          </Button>
          <Button
            disabled={busy || preview.errors > 0 || preview.count === 0}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await mutate("import.commit", { csv, mapping });
                setMessage(`导入成功：${r.imported}条，跳过${r.duplicates}条`);
                setPreview(null);
                refresh();
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            确认导入{preview.count}条
          </Button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      <div className="actions" style={{ marginTop: 16 }}>
        <a className="button outline" href="/api/export" download>
          导出CSV流水
        </a>
      </div>
    </section>
  );
}
