import { buildChartFromRequest, computeStats } from "@/lib/stats";
import { looksLikeFollowUpUpdate, tradeSnapshot } from "@/lib/chat-context";
import type {
  AddTradeInput,
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
  activeTradeId: string | null;
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
    activeTradeId?: string | null;
    userMessage: string;
    turnHasScreenshots?: boolean;
  }) {
    this.trades = opts.trades.map((t) => ({ ...t }));
    this.strategy = { ...opts.strategy };
    this.activeTradeId = opts.activeTradeId ?? null;
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
    if (
      this.activeTradeId &&
      looksLikeFollowUpUpdate(this.userMessage) &&
      this.trades.some((t) => t.id === this.activeTradeId)
    ) {
      return this.updateTrade({ ...input, id: this.activeTradeId });
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
    this.activeTradeId = trade.id;
    this.addTrades.push(trade);

    return {
      ok: true as const,
      action: "add_trade",
      trade: tradeSnapshot(trade),
      activeTradeId: this.activeTradeId,
      stats: this.getStats(),
      note: "Use this trade.id for further updates. Do not add_trade again for the same position.",
    };
  }

  updateTrade(input: UpdateTradeInput) {
    const existing = this.trades.find((t) => t.id === input.id);
    if (!existing) {
      return {
        ok: false as const,
        error: `No trade found with id ${input.id}`,
        activeTradeId: this.activeTradeId,
        hint: "Use an id from query_trades or a prior add_trade result.",
      };
    }

    const {
      id,
      appendNote,
      appendTags,
      chartExtract,
      notes,
      tags,
      ...rest
    } = input;

    const patch: Partial<Omit<Trade, "id">> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) {
        (patch as Record<string, unknown>)[key] = value;
      }
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
      id,
      ...(this.turnHasScreenshots
        ? {
            screenshots: [...(existing.screenshots ?? []), "pending"].slice(0, 4),
          }
        : {}),
    };

    this.trades = this.trades.map((t) => (t.id === id ? next : t));
    this.activeTradeId = id;
    this.updateTrades.push({ id, ...patch });

    return {
      ok: true as const,
      action: "update_trade",
      trade: tradeSnapshot(next),
      activeTradeId: this.activeTradeId,
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
    if (this.activeTradeId && remove.has(this.activeTradeId)) {
      this.activeTradeId = this.trades[0]?.id ?? null;
    }

    return {
      ok: true as const,
      action: "delete_trade",
      deletedIds: found,
      missingIds: missing.length ? missing : undefined,
      activeTradeId: this.activeTradeId,
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
        activeTradeId: this.activeTradeId,
      };
    }
    return {
      ok: true as const,
      action: "get_trade",
      trade: tradeSnapshot(trade),
      isActive: trade.id === this.activeTradeId,
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
