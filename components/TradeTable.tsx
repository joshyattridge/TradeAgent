"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Eye, EyeOff, MessageSquare } from "lucide-react";
import { TradeDetail } from "@/components/TradeDetail";
import {
  TRADE_COLUMNS,
  type TradeColumnId,
} from "@/lib/trade-columns";
import { useTradingStore } from "@/lib/store";
import type { Trade } from "@/lib/types";
import {
  formatDuration,
  formatPips,
  formatPnlUsd,
  formatTradeDate,
  formatTradeDateTime,
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
        <span className="mono">
          {trade.entryTime
            ? formatTradeDateTime(trade.entryTime, trade.date)
            : formatTradeDate(trade.date)}
        </span>
      );
    case "exitTime":
      return (
        <span className="mono">
          {formatTradeDateTime(trade.exitTime, trade.date)}
        </span>
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
      return <ClampedTags tags={trade.tags} />;
    case "notes":
      return <ClampedNotes notes={trade.notes} />;
  }
}

function ClampedNotes({ notes }: { notes?: string }) {
  const text = notes?.trim();
  if (!text) return <span className="notes notes--empty">—</span>;
  return (
    <span className="notes notes--clamp" title="Click row to read full notes">
      {text}
    </span>
  );
}

function ClampedTags({ tags }: { tags?: string[] }) {
  if (!tags?.length) return <span className="trade-tag-row trade-tag-row--empty">—</span>;
  const visible = tags.slice(0, 2);
  const overflow = tags.length - visible.length;
  return (
    <span
      className="trade-tag-row trade-tag-row--clamp"
      title={
        overflow > 0
          ? `${tags.join(", ")} — click row for all tags`
          : "Click row for details"
      }
    >
      {visible.map((tag) => (
        <span className="trade-tag" key={tag}>
          {tag}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="trade-tag trade-tag--more">+{overflow}</span>
      ) : null}
    </span>
  );
}

/** Comparable value for sorting a column. null = missing (sorted last). */
export function sortValue(
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

export function compareSortValues(
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
  const addChatReferencedTradeId = useTradingStore(
    (s) => s.addChatReferencedTradeId,
  );
  const hideTrade = useTradingStore((s) => s.hideTrade);
  const unhideTrade = useTradingStore((s) => s.unhideTrade);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [sortColumn, setSortColumn] = useState<TradeColumnId>("entryTime");
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

  function onReferenceTrade(id: string) {
    addChatReferencedTradeId(id);
  }

  function onToggleHidden(id: string, hidden: boolean | undefined) {
    if (hidden) unhideTrade(id);
    else hideTrade(id);
  }

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
          Click the chat bubble to reference a trade · click a row for details · hide greys the row and keeps it out of stats
        </p>
        <div className="trade-log__toolbar-actions">
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
      </div>

      <div className="table-wrap">
        <table className="trade-table trade-table--interactive">
          <thead>
            <tr>
              <th className="trade-table__chat" aria-label="Reference in chat" />
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
                className={[
                  "trade-table__row",
                  selectedId === trade.id ? "is-selected" : "",
                  trade.hidden ? "is-hidden-trade" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setSelectedId(trade.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(trade.id);
                  }
                }}
              >
                <td className="trade-table__chat">
                  <button
                    type="button"
                    className="trade-table__icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReferenceTrade(trade.id);
                    }}
                    aria-label={`Reference ${trade.symbol} in chat`}
                    title="Reference in chat"
                  >
                    <MessageSquare size={14} />
                  </button>
                  <button
                    type="button"
                    className="trade-table__icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleHidden(trade.id, trade.hidden);
                    }}
                    aria-label={
                      trade.hidden
                        ? `Unhide ${trade.symbol} trade`
                        : `Hide ${trade.symbol} trade`
                    }
                    title={trade.hidden ? "Unhide trade" : "Hide trade"}
                  >
                    {trade.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                </td>
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
