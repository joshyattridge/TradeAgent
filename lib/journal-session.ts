import { buildChartFromRequest, computeStats, visibleJournalTrades } from "@/lib/stats";
import { normalizeSymbol, tradeSnapshot } from "@/lib/chat-context";
import type {
  AnnotateTradeInput,
  FindTradeInput,
  LogTradeInput,
  PatchTradeInput,
  QueryTradesInput,
  TradeFilterInput,
} from "@/lib/chat-schemas";
import {
  mergeTradeChecklist,
  normalizeStrategyChecklist,
  resolveChecklistAnswers,
} from "@/lib/checklist";
import {
  markdownForChat,
  normalizeStrategy,
  strategyNameFromMarkdown,
  applyShortStrategyMarkdown,
  isShortStrategySnippet,
} from "@/lib/strategy-md";
import { normalizeTradeDateTime } from "@/lib/trade-format";
import type {
  ChartRequest,
  ChartSpec,
  Strategy,
  Trade,
} from "@/lib/types";

export type ChatActions = {
  addTrades?: Trade[];
  updateTrades?: Array<{ id: string } & Partial<Omit<Trade, "id">>>;
  deleteTradeIds?: string[];
  updateStrategy?: Partial<Strategy>;
  chartRequests?: ChartRequest[];
  charts?: ChartSpec[];
  addTrade?: Trade;
  updateTrade?: { id: string } & Partial<Omit<Trade, "id">>;
};

function uid() {
  return crypto.randomUUID();
}

function stripScreenshots(trade: Trade): Trade {
  const next = { ...trade };
  delete next.screenshots;
  return next;
}

function mergeTags(existing: string[] | undefined, incoming: string[]) {
  return [...new Set([...(existing ?? []), ...incoming.map((t) => t.trim()).filter(Boolean)])];
}

function removeTags(existing: string[] | undefined, toRemove: string[]) {
  if (!existing?.length) return existing;
  const drop = new Set(toRemove.map((t) => t.trim().toLowerCase()).filter(Boolean));
  const next = existing.filter((t) => !drop.has(t.toLowerCase()));
  return next.length ? next : undefined;
}

/** Normalize entry/exit times to ISO so UI clocks don't fall back to 00:00. */
function withNormalizedTimes<T extends { entryTime?: string; exitTime?: string; date?: string }>(
  fields: T,
  fallbackDate?: string,
): T {
  const date = fields.date ?? fallbackDate;
  const next = { ...fields };
  if (typeof fields.entryTime === "string") {
    next.entryTime = normalizeTradeDateTime(fields.entryTime, date) as string;
  }
  if (typeof fields.exitTime === "string") {
    next.exitTime = normalizeTradeDateTime(fields.exitTime, date) as string;
  }
  return next;
}

function appendNotes(existing: string | undefined, append: string) {
  if (!existing?.trim()) return append;
  return `${existing.trim()}\n${append.trim()}`;
}

/** Merge partial trade patches, skipping undefined so later updates cannot wipe fields. */
function mergeDefined<T extends Record<string, unknown>>(
  base: T,
  incoming: Partial<T>,
): T {
  const next = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined) {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}

function symbolsMatch(a?: string | null, b?: string | null) {
  return Boolean(a && b && normalizeSymbol(a) === normalizeSymbol(b));
}

/** Newest-first matches for a symbol in the working journal. */
function findTradesBySymbol(trades: Trade[], symbol: string) {
  const key = normalizeSymbol(symbol);
  return trades.filter((t) => normalizeSymbol(t.symbol) === key);
}

type TradeHints = {
  symbol?: string;
  side?: Trade["side"];
  result?: Trade["result"];
  date?: string;
  entry?: number;
  stop?: number;
  target?: number;
  exit?: number;
  size?: string;
  pnlUsd?: number;
  entryTime?: string;
  exitTime?: string;
  text?: string;
};

function priceClose(a: number | undefined, b: number | undefined, tolRatio = 0.0008) {
  if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) return false;
  const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / scale <= tolRatio || Math.abs(a - b) <= 0.00005;
}

