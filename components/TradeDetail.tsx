"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, Trash2, X } from "lucide-react";
import { useTradingStore } from "@/lib/store";
import type { Trade } from "@/lib/types";
import {
  formatDuration,
  formatPips,
  formatPnlUsd,
  formatTradeDateTime,
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

function Row({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`trade-detail__row${wide ? " trade-detail__row--wide" : ""}`}>
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
  const deleteTrade = useTradingStore((s) => s.deleteTrade);
  const setChatReferencedTradeId = useTradingStore(
    (s) => s.setChatReferencedTradeId,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  useEffect(() => {
    setConfirmDelete(false);
  }, [trade.id]);

  const duration = getTimeInTradeMinutes(trade);
  const slPips = getSlPips(trade);
  const tpPips = getTpPips(trade);
  const pnlClass =
    trade.pnlUsd == null ? "" : trade.pnlUsd >= 0 ? "pos" : "neg";

  function onDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    deleteTrade(trade.id);
    onClose();
  }

  function onReferenceInChat() {
    setChatReferencedTradeId(trade.id);
    onClose();
  }

  if (!mounted) return null;

  return createPortal(
    <div className="trade-detail-backdrop" onClick={onClose} role="presentation">
      <aside
        className="trade-detail"
        role="dialog"
        aria-modal="true"
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

        <div className="trade-detail__body">
          <div className="trade-detail__status">
            <span className={badgeClass(trade.result)}>{trade.result}</span>
            <span className={`mono ${trade.rMultiple >= 0 ? "pos" : "neg"}`}>
              {trade.rMultiple > 0 ? "+" : ""}
              {trade.rMultiple.toFixed(1)}R
            </span>
            <span className={`mono ${pnlClass}`}>{formatPnlUsd(trade.pnlUsd)}</span>
          </div>

          <div className="trade-detail__grid">
            <Row label="Session">{trade.session ?? "—"}</Row>
            <Row label="Setup" wide>
              {trade.setup}
            </Row>
            <Row label="Size">{trade.size ?? "—"}</Row>
            <Row label="Risk $">
              <span className="mono">
                {trade.riskUsd != null ? `$${trade.riskUsd.toFixed(0)}` : "—"}
              </span>
            </Row>
            <Row label="Entry">
              <span className="mono">{trade.entry}</span>
            </Row>
            <Row label="Exit">
              <span className="mono">{trade.exit ?? "—"}</span>
            </Row>
            <Row label="SL">
              <span className="mono neg">{trade.stop}</span>
            </Row>
            <Row label="TP">
              <span className="mono pos">{trade.target}</span>
            </Row>
            <Row label="SL pips">
              <span className="mono">{formatPips(slPips)}</span>
            </Row>
            <Row label="TP pips">
              <span className="mono">{formatPips(tpPips)}</span>
            </Row>
            <Row label="Entry time">
              <span className="mono">
                {formatTradeDateTime(trade.entryTime, trade.date)}
              </span>
            </Row>
            <Row label="Exit time">
              <span className="mono">
                {formatTradeDateTime(trade.exitTime, trade.date)}
              </span>
            </Row>
            <Row label="Duration">
              <span className="mono">{formatDuration(duration)}</span>
            </Row>
            <Row label="Fees $">
              <span className="mono">
                {trade.feesUsd != null ? `$${trade.feesUsd.toFixed(2)}` : "—"}
              </span>
            </Row>
          </div>

          {trade.screenshots?.length ? (
            <div className="trade-detail__shots">
              <p className="trade-detail__eyebrow">Screenshots</p>
              <div className="trade-detail__shot-grid">
                {trade.screenshots.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`${trade.id}-shot-${i}`}
                    src={src}
                    alt={`Trade chart ${i + 1}`}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {trade.tags?.length ? (
            <div className="trade-detail__tags">
              <p className="trade-detail__eyebrow">Tags</p>
              <div className="trade-detail__tag-list">
                {trade.tags.map((tag) => (
                  <span className="trade-tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="trade-detail__notes">
            <p className="trade-detail__eyebrow">Notes</p>
            <p>{trade.notes?.trim() ? trade.notes : "No notes yet."}</p>
          </div>
        </div>

        <footer className="trade-detail__actions">
          {confirmDelete ? (
            <>
              <p className="trade-detail__confirm">Delete this trade permanently?</p>
              <button type="button" className="danger-btn" onClick={onDelete}>
                <Trash2 size={14} />
                Confirm delete
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="ghost-btn trade-detail__ref-btn"
                onClick={onReferenceInChat}
              >
                <MessageSquare size={14} />
                Reference in chat
              </button>
              <button type="button" className="danger-btn" onClick={onDelete}>
                <Trash2 size={14} />
                Delete trade
              </button>
            </>
          )}
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
