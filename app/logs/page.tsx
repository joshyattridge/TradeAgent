"use client";

import { useMemo, useState } from "react";
import { TradeTable } from "@/components/TradeTable";
import { useTradingStore } from "@/lib/store";
import { computeStats, visibleJournalTrades } from "@/lib/stats";
import { formatDuration } from "@/lib/trade-format";

function formatSignedUsd(value: number, digits = 0): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}$${value.toFixed(digits)}`;
}

export default function LogsPage() {
  const trades = useTradingStore((s) => s.trades);
  const hydrated = useTradingStore((s) => s.hydrated);
  const [showHidden, setShowHidden] = useState(false);
  const stats = computeStats(trades);
  const hiddenCount = trades.filter((t) => t.hidden).length;
  const tableTrades = useMemo(
    () => (showHidden ? trades : visibleJournalTrades(trades)),
    [showHidden, trades],
  );

  if (!hydrated) {
    return (
      <div className="page">
        <p className="empty-note">Loading logs…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="page-hero page-hero--split">
        <div>
          <h1>Trading Logs</h1>
          <p>
            Every trade on record. Keep the table light, click a row for full
            details, and toggle columns anytime.
          </p>
        </div>
        {hiddenCount ? (
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setShowHidden((v) => !v)}
            aria-pressed={showHidden}
          >
            {showHidden
              ? "Hide hidden trades"
              : `Show hidden (${hiddenCount})`}
          </button>
        ) : null}
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
            <span className="pos">{formatSignedUsd(stats.best)}</span>
            <span style={{ color: "var(--muted)" }}> / </span>
            <span className="neg">{formatSignedUsd(stats.worst)}</span>
          </p>
        </div>
      </section>

      <TradeTable trades={tableTrades} />
    </div>
  );
}
