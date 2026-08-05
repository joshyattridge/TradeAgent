import { normalizeStrategy, strategyNameFromMarkdown } from "@/lib/strategy-md";
import { formatTradeDateTime, normalizeTradeDateTime } from "@/lib/trade-format";
import type { ChartSpec, Strategy, Trade } from "@/lib/types";

export interface ChatActionPayload {
  addTrade?: Omit<Trade, "id"> | Trade;
  addTrades?: Array<Omit<Trade, "id"> | Trade>;
  updateTrade?: { id: string } & Partial<Omit<Trade, "id">>;
  updateTrades?: Array<{ id: string } & Partial<Omit<Trade, "id">>>;
  deleteTradeIds?: string[];
  updateStrategy?: Partial<Strategy>;
  charts?: ChartSpec[];
  /** Screenshots from the current chat turn to attach to a newly logged/updated trade */
  screenshots?: string[];
}

export type ProposalChange =
  | {
      kind: "add";
      trade: Trade;
    }
  | {
      kind: "update";
      id: string;
      before: Trade;
      after: Trade;
      changedKeys: (keyof Trade)[];
    }
  | {
      kind: "delete";
      id: string;
      before: Trade;
    }
  | {
      kind: "strategy";
      before: Strategy;
      after: Strategy;
    };

export type ChatProposal = {
  id: string;
  createdAt: string;
  /** Payload to pass to applyChatActions on Accept */
  actions: ChatActionPayload;
  changes: ProposalChange[];
  summary: string;
};

const TRADE_COMPARE_KEYS: (keyof Trade)[] = [
  "date",
  "symbol",
  "side",
  "setup",
  "entry",
  "stop",
  "target",
  "exit",
  "slPips",
  "tpPips",
  "entryTime",
  "exitTime",
  "timeInTradeMinutes",
  "pnlUsd",
  "riskUsd",
  "size",
  "feesUsd",
  "rMultiple",
  "result",
  "notes",
  "session",
  "tags",
  "screenshots",
  "checklist",
];

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

export function changedTradeKeys(before: Trade, after: Trade): (keyof Trade)[] {
  return TRADE_COMPARE_KEYS.filter((key) => !valuesEqual(before[key], after[key]));
}

export function mergeTradePatch(
  before: Trade,
  patch: Partial<Omit<Trade, "id">>,
): Trade {
  const next: Trade = { ...before };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      (next as unknown as Record<string, unknown>)[key] = value;
    }
  }
  const date = next.date ?? before.date;
  if (typeof next.entryTime === "string" && next.entryTime.trim()) {
    next.entryTime =
      normalizeTradeDateTime(next.entryTime, date) ?? next.entryTime;
  }
  if (typeof next.exitTime === "string" && next.exitTime.trim()) {
    next.exitTime =
      normalizeTradeDateTime(next.exitTime, date) ?? next.exitTime;
  }
  return next;
}

export function mergeStrategyPatch(
  before: Strategy,
  patch: Partial<Strategy>,
): Strategy {
  const merged = normalizeStrategy({
    ...before,
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  });
  if (patch.markdown != null && patch.name == null) {
    merged.name = strategyNameFromMarkdown(patch.markdown, before.name);
  }
  return merged;
}

/** True if actions contain any journal write that needs approval. */
export function hasGatedJournalWrites(actions: ChatActionPayload | null | undefined): boolean {
  if (!actions) return false;
  if (actions.addTrades?.length) return true;
  if (actions.addTrade) return true;
  if (actions.updateTrades?.length) return true;
  if (actions.updateTrade?.id) return true;
  if (actions.deleteTradeIds?.length) return true;
  if (actions.updateStrategy && Object.keys(actions.updateStrategy).length) {
    return true;
  }
  return false;
}

/** Actions that apply immediately (charts only). */
export function chartOnlyActions(actions: ChatActionPayload): ChatActionPayload {
  const next: ChatActionPayload = {};
  if (actions.charts?.length) next.charts = actions.charts;
  return next;
}

/**
 * Split a chat `done` payload into immediate chart applies vs a gated proposal.
 * Used by ChatWidget and covered by unit tests.
 */
export function planChatDone(opts: {
  actions: ChatActionPayload | null | undefined;
  trades: Trade[];
  strategy: Strategy;
  screenshots?: string[];
}): {
  chartActions: ChatActionPayload;
  proposal: ChatProposal | null;
} {
  if (!opts.actions) {
    return { chartActions: {}, proposal: null };
  }
  return {
    chartActions: chartOnlyActions(opts.actions),
    proposal: buildChatProposal({
      actions: opts.actions,
      trades: opts.trades,
      strategy: opts.strategy,
      screenshots: opts.screenshots,
    }),
  };
}

