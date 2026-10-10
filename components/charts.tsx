"use client";
import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart, PieChart, BarChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
echarts.use([
  LineChart,
  PieChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);
export function Chart({
  type = "line",
  labels = [],
  series,
  pie,
}: {
  type?: "line" | "bar";
  labels?: string[];
  series?: { name: string; values: (string | null)[] }[];
  pie?: { name: string; value: string }[];
}) {
  const ref = useRef<HTMLDivElement>(null),
    hasData = pie
      ? pie.length > 0
      : !!series?.some((s) => s.values.some((v) => v !== null));
  useEffect(() => {
    if (!ref.current || !hasData) return;
    const chart = echarts.init(ref.current);
    const muted = getComputedStyle(document.documentElement)
        .getPropertyValue("--muted")
        .trim(),
      line = getComputedStyle(document.documentElement)
        .getPropertyValue("--line")
        .trim();
    chart.setOption({
      color: ["#64d4b1", "#6f9fd8", "#d4b477", "#aa94d5", "#e68791"],
      tooltip: { trigger: pie ? "item" : "axis" },
      legend: { bottom: 0, textStyle: { color: muted } },
      grid: { left: 60, right: 15, top: 25, bottom: 50 },
      ...(pie
        ? {
            series: [
              {
                type: "pie",
                radius: ["48%", "72%"],
                label: { color: muted },
                data: pie.map((p) => ({ ...p, value: Number(p.value) })),
              },
            ],
          }
        : {
            xAxis: {
              type: "category",
              data: labels,
              axisLabel: { color: muted },
              axisLine: { lineStyle: { color: line } },
            },
            yAxis: {
              type: "value",
              axisLabel: { color: muted },
              splitLine: { lineStyle: { color: line } },
            },
            series: series?.map((s) => ({
              name: s.name,
              type,
              data: s.values.map((v) => (v === null ? null : Number(v))),
              showSymbol: false,
              lineStyle: { width: 2 },
            })),
          }),
    });
    const syncTheme = () => {
      const css = getComputedStyle(document.documentElement),
        muted = css.getPropertyValue("--muted").trim(),
        line = css.getPropertyValue("--line").trim(),
        palette =
          document.documentElement.dataset.theme === "light"
            ? ["#14795c", "#376d9e", "#876a29", "#7150a6", "#a73d50"]
            : ["#64d4b1", "#6f9fd8", "#d4b477", "#aa94d5", "#e68791"];
      chart.setOption({
        color: palette,
        legend: { textStyle: { color: muted } },
        ...(pie
          ? { series: [{ label: { color: muted } }] }
          : {
              xAxis: {
                axisLabel: { color: muted },
                axisLine: { lineStyle: { color: line } },
              },
              yAxis: {
                axisLabel: { color: muted },
                splitLine: { lineStyle: { color: line } },
              },
            }),
      });
    };
    syncTheme();
    const themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      themeObserver.disconnect();
      chart.dispose();
    };
  }, [labels, series, pie, type, hasData]);
  if (!hasData)
    return (
      <div className="chart empty">
        暂无足够数据，保存估值或录入记录后显示。
      </div>
    );
  return (
    <div
      className="chart"
      ref={ref}
      role="img"
      aria-label={pie ? "资产分布图" : "资产或收益历史趋势图"}
    />
  );
}
