"use client";

import { TradeTable } from "@/components/TradeTable";
import { useTradingStore } from "@/lib/store";
import { computeStats } from "@/lib/stats";

export default function LogsPage() {
  const trades = useTradingStore((s) => s.trades);
  const hydrated = useTradingStore((s) => s.hydrated);
  const stats = computeStats(trades);

  const sorted = [...trades].sort((a, b) => b.date.localeCompare(a.date));

  if (!hydrated) {
    return <div className="page"><p className="empty-note">Loading logs…</p></div>;
  }

  return (
    <div className="page">
      <section className="page-hero">
        <h1>Trading Logs</h1>
        <p>
          Every trade on record. Ask the chat to log a new one — it stays synced
          across dashboard and strategy context.
        </p>
      </section>

      <section className="stat-row">
        <div className="stat">
          <p className="stat__label">Trades</p>
          <p className="stat__value">{stats.totalTrades}</p>
        </div>
        <div className="stat">
          <p className="stat__label">Wins</p>
          <p className="stat__value pos">{stats.wins}</p>
        </div>
        <div className="stat">
          <p className="stat__label">Losses</p>
          <p className="stat__value neg">{stats.losses}</p>
        </div>
        <div className="stat">
          <p className="stat__label">Best / worst</p>
          <p className="stat__value">
            <span className="pos">+{stats.best.toFixed(1)}</span>
            <span style={{ color: "var(--muted)" }}> / </span>
            <span className="neg">{stats.worst.toFixed(1)}R</span>
          </p>
        </div>
      </section>

      <TradeTable trades={sorted} />
    </div>
  );
}
