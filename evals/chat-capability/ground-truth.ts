import type { Strategy, Trade, TradeChecklistAnswer } from "@/lib/types";
import type { JournalEnvironment } from "./environments";

/** Planned reward:risk from TP/SL distances (falls back to |target-entry|/|entry-stop|). */
export function plannedRewardRisk(trade: Trade): number | null {
  if (
    typeof trade.tpPips === "number" &&
    typeof trade.slPips === "number" &&
    trade.slPips > 0
  ) {
    return trade.tpPips / trade.slPips;
  }
  const risk = Math.abs(trade.entry - trade.stop);
  const reward = Math.abs(trade.target - trade.entry);
  if (risk <= 0) return null;
  return reward / risk;
}

/** Fraction of strategy checklist items marked checked on the trade (0–1). */
export function checklistCompletion(
  trade: Trade,
  strategy: Strategy,
): number | null {
  const items = strategy.checklist ?? [];
  if (!items.length) return null;
  const answers = new Map((trade.checklist ?? []).map((a) => [a.id, a.checked]));
  let checked = 0;
  for (const item of items) {
    if (answers.get(item.id) === true) checked += 1;
  }
  return checked / items.length;
}

export function checklistCheckedCount(trade: Trade, strategy: Strategy): number {
  const items = strategy.checklist ?? [];
  const answers = new Map((trade.checklist ?? []).map((a) => [a.id, a.checked]));
  return items.filter((item) => answers.get(item.id) === true).length;
}

export function hasChecklistAnswers(trade: Trade) {
  return Boolean(trade.checklist?.length);
}

export function answersFor(
  strategy: Strategy,
  checkedIds: string[],
): TradeChecklistAnswer[] {
  const set = new Set(checkedIds);
  return (strategy.checklist ?? []).map((item) => ({
    id: item.id,
    label: item.label,
    checked: set.has(item.id),
  }));
}

export function filterTradesBy(
  env: JournalEnvironment,
  pred: (t: Trade) => boolean,
) {
  return env.trades.filter(pred);
}

export function closedOnly(trades: Trade[]) {
  return trades.filter((t) => t.result !== "open");
}
