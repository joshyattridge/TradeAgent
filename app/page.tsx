"use client";

import { ChartRenderer } from "@/components/ChartRenderer";
import { useTradingStore } from "@/lib/store";
import { buildChart, computeStats } from "@/lib/stats";

export default function DashboardPage() {
  const trades = useTradingStore((s) => s.trades);
  const hydrated = useTradingStore((s) => s.hydrated);
  const stats = computeStats(trades);

  const equity = buildChart("equity", trades, "Equity curve");
  const winLoss = buildChart("winLoss", trades, "Win / loss");
  const bySymbol = buildChart("bySymbol", trades, "R by symbol");

  if (!hydrated) {
    return <div className="page"><p className="empty-note">Loading book…</p></div>;
  }

  return (
    <div className="page">
      <section className="page-hero">
        <h1>Dashboard</h1>
        <p>
          Progress at a glance — cumulative R, hit rate, and where your edge is
          actually printing.
        </p>
      </section>

      <section className="stat-row">
        <div className="stat">
          <p className="stat__label">Total R</p>
          <p className={`stat__value ${stats.totalR >= 0 ? "pos" : "neg"}`}>
            {stats.totalR > 0 ? "+" : ""}
            {stats.totalR.toFixed(1)}R
          </p>
        </div>
        <div className="stat">
          <p className="stat__label">$ P&amp;L</p>
          <p className={`stat__value ${stats.totalPnlUsd >= 0 ? "pos" : "neg"}`}>
            {stats.totalPnlUsd > 0 ? "+" : ""}
            ${stats.totalPnlUsd.toFixed(0)}
          </p>
        </div>
        <div className="stat">
          <p className="stat__label">Win rate</p>
          <p className="stat__value">{stats.winRate.toFixed(0)}%</p>
        </div>
        <div className="stat">
          <p className="stat__label">Expectancy</p>
          <p className={`stat__value ${stats.expectancy >= 0 ? "pos" : "neg"}`}>
            {stats.expectancy >= 0 ? "+" : ""}
            {stats.expectancy.toFixed(2)}R
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
    </div>
  );
}
