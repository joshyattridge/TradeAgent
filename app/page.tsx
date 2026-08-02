"use client";

import { useState } from "react";
import { ChartRenderer } from "@/components/ChartRenderer";
import { PnlCalendar } from "@/components/PnlCalendar";
import { useTradingStore } from "@/lib/store";
import { buildChart, computeStats, type PerformanceUnit } from "@/lib/stats";

function formatSignedUsd(value: number, digits = 0): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}$${value.toFixed(digits)}`;
}

function formatSignedR(value: number, digits = 1): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}R`;
}

export default function DashboardPage() {
  const trades = useTradingStore((s) => s.trades);
  const hydrated = useTradingStore((s) => s.hydrated);
  const stats = computeStats(trades);
  const [unit, setUnit] = useState<PerformanceUnit>("r");

  const equity = buildChart("equity", trades, undefined, undefined, unit);
  const winLoss = buildChart("winLoss", trades, "Win / loss");
  const bySymbol = buildChart("bySymbol", trades, undefined, undefined, unit);

  if (!hydrated) {
    return <div className="page"><p className="empty-note">Loading book…</p></div>;
  }

  const primary =
    unit === "usd"
      ? {
          label: "$ P&L",
          value: formatSignedUsd(stats.totalPnlUsd),
          positive: stats.totalPnlUsd >= 0,
        }
      : {
          label: "Total R",
          value: formatSignedR(stats.totalR),
          positive: stats.totalR >= 0,
        };

  const secondary =
    unit === "usd"
      ? {
          label: "Total R",
          value: formatSignedR(stats.totalR),
          positive: stats.totalR >= 0,
        }
      : {
          label: "$ P&L",
          value: formatSignedUsd(stats.totalPnlUsd),
          positive: stats.totalPnlUsd >= 0,
        };

  const expectancy =
    unit === "usd"
      ? {
          label: "Avg $",
          value: formatSignedUsd(stats.avgPnlUsd),
          positive: stats.avgPnlUsd >= 0,
        }
      : {
          label: "Expectancy",
          value: `${stats.expectancy >= 0 ? "+" : ""}${stats.expectancy.toFixed(2)}R`,
          positive: stats.expectancy >= 0,
        };

  return (
    <div className="page">
      <section className="page-hero page-hero--split">
        <div>
          <h1>Dashboard</h1>
          <p>
            Progress at a glance — cumulative {unit === "usd" ? "$" : "R"}, hit
            rate, and where your edge is actually printing.
          </p>
        </div>
        <div
          className="unit-toggle"
          role="group"
          aria-label="Performance unit"
        >
          <button
            type="button"
            className={unit === "r" ? "unit-toggle__btn is-active" : "unit-toggle__btn"}
            aria-pressed={unit === "r"}
            onClick={() => setUnit("r")}
          >
            R
          </button>
          <button
            type="button"
            className={unit === "usd" ? "unit-toggle__btn is-active" : "unit-toggle__btn"}
            aria-pressed={unit === "usd"}
            onClick={() => setUnit("usd")}
          >
            $
          </button>
        </div>
      </section>

      <section className="stat-row">
        <div className="stat">
          <p className="stat__label">{primary.label}</p>
          <p className={`stat__value ${primary.positive ? "pos" : "neg"}`}>
            {primary.value}
          </p>
        </div>
        <div className="stat">
          <p className="stat__label">{secondary.label}</p>
          <p className={`stat__value ${secondary.positive ? "pos" : "neg"}`}>
            {secondary.value}
          </p>
        </div>
        <div className="stat">
          <p className="stat__label">Win rate</p>
          <p className="stat__value">{stats.winRate.toFixed(0)}%</p>
        </div>
        <div className="stat">
          <p className="stat__label">{expectancy.label}</p>
          <p className={`stat__value ${expectancy.positive ? "pos" : "neg"}`}>
            {expectancy.value}
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
        <PnlCalendar trades={trades} unit={unit} />
      </section>
    </div>
  );
}
