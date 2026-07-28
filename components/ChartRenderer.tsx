"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartSpec } from "@/lib/types";

const TEAL = "#0d9488";
const CORAL = "#e11d48";
const MUTED = "#78716c";

function tooltipStyle() {
  return {
    background: "#fffdf8",
    border: "1px solid rgba(28,25,23,0.12)",
    borderRadius: 12,
    fontSize: 12,
  };
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
                {data.map((entry) => (
                  <Cell
                    key={entry.label}
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
        ) : chart.type === "equity" ? (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data}>
              <defs>
                <linearGradient id={`eq-${chart.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={TEAL} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={TEAL} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(28,25,23,0.08)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
              <Tooltip contentStyle={tooltipStyle()} />
              <Area
                type="monotone"
                dataKey="value"
                stroke={TEAL}
                strokeWidth={2.2}
                fill={`url(#eq-${chart.id})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data}>
              <CartesianGrid stroke="rgba(28,25,23,0.08)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
              <Tooltip contentStyle={tooltipStyle()} />
              <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                {data.map((entry) => (
                  <Cell
                    key={entry.label}
                    fill={entry.value >= 0 ? TEAL : CORAL}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
