"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import {
  formatTradeFieldValue,
  lineDiff,
  PROPOSED_TRADE_KEYS,
  TRADE_FIELD_LABELS,
  type ProposalChange,
} from "@/lib/chat-proposals";
import { useTradingStore } from "@/lib/store";
import type { Trade } from "@/lib/types";

function TradeFieldRows({
  trade,
  keys,
  mode,
}: {
  trade: Trade;
  keys: (keyof Trade)[];
  mode: "proposed" | "before" | "after" | "plain";
}) {
  return (
    <div className="proposal-fields">
      {keys.map((key) => {
        if (key === "screenshots") {
          const shots = trade.screenshots?.filter((s) => s && s !== "pending") ?? [];
          return (
            <div className="proposal-field" key={key}>
              <span>Screenshots</span>
              <strong className={`proposal-field__value proposal-field__value--${mode}`}>
                {shots.length ? (
                  <span className="proposal-shots">
                    {shots.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={`${src.slice(0, 24)}-${i}`} src={src} alt="" />
                    ))}
                  </span>
                ) : (
                  "—"
                )}
              </strong>
            </div>
          );
        }
        return (
          <div className="proposal-field" key={key}>
            <span>{TRADE_FIELD_LABELS[key] ?? key}</span>
            <strong className={`proposal-field__value proposal-field__value--${mode}`}>
              {formatTradeFieldValue(trade, key)}
            </strong>
          </div>
        );
      })}
    </div>
  );
}

