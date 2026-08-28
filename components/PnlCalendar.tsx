"use client";

import { pnlCalendar } from "@/lib/stats";
import type { Trade } from "@/lib/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function formatDayUsd(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}$${value.toFixed(Math.abs(value) >= 100 ? 0 : 2)}`;
}

function formatTradeCount(count: number): string {
  return count === 1 ? "1 trade" : `${count} trades`;
}

function cellTone(hasTrades: boolean, value: number | null): string {
  if (!hasTrades || value === null || value === 0) return "pnl-cal__cell--flat";
  return value > 0 ? "pnl-cal__cell--pos" : "pnl-cal__cell--neg";
}

export function PnlCalendar({
  trades,
  days = 30,
  now,
}: {
  trades: Trade[];
  days?: number;
  now?: Date;
}) {
  const cells = pnlCalendar(trades, days, now ?? new Date());

  return (
    <div className="chart-panel pnl-cal" data-testid="pnl-calendar">
      <div className="chart-panel__head">
        <h3>Last {days} days</h3>
        <p>Daily $ and trade count — green when profitable, red when not</p>
      </div>
      <div className="chart-panel__body">
        <div className="pnl-cal__weekdays" aria-hidden="true">
          {WEEKDAYS.map((d) => (
            <span key={d} className="pnl-cal__weekday">
              {d}
            </span>
          ))}
        </div>
        <div
          className="pnl-cal__grid"
          role="grid"
          aria-label={`Profit calendar for the last ${days} days`}
        >
          {cells.map((cell) => {
            if (!cell.inRange) {
              return (
                <div
                  key={cell.date}
                  className="pnl-cal__cell pnl-cal__cell--pad"
                  aria-hidden="true"
                />
              );
            }

            const tone = cellTone(cell.hasTrades, cell.value);
            const amount =
              cell.hasTrades && cell.value !== null
                ? formatDayUsd(cell.value)
                : "—";
            const countLabel = cell.hasTrades
              ? formatTradeCount(cell.count)
              : null;
            const summary = countLabel ? `${amount}, ${countLabel}` : "no trades";

            return (
              <div
                key={cell.date}
                role="gridcell"
                className={`pnl-cal__cell ${tone}`}
                title={`${cell.label}: ${summary}`}
                aria-label={`${cell.label}: ${summary}`}
              >
                <div className="pnl-cal__meta">
                  <span className="pnl-cal__day">{cell.dayOfMonth}</span>
                  {countLabel ? (
                    <span className="pnl-cal__count">{countLabel}</span>
                  ) : null}
                </div>
                <span className="pnl-cal__amount">{amount}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
