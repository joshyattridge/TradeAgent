import type {
  StrategyChecklistItem,
  TradeChecklistAnswer,
} from "./types";

/** Input shape from chat tools (labels resolved from the strategy). */
export type ChecklistAnswerInput = {
  id: string;
  checked: boolean;
};

export function normalizeStrategyChecklist(
  raw: unknown,
): StrategyChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  const items: StrategyChecklistItem[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const id = typeof (entry as { id?: unknown }).id === "string"
      ? (entry as { id: string }).id.trim()
      : "";
    const label =
      typeof (entry as { label?: unknown }).label === "string"
        ? (entry as { label: string }).label.trim()
        : "";
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    items.push({ id, label });
  }
  return items;
}

export function normalizeTradeChecklist(raw: unknown): TradeChecklistAnswer[] {
  if (!Array.isArray(raw)) return [];
  const items: TradeChecklistAnswer[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const id = typeof (entry as { id?: unknown }).id === "string"
      ? (entry as { id: string }).id.trim()
      : "";
    const label =
      typeof (entry as { label?: unknown }).label === "string"
        ? (entry as { label: string }).label.trim()
        : "";
    const checked = (entry as { checked?: unknown }).checked;
    if (!id || !label || typeof checked !== "boolean" || seen.has(id)) continue;
    seen.add(id);
    items.push({ id, label, checked });
  }
  return items;
}

/**
 * Resolve chat/tool answers against the live strategy checklist.
 * Unknown ids are rejected; labels are snapshotted from the strategy.
 */
export function resolveChecklistAnswers(
  strategyChecklist: StrategyChecklistItem[] | undefined,
  answers: ChecklistAnswerInput[] | undefined,
):
  | { ok: true; checklist: TradeChecklistAnswer[] }
  | { ok: false; error: string; unknownIds: string[] } {
  if (!answers?.length) {
    return { ok: true, checklist: [] };
  }

  const byId = new Map(
    (strategyChecklist ?? []).map((item) => [item.id, item]),
  );
  const unknownIds: string[] = [];
  const resolved: TradeChecklistAnswer[] = [];
  const seen = new Set<string>();

  for (const answer of answers) {
    const id = answer.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const item = byId.get(id);
    if (!item) {
      unknownIds.push(id);
      continue;
    }
    resolved.push({
      id: item.id,
      label: item.label,
      checked: Boolean(answer.checked),
    });
  }

  if (unknownIds.length) {
    return {
      ok: false,
      error: `Unknown checklist id(s): ${unknownIds.join(", ")}. Call get_strategy and use checklist item ids.`,
      unknownIds,
    };
  }

  return { ok: true, checklist: resolved };
}

/** Merge patch answers into existing trade answers (by id). */
export function mergeTradeChecklist(
  existing: TradeChecklistAnswer[] | undefined,
  incoming: TradeChecklistAnswer[],
): TradeChecklistAnswer[] {
  const byId = new Map((existing ?? []).map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

/** Display rows: trade answers + unanswered current strategy items. */
export function checklistDisplayRows(
  strategyChecklist: StrategyChecklistItem[] | undefined,
  tradeChecklist: TradeChecklistAnswer[] | undefined,
): Array<{
  id: string;
  label: string;
  checked: boolean | null;
}> {
  const answers = new Map((tradeChecklist ?? []).map((a) => [a.id, a]));
  const rows: Array<{ id: string; label: string; checked: boolean | null }> =
    [];
  const seen = new Set<string>();

  for (const item of strategyChecklist ?? []) {
    seen.add(item.id);
    const answer = answers.get(item.id);
    rows.push({
      id: item.id,
      label: item.label,
      checked: answer ? answer.checked : null,
    });
  }

  // Orphaned answers from removed strategy items — still show for history.
  for (const answer of tradeChecklist ?? []) {
    if (seen.has(answer.id)) continue;
    rows.push({
      id: answer.id,
      label: answer.label,
      checked: answer.checked,
    });
  }

  return rows;
}

/** Reorder a checklist item by id. Returns the same array if the move is invalid. */
export function reorderChecklistItems<T extends { id: string }>(
  items: T[],
  id: string,
  direction: -1 | 1,
): T[] {
  const index = items.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}