function scoreTradeAgainstHints(trade: Trade, hints: TradeHints, newestIndex: number) {
  let score = 0;
  const reasons: string[] = [];

  if (hints.symbol && symbolsMatch(trade.symbol, hints.symbol)) {
    score += 40;
    reasons.push("symbol");
  }

  if (hints.side && trade.side === hints.side) {
    score += 18;
    reasons.push("side");
  }
  if (hints.result && trade.result === hints.result) {
    score += 18;
    reasons.push("result");
  }
  if (hints.date && trade.date === hints.date) {
    score += 22;
    reasons.push("date");
  }
  if (priceClose(trade.entry, hints.entry)) {
    score += 35;
    reasons.push("entry");
  }
  if (priceClose(trade.stop, hints.stop)) {
    score += 14;
    reasons.push("stop");
  }
  if (priceClose(trade.target, hints.target)) {
    score += 14;
    reasons.push("target");
  }
  if (priceClose(trade.exit, hints.exit)) {
    score += 18;
    reasons.push("exit");
  }
  if (
    hints.pnlUsd != null &&
    trade.pnlUsd != null &&
    Math.abs(trade.pnlUsd - hints.pnlUsd) <= Math.max(1, Math.abs(hints.pnlUsd) * 0.05)
  ) {
    score += 16;
    reasons.push("pnl");
  }
  if (
    hints.size &&
    trade.size &&
    trade.size.toLowerCase().includes(hints.size.toLowerCase().replace(/\s+/g, " ").trim())
  ) {
    score += 10;
    reasons.push("size");
  }
  if (hints.entryTime && trade.entryTime) {
    // Compare clock portion if both look like ISO
    const a = hints.entryTime.slice(11, 16);
    const b = trade.entryTime.slice(11, 16);
    if (a && b && a === b) {
      score += 16;
      reasons.push("entryTime");
    }
  }
  if (hints.exitTime && trade.exitTime) {
    const a = hints.exitTime.slice(11, 16);
    const b = trade.exitTime.slice(11, 16);
    if (a && b && a === b) {
      score += 12;
      reasons.push("exitTime");
    }
  }
  if (hints.text) {
    const q = hints.text.toLowerCase();
    const hay = `${trade.notes ?? ""} ${(trade.tags ?? []).join(" ")}`.toLowerCase();
    if (hay.includes(q)) {
      score += 28;
      reasons.push("text");
    }
  }

  // Prefer newer trades when hints are sparse
  score += Math.max(0, 8 - newestIndex);

  return { score, reasons };
}

