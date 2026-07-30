"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from "lucide-react";
import { TradeDetail } from "@/components/TradeDetail";
import {
  TRADE_COLUMNS,
  type TradeColumnId,
} from "@/lib/trade-columns";
import { useTradingStore } from "@/lib/store";
import type { Trade } from "@/lib/types";
import {
  formatClock,
  formatDuration,
  formatPips,
  formatPnlUsd,
  formatTradeDate,
  getSlPips,
  getTimeInTradeMinutes,
  getTpPips,
  parseTradeDateTime,
} from "@/lib/trade-format";

type SortDir = "asc" | "desc";

function badgeClass(result: Trade["result"]) {
  if (result === "win") return "badge badge--win";
  if (result === "loss") return "badge badge--loss";
  if (result === "open") return "badge badge--open";
  return "badge";
}

/**
 * Build a reliable millisecond timestamp for sorting.
 * Handles ISO datetimes, date-only YYYY-MM-DD, and time-only HH:mm[:ss]
 * (combined with the trade's calendar date).
 */
function toSortTimestamp(
  raw: string | undefined,
  fallbackDate?: string,
): number | null {
  const d = parseTradeDateTime(raw, fallbackDate);
  return d ? d.getTime() : null;
}

/** Date/time sort key: entry datetime when present, else calendar date. */
function tradeDateTimeKey(trade: Trade): number | null {
  return (
    toSortTimestamp(trade.entryTime, trade.date) ??
    toSortTimestamp(trade.date)
  );
}

function cellValue(trade: Trade, column: TradeColumnId) {
  switch (column) {
    case "date":
      return formatTradeDate(trade.date);
    case "symbol":
      return <span className="mono">{trade.symbol}</span>;
    case "side":
      return (
        <span className={trade.side === "long" ? "side-long" : "side-short"}>
          {trade.side}
        </span>
      );
    case "setup":
      return trade.setup;
    case "session":
      return trade.session ?? "—";
    case "size":
      return <span className="mono">{trade.size ?? "—"}</span>;
    case "entry":
      return <span className="mono">{trade.entry}</span>;
    case "stop":
      return <span className="mono neg">{trade.stop}</span>;
    case "target":
      return <span className="mono pos">{trade.target}</span>;
    case "slPips":
      return <span className="mono">{formatPips(getSlPips(trade))}</span>;
    case "tpPips":
      return <span className="mono">{formatPips(getTpPips(trade))}</span>;
    case "exit":
      return <span className="mono">{trade.exit ?? "—"}</span>;
    case "entryTime":
      return (
        <span className="mono">{formatClock(trade.entryTime, trade.date)}</span>
      );
    case "exitTime":
      return (
        <span className="mono">{formatClock(trade.exitTime, trade.date)}</span>
      );
    case "timeInTrade":
      return (
        <span className="mono">
          {formatDuration(getTimeInTradeMinutes(trade))}
        </span>
      );
    case "riskUsd":
      return (
        <span className="mono">
          {trade.riskUsd != null ? `$${trade.riskUsd.toFixed(0)}` : "—"}
        </span>
      );
    case "pnlUsd": {
      const pnlClass =
        trade.pnlUsd == null ? "" : trade.pnlUsd >= 0 ? "pos" : "neg";
      return <span className={`mono ${pnlClass}`}>{formatPnlUsd(trade.pnlUsd)}</span>;
    }
    case "rMultiple":
      return (
        <span className={`mono ${trade.rMultiple >= 0 ? "pos" : "neg"}`}>
          {trade.rMultiple > 0 ? "+" : ""}
          {trade.rMultiple.toFixed(1)}R
        </span>
      );
    case "result":
      return <span className={badgeClass(trade.result)}>{trade.result}</span>;
    case "screenshots":
      return trade.screenshots?.length ? (
        <span className="trade-shot-stack">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={trade.screenshots[0]} alt="" />
          {trade.screenshots.length > 1 ? (
            <span className="trade-shot-stack__count">
              +{trade.screenshots.length - 1}
            </span>
          ) : null}
        </span>
      ) : (
        "—"
      );
    case "tags":
      return trade.tags?.length ? (
        <span className="trade-tag-row">
          {trade.tags.map((tag) => (
            <span className="trade-tag" key={tag}>
              {tag}
            </span>
          ))}
        </span>
      ) : (
        "—"
      );
    case "notes":
      return <span className="notes">{trade.notes ?? "—"}</span>;
  }
}

