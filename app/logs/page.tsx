"use client";

import { TradeTable } from "@/components/TradeTable";
import { useTradingStore } from "@/lib/store";
import { computeStats } from "@/lib/stats";
import { formatDuration } from "@/lib/trade-format";

export default function LogsPage() {
  const trades = useTradingStore((s) => s.trades);
  const hydrated = useTradingStore((s) => s.hydrated);
  const stats = computeStats(trades);

  const sorted = [...trades].sort((a, b) => {
    const aKey = a.entryTime ?? a.date;
    const bKey = b.entryTime ?? b.date;
    return bKey.localeCompare(aKey);
  });

  if (!hydrated) {
    return (
      <div className="page">
        <p className="empty-note">Loading logs…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="page-hero">
        <h1>Trading Logs</h1>
        <p>
          Every trade on record — times, duration, dollar P&amp;L, and R. Ask the
          chat to log a new one and it stays synced across the app.
        </p>
      </section>

      <section className="stat-row">
        <div className="stat">
          <p className="stat__label">$ P&amp;L</p>
          <p className={`stat__value ${stats.totalPnlUsd >= 0 ? "pos" : "neg"}`}>
            {stats.totalPnlUsd > 0 ? "+" : ""}
            ${stats.totalPnlUsd.toFixed(0)}
          </p>
        </div>
        <div className="stat">
          <p className="stat__label">Wins / losses</p>
          <p className="stat__value">
            <span className="pos">{stats.wins}</span>
            <span style={{ color: "var(--muted)" }}> / </span>
            <span className="neg">{stats.losses}</span>
          </p>
        </div>
        <div className="stat">
          <p className="stat__label">Avg time in trade</p>
          <p className="stat__value" style={{ fontSize: "1.45rem" }}>
            {formatDuration(
              stats.avgTimeInTradeMinutes != null
                ? Math.round(stats.avgTimeInTradeMinutes)
                : undefined,
            )}
          </p>
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