function rankTradesByHints(trades: Trade[], hints: TradeHints, limit = 8) {
  const pool = hints.symbol
    ? findTradesBySymbol(trades, hints.symbol)
    : [...trades];

  // Newest first for index bonus
  const newestFirst = [...pool].sort((a, b) => {
    const aKey = a.entryTime ?? a.date;
    const bKey = b.entryTime ?? b.date;
    return bKey.localeCompare(aKey);
  });

  const ranked = newestFirst
    .map((trade, index) => {
      const { score, reasons } = scoreTradeAgainstHints(trade, hints, index);
      return { trade, score, reasons };
    })
    .filter((r) => r.score > -500)
    .sort((a, b) => b.score - a.score || (b.trade.date.localeCompare(a.trade.date)))
    .slice(0, limit);

  const best = ranked[0];
  const second = ranked[1];
  const confident =
    Boolean(best) &&
    best.score >= 50 &&
    (!second || best.score - second.score >= 12);

  return {
    ranked,
    bestMatch: confident ? best : undefined,
  };
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Drop blank/empty/`any` filter args the model often invents when filling the schema. */
export function normalizeTradeFilter(filter: TradeFilterInput = {}): TradeFilterInput {
  const ids = filter.ids?.map((id) => id.trim()).filter(Boolean);
  const tags = filter.tags?.map((tag) => tag.trim()).filter(Boolean);
  const side = filter.side && filter.side !== "any" ? filter.side : undefined;
  const result = filter.result && filter.result !== "any" ? filter.result : undefined;
  return {
    symbol: nonEmptyString(filter.symbol),
    side,
    result,
    session: nonEmptyString(filter.session),
    dateFrom: nonEmptyString(filter.dateFrom),
    dateTo: nonEmptyString(filter.dateTo),
    text: nonEmptyString(filter.text),
    ids: ids?.length ? ids : undefined,
    tags: tags?.length ? tags : undefined,
  };
}

function filterIsActive(filter: TradeFilterInput) {
  return Boolean(
    filter.symbol ||
      filter.side ||
      filter.result ||
      filter.session ||
      filter.dateFrom ||
      filter.dateTo ||
      filter.text ||
      filter.ids?.length ||
      filter.tags?.length,
  );
}

export function filterTrades(trades: Trade[], filter: TradeFilterInput): Trade[] {
  const f = normalizeTradeFilter(filter);
  return trades.filter((t) => {
    if (t.hidden) return false;
    if (f.ids?.length && !f.ids.includes(t.id)) return false;
    if (f.symbol && !t.symbol.toUpperCase().includes(f.symbol.toUpperCase())) {
      return false;
    }
    if (f.side && t.side !== f.side) return false;
    if (f.result && t.result !== f.result) return false;
    if (
      f.session &&
      !(t.session ?? "").toLowerCase().includes(f.session.toLowerCase())
    ) {
      return false;
    }
    if (f.dateFrom && t.date < f.dateFrom) return false;
    if (f.dateTo && t.date > f.dateTo) return false;
    if (f.tags?.length) {
      const tags = new Set((t.tags ?? []).map((x) => x.toLowerCase()));
      if (!f.tags.every((tag) => tags.has(tag.toLowerCase()))) return false;
    }
    if (f.text) {
      const q = f.text.toLowerCase();
      const hay = `${t.notes ?? ""} ${t.symbol} ${(t.tags ?? []).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function pnlSortValue(trade: Trade) {
  return trade.pnlUsd ?? 0;
}

function sortTrades(trades: Trade[], sort: QueryTradesInput["sort"] = "newest") {
  const copy = [...trades];
  switch (sort) {
    case "oldest":
      return copy.sort((a, b) => a.date.localeCompare(b.date));
    case "bestPnl":
    case "bestR":
      return copy.sort((a, b) => pnlSortValue(b) - pnlSortValue(a));
    case "worstPnl":
    case "worstR":
      return copy.sort((a, b) => pnlSortValue(a) - pnlSortValue(b));
    case "newest":
    default:
      return copy.sort((a, b) => b.date.localeCompare(a.date));
  }
}

/** Mutable journal used while the model calls tools within one request. */
export class JournalSession {
  trades: Trade[];
  strategy: Strategy;
  private readonly turnHasScreenshots: boolean;
  private readonly addTrades: Trade[] = [];
  private readonly updateTrades: Array<
    { id: string } & Partial<Omit<Trade, "id">>
  > = [];
  private readonly deleteTradeIds = new Set<string>();
  private updateStrategyPatch: Partial<Strategy> | undefined;
  private readonly chartRequests: ChartRequest[] = [];
  private readonly charts: ChartSpec[] = [];

  constructor(opts: {
    trades: Trade[];
    strategy: Strategy;
    userMessage?: string;
    turnHasScreenshots?: boolean;
  }) {
    this.trades = opts.trades.map((t) => ({ ...t }));
    this.strategy = normalizeStrategy(opts.strategy);
    this.turnHasScreenshots = Boolean(opts.turnHasScreenshots);
  }

  getStats(filter?: TradeFilterInput, closedOnly?: boolean) {
    let pool = filter ? filterTrades(this.trades, filter) : this.trades;
    if (closedOnly) pool = pool.filter((t) => t.result !== "open");
    return computeStats(pool);
  }

  toActions(): ChatActions {
    const addTrades = this.addTrades.map(stripScreenshots);
    // Coalesce multiple patches per id; never let undefined overwrite earlier fields
    const mergedById = new Map<string, { id: string } & Partial<Omit<Trade, "id">>>();
    for (const update of this.updateTrades) {
      const { id, ...rest } = update;
      const prev = mergedById.get(id) ?? { id };
      const { id: _prevId, ...prevRest } = prev;
      void _prevId;
      mergedById.set(id, { id, ...mergeDefined(prevRest, rest) });
    }
    // Prefer the live journal row for fields this patch actually touched.
    // Never attach notes/tags as a side effect of unrelated updates — that was
    // wiping tags when the model only appended a note (and vice versa).
    const updateTrades = [...mergedById.values()].map((patch) => {
      const live = this.trades.find((t) => t.id === patch.id);
      const { screenshots: _s, ...rest } = patch;
      void _s;
      if (!live) return rest;

      const touchedNotes = Object.prototype.hasOwnProperty.call(patch, "notes");
      const touchedTags = Object.prototype.hasOwnProperty.call(patch, "tags");
      const touchedSession = Object.prototype.hasOwnProperty.call(patch, "session");

      return {
        ...rest,
        ...(touchedNotes ? { notes: live.notes } : {}),
        ...(touchedTags ? { tags: live.tags ?? [] } : {}),
        ...(touchedSession ? { session: live.session } : {}),
      };
    });
    const deleteTradeIds = [...this.deleteTradeIds];
    const actions: ChatActions = {};

    if (addTrades.length) {
      actions.addTrades = addTrades;
      actions.addTrade = addTrades[addTrades.length - 1];
    }
    if (updateTrades.length) {
      actions.updateTrades = updateTrades;
      actions.updateTrade = updateTrades[updateTrades.length - 1];
    }
    if (deleteTradeIds.length) actions.deleteTradeIds = deleteTradeIds;
    if (this.updateStrategyPatch) actions.updateStrategy = this.updateStrategyPatch;
    if (this.chartRequests.length) actions.chartRequests = this.chartRequests;
    if (this.charts.length) actions.charts = this.charts;
    return actions;
  }

  /**
   * Create a brand-new trade only. Never updates an existing row.
   * For follow-up details on a logged trade, use patch_trade / annotate_trade with the returned id.
   */
  logTrade(input: LogTradeInput) {
    const times = withNormalizedTimes({
      date: input.date,
      entryTime: input.entryTime,
      exitTime: input.exitTime,
    });

    let checklist = undefined as Trade["checklist"];
    if (input.checklist?.length) {
      const resolved = resolveChecklistAnswers(
        this.strategy.checklist,
        input.checklist,
      );
      if (!resolved.ok) {
        return {
          ok: false as const,
          error: resolved.error,
          unknownIds: resolved.unknownIds,
        };
      }
      checklist = resolved.checklist.length ? resolved.checklist : undefined;
    }

    const trade: Trade = {
      id: uid(),
      date: input.date,
      symbol: input.symbol,
      side: input.side,
      entry: input.entry,
      stop: input.stop,
      target: input.target,
      result: input.result,
      exit: input.exit,
      slPips: input.slPips,
      tpPips: input.tpPips,
      entryTime: times.entryTime,
      exitTime: times.exitTime,
      timeInTradeMinutes: input.timeInTradeMinutes,
      pnlUsd: input.pnlUsd,
      riskUsd: input.riskUsd,
      size: input.size,
      feesUsd: input.feesUsd,
      notes: input.notes,
      session: input.session,
      tags: input.tags,
      checklist,
      ...(this.turnHasScreenshots ? { screenshots: ["pending"] } : {}),
    };

    this.trades = [trade, ...this.trades];
    this.addTrades.push(trade);

    return {
      ok: true as const,
      action: "log_trade",
      trade: tradeSnapshot(trade),
      stats: this.getStats(),
      note: "Use this trade.id with patch_trade / annotate_trade for further changes. Do not log_trade again for the same position.",
    };
  }

  /**
   * Partial field update by exact id. Never touches notes/tags.
   * No silent id redirects — wrong id fails.
   */
  patchTrade(input: PatchTradeInput) {
    const existing = this.trades.find((t) => t.id === input.id);
    if (!existing) {
      return {
        ok: false as const,
        error: `No trade found with id ${input.id}`,
        hint: "Call find_trade or query_trades first, then patch_trade with that exact id.",
      };
    }

    if (input.symbol && !symbolsMatch(existing.symbol, input.symbol)) {
      return {
        ok: false as const,
        error: `Refused to apply ${input.symbol} fields onto ${existing.symbol} (${input.id}). Trade identity is sacred — resolve the correct id with find_trade.`,
      };
    }

    const { id: _id, symbol: _symbol, checklist: checklistInput, ...rest } =
      input;
    void _id;
    void _symbol;

    const patch: Partial<Omit<Trade, "id">> = {};
    for (const [key, value] of Object.entries(rest)) {
      // Empty strings are LLM filler for unused optional fields — never wipe.
      if (value === undefined) continue;
      if (typeof value === "string" && value.trim() === "") continue;
      (patch as Record<string, unknown>)[key] = value;
    }

    // Hard deny: notes/tags/screenshots are never patchable here.
    delete (patch as Record<string, unknown>).notes;
    delete (patch as Record<string, unknown>).tags;
    delete (patch as Record<string, unknown>).screenshots;
    delete (patch as Record<string, unknown>).id;

    if (checklistInput?.length) {
      const resolved = resolveChecklistAnswers(
        this.strategy.checklist,
        checklistInput,
      );
      if (!resolved.ok) {
        return {
          ok: false as const,
          error: resolved.error,
          unknownIds: resolved.unknownIds,
        };
      }
      patch.checklist = mergeTradeChecklist(
        existing.checklist,
        resolved.checklist,
      );
    }

    // Same-pair typo fix only (already validated above)
    if (input.symbol && symbolsMatch(existing.symbol, input.symbol)) {
      patch.symbol = existing.symbol;
    }

    const normalized = withNormalizedTimes(patch, existing.date);
    Object.assign(patch, {
      ...(normalized.entryTime !== undefined ? { entryTime: normalized.entryTime } : {}),
      ...(normalized.exitTime !== undefined ? { exitTime: normalized.exitTime } : {}),
    });

    if (Object.keys(patch).length === 0) {
      return {
        ok: false as const,
        error: "No fields to patch. Pass at least one trade field (notes/tags go through annotate_trade).",
      };
    }

    const next: Trade = {
      ...existing,
      ...patch,
      id: existing.id,
      symbol: existing.symbol,
      notes: existing.notes,
      tags: existing.tags,
      screenshots: existing.screenshots,
    };

    this.trades = this.trades.map((t) => (t.id === existing.id ? next : t));
    this.updateTrades.push({ id: existing.id, ...patch, symbol: existing.symbol });

    return {
      ok: true as const,
      action: "patch_trade",
      trade: tradeSnapshot(next),
      stats: this.getStats(),
      screenshotsPending: this.turnHasScreenshots,
    };
  }

  /**
   * Notes/tags only. Exact id. Append/add/remove preferred; replace* only when requested.
   */
  annotateTrade(input: AnnotateTradeInput) {
    const existing = this.trades.find((t) => t.id === input.id);
    if (!existing) {
      return {
        ok: false as const,
        error: `No trade found with id ${input.id}`,
        hint: "Call find_trade or query_trades first, then annotate_trade with that exact id.",
      };
    }

    const patch: Partial<Omit<Trade, "id">> = {};

    if (input.replaceNotes !== undefined) {
      patch.notes = input.replaceNotes;
    } else if (input.appendNote !== undefined) {
      patch.notes = appendNotes(existing.notes, input.appendNote);
    }

    if (input.replaceTags !== undefined) {
      const cleaned = [
        ...new Set(input.replaceTags.map((t) => t.trim()).filter(Boolean)),
      ];
      patch.tags = cleaned;
    } else {
      let tags = existing.tags;
      if (input.addTags?.length) {
        tags = mergeTags(tags, input.addTags);
      }
      if (input.removeTags?.length) {
        tags = removeTags(tags, input.removeTags);
      }
      if (input.addTags?.length || input.removeTags?.length) {
        patch.tags = tags;
      }
    }

    const next: Trade = {
      ...existing,
      ...patch,
      id: existing.id,
    };

    this.trades = this.trades.map((t) => (t.id === existing.id ? next : t));
    this.updateTrades.push({ id: existing.id, ...patch });

    return {
      ok: true as const,
      action: "annotate_trade",
      trade: tradeSnapshot(next),
      stats: this.getStats(),
    };
  }

  deleteTrade(input: { id?: string; ids?: string[] }) {
    const ids = [
      ...(input.id ? [input.id] : []),
      ...(input.ids ?? []),
    ];
    const unique = [...new Set(ids)];
    const found = unique.filter((id) => this.trades.some((t) => t.id === id));
    const missing = unique.filter((id) => !found.includes(id));
    if (!found.length) {
      return {
        ok: false as const,
        error: "None of the given trade ids exist",
        missing,
      };
    }

    const remove = new Set(found);
    this.trades = this.trades.filter((t) => !remove.has(t.id));
    for (const id of found) this.deleteTradeIds.add(id);

    return {
      ok: true as const,
      action: "delete_trade",
      deletedIds: found,
      missingIds: missing.length ? missing : undefined,
      stats: this.getStats(),
    };
  }

  updateStrategy(input: {
    markdown?: string;
    appendMarkdown?: string;
    name?: string;
    replacements?: Array<{ find: string; replace: string; replaceAll?: boolean }>;
    checklist?: Array<{ id: string; label: string }>;
  }) {
    const patch: Partial<Strategy> = {};
    let nextMarkdown = this.strategy.markdown;
    const applied: string[] = [];

    if (input.replacements?.length) {
      for (const [index, item] of input.replacements.entries()) {
        const find = item.find;
        if (!find) {
          return {
            ok: false as const,
            error: `replacements[${index}].find is empty`,
          };
        }
        const occurrences = nextMarkdown.split(find).length - 1;
        if (occurrences === 0) {
          return {
            ok: false as const,
            error: `replacements[${index}] find text not found in strategy. Call get_strategy and copy the exact substring.`,
            findPreview: find.slice(0, 120),
          };
        }
        if (!item.replaceAll && occurrences > 1) {
          return {
            ok: false as const,
            error: `replacements[${index}] find text matches ${occurrences} times — pass a longer unique snippet or set replaceAll: true.`,
            findPreview: find.slice(0, 120),
          };
        }
        nextMarkdown = item.replaceAll
          ? nextMarkdown.split(find).join(item.replace)
          : nextMarkdown.replace(find, item.replace);
        applied.push(
          item.replaceAll
            ? `replaced all (${occurrences})`
            : "replaced once",
        );
      }
      patch.markdown = nextMarkdown;
    }

    if (input.markdown !== undefined) {
      // Models often pass a short snippet as `markdown` (full replace). Fold it
      // into the existing doc instead of wiping the plan.
      if (isShortStrategySnippet(this.strategy.markdown, input.markdown)) {
        const folded = applyShortStrategyMarkdown(
          nextMarkdown,
          input.markdown,
        );
        nextMarkdown = folded.markdown;
        patch.markdown = nextMarkdown;
        applied.push(folded.mode);
      } else {
        nextMarkdown = input.markdown;
        patch.markdown = nextMarkdown;
        applied.push("full replace");
      }
    }

    if (input.appendMarkdown?.trim()) {
      const append = input.appendMarkdown.trim();
      nextMarkdown = `${nextMarkdown.replace(/\s*$/, "")}\n\n${append}\n`;
      patch.markdown = nextMarkdown;
      applied.push("append");
    }

    if (input.name?.trim()) {
      patch.name = input.name.trim();
    } else if (patch.markdown != null) {
      patch.name = strategyNameFromMarkdown(nextMarkdown, this.strategy.name);
    }

    if (input.checklist !== undefined) {
      patch.checklist = normalizeStrategyChecklist(input.checklist);
      applied.push("checklist");
    }

    if (!Object.keys(patch).length) {
      return { ok: false as const, error: "update_strategy received no valid fields" };
    }

    this.strategy = {
      ...this.strategy,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.updateStrategyPatch = {
      ...(this.updateStrategyPatch ?? {}),
      ...patch,
    };

    return {
      ok: true as const,
      action: "update_strategy",
      strategy: {
        name: this.strategy.name,
        updatedAt: this.strategy.updatedAt,
        markdownChars: this.strategy.markdown.length,
        checklistCount: this.strategy.checklist?.length ?? 0,
      },
      applied,
    };
  }

  generateCharts(charts: ChartRequest[]) {
    const built: ChartSpec[] = [];
    for (const req of charts) {
      const chart = buildChartFromRequest(req, this.trades);
      built.push(chart);
      this.chartRequests.push(req);
      this.charts.push(chart);
    }
    return {
      ok: true as const,
      action: "generate_charts",
      charts: built.map((c) => {
        const data = c.data!;
        return {
          id: c.id,
          title: c.title,
          type: c.type,
          pointCount: data.length,
          samplePoints: data.slice(0, 5),
        };
      }),
      tradeCountUsed: this.trades.length,
    };
  }

  queryTrades(input: QueryTradesInput) {
    const filter = normalizeTradeFilter(input);
    const live = visibleJournalTrades(this.trades);
    const filtered = filterTrades(this.trades, filter);
    const sorted = sortTrades(filtered, input.sort);
    const limit = input.limit ?? 10;
    const slice = sorted.slice(0, limit);
    const openCount = live.filter((t) => t.result === "open").length;
    const closedCount = live.length - openCount;
    const narrowed = filterIsActive(filter);
    const journalStats = computeStats(this.trades);
    return {
      ok: true as const,
      action: "query_trades",
      journal: {
        total: live.length,
        open: openCount,
        closed: closedCount,
      },
      /** Full-book scoreboard — use this for win/loss/$ PnL, not the filtered trades[] slice. */
      journalStats,
      count: filtered.length,
      returned: slice.length,
      trades: slice.map(tradeSnapshot),
      note: narrowed
        ? `Filters are active on trades[] only (matched ${filtered.length}/${live.length}). Performance numbers are in journalStats (full book). Do NOT recount from the filtered slice. To list every row, call again with NO symbol/side/result filters and limit=25.`
        : "Full-book query (no filters). Use journalStats for performance. If returned < count, raise limit (max 25) and call again.",
    };
  }

  getStatsTool(input: { closedOnly?: boolean } = {}) {
    // Intentionally unfilterable — models kept inventing side/result and mis-scoring the book.
    const closedOnly = input.closedOnly !== false;
    const live = visibleJournalTrades(this.trades);
    const pool = closedOnly
      ? live.filter((t) => t.result !== "open")
      : live;
    const stats = computeStats(pool);
    const openCount = live.filter((t) => t.result === "open").length;
    const closedCount = live.length - openCount;
    return {
      ok: true as const,
      action: "get_stats",
      journal: {
        total: live.length,
        open: openCount,
        closed: closedCount,
      },
      matched: live.length,
      poolSize: pool.length,
      closedOnly,
      stats,
      note: "Full-journal stats (filters are not supported on get_stats). Use stats.wins/losses/totalPnlUsd for performance answers.",
    };
  }

  getStrategy(_section: "all" | "summary" | "rules" | "risk" | "targets" | "timeframes" = "all") {
    const s = this.strategy;
    return {
      ok: true as const,
      action: "get_strategy",
      section: "all" as const,
      strategy: {
        name: s.name,
        updatedAt: s.updatedAt,
        markdown: markdownForChat(s.markdown),
        checklist: s.checklist ?? [],
      },
      note: "Full strategy markdown + checklist. Use checklist[].id when logging/patching trade checklist answers. Embedded images are placeholders here; open the Strategy page to view them.",
    };
  }

  getTrade(id: string) {
    const trade = this.trades.find((t) => t.id === id);
    if (!trade) {
      return {
        ok: false as const,
        action: "get_trade",
        error: `No trade found with id ${id}`,
      };
    }
    return {
      ok: true as const,
      action: "get_trade",
      trade: tradeSnapshot(trade),
    };
  }

  /**
   * Rank recent trades against screenshot/message hints so the model can pick
   * the right row even when multiple trades share a symbol.
   */
  findTrade(input: FindTradeInput) {
    const limit = input.limit ?? 8;
    const { ranked, bestMatch } = rankTradesByHints(
      visibleJournalTrades(this.trades),
      input,
      limit,
    );

    if (!ranked.length) {
      return {
        ok: false as const,
        action: "find_trade",
        error: "No matching trades",
        journal: {
          total: this.trades.length,
        },
      };
    }

    return {
      ok: true as const,
      action: "find_trade",
      confident: Boolean(bestMatch),
      bestMatchId: bestMatch?.trade.id,
      bestScore: bestMatch?.score,
      matchedOn: bestMatch?.reasons,
      candidates: ranked.map((r) => ({
        id: r.trade.id,
        score: r.score,
        matched: r.reasons,
        trade: tradeSnapshot(r.trade),
      })),
      note: bestMatch
        ? `Best match ${bestMatch.trade.id} (${bestMatch.trade.symbol}). Call patch_trade or annotate_trade with this id.`
        : "No single confident match — compare candidates to the screenshot and pick an id, or ask the user which one.",
    };
  }

}
