"use client";

import { format, parseISO } from "date-fns";
import type { Trade } from "@/lib/types";
import {
  formatClock,
  formatDuration,
  formatPnlUsd,
  getTimeInTradeMinutes,
} from "@/lib/trade-format";

function badgeClass(result: Trade["result"]) {
  if (result === "win") return "badge badge--win";
  if (result === "loss") return "badge badge--loss";
  if (result === "open") return "badge badge--open";
  return "badge";
}

export function TradeTable({ trades }: { trades: Trade[] }) {
  if (!trades.length) {
    return <p className="empty-note">No trades logged yet. Tell the chat to add one.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="trade-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Setup</th>
            <th>Session</th>
            <th>Size</th>
            <th>Entry</th>
            <th>Exit</th>
            <th>Entry time</th>
            <th>Exit time</th>
            <th>Time in trade</th>
            <th>Risk $</th>
            <th>$ P&amp;L</th>
            <th>R</th>
            <th>Result</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => {
            const duration = getTimeInTradeMinutes(trade);
            const pnlClass =
              trade.pnlUsd == null
                ? ""
                : trade.pnlUsd >= 0
                  ? "pos"
                  : "neg";

            return (
              <tr key={trade.id}>
                <td>{format(parseISO(trade.date), "MMM d, yyyy")}</td>
                <td className="mono">{trade.symbol}</td>
                <td className={trade.side === "long" ? "side-long" : "side-short"}>
                  {trade.side}
                </td>
                <td>{trade.setup}</td>
                <td>{trade.session ?? "—"}</td>
                <td className="mono">{trade.size ?? "—"}</td>
                <td className="mono">{trade.entry}</td>
                <td className="mono">{trade.exit ?? "—"}</td>
                <td className="mono">{formatClock(trade.entryTime)}</td>
                <td className="mono">{formatClock(trade.exitTime)}</td>
                <td className="mono">{formatDuration(duration)}</td>
                <td className="mono">
                  {trade.riskUsd != null ? `$${trade.riskUsd.toFixed(0)}` : "—"}
                </td>
                <td className={`mono ${pnlClass}`}>{formatPnlUsd(trade.pnlUsd)}</td>
                <td className={`mono ${trade.rMultiple >= 0 ? "pos" : "neg"}`}>
                  {trade.rMultiple > 0 ? "+" : ""}
                  {trade.rMultiple.toFixed(1)}R
                </td>
                <td>
                  <span className={badgeClass(trade.result)}>{trade.result}</span>
                </td>
                <td className="notes">{trade.notes ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
