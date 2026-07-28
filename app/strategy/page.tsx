"use client";

import { format, parseISO } from "date-fns";
import { useTradingStore } from "@/lib/store";

export default function StrategyPage() {
  const strategy = useTradingStore((s) => s.strategy);
  const hydrated = useTradingStore((s) => s.hydrated);

  if (!hydrated) {
    return <div className="page"><p className="empty-note">Loading strategy…</p></div>;
  }

  return (
    <div className="page">
      <section className="strategy-stack">
        <div className="strategy-hero">
          <div className="strategy-hero__meta">
            <span className="pill">v{strategy.version}</span>
            <span className="pill">
              Updated {format(parseISO(strategy.updatedAt), "MMM d, yyyy")}
            </span>
          </div>
          <h1>{strategy.name}</h1>
          <p className="lede">{strategy.summary}</p>
        </div>

        <div className="grid-2">
          <section className="panel">
            <h2>Edge</h2>
            <p style={{ marginTop: "0.75rem", color: "var(--ink-soft)" }}>
              {strategy.edge}
            </p>
            <h3 style={{ marginTop: "1.25rem" }}>How you approach each trade</h3>
            <p style={{ marginTop: "0.5rem", color: "var(--ink-soft)", whiteSpace: "pre-wrap" }}>
              {strategy.approach}
            </p>
          </section>

          <section className="panel">
            <h2>Targets</h2>
            <div className="target-grid" style={{ marginTop: "0.75rem" }}>
              {strategy.targets.map((t) => (
                <div className="target" key={t.metric}>
                  <p>{t.metric}</p>
                  <strong>{t.value}</strong>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="panel">
          <h2>Timeframe stack</h2>
          <div style={{ marginTop: "0.5rem" }}>
            {strategy.timeframes.map((tf) => (
              <div className="tf-row" key={tf.role}>
                <span>{tf.role}</span>
                <strong>{tf.tf}</strong>
                <p>{tf.job}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="grid-2">
          <section className="panel">
            <h2>Rules</h2>
            <div className="rule-list" style={{ marginTop: "0.85rem" }}>
              {strategy.rules.map((rule) => (
                <div className="rule-item" key={rule.title + rule.body.slice(0, 12)}>
                  <h3>{rule.title}</h3>
                  <p>{rule.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Risk</h2>
            <div className="rule-list" style={{ marginTop: "0.85rem" }}>
              {strategy.risk.map((rule) => (
                <div className="rule-item" key={rule.title}>
                  <h3>{rule.title}</h3>
                  <p>{rule.body}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
