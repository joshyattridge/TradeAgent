import { buildChartFromRequest, computeStats } from "@/lib/stats";
import {
  looksLikeFollowUpUpdate,
  normalizeSymbol,
  tradeSnapshot,
} from "@/lib/chat-context";
import type {
  AddTradeInput,
  FindTradeInput,
  QueryTradesInput,
  TradeFilterInput,
  UpdateTradeInput,
} from "@/lib/chat-schemas";
import type {
  ChartExtract,
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

function mergeTags(existing: string[] | undefined, incoming?: string[]) {
  if (!incoming?.length) return existing;
  return [...new Set([...(existing ?? []), ...incoming.map((t) => t.trim()).filter(Boolean)])];
}

function mergeChartExtract(
  existing: ChartExtract | undefined,
  incoming: ChartExtract | undefined,
): ChartExtract | undefined {
  if (!incoming) return existing;
  return {
    ...existing,
    ...incoming,
    levels: { ...existing?.levels, ...incoming.levels },
    setupTags: mergeTags(existing?.setupTags, incoming.setupTags),
    extractedAt: incoming.extractedAt ?? existing?.extractedAt ?? new Date().toISOString(),
  };
}

function appendNotes(existing: string | undefined, append?: string, replace?: string) {
  if (replace !== undefined) return replace;
  if (!append) return existing;
  if (!existing?.trim()) return append;
  return `${existing.trim()}\n${append.trim()}`;
}

function symbolsMatch(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  return normalizeSymbol(a) === normalizeSymbol(b);
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

  if (hints.symbol) {
    if (symbolsMatch(trade.symbol, hints.symbol)) {
      score += 40;
      reasons.push("symbol");
    } else {
      return { score: -1000, reasons: ["symbol mismatch"] };
    }
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
    const hay = `${trade.notes ?? ""} ${(trade.tags ?? []).join(" ")} ${trade.chartExtract?.notes ?? ""}`.toLowerCase();
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
    (!second || best.score - second.score >= 12 || ranked.length === 1);

  return {
    ranked,
    bestMatch: confident ? best : undefined,
  };
}

export function filterTrades(trades: Trade[], filter: TradeFilterInput): Trade[] {
  return trades.filter((t) => {
    if (filter.ids?.length && !filter.ids.includes(t.id)) return false;
    if (filter.symbol && !t.symbol.toUpperCase().includes(filter.symbol.toUpperCase())) {
      return false;
    }
    if (filter.side && t.side !== filter.side) return false;
    if (filter.result && t.result !== filter.result) return false;
    if (filter.setup && !t.setup.toLowerCase().includes(filter.setup.toLowerCase())) {
      return false;
    }
    if (
      filter.session &&
      !(t.session ?? "").toLowerCase().includes(filter.session.toLowerCase())
    ) {
      return false;
    }
    if (filter.dateFrom && t.date < filter.dateFrom) return false;
    if (filter.dateTo && t.date > filter.dateTo) return false;
    if (filter.tags?.length) {
      const tags = new Set((t.tags ?? []).map((x) => x.toLowerCase()));
      if (!filter.tags.every((tag) => tags.has(tag.toLowerCase()))) return false;
    }
    if (filter.text) {
      const q = filter.text.toLowerCase();
      const hay = `${t.notes ?? ""} ${t.setup} ${t.symbol} ${(t.tags ?? []).join(" ")} ${t.chartExtract?.notes ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function sortTrades(trades: Trade[], sort: QueryTradesInput["sort"] = "newest") {
  const copy = [...trades];
  switch (sort) {
    case "oldest":
      return copy.sort((a, b) => a.date.localeCompare(b.date));
    case "bestR":
      return copy.sort((a, b) => b.rMultiple - a.rMultiple);
    case "worstR":
      return copy.sort((a, b) => a.rMultiple - b.rMultiple);
    case "newest":
    default:
      return copy.sort((a, b) => b.date.localeCompare(a.date));
  }
}

/** Mutable journal used while the model calls tools within one request. */
export class JournalSession {
  trades: Trade[];
  strategy: Strategy;
  private readonly userMessage: string;
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
    userMessage: string;
    turnHasScreenshots?: boolean;
  }) {
    this.trades = opts.trades.map((t) => ({ ...t }));
    this.strategy = { ...opts.strategy };
    this.userMessage = opts.userMessage;
    this.turnHasScreenshots = Boolean(opts.turnHasScreenshots);
  }

  getStats(filter?: TradeFilterInput, closedOnly?: boolean) {
    let pool = filter ? filterTrades(this.trades, filter) : this.trades;
    if (closedOnly) pool = pool.filter((t) => t.result !== "open");
    return computeStats(pool);
  }

  toActions(): ChatActions {
    const addTrades = this.addTrades.map(stripScreenshots);
    const updateTrades = [...this.updateTrades];
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

  addTrade(input: AddTradeInput) {
    // Follow-up with details → resolve which existing row to update using hints
    if (looksLikeFollowUpUpdate(this.userMessage)) {
      const { ranked, bestMatch } = rankTradesByHints(this.trades, input, 8);
      if (bestMatch) {
        return this.updateTrade({ ...input, id: bestMatch.trade.id });
      }
      if (ranked.length > 0) {
        return {
          ok: false as const,
          error: `Could not uniquely resolve which ${input.symbol} trade to update. Review candidates and call update_trade with the correct id (or call find_trade with more hints).`,
          candidates: ranked.map((r) => ({
            id: r.trade.id,
            score: r.score,
            matched: r.reasons,
            symbol: r.trade.symbol,
            side: r.trade.side,
            date: r.trade.date,
            result: r.trade.result,
            entry: r.trade.entry,
            stop: r.trade.stop,
            target: r.trade.target,
            exit: r.trade.exit,
            pnlUsd: r.trade.pnlUsd,
            size: r.trade.size,
          })),
        };
      }
    }

    const chartExtract = input.chartExtract
      ? {
          ...input.chartExtract,
          extractedAt:
            input.chartExtract.extractedAt ?? new Date().toISOString(),
        }
      : undefined;

    const trade: Trade = {
      id: uid(),
      date: input.date,
      symbol: input.symbol,
      side: input.side,
      setup: input.setup,
      entry: input.entry,
      stop: input.stop,
      target: input.target,
      rMultiple: input.rMultiple,
      result: input.result,
      exit: input.exit,
      slPips: input.slPips,
      tpPips: input.tpPips,
      entryTime: input.entryTime,
      exitTime: input.exitTime,
      timeInTradeMinutes: input.timeInTradeMinutes,
      pnlUsd: input.pnlUsd,
      riskUsd: input.riskUsd,
      size: input.size,
      feesUsd: input.feesUsd,
      notes: input.notes,
      session: input.session,
      tags: input.tags,
      chartExtract,
      ...(this.turnHasScreenshots ? { screenshots: ["pending"] } : {}),
    };

    this.trades = [trade, ...this.trades];
    this.addTrades.push(trade);

    return {
      ok: true as const,
      action: "add_trade",
      trade: tradeSnapshot(trade),
      stats: this.getStats(),
      note: "Use this trade.id for further updates. Do not add_trade again for the same position.",
    };
  }

  updateTrade(input: UpdateTradeInput) {
    let targetId = input.id;
    let redirectedFrom: string | undefined;
    let existing = this.trades.find((t) => t.id === targetId);

    // Guard: never overwrite EURUSD with AUDUSD fields (etc.)
    if (
      existing &&
      input.symbol &&
      !symbolsMatch(existing.symbol, input.symbol)
    ) {
      const { ranked, bestMatch } = rankTradesByHints(this.trades, input, 8);
      if (bestMatch) {
        redirectedFrom = targetId;
        targetId = bestMatch.trade.id;
        existing = bestMatch.trade;
      } else {
        return {
          ok: false as const,
          error: `Refused to apply ${input.symbol} fields onto ${existing.symbol} (${input.id}). Could not uniquely match a ${input.symbol} trade — pick an id from candidates.`,
          candidates: ranked.map((r) => ({
            id: r.trade.id,
            score: r.score,
            matched: r.reasons,
            symbol: r.trade.symbol,
            side: r.trade.side,
            date: r.trade.date,
            result: r.trade.result,
            entry: r.trade.entry,
            stop: r.trade.stop,
            target: r.trade.target,
            exit: r.trade.exit,
            pnlUsd: r.trade.pnlUsd,
          })),
        };
      }
    }

    // Wrong/missing id but hints uniquely identify a trade
    if (!existing) {
      const { ranked, bestMatch } = rankTradesByHints(this.trades, input, 8);
      if (bestMatch) {
        targetId = bestMatch.trade.id;
        existing = bestMatch.trade;
      } else if (ranked.length) {
        return {
          ok: false as const,
          error: `No trade found with id ${input.id}. Candidates below — call update_trade with the correct id.`,
          candidates: ranked.map((r) => ({
            id: r.trade.id,
            score: r.score,
            matched: r.reasons,
            symbol: r.trade.symbol,
            date: r.trade.date,
            result: r.trade.result,
            entry: r.trade.entry,
          })),
          hint: "Use find_trade with screenshot levels to resolve ambiguity.",
        };
      }
    }

    if (!existing) {
      return {
        ok: false as const,
        error: `No trade found with id ${input.id}`,
        hint: "Call find_trade or query_trades first, then update_trade with that exact id.",
      };
    }

    const {
      id: _id,
      appendNote,
      appendTags,
      chartExtract,
      notes,
      tags,
      ...rest
    } = input;
    void _id;

    const patch: Partial<Omit<Trade, "id">> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) {
        (patch as Record<string, unknown>)[key] = value;
      }
    }
    // Keep the row's real symbol unless explicitly correcting typos on the SAME pair
    if (patch.symbol && !symbolsMatch(existing.symbol, patch.symbol)) {
      delete patch.symbol;
    }

    patch.notes = appendNotes(existing.notes, appendNote, notes);
    if (tags) patch.tags = tags;
    if (appendTags?.length) patch.tags = mergeTags(tags ?? existing.tags, appendTags);
    if (chartExtract) {
      patch.chartExtract = mergeChartExtract(existing.chartExtract, {
        ...chartExtract,
        extractedAt: chartExtract.extractedAt ?? new Date().toISOString(),
      });
    }

    const next: Trade = {
      ...existing,
      ...patch,
      id: targetId,
      symbol: existing.symbol,
      ...(this.turnHasScreenshots
        ? {
            screenshots: [...(existing.screenshots ?? []), "pending"].slice(0, 4),
          }
        : {}),
    };

    this.trades = this.trades.map((t) => (t.id === targetId ? next : t));
    this.updateTrades.push({ id: targetId, ...patch, symbol: existing.symbol });

    return {
      ok: true as const,
      action: "update_trade",
      trade: tradeSnapshot(next),
      redirectedFrom,
      note: redirectedFrom
        ? `Redirected update from ${redirectedFrom} → ${targetId} because symbol ${existing.symbol} did not match the requested id's pair.`
        : undefined,
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
    name?: string;
    version?: string;
    summary?: string;
    edge?: string;
    approach?: string;
    addRule?: { title: string; body: string };
    addRisk?: { title: string; body: string };
  }) {
    const patch: Partial<Strategy> = {};
    for (const key of ["name", "version", "summary", "edge", "approach"] as const) {
      if (input[key] !== undefined) patch[key] = input[key];
    }
    if (input.addRule) {
      patch.rules = [...(this.strategy.rules ?? []), input.addRule];
    }
    if (input.addRisk) {
      patch.risk = [...(this.strategy.risk ?? []), input.addRisk];
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
      ...(patch.rules ? { rules: this.strategy.rules } : {}),
      ...(patch.risk ? { risk: this.strategy.risk } : {}),
    };

    return {
      ok: true as const,
      action: "update_strategy",
      strategy: {
        name: this.strategy.name,
        version: this.strategy.version,
        summary: this.strategy.summary,
        rulesCount: this.strategy.rules?.length ?? 0,
        riskCount: this.strategy.risk?.length ?? 0,
        updatedAt: this.strategy.updatedAt,
      },
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
      charts: built.map((c) => ({
        id: c.id,
        title: c.title,
        type: c.type,
        pointCount: c.data?.length ?? 0,
        samplePoints: (c.data ?? []).slice(0, 5),
      })),
      tradeCountUsed: this.trades.length,
    };
  }

  queryTrades(input: QueryTradesInput) {
    const filtered = filterTrades(this.trades, input);
    const sorted = sortTrades(filtered, input.sort);
    const limit = input.limit ?? 10;
    const slice = sorted.slice(0, limit);
    const openCount = this.trades.filter((t) => t.result === "open").length;
    const closedCount = this.trades.length - openCount;
    return {
      ok: true as const,
      action: "query_trades",
      journal: {
        total: this.trades.length,
        open: openCount,
        closed: closedCount,
      },
      count: filtered.length,
      returned: slice.length,
      trades: slice.map(tradeSnapshot),
      note:
        "journal.total/open/closed is the full book. count/returned are for this filter only. Re-query with result=win|loss|breakeven for closed trades, or omit result for everything.",
    };
  }

  getStatsTool(input: TradeFilterInput & { closedOnly?: boolean }) {
    const { closedOnly, ...filter } = input;
    const filtered = filterTrades(this.trades, filter);
    const pool = closedOnly
      ? filtered.filter((t) => t.result !== "open")
      : filtered;
    const stats = computeStats(pool);
    const openCount = this.trades.filter((t) => t.result === "open").length;
    return {
      ok: true as const,
      action: "get_stats",
      journal: {
        total: this.trades.length,
        open: openCount,
        closed: this.trades.length - openCount,
      },
      matched: filtered.length,
      poolSize: pool.length,
      closedOnly: Boolean(closedOnly),
      stats,
    };
  }

  getStrategy(section: "all" | "summary" | "rules" | "risk" | "targets" | "timeframes" = "all") {
    const s = this.strategy;
    if (section === "summary") {
      return {
        ok: true as const,
        action: "get_strategy",
        section,
        strategy: {
          name: s.name,
          version: s.version,
          summary: s.summary,
          edge: s.edge,
          approach: s.approach,
        },
      };
    }
    if (section === "rules") {
      return { ok: true as const, action: "get_strategy", section, rules: s.rules };
    }
    if (section === "risk") {
      return { ok: true as const, action: "get_strategy", section, risk: s.risk };
    }
    if (section === "targets") {
      return {
        ok: true as const,
        action: "get_strategy",
        section,
        targets: s.targets,
      };
    }
    if (section === "timeframes") {
      return {
        ok: true as const,
        action: "get_strategy",
        section,
        timeframes: s.timeframes,
      };
    }
    return {
      ok: true as const,
      action: "get_strategy",
      section: "all" as const,
      strategy: s,
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
    const { ranked, bestMatch } = rankTradesByHints(this.trades, input, limit);

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
        ? `Best match ${bestMatch.trade.id} (${bestMatch.trade.symbol}). Call update_trade with this id.`
        : "No single confident match — compare candidates to the screenshot and pick an id, or ask the user which one.",
    };
  }

  bulkUpdateTrades(input: {
    ids: string[];
    patch: {
      setup?: string;
      session?: string;
      result?: Trade["result"];
      notes?: string;
      appendNote?: string;
      tags?: string[];
      appendTags?: string[];
      side?: Trade["side"];
    };
  }) {
    const results = input.ids.map((id) => {
      const existing = this.trades.find((t) => t.id === id);
      if (!existing) {
        return { id, ok: false as const, error: "not found" };
      }
      const updated = this.updateTrade({
        id,
        setup: input.patch.setup,
        session: input.patch.session,
        result: input.patch.result,
        notes: input.patch.notes,
        appendNote: input.patch.appendNote,
        tags: input.patch.tags,
        appendTags: input.patch.appendTags,
        side: input.patch.side,
      });
      return {
        id,
        ok: updated.ok,
        error: updated.ok ? undefined : "error" in updated ? updated.error : "failed",
      };
    });

    return {
      ok: true as const,
      action: "bulk_update_trades",
      results,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };
  }

  addTradeNote(input: { id: string; note: string; tags?: string[] }) {
    return this.updateTrade({
      id: input.id,
      appendNote: input.note,
      appendTags: input.tags,
    });
  }

  compareToStrategy(input: TradeFilterInput & { ids?: string[]; limit?: number }) {
    const filtered = filterTrades(this.trades, {
      ...input,
      ids: input.ids,
    });
    const limit = input.limit ?? 5;
    const picks = filtered.slice(0, limit);
    if (!picks.length) {
      return {
        ok: false as const,
        error: "No trades matched for strategy comparison",
      };
    }

    const comparisons = picks.map((trade) => compareTradeToStrategy(trade, this.strategy));
    return {
      ok: true as const,
      action: "compare_to_strategy",
      strategy: {
        name: this.strategy.name,
        version: this.strategy.version,
      },
      comparisons,
    };
  }
}

function compareTradeToStrategy(trade: Trade, strategy: Strategy) {
  const fits: string[] = [];
  const gaps: string[] = [];
  const unclear: string[] = [];

  if (trade.stop != null && trade.entry != null) {
    fits.push("Has defined entry and stop");
  } else {
    gaps.push("Missing entry/stop levels");
  }

  if (trade.target != null) {
    fits.push("Has a target");
  } else {
    gaps.push("No take-profit / target set");
  }

  const sessionHay = `${trade.session ?? ""} ${trade.chartExtract?.sessionGuess ?? ""}`.toLowerCase();
  const wantsSession = /london|new york|ny\b|asian/i.test(
    `${strategy.edge} ${strategy.summary} ${strategy.rules.map((r) => r.body).join(" ")}`,
  );
  if (wantsSession) {
    if (/london|new york|\bny\b|asian/.test(sessionHay)) {
      fits.push(`Session noted: ${trade.session || trade.chartExtract?.sessionGuess}`);
    } else {
      gaps.push("Strategy prefers London/NY — session not recorded");
    }
  }

  const setupHay = `${trade.setup} ${(trade.tags ?? []).join(" ")} ${(trade.chartExtract?.setupTags ?? []).join(" ")}`.toLowerCase();
  const strategySetupHints = strategy.rules
    .map((r) => r.title)
    .concat(strategy.name)
    .join(" ")
    .toLowerCase();
  if (/fvg|fair value|order block|sweep|continuation/.test(strategySetupHints)) {
    if (/fvg|fair value|order block|sweep|continuation|poi|mss|bos/.test(setupHay)) {
      fits.push("Setup labeling aligns with strategy vocabulary");
    } else {
      unclear.push("Setup text does not clearly map to strategy rule names");
    }
  }

  const rrHint = strategy.targets.find((t) => /r:?r|avg r/i.test(t.metric));
  if (rrHint && /2/.test(rrHint.value) && trade.rMultiple < 0 && trade.result === "loss") {
    fits.push("Loss is journaled with R — reviewable against risk plan");
  }
  if (trade.result !== "open" && trade.rMultiple >= 2) {
    fits.push(`Closed at ${trade.rMultiple}R (≥2R target language in plan)`);
  } else if (trade.result === "win" && trade.rMultiple > 0 && trade.rMultiple < 1.5) {
    unclear.push("Win R is below common ≥2R target language — check management");
  }

  if (trade.riskUsd == null && !trade.size) {
    gaps.push("No risk $ or size recorded");
  } else {
    fits.push("Size/risk field present");
  }

  if (!trade.chartExtract && !(trade.screenshots?.length)) {
    unclear.push("No screenshot extract or screenshots on file");
  } else if (trade.chartExtract) {
    fits.push("Has structured chartExtract for follow-ups");
  }

  return {
    tradeId: trade.id,
    symbol: trade.symbol,
    side: trade.side,
    result: trade.result,
    rMultiple: trade.rMultiple,
    fits,
    gaps,
    unclear,
  };
}