/**
 * Decide how a chat turn should update the pending proposal panel.
 * - New diffs → replace/open proposal
 * - Mutation tools ran but no net diffs vs live journal → clear stale pending
 *   (e.g. refine said "ignore times" and nothing else needs changing)
 */
export function resolvePendingProposalUpdate(opts: {
  actions: ChatActionPayload | null | undefined;
  trades: Trade[];
  strategy: Strategy;
  screenshots?: string[];
}): {
  chartActions: ChatActionPayload;
  nextProposal: ChatProposal | null;
  clearPending: boolean;
} {
  const planned = planChatDone(opts);
  const gated = hasGatedJournalWrites(
    opts.actions
      ? gatedActionsSlice(opts.actions, opts.screenshots)
      : null,
  );
  return {
    chartActions: planned.chartActions,
    nextProposal: planned.proposal,
    clearPending: Boolean(gated && !planned.proposal),
  };
}

/** Journal write slice + screenshots for the proposal Accept path. */
export function gatedActionsSlice(
  actions: ChatActionPayload,
  screenshots?: string[],
): ChatActionPayload {
  const next: ChatActionPayload = {};
  if (actions.addTrades?.length) next.addTrades = actions.addTrades;
  if (actions.addTrade && !actions.addTrades?.length) next.addTrade = actions.addTrade;
  if (actions.updateTrades?.length) next.updateTrades = actions.updateTrades;
  if (actions.updateTrade?.id && !actions.updateTrades?.length) {
    next.updateTrade = actions.updateTrade;
  }
  if (actions.deleteTradeIds?.length) next.deleteTradeIds = actions.deleteTradeIds;
  if (actions.updateStrategy) next.updateStrategy = actions.updateStrategy;
  if (screenshots?.length) next.screenshots = screenshots;
  return next;
}

function asTrade(incoming: Omit<Trade, "id"> | Trade, screenshots?: string[]): Trade {
  const id = "id" in incoming && incoming.id ? incoming.id : `proposed-${crypto.randomUUID()}`;
  const shots = [
    ...(incoming.screenshots ?? []).filter((s) => s && s !== "pending"),
    ...(screenshots ?? []),
  ].slice(0, 2);
  return {
    ...incoming,
    id,
    ...(shots.length ? { screenshots: shots } : { screenshots: undefined }),
  };
}

function summarize(changes: ProposalChange[]): string {
  const parts: string[] = [];
  const adds = changes.filter((c) => c.kind === "add").length;
  const updates = changes.filter((c) => c.kind === "update").length;
  const deletes = changes.filter((c) => c.kind === "delete").length;
  const strategy = changes.some((c) => c.kind === "strategy");
  if (adds) parts.push(`${adds} new trade${adds > 1 ? "s" : ""}`);
  if (updates) parts.push(`${updates} update${updates > 1 ? "s" : ""}`);
  if (deletes) parts.push(`${deletes} delete${deletes > 1 ? "s" : ""}`);
  if (strategy) parts.push("strategy edit");
  return parts.join(" · ");
}

/**
 * Build a reviewable before/after proposal from chat actions + current journal.
 */
export function buildChatProposal(opts: {
  actions: ChatActionPayload;
  trades: Trade[];
  strategy: Strategy;
  screenshots?: string[];
}): ChatProposal | null {
  const gated = gatedActionsSlice(opts.actions, opts.screenshots);
  if (!hasGatedJournalWrites(gated)) return null;

  const byId = new Map(opts.trades.map((t) => [t.id, t]));
  const changes: ProposalChange[] = [];

  const adds: Array<Omit<Trade, "id"> | Trade> = [
    ...(gated.addTrades ?? []),
    ...(gated.addTrade && !gated.addTrades?.length ? [gated.addTrade] : []),
  ];
  for (const incoming of adds) {
    changes.push({ kind: "add", trade: asTrade(incoming, gated.screenshots) });
  }

  const updates: Array<{ id: string } & Partial<Omit<Trade, "id">>> = [
    ...(gated.updateTrades ?? []),
    ...(gated.updateTrade?.id && !gated.updateTrades?.length
      ? [gated.updateTrade]
      : []),
  ];

  // Preview screenshot attach for single-update turns (mirrors applyChatActions)
  const uniqueUpdateIds = [...new Set(updates.map((u) => u.id).filter(Boolean))];
  const attachShots =
    gated.screenshots?.length &&
    !adds.length &&
    uniqueUpdateIds.length === 1
      ? gated.screenshots
      : undefined;

  for (const update of updates) {
    const before = byId.get(update.id);
    if (!before) continue;
    const { id, ...patch } = update;
    let after = mergeTradePatch(before, patch);
    if (attachShots?.length && id === uniqueUpdateIds[0]) {
      after = {
        ...after,
        screenshots: [...(after.screenshots ?? []), ...attachShots]
          .filter((s) => s && s !== "pending")
          .slice(0, 2),
      };
    }
    const keys = changedTradeKeys(before, after);
    if (!keys.length) continue;
    changes.push({ kind: "update", id, before, after, changedKeys: keys });
  }

  for (const id of gated.deleteTradeIds ?? []) {
    const before = byId.get(id);
    if (!before) continue;
    changes.push({ kind: "delete", id, before });
  }

  if (gated.updateStrategy) {
    const after = mergeStrategyPatch(opts.strategy, gated.updateStrategy);
    if (
      after.name !== opts.strategy.name ||
      after.markdown !== opts.strategy.markdown ||
      JSON.stringify(after.checklist) !==
        JSON.stringify(opts.strategy.checklist ?? [])
    ) {
      changes.push({
        kind: "strategy",
        before: opts.strategy,
        after,
      });
    }
  }

  if (!changes.length) return null;

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    actions: gated,
    changes,
    summary: summarize(changes),
  };
}

