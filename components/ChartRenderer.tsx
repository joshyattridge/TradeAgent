"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ComposedChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { useTheme } from "@/components/ThemeProvider";
import { readCssVar } from "@/lib/theme";
import type { ChartPoint, ChartSpec } from "@/lib/types";

const CHART_HEIGHT = 220;
const FEATURED_CHART_HEIGHT = 380;

/** Override Recharts defaults (#fff panel, #000 item text) with theme tokens. */
const chartTooltipProps = {
  contentStyle: {
    backgroundColor: "var(--paper-2)",
    border: "1px solid var(--line)",
    borderRadius: 12,
    fontSize: 12,
    color: "var(--ink)",
  },
  itemStyle: { color: "var(--ink)" },
  labelStyle: { color: "var(--ink)" },
};

function useChartPalette() {
  const { resolved } = useTheme();
  return useMemo(() => {
    void resolved;
    const teal = readCssVar("--teal", "#0d9488");
    const coral = readCssVar("--coral", "#e11d48");
    const muted = readCssVar("--muted", "#78716c");
    return {
      teal,
      tealMuted: readCssVar("--teal-muted", "rgba(13, 148, 136, 0.32)"),
      coral,
      coralMuted: readCssVar("--coral-muted", "rgba(225, 29, 72, 0.32)"),
      muted,
      grid: readCssVar("--chart-grid", "rgba(28,25,23,0.08)"),
      axisTick: { fill: muted, fontSize: 11 },
      pointColor: (value: number) => (value >= 0 ? teal : coral),
    };
  }, [resolved]);
}

function formatChartValue(value: unknown, unit?: "usd" | "percent"): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  if (unit === "usd") {
    const sign = n > 0 ? "+" : "";
    return `${sign}$${n.toFixed(Math.abs(n) >= 100 ? 0 : 2)}`;
  }
  if (unit === "percent") {
    if (n === 0) return "0%";
    if (Math.abs(n) >= 1) {
      return `${Number.isInteger(n) ? String(n) : n.toFixed(1)}%`;
    }
    return `${n.toFixed(2)}%`;
  }
  return String(n);
}

