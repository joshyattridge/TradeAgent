import { generateText, type LanguageModel } from "ai";
import type { ChartExtract, Strategy, Trade } from "@/lib/types";

export const RECENT_HISTORY_COUNT = 6;
export const HISTORY_FOLD_THRESHOLD = 2;
export const RELEVANT_TRADES_LIMIT = 10;
export const TRADE_INDEX_LIMIT = 80;
export const MAX_REATTACH_SCREENSHOTS = 2;

export type HistoryMessage = {
  role: "user" | "assistant" | string;
  content: string;
};

export type TradeSnapshot = {
  id: string;
  date: string;
  symbol: string;
  side: Trade["side"];
  setup: string;
  entry: number;
  stop: number;
  target: number;
  exit?: number;
  slPips?: number;
  tpPips?: number;
  entryTime?: string;
  exitTime?: string;
  timeInTradeMinutes?: number;
  pnlUsd?: number;
  riskUsd?: number;
  size?: string;
  feesUsd?: number;
  rMultiple: number;
  result: Trade["result"];
  session?: string;
  notes?: string;
  tags?: string[];
  chartExtract?: ChartExtract;
  hasScreenshots: boolean;
};

export type ChatContextPack = {
  /** Pointer only — full strategy/trades are loaded via tools */
  tradeCount: number;
  strategyName: string | null;
  conversationSummary: string;
  reattachedScreenshotCount: number;
  /** One-turn UI pin from trade detail → chat (not a persistent active trade). */
  referencedTradeId: string | null;
};

export function tradeSnapshot(trade: Trade): TradeSnapshot {
  return {
    id: trade.id,
    date: trade.date,
    symbol: trade.symbol,
    side: trade.side,
    setup: trade.setup,
    entry: trade.entry,
    stop: trade.stop,
    target: trade.target,
    exit: trade.exit,
    slPips: trade.slPips,
    tpPips: trade.tpPips,
    entryTime: trade.entryTime,
    exitTime: trade.exitTime,
    timeInTradeMinutes: trade.timeInTradeMinutes,
    pnlUsd: trade.pnlUsd,
    riskUsd: trade.riskUsd,
    size: trade.size,
    feesUsd: trade.feesUsd,
    rMultiple: trade.rMultiple,
    result: trade.result,
    session: trade.session,
    notes: trade.notes,
    tags: trade.tags,
    chartExtract: trade.chartExtract,
    hasScreenshots: Boolean(
      trade.screenshots?.some((s) => s && s !== "pending"),
    ),
  };
}

export function looksLikeFollowUpUpdate(message: string) {
  return /(update|lost|loss|won|win|closed|close it|fix|change|correct|actually|reflect|make it|set (it|the)|pnl|p&l|-\s*\$?\d|result|duplicate|remove|delete|keep the)/i.test(
    message,
  );
}

export function normalizeSymbol(symbol: string) {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Symbols from the journal that appear as whole tokens in the message. */
export function mentionedJournalSymbols(message: string, trades: Trade[]) {
  const found = new Set<string>();
  for (const symbol of new Set(trades.map((t) => t.symbol).filter(Boolean))) {
    const token = normalizeSymbol(symbol);
    if (token.length < 2) continue;
    const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(message)) found.add(symbol);
  }
  return [...found];
}

