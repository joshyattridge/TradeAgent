"use client";

import { ChartRenderer } from "@/components/ChartRenderer";
import { PnlCalendar } from "@/components/PnlCalendar";
import { useTradingStore } from "@/lib/store";
import { buildChart, computeStats } from "@/lib/stats";

function formatSignedUsd(value: number, digits = 0): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}$${value.toFixed(digits)}`;
}

function formatSignedR(value: number, digits = 2): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}R`;
}

export default function DashboardPage() {
  const trades = useTradingStore((s) => s.trades);
  const hydrated = useTradingStore((s) => s.hydrated);
  const stats = computeStats(trades);

  const equity = buildChart("equity", trades, undefined, undefined, "usd");
  const winLoss = buildChart("winLoss", trades, "Win / loss");
  const bySymbol = buildChart("bySymbol", trades, undefined, undefined, "usd");

  if (!hydrated) {
    return <div className="page"><p className="empty-note">Loading book…</p></div>;
  }

  return (
    <div className="page">
      <section className="page-hero">
        <h1>Dashboard</h1>
        <p>
          Progress at a glance — cumulative $, hit rate, and where your edge is
          actually printing.
        </p>
      </section>

      <section className="stat-row">
        <div className="stat">
          <p className="stat__label">$ P&amp;L</p>
          <p
            className={`stat__value ${stats.totalPnlUsd >= 0 ? "pos" : "neg"}`}
          >
            {formatSignedUsd(stats.totalPnlUsd)}
          </p>
        </div>
        <div className="stat">
          <p className="stat__label">Win rate</p>
          <p className="stat__value">{stats.winRate.toFixed(0)}%</p>
        </div>
        <div className="stat">
          <p className="stat__label">Avg RR</p>
          <p className={`stat__value ${stats.avgR >= 0 ? "pos" : "neg"}`}>
            {formatSignedR(stats.avgR)}
          </p>
        </div>
        <div className="stat">
          <p className="stat__label">Avg $</p>
          <p
            className={`stat__value ${stats.avgPnlUsd >= 0 ? "pos" : "neg"}`}
          >
            {formatSignedUsd(stats.avgPnlUsd)}
          </p>
        </div>
      </section>

      <section className="grid-2">
        <ChartRenderer chart={equity} />
        <ChartRenderer chart={winLoss} />
      </section>

      <section style={{ marginTop: "1rem" }}>
        <ChartRenderer chart={bySymbol} />
      </section>

      <section style={{ marginTop: "1rem" }}>
        <PnlCalendar trades={trades} />
      </section>
    </div>
  );
}
