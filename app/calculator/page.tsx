"use client";

import { useMemo } from "react";
import {
  CALCULATOR_SYMBOLS,
  CALCULATOR_SYMBOL_LABELS,
  calculatePositionSize,
  calculatorStopField,
  calculatorStopUnit,
  defaultRiskUsd,
  needsConversionQuote,
  slSizeToStopPips,
} from "@/lib/position-size";
import { useTradingStore } from "@/lib/store";

function parseNum(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function formatStopSize(
  symbol: (typeof CALCULATOR_SYMBOLS)[number],
  stopPips: number,
  stopDistance: number,
): string {
  const unit = calculatorStopUnit(symbol);
  if (unit === "price") return `$${stopDistance.toFixed(2)}`;
  if (unit === "points") return `${stopPips} points`;
  return `${stopPips} pips`;
}

export default function CalculatorPage() {
  const hydrated = useTradingStore((s) => s.hydrated);
  const trades = useTradingStore((s) => s.trades);
  const symbol = useTradingStore((s) => s.calculator.symbol);
  const slSize = useTradingStore((s) => s.calculator.slSize);
  const quote = useTradingStore((s) => s.calculator.quote);
  const risk = useTradingStore((s) => s.calculator.risk);
  const setCalculatorDraft = useTradingStore((s) => s.setCalculatorDraft);

  const riskPlaceholder = String(defaultRiskUsd(trades));
  const stopField = calculatorStopField(symbol);
  const needsQuote = needsConversionQuote(symbol);

  const result = useMemo(() => {
    const slN = parseNum(slSize);
    const quoteN = parseNum(quote);
    const riskN = parseNum(risk) ?? parseNum(riskPlaceholder);
    if (slN == null || riskN == null) return null;
    if (needsQuote && quoteN == null) return null;
    return calculatePositionSize({
      symbol,
      riskUsd: riskN,
      stopPips: slSizeToStopPips(symbol, slN),
      entry: needsQuote ? quoteN : undefined,
    });
  }, [symbol, slSize, quote, risk, riskPlaceholder, needsQuote]);

  if (!hydrated) {
    return (
      <div className="page page--calc">
        <p className="empty-note">Loading calculator…</p>
      </div>
    );
  }

  return (
    <div className="page page--calc">
      <article className="calc-card">
        <header className="calc-card__hero">
          <p className="calc-card__kicker">Calculator</p>
          <h1>Position size</h1>
          <p>
            Risk a fixed dollar amount against your stop size. FX uses pips,
            gold uses dollars of price, NAS100 uses index points.
          </p>
        </header>

        <div className="calc-grid">
          <label className="field calc-grid__full">
            <span className="field__label">Symbol</span>
            <select
              value={symbol}
              onChange={(e) =>
                setCalculatorDraft({
                  symbol: e.target.value as (typeof CALCULATOR_SYMBOLS)[number],
                })
              }
              aria-label="Symbol"
            >
              {CALCULATOR_SYMBOLS.map((s) => (
                <option key={s} value={s}>
                  {CALCULATOR_SYMBOL_LABELS[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Risk $</span>
            <input
              type="text"
              inputMode="decimal"
              value={risk}
              onChange={(e) => setCalculatorDraft({ risk: e.target.value })}
              placeholder={riskPlaceholder}
              aria-label="Risk dollars"
            />
          </label>

          <label className="field">
            <span className="field__label">{stopField.label}</span>
            <input
              type="text"
              inputMode="decimal"
              value={slSize}
              onChange={(e) => setCalculatorDraft({ slSize: e.target.value })}
              aria-label={stopField.ariaLabel}
            />
          </label>

          {needsQuote ? (
            <label className="field calc-grid__full">
              <span className="field__label">Quote</span>
              <input
                type="text"
                inputMode="decimal"
                value={quote}
                onChange={(e) => setCalculatorDraft({ quote: e.target.value })}
                placeholder={symbol}
                aria-label="Quote"
              />
            </label>
          ) : null}
        </div>

        {result == null ? (
          <p className="calc-card__hint empty-note">
            {needsQuote
              ? `Enter ${symbol} quote and stop size to size the trade. Risk defaults to $${riskPlaceholder} if left blank.`
              : `Enter stop size to size the trade. Risk defaults to $${riskPlaceholder} if left blank.`}
          </p>
        ) : result.ok ? (
          <section className="calc-result" aria-label="Position size result">
            <p className="calc-result__kicker">Size</p>
            <p className="calc-result__size">{result.sizeLabel}</p>
            <dl className="calc-result__meta">
              <div>
                <dt>Stop</dt>
                <dd>
                  {formatStopSize(symbol, result.stopPips, result.stopDistance)}
                </dd>
              </div>
              <div>
                <dt>Pip value</dt>
                <dd>${result.pipValue.toFixed(2)}</dd>
              </div>
              <div>
                <dt>Rounded risk</dt>
                <dd>${result.potentialLossRounded.toFixed(2)}</dd>
              </div>
            </dl>
            <ul className="calc-notes">
              {result.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
              <li>
                Exact size {result.lots.toFixed(4)} {result.sizeUnit}. Brokers
                usually step {result.sizeUnit} in 0.01.
              </li>
            </ul>
          </section>
        ) : (
          <p className="settings-backup-error calc-card__error">{result.error}</p>
        )}
      </article>
    </div>
  );
}
