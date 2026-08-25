"use client";

import { TradeTable } from "@/components/TradeTable";
import { useTradingStore } from "@/lib/store";
import { computeStats } from "@/lib/stats";
import { formatDuration, formatRewardRisk } from "@/lib/trade-format";

export default function LogsPage() {
  const trades = useTradingStore((s) => s.trades);
  const hydrated = useTradingStore((s) => s.hydrated);
  const stats = computeStats(trades);

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
          Every trade on record. Keep the table light, click a row for full
          details, and toggle columns anytime. Hidden rows and missed setups
          stay in the list but drop out of stats.
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
          <p className="stat__label">Avg RR</p>
          <p
            className={`stat__value ${stats.avgR >= 0 ? "pos" : "neg"}`}
          >
            {formatRewardRisk(stats.avgR, true)}
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
      </section>

      <TradeTable trades={trades} />
    </div>
  );
}
