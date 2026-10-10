import { D } from "./calculations/decimal";
export function amount(value: string | null | undefined, currency = "") {
  if (value == null) return "数据不足";
  const [whole, dec] = (
    D(value).abs().gt(0) && D(value).abs().lt("0.01")
      ? D(value).toSignificantDigits(6).toFixed()
      : D(value).toFixed(2)
  ).split(".");
  return `${currency ? currency + " " : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${dec ? "." + dec : ""}`;
}
export const pct = (v: string | null | undefined) =>
  v == null ? "数据不足" : `${D(v).mul(100).toFixed(2)}%`;
export const when = (s: string) =>
  new Date(s).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });

export const day = (s: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(s));

export function signedClass(value: string | null | undefined) {
  return value == null
    ? ""
    : D(value).gt(0)
      ? "positive"
      : D(value).lt(0)
        ? "negative"
        : "";
}

export function compareValues(x: string | number, y: string | number) {
  const decimal = /^-?\d+(?:\.\d+)?$/;
  if (decimal.test(String(x)) && decimal.test(String(y))) return D(x).cmp(y);
  return String(x).localeCompare(String(y), "zh-CN", { numeric: true });
}