/** Comparable value for sorting a column. null = missing (sorted last). */
function sortValue(
  trade: Trade,
  column: TradeColumnId,
): string | number | null {
  switch (column) {
    case "date":
      return tradeDateTimeKey(trade);
    case "symbol":
      return trade.symbol.toUpperCase();
    case "side":
      return trade.side;
    case "setup":
      return trade.setup.toLowerCase();
    case "session":
      return (trade.session ?? "").toLowerCase() || null;
    case "size":
      return (trade.size ?? "").toLowerCase() || null;
    case "entry":
      return trade.entry;
    case "stop":
      return trade.stop;
    case "target":
      return trade.target;
    case "slPips":
      return getSlPips(trade) ?? null;
    case "tpPips":
      return getTpPips(trade) ?? null;
    case "exit":
      return trade.exit ?? null;
    case "entryTime":
      return toSortTimestamp(trade.entryTime, trade.date);
    case "exitTime":
      return toSortTimestamp(trade.exitTime, trade.date);
    case "timeInTrade":
      return getTimeInTradeMinutes(trade) ?? null;
    case "riskUsd":
      return trade.riskUsd ?? null;
    case "pnlUsd":
      return trade.pnlUsd ?? null;
    case "rMultiple":
      return trade.rMultiple;
    case "result":
      return trade.result;
    case "screenshots":
      return trade.screenshots?.length ?? 0;
    case "tags":
      return (trade.tags ?? []).join(", ").toLowerCase() || null;
    case "notes":
      return (trade.notes ?? "").toLowerCase() || null;
  }
}

function compareSortValues(
  a: string | number | null,
  b: string | number | null,
  dir: SortDir,
): number {
  const mul = dir === "asc" ? 1 : -1;
  if (a == null && b == null) return 0;
  if (a == null) return 1; // missing always last
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") {
    return (a - b) * mul;
  }
  return (
    String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: "base",
    }) * mul
  );
}

function SortIcon({
  active,
  dir,
}: {
  active: boolean;
  dir: SortDir;
}) {
  if (!active) return <ArrowUpDown size={12} className="sort-icon sort-icon--idle" />;
  if (dir === "asc") return <ArrowUp size={12} className="sort-icon" />;
  return <ArrowDown size={12} className="sort-icon" />;
}

export function TradeTable({ trades }: { trades: Trade[] }) {
  const visibleTradeColumns = useTradingStore((s) => s.visibleTradeColumns);
  const toggleTradeColumn = useTradingStore((s) => s.toggleTradeColumn);
  const resetTradeColumns = useTradingStore((s) => s.resetTradeColumns);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [sortColumn, setSortColumn] = useState<TradeColumnId>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const visible = useMemo(
    () => TRADE_COLUMNS.filter((c) => visibleTradeColumns.includes(c.id)),
    [visibleTradeColumns],
  );

  const sortedTrades = useMemo(() => {
    return [...trades].sort((a, b) => {
      const primary = compareSortValues(
        sortValue(a, sortColumn),
        sortValue(b, sortColumn),
        sortDir,
      );
      if (primary !== 0) return primary;
      // Tie-break: newest datetime, then id for stability
      const byTime = compareSortValues(
        tradeDateTimeKey(a),
        tradeDateTimeKey(b),
        "desc",
      );
      if (byTime !== 0) return byTime;
      return a.id.localeCompare(b.id);
    });
  }, [trades, sortColumn, sortDir]);

  const selected = sortedTrades.find((t) => t.id === selectedId) ?? null;

  function onSort(column: TradeColumnId) {
    if (sortColumn === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      // Date/time defaults to newest first; most other columns start ascending
      setSortDir(column === "date" || column === "entryTime" || column === "exitTime" ? "desc" : "asc");
    }
  }

  if (!trades.length) {
    return <p className="empty-note">No trades logged yet. Tell the chat to add one.</p>;
  }

  return (
    <div className="trade-log">
      <div className="trade-log__toolbar">
        <p className="trade-log__hint">
          Click a column header to sort · click a row for details
        </p>
        <div className="trade-log__column-wrap">
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setColumnsOpen((v) => !v)}
            aria-expanded={columnsOpen}
          >
            <Columns3 size={14} style={{ marginRight: 6, verticalAlign: "-2px" }} />
            Columns
          </button>
          {columnsOpen ? (
            <div className="column-picker" role="menu">
              <p className="column-picker__title">Visible columns</p>
              {TRADE_COLUMNS.map((col) => {
                const checked = visibleTradeColumns.includes(col.id);
                return (
                  <label key={col.id} className="column-picker__item">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTradeColumn(col.id)}
                    />
                    <span>{col.label}</span>
                  </label>
                );
              })}
              <button
                type="button"
                className="advanced-link"
                onClick={() => resetTradeColumns()}
              >
                Reset defaults
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="table-wrap">
        <table className="trade-table trade-table--interactive">
          <thead>
            <tr>
              {visible.map((col) => {
                const active = sortColumn === col.id;
                return (
                  <th key={col.id} aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                    <button
                      type="button"
                      className={`th-sort${active ? " is-active" : ""}`}
                      onClick={() => onSort(col.id)}
                    >
                      <span>{col.label}</span>
                      <SortIcon active={active} dir={sortDir} />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedTrades.map((trade) => (
              <tr
                key={trade.id}
                tabIndex={0}
                className={selectedId === trade.id ? "is-selected" : undefined}
                onClick={() => setSelectedId(trade.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(trade.id);
                  }
                }}
              >
                {visible.map((col) => (
                  <td key={col.id}>{cellValue(trade, col.id)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected ? (
        <TradeDetail trade={selected} onClose={() => setSelectedId(null)} />
      ) : null}
    </div>
  );
}
