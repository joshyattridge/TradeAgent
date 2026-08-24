"use client";

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
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { ChartPoint, ChartSpec } from "@/lib/types";

const TEAL = "#0d9488";
const CORAL = "#e11d48";
const MUTED = "#78716c";
const GRID = "rgba(28,25,23,0.08)";

function tooltipStyle() {
  return {
    background: "#f8faf9",
    border: "1px solid rgba(28,25,23,0.12)",
    borderRadius: 12,
    fontSize: 12,
    color: "#1c1917",
  };
}

function axisTick() {
  return { fill: MUTED, fontSize: 11 };
}

function pointColor(value: number) {
  return value >= 0 ? TEAL : CORAL;
}

function formatChartValue(value: unknown, unit?: "usd"): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  if (unit === "usd") {
    const sign = n > 0 ? "+" : "";
    return `${sign}$${n.toFixed(Math.abs(n) >= 100 ? 0 : 2)}`;
  }
  return String(n);
}

function ScatterBody({ chart, data }: { chart: ChartSpec; data: ChartPoint[] }) {
  const rows = data.map((d, i) => ({
    ...d,
    x: d.x ?? d.value,
    y: d.y ?? d.secondary ?? 0,
    i,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          type="number"
          dataKey="x"
          name={chart.xLabel ?? "X"}
          tick={axisTick()}
          axisLine={false}
          tickLine={false}
          label={
            chart.xLabel
              ? {
                  value: chart.xLabel,
                  position: "insideBottom",
                  offset: -2,
                  fill: MUTED,
                  fontSize: 11,
                }
              : undefined
          }
        />
        <YAxis
          type="number"
          dataKey="y"
          name={chart.yLabel ?? "Y"}
          tick={axisTick()}
          axisLine={false}
          tickLine={false}
          width={44}
          label={
            chart.yLabel
              ? {
                  value: chart.yLabel,
                  angle: -90,
                  position: "insideLeft",
                  fill: MUTED,
                  fontSize: 11,
                }
              : undefined
          }
        />
        <ZAxis range={[60, 60]} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3", stroke: MUTED }}
          contentStyle={tooltipStyle()}
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
        <Scatter data={rows} fill={TEAL}>
          {rows.map((entry) => (
            <Cell key={`${entry.label}-${entry.i}`} fill={pointColor(entry.y)} />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function LineBody({ chart, data }: { chart: ChartSpec; data: ChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="label"
          tick={axisTick()}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={axisTick()}
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
                  fill: MUTED,
                  fontSize: 11,
                }
              : undefined
          }
        />
        <Tooltip
          contentStyle={tooltipStyle()}
          formatter={(value) => [formatChartValue(value, chart.valueUnit), chart.yLabel ?? "Value"]}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke={TEAL}
          strokeWidth={2.2}
          dot={{ r: 3.5, fill: TEAL, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function BarBody({ chart, data }: { chart: ChartSpec; data: ChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={axisTick()} axisLine={false} tickLine={false} />
        <YAxis
          tick={axisTick()}
          axisLine={false}
          tickLine={false}
          width={52}
          tickFormatter={(v) => formatChartValue(v, chart.valueUnit)}
        />
        <Tooltip
          contentStyle={tooltipStyle()}
          formatter={(value, _name, item) => {
            const point = item?.payload as ChartPoint | undefined;
            const formatted = formatChartValue(value, chart.valueUnit);
            const bits = [formatted];
            if (point?.estimated) bits.push("(est.)");
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
              fill={
                entry.estimated && entry.value === 0
                  ? MUTED
                  : pointColor(entry.value)
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ChartRenderer({ chart }: { chart: ChartSpec }) {
  const data = chart.data ?? [];

  return (
    <div className="chart-panel">
      <div className="chart-panel__head">
        <h3>{chart.title}</h3>
        {chart.description ? <p>{chart.description}</p> : null}
      </div>
      <div className="chart-panel__body">
        {data.length === 0 ? (
          <p className="empty-note">No data yet.</p>
        ) : chart.type === "winLoss" ? (
          <ResponsiveContainer width="100%" height={220}>
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
                        ? TEAL
                        : entry.label === "Losses"
                          ? CORAL
                          : MUTED
                    }
                  />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle()} />
            </PieChart>
          </ResponsiveContainer>
        ) : chart.type === "equity" || chart.type === "line" ? (
          chart.type === "line" ? (
            <LineBody chart={chart} data={data} />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data}>
                <defs>
                  <linearGradient id={`eq-${chart.id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={TEAL} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={TEAL} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} vertical={false} />
                {/*
                  Prefer sequential `x` so same-day trades never share a category
                  key (duplicate date labels used to collapse points in Recharts).
                */}
                <XAxis
                  dataKey={data.every((d) => d.id != null && d.id !== "") ? "id" : "label"}
                  type="category"
                  allowDuplicatedCategory
                  tick={axisTick()}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(_value, index) => data[index]?.label ?? String(_value ?? "")}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={axisTick()}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                  tickFormatter={(v) => formatChartValue(v, chart.valueUnit)}
                />
                <Tooltip
                  contentStyle={tooltipStyle()}
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
                  stroke={TEAL}
                  strokeWidth={2.2}
                  fill={`url(#eq-${chart.id})`}
                  isAnimationActive={false}
                  dot={{ r: 3, fill: TEAL, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
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
