"use client";
import { useState } from "react";
import { Button } from "./ui/button";
export type Field = {
  name: string;
  label: string;
  type?: string;
  value?: string;
  options?: { value: string; label: string }[];
  optional?: boolean;
  wide?: boolean;
  help?: string;
};
export const nowLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export async function mutate(action: string, input: unknown) {
  const r = await fetch("/api/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, input }),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error);
  return result.result;
}
export function Form({
  title,
  id,
  action,
  fields,
  onDone,
  transform,
  submit = "保存",
  preview,
}: {
  title: string;
  id?: string;
  action: string;
  fields: Field[];
  onDone: () => void;
  transform?: (data: Record<string, unknown>) => unknown;
  submit?: string;
  preview?: (data: Record<string, string>) => React.ReactNode;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [values, setValues] = useState<Record<string, string>>({});
  return (
    <section className="panel" id={id}>
      <h2>{title}</h2>
      <form
        onChange={(e) => {
          if (preview)
            setValues(
              Object.fromEntries(
                new FormData(e.currentTarget).entries(),
              ) as Record<string, string>,
            );
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          const el = e.currentTarget;
          setError("");
          setBusy(true);
          try {
            const fd = new FormData(el);
            const data: Record<string, unknown> = {};
            for (const field of fields) {
              const value = String(fd.get(field.name) ?? "");
              if (field.optional && !value) continue;
              data[field.name] =
                field.type === "datetime-local"
                  ? new Date(value).toISOString()
                  : field.type === "checkbox"
                    ? fd.has(field.name)
                    : field.type === "integer"
                      ? Number(value)
                      : value;
            }
            await mutate(action, transform ? transform(data) : data);
            el.reset();
            onDone();
          } catch (e) {
            setError(e instanceof Error ? e.message : "保存失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          {fields.map((f) => (
            <label className={`field ${f.wide ? "wide" : ""}`} key={f.name}>
              {f.label}
              {f.options ? (
                <select
                  name={f.name}
                  defaultValue={f.value ?? ""}
                  required={!f.optional}
                >
                  <option value="">请选择</option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  name={f.name}
                  defaultValue={f.value}
                  required={!f.optional}
                />
              ) : f.type === "checkbox" ? (
                <input
                  type="checkbox"
                  name={f.name}
                  defaultChecked={f.value === "true"}
                />
              ) : (
                <input
                  name={f.name}
                  type={f.type === "integer" ? "number" : (f.type ?? "text")}
                  step={f.type === "integer" ? "1" : undefined}
                  defaultValue={
                    f.type === "datetime-local"
                      ? (f.value ?? nowLocal())
                      : f.value
                  }
                  required={!f.optional}
                />
              )}{" "}
              {f.help && <small>{f.help}</small>}
            </label>
          ))}
        </div>
        {preview && preview(values)}
        <div className="form-actions">
          <Button disabled={busy}>{busy ? "保存中…" : submit}</Button>
          {error && (
            <span role="alert" className="error">
              {error}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