function truncate(text: string, max: number) {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

export function buildStrategyDigest(strategy: Strategy) {
  return {
    name: strategy.name,
    version: strategy.version,
    summary: truncate(strategy.summary, 320),
    edge: truncate(strategy.edge, 280),
    approach: truncate(strategy.approach, 280),
    timeframes: strategy.timeframes.map(
      (tf) => `${tf.role} ${tf.tf}: ${truncate(tf.job, 80)}`,
    ),
    rules: strategy.rules.map((r) => `${r.title}: ${truncate(r.body, 140)}`),
    risk: strategy.risk.map((r) => `${r.title}: ${truncate(r.body, 120)}`),
    targets: strategy.targets.map((t) => `${t.metric}: ${t.value}`),
  };
}

export function buildTradeIndexLine(trade: Trade) {
  const pnl =
    trade.pnlUsd != null ? ` $${trade.pnlUsd}` : "";
  return `${trade.id} | ${trade.date} | ${trade.symbol} | ${trade.side} | ${trade.result} | ${trade.rMultiple}R${pnl} | ${trade.setup}${trade.session ? ` | ${trade.session}` : ""}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractMentionedSymbols(message: string, trades: Trade[]) {
  const known = [...new Set(trades.map((t) => t.symbol).filter(Boolean))];
  const found = new Set<string>();
  const upper = message.toUpperCase();

  for (const symbol of known) {
    const token = symbol.toUpperCase();
    if (token.length < 2) continue;
    const re = new RegExp(`\\b${escapeRegExp(token)}\\b`, "i");
    if (re.test(message)) found.add(symbol);
  }

  // Common futures / FX / crypto aliases not necessarily in the book yet
  const aliases = upper.match(
    /\b(?:NQ|MNQ|ES|MES|YM|RTY|GC|CL|BTC(?:USD)?|ETH(?:USD)?|EURUSD|GBPUSD|USDJPY|XAUUSD|SPX|NDX)\b/g,
  );
  if (aliases) {
    for (const a of aliases) {
      const match = known.find((s) => s.toUpperCase() === a || s.toUpperCase().includes(a));
      if (match) found.add(match);
      else found.add(a);
    }
  }

  return found;
}

function extractMentionedDates(message: string) {
  const dates = new Set<string>();
  for (const m of message.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)) {
    dates.add(m[1]);
  }
  return dates;
}

function extractSetupHints(message: string) {
  const hints: string[] = [];
  const lower = message.toLowerCase();
  const patterns = [
    "fvg",
    "fair value gap",
    "order block",
    "ob",
    "bos",
    "mss",
    "liquidity",
    "sweep",
    "continuation",
    "reversal",
    "london",
    "new york",
    "ny",
    "asian",
    "session",
  ];
  for (const p of patterns) {
    if (lower.includes(p)) hints.push(p);
  }
  return hints;
}

function scoreTrade(
  trade: Trade,
  opts: {
    symbols: Set<string>;
    dates: Set<string>;
    setupHints: string[];
    wantsLosses: boolean;
    wantsWins: boolean;
    wantsOpen: boolean;
    queryTokens: string[];
  },
) {
  let score = 0;

  const sym = trade.symbol.toUpperCase();
  for (const s of opts.symbols) {
    if (sym === s.toUpperCase() || sym.includes(s.toUpperCase())) score += 40;
  }

  if (opts.dates.has(trade.date)) score += 35;

  const hay = `${trade.setup} ${trade.session ?? ""} ${trade.notes ?? ""}`.toLowerCase();
  for (const hint of opts.setupHints) {
    if (hay.includes(hint)) score += 12;
  }

  if (opts.wantsLosses && trade.result === "loss") score += 15;
  if (opts.wantsWins && trade.result === "win") score += 15;
  if (opts.wantsOpen && trade.result === "open") score += 20;

  for (const token of opts.queryTokens) {
    if (token.length < 3) continue;
    if (hay.includes(token) || trade.id.toLowerCase().includes(token)) {
      score += 6;
    }
  }

  return score;
}

/**
 * Pick trades relevant to the user message instead of stuffing the newest N.
 */
export function selectRelevantTrades(
  trades: Trade[],
  userMessage: string,
  limit = RELEVANT_TRADES_LIMIT,
): { trades: Trade[]; notes: string[] } {
  if (!trades.length) return { trades: [], notes: ["No trades in log."] };

  const symbols = extractMentionedSymbols(userMessage, trades);
  const dates = extractMentionedDates(userMessage);
  const setupHints = extractSetupHints(userMessage);
  const wantsLosses = /\b(loss|losses|losers|red)\b/i.test(userMessage);
  const wantsWins = /\b(win|wins|winners|green)\b/i.test(userMessage);
  const wantsOpen = /\b(open|active|running)\b/i.test(userMessage);
  const queryTokens = userMessage
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3)
    .slice(0, 24);

  const scored = trades.map((trade, index) => ({
    trade,
    index,
    score: scoreTrade(trade, {
      symbols,
      dates,
      setupHints,
      wantsLosses,
      wantsWins,
      wantsOpen,
      queryTokens,
    }),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const byDate = b.trade.date.localeCompare(a.trade.date);
    if (byDate !== 0) return byDate;
    return a.index - b.index;
  });

  const picked: Trade[] = [];
  const seen = new Set<string>();
  const notes: string[] = [];

  for (const row of scored) {
    if (picked.length >= limit) break;
    if (seen.has(row.trade.id)) continue;
    if (row.score <= 0 && picked.length >= Math.min(5, limit)) continue;
    picked.push(row.trade);
    seen.add(row.trade.id);
  }

  for (const trade of trades) {
    if (picked.length >= limit) break;
    if (seen.has(trade.id)) continue;
    picked.push(trade);
    seen.add(trade.id);
  }

  if (symbols.size) {
    notes.push(`Symbol filters: ${[...symbols].join(", ")}`);
  }
  if (dates.size) {
    notes.push(`Date filters: ${[...dates].join(", ")}`);
  }
  if (setupHints.length) {
    notes.push(`Setup/session hints: ${setupHints.slice(0, 6).join(", ")}`);
  }
  notes.push(`Selected ${picked.length} of ${trades.length} trades for detail.`);

  return { trades: picked, notes };
}

export function buildTradeIndex(trades: Trade[], limit = TRADE_INDEX_LIMIT) {
  return trades.slice(0, limit).map(buildTradeIndexLine);
}

/**
 * Optionally re-attach screenshots from a trade uniquely identified by symbol
 * in the user message (no "active trade" concept).
 */
export function selectReattachedScreenshots(opts: {
  userMessage: string;
  hasNewImages: boolean;
  trades: Trade[];
  max?: number;
}): string[] {
  const {
    userMessage,
    hasNewImages,
    trades,
    max = MAX_REATTACH_SCREENSHOTS,
  } = opts;
  if (hasNewImages || !trades.length) return [];

  const mentioned = mentionedJournalSymbols(userMessage, trades);
  if (mentioned.length !== 1) return [];

  const matches = trades.filter(
    (t) => normalizeSymbol(t.symbol) === normalizeSymbol(mentioned[0]),
  );
  if (matches.length !== 1) return [];

  const real = (matches[0].screenshots ?? []).filter(
    (s) => typeof s === "string" && s.startsWith("data:image/"),
  );
  if (!real.length) return [];

  const needsVisual =
    looksLikeFollowUpUpdate(userMessage) ||
    /\b(screenshot|image|chart|look|see|review|re-?read|from (the|this)|levels?|entry|stop|target|sl|tp)\b/i.test(
      userMessage,
    );

  if (!needsVisual) return [];

  return real.slice(0, max);
}

/**
 * Fold older chat turns into a rolling summary. Keeps recent messages verbatim.
 */
export async function foldConversationSummary(opts: {
  model: LanguageModel;
  existingSummary?: string;
  olderMessages: HistoryMessage[];
}): Promise<string> {
  const older = opts.olderMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: truncate(m.content || "", 500),
    }))
    .filter((m) => m.content.trim());

  if (older.length < HISTORY_FOLD_THRESHOLD) {
    return opts.existingSummary?.trim() ?? "";
  }

  const existing = opts.existingSummary?.trim() ?? "";

  try {
    const { text } = await generateText({
      model: opts.model,
      system:
        "You maintain a compact rolling summary of a trading-journal chat. Output plain text only, 4–8 short lines max. Capture: trades discussed (symbol/side/ids if known), decisions made, pending questions, and coaching points. No markdown.",
      prompt: [
        existing ? `Existing summary:\n${existing}` : "No existing summary.",
        "",
        "New messages to fold in:",
        ...older.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
        "",
        "Return the updated summary only.",
      ].join("\n"),
      providerOptions: {
        openai: { reasoningEffort: "none" },
      },
    });
    if (text?.trim()) return truncate(text.trim(), 1200);
  } catch (error) {
    console.error("Conversation summary failed:", error);
  }

  const fallbackBits = older
    .slice(-4)
    .map((m) => `${m.role}: ${truncate(m.content, 120)}`);
  return truncate(
    [existing, ...fallbackBits].filter(Boolean).join("\n"),
    1200,
  );
}

export function splitHistoryForContext(
  history: HistoryMessage[],
  recentCount = RECENT_HISTORY_COUNT,
) {
  const cleaned = history.filter(
    (m) =>
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.trim(),
  );
  if (cleaned.length <= recentCount) {
    return { older: [] as HistoryMessage[], recent: cleaned };
  }
  return {
    older: cleaned.slice(0, -recentCount),
    recent: cleaned.slice(-recentCount),
  };
}

export function buildChatContextPack(opts: {
  strategy: Strategy;
  trades: Trade[];
  conversationSummary: string;
  reattachedScreenshotCount?: number;
  referencedTradeId?: string | null;
}): ChatContextPack {
  return {
    tradeCount: opts.trades.length,
    strategyName: opts.strategy?.name ?? null,
    conversationSummary: opts.conversationSummary,
    reattachedScreenshotCount: opts.reattachedScreenshotCount ?? 0,
    referencedTradeId: opts.referencedTradeId ?? null,
  };
}
