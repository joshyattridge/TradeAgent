"use client";

import { useEffect } from "react";
import { format, parseISO } from "date-fns";
import { X } from "lucide-react";
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="trade-detail__row">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

export function TradeDetail({
  trade,
  onClose,
}: {
  trade: Trade;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const duration = getTimeInTradeMinutes(trade);
  const slPips = getSlPips(trade);
  const tpPips = getTpPips(trade);
  const pnlClass =
    trade.pnlUsd == null ? "" : trade.pnlUsd >= 0 ? "pos" : "neg";

  return (
    <div className="trade-detail-backdrop" onClick={onClose} role="presentation">
      <aside
        className="trade-detail"
        role="dialog"
        aria-label={`${trade.symbol} trade details`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="trade-detail__header">
          <div>
            <p className="trade-detail__eyebrow">Trade detail</p>
            <h2>
              {trade.symbol}{" "}
              <span className={trade.side === "long" ? "side-long" : "side-short"}>
                {trade.side}
              </span>
            </h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close trade detail"
          >
            <X size={16} />
          </button>
        </header>

        <div className="trade-detail__status">
          <span className={badgeClass(trade.result)}>{trade.result}</span>
          <span className={`mono ${trade.rMultiple >= 0 ? "pos" : "neg"}`}>
            {trade.rMultiple > 0 ? "+" : ""}
            {trade.rMultiple.toFixed(1)}R
          </span>
          <span className={`mono ${pnlClass}`}>{formatPnlUsd(trade.pnlUsd)}</span>
        </div>

        <div className="trade-detail__grid">
          <Row label="Date">{format(parseISO(trade.date), "MMM d, yyyy")}</Row>
          <Row label="Setup">{trade.setup}</Row>
          <Row label="Session">{trade.session ?? "—"}</Row>
          <Row label="Size">{trade.size ?? "—"}</Row>
          <Row label="Entry">
            <span className="mono">{trade.entry}</span>
          </Row>
          <Row label="SL">
            <span className="mono neg">{trade.stop}</span>
          </Row>
          <Row label="TP">
            <span className="mono pos">{trade.target}</span>
          </Row>
          <Row label="Exit">
            <span className="mono">{trade.exit ?? "—"}</span>
          </Row>
          <Row label="SL pips">
            <span className="mono">{formatPips(slPips)}</span>
          </Row>
          <Row label="TP pips">
            <span className="mono">{formatPips(tpPips)}</span>
          </Row>
          <Row label="Entry time">
            <span className="mono">
              {trade.entryTime
                ? format(parseISO(trade.entryTime), "MMM d, HH:mm")
                : "—"}
            </span>
          </Row>
          <Row label="Exit time">
            <span className="mono">
              {trade.exitTime
                ? format(parseISO(trade.exitTime), "MMM d, HH:mm")
                : "—"}
            </span>
          </Row>
          <Row label="Time in trade">
            <span className="mono">{formatDuration(duration)}</span>
          </Row>
          <Row label="Risk $">
            <span className="mono">
              {trade.riskUsd != null ? `$${trade.riskUsd.toFixed(0)}` : "—"}
            </span>
          </Row>
          <Row label="Fees $">
            <span className="mono">
              {trade.feesUsd != null ? `$${trade.feesUsd.toFixed(2)}` : "—"}
            </span>
          </Row>
          <Row label="Clock">
            <span className="mono">
              {formatClock(trade.entryTime)} → {formatClock(trade.exitTime)}
            </span>
          </Row>
        </div>

        {trade.screenshots?.length ? (
          <div className="trade-detail__shots">
            <p className="trade-detail__eyebrow">Screenshots</p>
            <div className="trade-detail__shot-grid">
              {trade.screenshots.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={`${trade.id}-shot-${i}`} src={src} alt={`Trade chart ${i + 1}`} />
              ))}
            </div>
          </div>
        ) : null}

        {trade.notes ? (
          <div className="trade-detail__notes">
            <p className="trade-detail__eyebrow">Notes</p>
            <p>{trade.notes}</p>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
