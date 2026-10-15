"use client";
import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { LineChart, PieChart, BarChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { amount } from "@/lib/utils";
echarts.use([
  LineChart,
  PieChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);
const EMPTY_LABELS: string[] = [];
export function Chart({
  type = "line",
  labels = EMPTY_LABELS,
  series,
  pie,
  title,
  unit = "",
}: {
  type?: "line" | "bar";
  labels?: string[];
  series?: { name: string; values: (string | null)[] }[];
  pie?: { name: string; value: string }[];
  title?: string;
  unit?: string;
}) {
  const ref = useRef<HTMLDivElement>(null),
    [showData, setShowData] = useState(false),
    hasData = pie
      ? pie.length > 0
      : !!series?.some((s) => s.values.some((v) => v !== null)),
    name = title ?? (pie ? "资产分布图" : "资产或收益历史趋势图");
  useEffect(() => {
    if (!ref.current || !hasData) return;
    const element = ref.current;
    const chart = echarts.init(element);
    const sync = () => {
      if (!element.isConnected) return;
      const css = getComputedStyle(document.documentElement),
        muted = css.getPropertyValue("--muted").trim(),
        line = css.getPropertyValue("--line").trim(),
        text = css.getPropertyValue("--text").trim(),
        panel = css.getPropertyValue("--panel").trim(),
        light = document.documentElement.dataset.theme === "light",
        compact = element.clientWidth < 480,
        reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      chart.setOption({
        animation: !reduced,
        animationDuration: 200,
        color: light
          ? ["#14795c", "#376d9e", "#876a29", "#7150a6", "#a73d50"]
          : ["#64d4b1", "#6f9fd8", "#d4b477", "#aa94d5", "#e68791"],
        tooltip: {
          trigger: pie ? "item" : "axis",
          renderMode: "richText",
          confine: true,
          backgroundColor: panel,
          borderColor: line,
          textStyle: { color: text },
          valueFormatter: (value: number | null) =>
            value === null
              ? "数据不足"
              : `${amount(String(value))}${unit ? ` ${unit}` : ""}`,
        },
        legend: {
          bottom: 0,
          type: "scroll",
          textStyle: { color: muted },
          pageTextStyle: { color: muted },
          pageIconColor: muted,
          pageIconInactiveColor: line,
        },
        grid: { left: 12, right: 18, top: 28, bottom: 52, containLabel: true },
        ...(pie
          ? {
              series: [
                {
                  type: "pie",
                  radius: ["48%", "72%"],
                  center: ["50%", "44%"],
                  label: { show: !compact, color: muted },
                  data: pie.map((p) => ({ ...p, value: Number(p.value) })),
                },
              ],
            }
          : {
              xAxis: {
                type: "category",
                data: labels,
                boundaryGap: type === "bar",
                axisLabel: {
                  color: muted,
                  hideOverlap: true,
                  formatter: (value: string) =>
                    value.replace(/\s+\d{2}:\d{2}:\d{2}$/, ""),
                },
                axisLine: { lineStyle: { color: line } },
              },
              yAxis: {
                type: "value",
                name: unit,
                nameTextStyle: { color: muted },
                axisLabel: {
                  color: muted,
                  formatter: (v: number) =>
                    new Intl.NumberFormat("zh-CN", {
                      notation: "compact",
                      maximumFractionDigits: 1,
                    }).format(v),
                },
                splitLine: { lineStyle: { color: line } },
              },
              series: series?.map((s) => ({
                name: s.name,
                type,
                data: s.values.map((v) => (v === null ? null : Number(v))),
                connectNulls: false,
                showSymbol: labels.length === 1,
                symbolSize: 6,
                lineStyle: { width: 2 },
              })),
            }),
      });
    };
    sync();
    const theme = new MutationObserver(sync);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const ro = new ResizeObserver(() => {
      chart.resize();
      sync();
    });
    ro.observe(element);
    return () => {
      ro.disconnect();
      theme.disconnect();
      chart.dispose();
    };
  }, [labels, series, pie, type, hasData, unit]);
  if (!hasData)
    return (
      <div className="chart empty">
        <strong>还没有可展示的图表数据</strong>
        保存完整估值或录入记录后，趋势会显示在这里。
      </div>
    );
  return (
    <div className="chart-block">
      <div
        className="chart"
        ref={ref}
        role="img"
        aria-label={`${name}${unit ? `，单位 ${unit}` : ""}`}
      />
      <details
        className="chart-data"
        open={showData}
        onToggle={(e) => setShowData(e.currentTarget.open)}
      >
        <summary>图表数据</summary>
        {showData && (
          <div
            className="table-scroll"
            role="region"
            aria-label={`${name}数据`}
            tabIndex={0}
          >
            <table>
              <caption className="sr-only">
                {name}
                {unit ? `（${unit}）` : ""}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{pie ? "分类" : "日期 / 区间"}</th>
                  {pie ? (
                    <th scope="col">金额{unit ? `（${unit}）` : ""}</th>
                  ) : (
                    series?.map((s) => (
                      <th scope="col" key={s.name}>
                        {s.name}
                      </th>
                    ))
                  )}
                </tr>
              </thead>
              <tbody>
                {pie
                  ? pie.map((p) => (
                      <tr key={p.name}>
                        <th scope="row">{p.name}</th>
                        <td className="mono">{p.value}</td>
                      </tr>
                    ))
                  : labels.map((label, i) => (
                      <tr key={`${label}-${i}`}>
                        <th scope="row">{label}</th>
                        {series?.map((s) => (
                          <td className="mono" key={s.name}>
                            {s.values[i] ?? "数据不足"}
                          </td>
                        ))}
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </div>
  );
}
