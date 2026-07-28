"use client";

import { useMemo, useState } from "react";
import { Columns3 } from "lucide-react";
import { format, parseISO } from "date-fns";
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
  getSlPips,
  getTimeInTradeMinutes,
  getTpPips,
} from "@/lib/trade-format";

function badgeClass(result: Trade["result"]) {
  if (result === "win") return "badge badge--win";
  if (result === "loss") return "badge badge--loss";
  if (result === "open") return "badge badge--open";
  return "badge";
}

function cellValue(trade: Trade, column: TradeColumnId) {
  switch (column) {
    case "date":
      return format(parseISO(trade.date), "MMM d, yyyy");
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
      return <span className="mono">{formatClock(trade.entryTime)}</span>;
    case "exitTime":
      return <span className="mono">{formatClock(trade.exitTime)}</span>;
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
    case "notes":
      return <span className="notes">{trade.notes ?? "—"}</span>;
  }
}

export function TradeTable({ trades }: { trades: Trade[] }) {
  const visibleTradeColumns = useTradingStore((s) => s.visibleTradeColumns);
  const toggleTradeColumn = useTradingStore((s) => s.toggleTradeColumn);
  const resetTradeColumns = useTradingStore((s) => s.resetTradeColumns);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);

  const visible = useMemo(
    () => TRADE_COLUMNS.filter((c) => visibleTradeColumns.includes(c.id)),
    [visibleTradeColumns],
  );

  const selected = trades.find((t) => t.id === selectedId) ?? null;

  if (!trades.length) {
    return <p className="empty-note">No trades logged yet. Tell the chat to add one.</p>;
  }

  return (
    <div className="trade-log">
      <div className="trade-log__toolbar">
        <p className="trade-log__hint">Click a row for full trade details</p>
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
              {visible.map((col) => (
                <th key={col.id}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
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
