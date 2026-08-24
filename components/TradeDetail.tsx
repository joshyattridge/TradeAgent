"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { Check, Eye, EyeOff, MessageSquare, Trash2, X } from "lucide-react";
import { checklistDisplayRows } from "@/lib/checklist";
import { useTradingStore } from "@/lib/store";
import type { Trade, TradeResult, TradeSide } from "@/lib/types";
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

function parseOptionalNumber(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function numberInputValue(value: number | undefined): string {
  return value == null || !Number.isFinite(value) ? "" : String(value);
}

export function TradeDetail({
  trade: tradeProp,
  onClose,
}: {
  trade: Trade;
  onClose: () => void;
}) {
  const deleteTrade = useTradingStore((s) => s.deleteTrade);
  const updateTrade = useTradingStore((s) => s.updateTrade);
  const hideTrade = useTradingStore((s) => s.hideTrade);
  const unhideTrade = useTradingStore((s) => s.unhideTrade);
  const strategyChecklist = useTradingStore((s) => s.strategy.checklist);
  const liveTrade = useTradingStore((s) =>
    s.trades.find((t) => t.id === tradeProp.id),
  );
  const trade = liveTrade ?? tradeProp;
  const addChatReferencedTradeId = useTradingStore(
    (s) => s.addChatReferencedTradeId,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState((trade.tags ?? []).join(", "));
  const [notesDraft, setNotesDraft] = useState(trade.notes ?? "");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (lightboxSrc) {
        setLightboxSrc(null);
        return;
      }
      onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, lightboxSrc]);

  useEffect(() => {
    setConfirmDelete(false);
    setLightboxSrc(null);
    setTagDraft((trade.tags ?? []).join(", "));
    setNotesDraft(trade.notes ?? "");
  }, [trade.id]);

  useEffect(() => {
    setTagDraft((trade.tags ?? []).join(", "));
  }, [trade.tags]);

  useEffect(() => {
    setNotesDraft(trade.notes ?? "");
  }, [trade.notes]);

  const duration = getTimeInTradeMinutes(trade);
  const slPips = getSlPips(trade);
  const tpPips = getTpPips(trade);
  const pnlClass =
    trade.pnlUsd == null ? "" : trade.pnlUsd >= 0 ? "pos" : "neg";

  const checklistRows = checklistDisplayRows(
    strategyChecklist,
    trade.checklist,
  );
  const doneCount = checklistRows.filter((row) => row.checked === true).length;

  function commit(patch: Partial<Trade>) {
    updateTrade(trade.id, patch);
  }

  function onTextBlur(key: keyof Trade, raw: string, current: string | undefined) {
    const next = raw.trim();
    const prev = current?.trim() ?? "";
    if (next === prev) return;
    commit({ [key]: next || undefined } as Partial<Trade>);
  }

  function onNumberBlur(
    key: keyof Trade,
    raw: string,
    current: number | undefined,
  ) {
    const parsed = parseOptionalNumber(raw);
    if (parsed === current) return;
    if (raw.trim() && parsed == null) return;
    commit({ [key]: parsed } as Partial<Trade>);
  }

  function onRequiredNumberBlur(key: keyof Trade, raw: string, current: number) {
    const parsed = parseOptionalNumber(raw);
    if (parsed == null || parsed === current) return;
    commit({ [key]: parsed } as Partial<Trade>);
  }

  function toggleChecklistDone(id: string, label: string, done: boolean) {
    const byId = new Map(
      (trade.checklist ?? []).map((item) => [item.id, item]),
    );
    if (done) {
      byId.set(id, { id, label, checked: true });
    } else {
      byId.delete(id);
    }
    updateTrade(trade.id, { checklist: [...byId.values()] });
  }

  function onDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    deleteTrade(trade.id);
    onClose();
  }

  function onReferenceInChat() {
    addChatReferencedTradeId(trade.id);
    onClose();
  }

  function onSaveTags() {
    const tags = tagDraft
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const current = trade.tags ?? [];
    if (tags.join("\0") === current.join("\0")) return;
    commit({ tags: tags.length ? tags : undefined });
  }

  function onSaveNotes() {
    const next = notesDraft.trim();
    const prev = trade.notes?.trim() ?? "";
    if (next === prev) return;
    commit({ notes: next || undefined });
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
            <h2 className="trade-detail__title-edit">
              <input
                className="trade-detail__input trade-detail__input--title"
                aria-label="Symbol"
                defaultValue={trade.symbol}
                key={`${trade.id}-symbol`}
                onBlur={(e) => onTextBlur("symbol", e.target.value, trade.symbol)}
              />
              <select
                className="trade-detail__input trade-detail__input--select"
                aria-label="Side"
                value={trade.side}
                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                  commit({ side: e.target.value as TradeSide })
                }
              >
                <option value="long">long</option>
                <option value="short">short</option>
              </select>
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
            <select
              className={`trade-detail__input trade-detail__input--select ${badgeClass(trade.result)}`}
              aria-label="Result"
              value={trade.result}
              onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                commit({ result: e.target.value as TradeResult })
              }
            >
              <option value="win">win</option>
              <option value="loss">loss</option>
              <option value="breakeven">breakeven</option>
              <option value="open">open</option>
            </select>
            <span className={`mono ${pnlClass}`}>{formatPnlUsd(trade.pnlUsd)}</span>
          </div>

          <div className="trade-detail__grid">
            <Row label="Date">
              <input
                className="trade-detail__input"
                aria-label="Date"
                defaultValue={trade.date}
                key={`${trade.id}-date`}
                onBlur={(e) => onTextBlur("date", e.target.value, trade.date)}
              />
            </Row>
            <Row label="Session">
              <input
                className="trade-detail__input"
                aria-label="Session"
                defaultValue={trade.session ?? ""}
                key={`${trade.id}-session`}
                onBlur={(e) => onTextBlur("session", e.target.value, trade.session)}
              />
            </Row>
            <Row label="Size">
              <input
                className="trade-detail__input"
                aria-label="Size"
                defaultValue={trade.size ?? ""}
                key={`${trade.id}-size`}
                onBlur={(e) => onTextBlur("size", e.target.value, trade.size)}
              />
            </Row>
            <Row label="Risk $">
              <input
                className="trade-detail__input mono"
                aria-label="Risk $"
                inputMode="decimal"
                defaultValue={numberInputValue(trade.riskUsd)}
                key={`${trade.id}-riskUsd`}
                onBlur={(e) => onNumberBlur("riskUsd", e.target.value, trade.riskUsd)}
              />
            </Row>
            <Row label="Entry">
              <input
                className="trade-detail__input mono"
                aria-label="Entry"
                inputMode="decimal"
                defaultValue={numberInputValue(trade.entry)}
                key={`${trade.id}-entry`}
                onBlur={(e) => onRequiredNumberBlur("entry", e.target.value, trade.entry)}
              />
            </Row>
            <Row label="Exit">
              <input
                className="trade-detail__input mono"
                aria-label="Exit"
                inputMode="decimal"
                defaultValue={numberInputValue(trade.exit)}
                key={`${trade.id}-exit`}
                onBlur={(e) => onNumberBlur("exit", e.target.value, trade.exit)}
              />
            </Row>
            <Row label="SL">
              <input
                className="trade-detail__input mono"
                aria-label="SL"
                inputMode="decimal"
                defaultValue={numberInputValue(trade.stop)}
                key={`${trade.id}-stop`}
                onBlur={(e) => onRequiredNumberBlur("stop", e.target.value, trade.stop)}
              />
            </Row>
            <Row label="TP">
              <input
                className="trade-detail__input mono"
                aria-label="TP"
                inputMode="decimal"
                defaultValue={numberInputValue(trade.target)}
                key={`${trade.id}-target`}
                onBlur={(e) =>
                  onRequiredNumberBlur("target", e.target.value, trade.target)
                }
              />
            </Row>
            <Row label="SL pips">
              <input
                className="trade-detail__input mono"
                aria-label="SL pips"
                inputMode="decimal"
                defaultValue={numberInputValue(slPips)}
                key={`${trade.id}-slPips-${trade.slPips ?? "x"}`}
                onBlur={(e) => onNumberBlur("slPips", e.target.value, trade.slPips)}
              />
            </Row>
            <Row label="TP pips">
              <input
                className="trade-detail__input mono"
                aria-label="TP pips"
                inputMode="decimal"
                defaultValue={numberInputValue(tpPips)}
                key={`${trade.id}-tpPips-${trade.tpPips ?? "x"}`}
                onBlur={(e) => onNumberBlur("tpPips", e.target.value, trade.tpPips)}
              />
            </Row>
            <Row label="Entry time">
              <input
                className="trade-detail__input mono"
                aria-label="Entry time"
                defaultValue={trade.entryTime ?? ""}
                key={`${trade.id}-entryTime`}
                onBlur={(e) =>
                  onTextBlur("entryTime", e.target.value, trade.entryTime)
                }
              />
            </Row>
            <Row label="Exit time">
              <input
                className="trade-detail__input mono"
                aria-label="Exit time"
                defaultValue={trade.exitTime ?? ""}
                key={`${trade.id}-exitTime`}
                onBlur={(e) =>
                  onTextBlur("exitTime", e.target.value, trade.exitTime)
                }
              />
            </Row>
            <Row label="Duration">
              <input
                className="trade-detail__input mono"
                aria-label="Duration minutes"
                inputMode="numeric"
                defaultValue={numberInputValue(trade.timeInTradeMinutes ?? duration)}
                key={`${trade.id}-duration`}
                onBlur={(e) =>
                  onNumberBlur(
                    "timeInTradeMinutes",
                    e.target.value,
                    trade.timeInTradeMinutes,
                  )
                }
              />
            </Row>
            <Row label="Fees $ (comm+swap)">
              <input
                className="trade-detail__input mono"
                aria-label="Fees $"
                inputMode="decimal"
                defaultValue={numberInputValue(trade.feesUsd)}
                key={`${trade.id}-feesUsd`}
                onBlur={(e) => onNumberBlur("feesUsd", e.target.value, trade.feesUsd)}
              />
            </Row>
            <Row label="$ P&L" wide>
              <input
                className="trade-detail__input mono"
                aria-label="$ P&L"
                inputMode="decimal"
                defaultValue={numberInputValue(trade.pnlUsd)}
                key={`${trade.id}-pnlUsd`}
                onBlur={(e) => onNumberBlur("pnlUsd", e.target.value, trade.pnlUsd)}
              />
            </Row>
          </div>
          <p className="trade-detail__hint">
            {formatPips(slPips)} SL · {formatPips(tpPips)} TP ·{" "}
            {formatDuration(duration)}
            {trade.entryTime
              ? ` · ${formatTradeDateTime(trade.entryTime, trade.date)}`
              : ""}
          </p>

          {checklistRows.length ? (
            <div className="trade-detail__checklist">
              <div className="trade-detail__checklist-head">
                <p className="trade-detail__eyebrow">Checklist</p>
                <span className="trade-detail__checklist-score">
                  {doneCount}/{checklistRows.length} done
                </span>
              </div>
              <ul className="trade-detail__checklist-list">
                {checklistRows.map((row) => {
                  const done = row.checked === true;
                  return (
                    <li key={row.id}>
                      <label
                        className={`trade-detail__checklist-item${done ? " trade-detail__checklist-item--done" : ""}`}
                      >
                        <span
                          className={`trade-detail__checklist-mark${done ? " trade-detail__checklist-mark--done" : ""}`}
                          aria-hidden
                        >
                          {done ? <Check size={14} strokeWidth={2.5} /> : null}
                        </span>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={done}
                          onChange={(e) =>
                            toggleChecklistDone(
                              row.id,
                              row.label,
                              e.target.checked,
                            )
                          }
                        />
                        <span className="trade-detail__checklist-label">
                          {row.label}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {trade.screenshots?.length ? (
            <div className="trade-detail__shots">
              <p className="trade-detail__eyebrow">Screenshots</p>
              <div className="trade-detail__shot-grid">
                {trade.screenshots.map((src, i) => (
                  <button
                    type="button"
                    className="trade-detail__shot-btn"
                    key={`${trade.id}-shot-${i}`}
                    onClick={() => setLightboxSrc(src)}
                    aria-label={`View trade chart ${i + 1} full screen`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Trade chart ${i + 1}`} />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="trade-detail__tags">
            <p className="trade-detail__eyebrow">Tags</p>
            <input
              className="trade-detail__input"
              aria-label="Tags"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onBlur={onSaveTags}
              placeholder="comma, separated, tags"
            />
          </div>

          <div className="trade-detail__notes">
            <p className="trade-detail__eyebrow">Notes</p>
            <textarea
              className="trade-detail__input trade-detail__notes-input"
              aria-label="Notes"
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={onSaveNotes}
              rows={4}
              placeholder="No notes yet."
            />
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
              <button
                type="button"
                className="ghost-btn"
                onClick={() =>
                  trade.hidden ? unhideTrade(trade.id) : hideTrade(trade.id)
                }
              >
                {trade.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                {trade.hidden ? "Unhide trade" : "Hide trade"}
              </button>
              <button type="button" className="danger-btn" onClick={onDelete}>
                <Trash2 size={14} />
                Delete trade
              </button>
            </>
          )}
        </footer>
      </aside>
      {lightboxSrc ? (
        <div
          className="trade-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Screenshot"
          onClick={() => setLightboxSrc(null)}
        >
          <button
            type="button"
            className="trade-lightbox__close"
            aria-label="Close screenshot"
            onClick={() => setLightboxSrc(null)}
          >
            <X size={18} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxSrc}
            alt="Trade screenshot"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