function ScatterBody({ chart, data }: { chart: ChartSpec; data: ChartPoint[] }) {
  const {
    teal,
    muted,
    grid,
    axisTick,
    pointColor,
  } = useChartPalette();
  const rows = data.map((d, i) => ({
    ...d,
    x: d.x ?? d.value,
    y: d.y ?? d.secondary ?? 0,
    i,
  }));

  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <ScatterChart margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={grid} vertical={false} />
        <XAxis
          type="number"
          dataKey="x"
          name={chart.xLabel ?? "X"}
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          label={
            chart.xLabel
              ? {
                  value: chart.xLabel,
                  position: "insideBottom",
                  offset: -2,
                  fill: muted,
                  fontSize: 11,
                }
              : undefined
          }
        />
        <YAxis
          type="number"
          dataKey="y"
          name={chart.yLabel ?? "Y"}
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          width={44}
          label={
            chart.yLabel
              ? {
                  value: chart.yLabel,
                  angle: -90,
                  position: "insideLeft",
                  fill: muted,
                  fontSize: 11,
                }
              : undefined
          }
        />
        <ZAxis range={[60, 60]} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3", stroke: muted }}
          {...chartTooltipProps}
          formatter={(value, name) => {
            const n = typeof value === "number" ? value : Number(value);
            const label =
              name === "x"
                ? (chart.xLabel ?? "X")
                : name === "y"
                  ? (chart.yLabel ?? "Y")
                  : String(name);
            return [Number.isFinite(n) ? n : value, label];
          }}
          labelFormatter={(_, payload) => {
            const row = payload?.[0]?.payload as ChartPoint | undefined;
            return row?.label ?? "";
          }}
        />
        <Scatter data={rows} fill={teal}>
          {rows.map((entry) => (
            <Cell key={`${entry.label}-${entry.i}`} fill={pointColor(entry.y)} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function LineBody({ chart, data }: { chart: ChartSpec; data: ChartPoint[] }) {
  const { teal, muted, grid, axisTick } = useChartPalette();
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <LineChart data={data}>
        <CartesianGrid stroke={grid} vertical={false} />
        <XAxis
          dataKey="label"
          tick={axisTick}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          width={52}
          tickFormatter={(v) => formatChartValue(v, chart.valueUnit)}
          label={
            chart.yLabel
              ? {
                  value: chart.yLabel,
                  angle: -90,
                  position: "insideLeft",
                  fill: muted,
                  fontSize: 11,
                }
              : undefined
          }
        />
        <Tooltip
          {...chartTooltipProps}
          formatter={(value) => [formatChartValue(value, chart.valueUnit), chart.yLabel ?? "Value"]}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={teal}
          strokeWidth={2.2}
          dot={{ r: 3.5, fill: teal, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function barCellFill(
  chart: ChartSpec,
  entry: ChartPoint,
  hasCurrent: boolean,
  palette: ReturnType<typeof useChartPalette>,
): string {
  if (entry.estimated && entry.value === 0) return palette.muted;
  if (chart.type === "lossStreak") {
    return entry.current || !hasCurrent ? palette.coral : palette.coralMuted;
  }
  if (chart.type === "winWithin") {
    return entry.current || !hasCurrent ? palette.teal : palette.tealMuted;
  }
  return palette.pointColor(entry.value);
}

function FanBody({ chart, data }: { chart: ChartSpec; data: ChartPoint[] }) {
  const { teal, grid, axisTick } = useChartPalette();
  const rows = data.map((d) => {
    const lo = d.lo ?? d.value;
    const hi = d.hi ?? d.value;
    return {
      ...d,
      p10: lo,
      band: hi - lo,
      actual: d.estimated ? null : d.value,
      forecast: d.estimated || d.current ? d.value : null,
    };
  });

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={grid} vertical={false} />
        <XAxis
          dataKey="id"
          type="category"
          allowDuplicatedCategory
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          tickFormatter={(_label, index) => {
            const row = rows[index];
            if (!row) return "";
            if (row.current) return "Now";
            if (row.estimated) {
              return row.label === "10" || row.label === "5" ? `+${row.label}` : "";
            }
            if (index === 0) return String(row.label);
            return "";
          }}
        />
        <YAxis
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          width={52}
          tickFormatter={(v) => formatChartValue(v, chart.valueUnit)}
        />
        <Tooltip
          {...chartTooltipProps}
          labelFormatter={(_label, payload) => {
            const point = payload?.[0]?.payload as ChartPoint | undefined;
            if (!point?.label) return "";
            if (point.estimated) return `+${point.label} trades`;
            if (point.current) return `${point.label} · now`;
            return point.label;
          }}
          formatter={(value, name, item) => {
            const point = item?.payload as ChartPoint | undefined;
            if (name === "actual") {
              return [formatChartValue(value, chart.valueUnit), "Equity"];
            }
            if (name !== "forecast") return [null, null];
            const median = formatChartValue(value, chart.valueUnit);
            if (point?.lo == null || point?.hi == null || point.lo === point.hi) {
              return [median, "Median"];
            }
            const lo = formatChartValue(point.lo, chart.valueUnit);
            const hi = formatChartValue(point.hi, chart.valueUnit);
            return [`${median}  ·  10–90: ${lo} to ${hi}`, "Median"];
          }}
        />
        <Area
          stackId="fan"
          dataKey="p10"
          fill="transparent"
          stroke="none"
          tooltipType="none"
          legendType="none"
          isAnimationActive={false}
        />
        <Area
          stackId="fan"
          dataKey="band"
          fill={teal}
          fillOpacity={0.2}
          stroke="none"
          tooltipType="none"
          legendType="none"
          isAnimationActive={false}
        />
        <Line
          type="linear"
          dataKey="actual"
          stroke={teal}
          strokeWidth={2.2}
          connectNulls={false}
          dot={{ r: 3, fill: teal, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="forecast"
          stroke={teal}
          strokeWidth={2.2}
          strokeDasharray="5 4"
          connectNulls={false}
          dot={false}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function BarBody({ chart, data }: { chart: ChartSpec; data: ChartPoint[] }) {
  const palette = useChartPalette();
  const { muted, grid, axisTick } = palette;
  const hasCurrent = data.some((d) => d.current);
  return (
    <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
      <BarChart data={data}>
        <CartesianGrid stroke={grid} vertical={false} />
        <XAxis
          dataKey="label"
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          label={
            chart.xLabel
              ? {
                  value: chart.xLabel,
                  position: "insideBottom",
                  offset: -2,
                  fill: muted,
                  fontSize: 11,
                }
              : undefined
          }
        />
        <YAxis
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          width={52}
          tickFormatter={(v) => formatChartValue(v, chart.valueUnit)}
        />
        <Tooltip
          {...chartTooltipProps}
          formatter={(value, _name, item) => {
            const point = item?.payload as ChartPoint | undefined;
            const formatted = formatChartValue(value, chart.valueUnit);
            const bits = [formatted];
            if (point?.estimated) bits.push("(est.)");
            if (point?.current) bits.push("· you are here");
            if (point?.count != null && point.count > 0) {
              bits.push(`· ${point.count} trade${point.count === 1 ? "" : "s"}`);
            }
            const seriesLabel =
              point?.count != null && point.count > 0
                ? `Net ${chart.yLabel ?? "value"}`
                : (chart.yLabel ?? "Value");
            return [bits.join(" "), seriesLabel];
          }}
        />
        {/* minPointSize keeps $0 / breakeven / estimated-zero symbols visible */}
        <Bar dataKey="value" radius={[8, 8, 0, 0]} minPointSize={4}>
          {data.map((entry, i) => (
            <Cell
              key={entry.id ?? `${entry.label}-${i}`}
              fill={barCellFill(chart, entry, hasCurrent, palette)}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function EquityBody({
  chart,
  data,
  featured,
}: {
  chart: ChartSpec;
  data: ChartPoint[];
  featured?: boolean;
}) {
  const { teal, grid, axisTick } = useChartPalette();
  const height = featured ? FEATURED_CHART_HEIGHT : CHART_HEIGHT;
  const strokeWidth = featured ? 2.8 : 2.2;
  const dotRadius = featured ? 4 : 3;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id={`eq-${chart.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={teal} stopOpacity={featured ? 0.42 : 0.35} />
            <stop offset="100%" stopColor={teal} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={grid} vertical={false} />
        {/*
          Prefer sequential `x` so same-day trades never share a category
          key (duplicate date labels used to collapse points in Recharts).
        */}
        <XAxis
          dataKey={data.every((d) => d.id != null && d.id !== "") ? "id" : "label"}
          type="category"
          allowDuplicatedCategory
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          tickFormatter={(_value, index) => data[index]?.label ?? String(_value ?? "")}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          width={52}
          tickFormatter={(v) => formatChartValue(v, chart.valueUnit)}
        />
        <Tooltip
          {...chartTooltipProps}
          labelFormatter={(_label, payload) => {
            const point = payload?.[0]?.payload as ChartPoint | undefined;
            return point?.label ?? "";
          }}
          formatter={(value, _name, item) => {
            const point = item?.payload as ChartPoint | undefined;
            const formatted = formatChartValue(value, chart.valueUnit);
            const suffix = point?.estimated ? " (est.)" : "";
            return [`${formatted}${suffix}`, chart.yLabel ?? "Value"];
          }}
        />
        <Area
          type="linear"
          dataKey="value"
          stroke={teal}
          strokeWidth={strokeWidth}
          fill={`url(#eq-${chart.id})`}
          isAnimationActive={false}
          dot={{ r: dotRadius, fill: teal, strokeWidth: 0 }}
          activeDot={{ r: featured ? 6 : 5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ChartRenderer({
  chart,
  featured = false,
}: {
  chart: ChartSpec;
  featured?: boolean;
}) {
  const { teal, coral, muted } = useChartPalette();
  const data = chart.data ?? [];

  return (
    <div className={featured ? "chart-panel chart-panel--featured" : "chart-panel"}>
      <div className="chart-panel__head">
        <h3>{chart.title}</h3>
        {chart.description ? <p>{chart.description}</p> : null}
      </div>
      <div className="chart-panel__body">
        {data.length === 0 ? (
          <p className="empty-note">No data yet.</p>
        ) : chart.type === "winLoss" ? (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                innerRadius={52}
                outerRadius={78}
                paddingAngle={3}
              >
                {data.map((entry, i) => (
                  <Cell
                    key={entry.id ?? `${entry.label}-${i}`}
                    fill={
                      entry.label === "Wins"
                        ? teal
                        : entry.label === "Losses"
                          ? coral
                          : muted
                    }
                  />
                ))}
              </Pie>
              <Tooltip {...chartTooltipProps} />
            </PieChart>
          </ResponsiveContainer>
        ) : chart.type === "equityFan" ? (
          <FanBody chart={chart} data={data} />
        ) : chart.type === "equity" || chart.type === "line" ? (
          chart.type === "line" ? (
            <LineBody chart={chart} data={data} />
          ) : (
            <EquityBody chart={chart} data={data} featured={featured} />
          )
        ) : chart.type === "scatter" ? (
          <ScatterBody chart={chart} data={data} />
        ) : (
          <BarBody chart={chart} data={data} />
        )}
      </div>
    </div>
  );
}
