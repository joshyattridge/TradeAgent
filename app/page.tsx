"use client";

import { ChartRenderer } from "@/components/ChartRenderer";
import { PnlCalendar } from "@/components/PnlCalendar";
import { useTradingStore } from "@/lib/store";
import { buildChart, computeStats, type SampleConfidence } from "@/lib/stats";
import { formatRewardRisk } from "@/lib/trade-format";

function formatSignedUsd(value: number, digits = 0): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}$${value.toFixed(digits)}`;
}

function SampleConfidenceBanner({ confidence }: { confidence: SampleConfidence }) {
  const score =
    confidence.positiveEdgePct == null ? "—" : `${confidence.positiveEdgePct}%`;
  return (
    <section
      className={`sample-confidence sample-confidence--${confidence.level}`}
      aria-label="Sample confidence"
    >
      <div className="sample-confidence__body">
        <div className="sample-confidence__copy">
          <p className="sample-confidence__kicker">Can you trust these numbers?</p>
          <h2>{confidence.title}</h2>
          <p>{confidence.summary}</p>
          {confidence.closedCount > 0 ? (
            <ul className="sample-confidence__facts">
              <li>{confidence.closedCount} closed</li>
              <li>Win rate {confidence.winRateRangeLabel}</li>
              {confidence.avgRangeLabel ? (
                <li>Avg $ {confidence.avgRangeLabel}</li>
              ) : (
                <li>Avg $ range needs 2 trades</li>
              )}
            </ul>
          ) : null}
        </div>
        <div
          className={`sample-confidence__edge sample-confidence__edge--${confidence.edgeTone}`}
        >
          <p className="sample-confidence__kicker">+$ edge</p>
          <p className="sample-confidence__edge-value">{score}</p>
          <p>{confidence.edgeScoreLabel}</p>
        </div>
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const trades = useTradingStore((s) => s.trades);
  const hydrated = useTradingStore((s) => s.hydrated);
  const stats = computeStats(trades);

  const equity = buildChart("equity", trades);
  const winLoss = buildChart("winLoss", trades, "Win / loss");
  const bySymbol = buildChart("bySymbol", trades);
  const lossStreak = buildChart("lossStreak", trades);
  const winWithin = buildChart("winWithin", trades);
  const equityFan = buildChart("equityFan", trades);

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

      <SampleConfidenceBanner confidence={stats.sampleConfidence} />

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
          <p
            className={`stat__value ${stats.avgR >= 0 ? "pos" : "neg"}`}
          >
            {formatRewardRisk(stats.avgR, true)}
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

      <section>
        <ChartRenderer chart={equity} featured />
      </section>

      <section className="grid-2" style={{ marginTop: "1rem" }}>
        <ChartRenderer chart={winLoss} />
        <ChartRenderer chart={bySymbol} />
      </section>

      <section className="grid-2" style={{ marginTop: "1rem" }}>
        <ChartRenderer chart={lossStreak} />
        <ChartRenderer chart={winWithin} />
      </section>

      <section style={{ marginTop: "1rem" }}>
        <ChartRenderer chart={equityFan} />
      </section>

      <section style={{ marginTop: "1rem" }}>
        <PnlCalendar trades={trades} />
      </section>
    </div>
  );
}
