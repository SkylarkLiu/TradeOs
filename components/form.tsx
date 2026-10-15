"use client";
import { useEffect, useId, useRef, useState } from "react";
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
  let r: Response;
  try {
    r = await fetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, input }),
    });
  } catch {
    throw new Error("无法连接本地服务。请先检查记录是否已保存，再尝试操作。");
  }
  let result;
  try {
    result = await r.json();
  } catch {
    throw new Error("服务未返回有效结果。请检查记录状态后再重试。");
  }
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
  retain = [],
}: {
  title: string;
  id?: string;
  action: string;
  fields: Field[];
  onDone: () => void;
  transform?: (data: Record<string, unknown>) => unknown;
  submit?: string;
  preview?: (data: Record<string, string>) => React.ReactNode;
  retain?: string[];
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<{ message: string } | null>(null),
    [success, setSuccess] = useState(""),
    [helpOpen, setHelpOpen] = useState<Record<string, boolean>>({}),
    [values, setValues] = useState<Record<string, string>>({});
  const formId = useId(),
    submitting = useRef(false),
    errorRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  return (
    <section className="panel" id={id}>
      <h2 id={`${formId}-title`}>{title}</h2>
      <form
        aria-labelledby={`${formId}-title`}
        aria-busy={busy}
        onChange={(e) => {
          setSuccess("");
          if (preview)
            setValues(
              Object.fromEntries(
                new FormData(e.currentTarget).entries(),
              ) as Record<string, string>,
            );
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting.current) return;
          const el = e.currentTarget;
          submitting.current = true;
          setError(null);
          setSuccess("");
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
            for (const name of retain) {
              const field = el.elements.namedItem(name);
              if (
                field instanceof HTMLInputElement &&
                field.type === "checkbox"
              )
                field.checked = fd.has(name);
              else if (
                field instanceof HTMLInputElement ||
                field instanceof HTMLSelectElement ||
                field instanceof HTMLTextAreaElement
              )
                field.value = String(fd.get(name) ?? "");
            }
            setValues({});
            const retained = fields
              .filter((f) => retain.includes(f.name))
              .map((f) => f.label)
              .join("、");
            setSuccess(
              `${submit === "保存" ? "保存成功。" : `${submit}成功。`}${retained ? `已保留${retained}。` : ""}`,
            );
            onDone();
          } catch (e) {
            setError({ message: e instanceof Error ? e.message : "保存失败" });
          } finally {
            submitting.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset className="form-fields" disabled={busy}>
          <div className="form-grid">
            {fields.map((f) => {
              const fieldId = `${formId}-${f.name}`,
                helpId = f.help ? `${fieldId}-help` : undefined,
                describedBy = helpOpen[f.name] ? helpId : undefined,
                requirement =
                  /可选|选填|必选|必填|留空/.test(f.label) ||
                  f.type === "checkbox"
                    ? ""
                    : f.optional
                      ? "选填"
                      : "*";
              return (
                <div className={`field ${f.wide ? "wide" : ""}`} key={f.name}>
                  <div className="field-label">
                    <label htmlFor={fieldId}>{f.label}</label>
                    {requirement && (
                      <span className="field-requirement" aria-hidden="true">
                        {requirement}
                      </span>
                    )}
                    {f.help && (
                      <details
                        className="field-help"
                        open={helpOpen[f.name] ?? false}
                        onToggle={(event) => {
                          const open = event.currentTarget.open;
                          setHelpOpen((previous) => ({
                            ...previous,
                            [f.name]: open,
                          }));
                        }}
                      >
                        <summary aria-label={`${f.label}说明`}>说明</summary>
                        <small id={helpId}>{f.help}</small>
                      </details>
                    )}
                  </div>
                  {f.options ? (
                    <select
                      id={fieldId}
                      name={f.name}
                      aria-describedby={describedBy}
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
                      id={fieldId}
                      name={f.name}
                      aria-describedby={describedBy}
                      defaultValue={f.value}
                      required={!f.optional}
                    />
                  ) : f.type === "checkbox" ? (
                    <input
                      type="checkbox"
                      id={fieldId}
                      name={f.name}
                      aria-describedby={describedBy}
                      defaultChecked={f.value === "true"}
                    />
                  ) : (
                    <input
                      id={fieldId}
                      name={f.name}
                      aria-describedby={describedBy}
                      type={
                        f.type === "integer" ? "number" : (f.type ?? "text")
                      }
                      step={f.type === "integer" ? "1" : undefined}
                      defaultValue={
                        f.type === "datetime-local"
                          ? (f.value ?? nowLocal())
                          : f.value
                      }
                      required={!f.optional}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>
        {preview && preview(values)}
        <div className="form-actions">
          <Button disabled={busy} aria-busy={busy}>
            {busy ? "保存中…" : submit}
          </Button>
          <span role="status" className="form-success">
            {success}
          </span>
          {error && (
            <span
              role="alert"
              className="error form-feedback"
              ref={errorRef}
              tabIndex={-1}
            >
              {error.message}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