function ChangeBlock({ change }: { change: ProposalChange }) {
  if (change.kind === "add") {
    const keys = PROPOSED_TRADE_KEYS.filter((key) => {
      const v = change.trade[key];
      if (v == null || v === "") return false;
      if (Array.isArray(v) && !v.length) return false;
      return true;
    });
    return (
      <section className="proposal-change">
        <header className="proposal-change__head">
          <span className="proposal-badge proposal-badge--add">New trade</span>
          <h3>
            {change.trade.symbol}{" "}
            <span className={change.trade.side === "long" ? "side-long" : "side-short"}>
              {change.trade.side}
            </span>
          </h3>
        </header>
        <TradeFieldRows trade={change.trade} keys={keys.length ? keys : ["symbol", "side", "result"]} mode="proposed" />
      </section>
    );
  }

  if (change.kind === "update") {
    return (
      <section className="proposal-change">
        <header className="proposal-change__head">
          <span className="proposal-badge proposal-badge--update">Update</span>
          <h3>
            {change.before.symbol}{" "}
            <span className={change.before.side === "long" ? "side-long" : "side-short"}>
              {change.before.side}
            </span>
          </h3>
          <p className="proposal-change__meta mono">{change.id}</p>
        </header>
        <div className="proposal-diff-grid">
          <div>
            <p className="proposal-col-label">Before</p>
            <TradeFieldRows
              trade={change.before}
              keys={change.changedKeys}
              mode="before"
            />
          </div>
          <div>
            <p className="proposal-col-label">After</p>
            <TradeFieldRows
              trade={change.after}
              keys={change.changedKeys}
              mode="after"
            />
          </div>
        </div>
      </section>
    );
  }

  if (change.kind === "delete") {
    return (
      <section className="proposal-change proposal-change--delete">
        <header className="proposal-change__head">
          <span className="proposal-badge proposal-badge--delete">Delete</span>
          <h3>
            {change.before.symbol}{" "}
            <span className={change.before.side === "long" ? "side-long" : "side-short"}>
              {change.before.side}
            </span>
          </h3>
          <p className="proposal-change__meta">This trade will be removed from the journal.</p>
        </header>
        <TradeFieldRows
          trade={change.before}
          keys={["entryTime", "setup", "result", "rMultiple", "pnlUsd", "notes"]}
          mode="before"
        />
      </section>
    );
  }

  const nameChanged = change.before.name !== change.after.name;
  const mdDiff = lineDiff(change.before.markdown, change.after.markdown);
  const changedOnly = mdDiff.filter((l) => l.type !== "same");
  const showDiff = changedOnly.length ? mdDiff : mdDiff.slice(0, 40);
  const beforeChecklist = change.before.checklist ?? [];
  const afterChecklist = change.after.checklist ?? [];
  const checklistChanged =
    JSON.stringify(beforeChecklist) !== JSON.stringify(afterChecklist);

  return (
    <section className="proposal-change">
      <header className="proposal-change__head">
        <span className="proposal-badge proposal-badge--strategy">Strategy</span>
        <h3>{change.after.name}</h3>
        {nameChanged ? (
          <p className="proposal-change__meta">
            Name: <span className="proposal-field__value--before">{change.before.name}</span>
            {" → "}
            <span className="proposal-field__value--after">{change.after.name}</span>
          </p>
        ) : null}
      </header>
      {checklistChanged ? (
        <div className="proposal-checklist-diff">
          <p className="proposal-change__meta">Checklist</p>
          <p className="proposal-field__value--before">
            {beforeChecklist.length
              ? beforeChecklist.map((item) => item.label).join("; ")
              : "—"}
          </p>
          <p className="proposal-field__value--after">
            {afterChecklist.length
              ? afterChecklist.map((item) => item.label).join("; ")
              : "—"}
          </p>
        </div>
      ) : null}
      <div className="proposal-md-diff" aria-label="Strategy markdown diff">
        {showDiff.map((line, i) => (
          <div
            key={`${line.type}-${i}-${line.text.slice(0, 24)}`}
            className={`proposal-md-line proposal-md-line--${line.type}`}
          >
            <span className="proposal-md-mark">
              {line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}
            </span>
            <code>{line.text || " "}</code>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ProposalReview() {
  const proposal = useTradingStore((s) => s.pendingProposal);
  const open = useTradingStore((s) => s.proposalReviewOpen);
  const accept = useTradingStore((s) => s.acceptPendingProposal);
  const reject = useTradingStore((s) => s.rejectPendingProposal);
  const close = useTradingStore((s) => s.closeProposalReview);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !proposal) return;
    function onKey(e: KeyboardEvent) {
      // Hide panel only — do not Reject. User may still refine via chat.
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, proposal, close]);

  if (!mounted || !proposal || !open) return null;

  return createPortal(
    <div
      className="proposal-backdrop"
      onClick={() => close()}
      role="presentation"
    >
      <aside
        key={proposal.id}
        className="proposal-panel"
        role="dialog"
        aria-modal="false"
        aria-label="Review proposed journal changes"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="proposal-panel__header">
          <div>
            <p className="proposal-panel__eyebrow">Review before saving</p>
            <h2>{proposal.summary}</h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={() => close()}
            aria-label="Hide review panel"
          >
            <X size={16} />
          </button>
        </header>

        <div className="proposal-refine-banner" role="note">
          <strong>Just keep chatting</strong>
          <span>
            Tell TradeAgent what to change (e.g. “ignore the times”, “make it
            2R”) — the proposal updates automatically. Accept when it looks
            right. No need to Reject first.
          </span>
        </div>

        <div className="proposal-panel__body">
          {proposal.changes.map((change, i) => (
            <ChangeBlock
              key={
                change.kind === "strategy"
                  ? `strategy-${i}`
                  : change.kind === "add"
                    ? `add-${change.trade.id}-${i}`
                    : `${change.kind}-${change.id}-${i}`
              }
              change={change}
            />
          ))}
        </div>

        <footer className="proposal-panel__footer">
          <p className="proposal-panel__footer-hint">
            Or keep chatting under this panel to refine
          </p>
          <div className="proposal-panel__footer-actions">
            <button type="button" className="ghost-btn" onClick={() => reject()}>
              Reject
            </button>
            <button type="button" className="primary-btn proposal-accept" onClick={() => accept()}>
              <Check size={16} />
              Accept
            </button>
          </div>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