export type DiffLine = {
  type: "same" | "add" | "remove";
  text: string;
};

/** Tiny line diff for strategy markdown preview (no dependency). */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\r\n/g, "\n").split("\n");
  const b = after.replace(/\r\n/g, "\n").split("\n");
  const n = a.length;
  const m = b.length;
  // LCS DP — fine for strategy docs of typical size
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "remove", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: "remove", text: a[i++] });
  }
  while (j < m) {
    out.push({ type: "add", text: b[j++] });
  }
  return out;
}

export const TRADE_FIELD_LABELS: Partial<Record<keyof Trade, string>> = {
  date: "Date",
  symbol: "Symbol",
  side: "Side",
  setup: "Setup",
  entry: "Entry",
  stop: "Stop",
  target: "Target",
  exit: "Exit",
  slPips: "SL (pips)",
  tpPips: "TP (pips)",
  entryTime: "Entry time",
  exitTime: "Exit time",
  timeInTradeMinutes: "Time in trade",
  pnlUsd: "P&L ($)",
  riskUsd: "Risk ($)",
  size: "Size",
  feesUsd: "Fees (comm+swap $)",
  rMultiple: "R",
  result: "Result",
  notes: "Notes",
  session: "Session",
  tags: "Tags",
  screenshots: "Screenshots",
  checklist: "Checklist",
};

export function formatTradeFieldValue(
  trade: Trade,
  key: keyof Trade,
): string {
  const value = trade[key];
  if (value == null || value === "") return "—";
  if (key === "tags" && Array.isArray(value)) {
    return value.length ? value.join(", ") : "—";
  }
  if (key === "screenshots" && Array.isArray(value)) {
    return value.length ? `${value.length} image${value.length > 1 ? "s" : ""}` : "—";
  }
  if (key === "checklist" && Array.isArray(value)) {
    if (!value.length) return "—";
    return value
      .map((item) => {
        if (
          item &&
          typeof item === "object" &&
          "label" in item &&
          "checked" in item
        ) {
          const answer = item as { label: string; checked: boolean };
          return `${answer.label}: ${answer.checked ? "Done" : "Not done"}`;
        }
        return String(item);
      })
      .join("; ");
  }
  if ((key === "entryTime" || key === "exitTime") && typeof value === "string") {
    return formatTradeDateTime(value, trade.date, "MMM d, yyyy HH:mm:ss");
  }
  if (key === "rMultiple" && typeof value === "number") {
    return `${value > 0 ? "+" : ""}${value.toFixed(2)}R`;
  }
  if (
    (key === "pnlUsd" || key === "riskUsd" || key === "feesUsd") &&
    typeof value === "number"
  ) {
    const sign = value > 0 && key === "pnlUsd" ? "+" : "";
    return `${sign}$${value.toFixed(2)}`;
  }
  if (typeof value === "number") return String(value);
  return String(value);
}

/** Fields to show for a full proposed new trade. */
export const PROPOSED_TRADE_KEYS: (keyof Trade)[] = [
  "date",
  "symbol",
  "side",
  "setup",
  "result",
  "entry",
  "stop",
  "target",
  "exit",
  "rMultiple",
  "pnlUsd",
  "riskUsd",
  "size",
  "feesUsd",
  "session",
  "entryTime",
  "exitTime",
  "slPips",
  "tpPips",
  "notes",
  "tags",
  "screenshots",
  "checklist",
];
