import { markdownForChat } from "@/lib/strategy-md";
import type { Strategy, Trade } from "@/lib/types";

export const RELEVANT_TRADES_LIMIT = 10;
export const TRADE_INDEX_LIMIT = 80;
export const MAX_REATTACH_SCREENSHOTS = 2;

export type { HistoryMessage, ChatAgentMessage } from "@/lib/chat-history";
export {
  expandHistoryToModelMessages,
  sanitizeAgentMessages,
  ensureFinalAssistantText,
  countToolsInAgentMessages,
} from "@/lib/chat-history";

export type TradeSnapshot = {
  id: string;
  date: string;
  symbol: string;
  side: Trade["side"];
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
  result: Trade["result"];
  session?: string;
  notes?: string;
  tags?: string[];
  checklist?: Trade["checklist"];
  hasScreenshots: boolean;
  hidden?: boolean;
};

export type ChatContextPack = {
  /** Pointer only — full strategy/trades are loaded via tools */
  tradeCount: number;
  strategyName: string | null;
  reattachedScreenshotCount: number;
  /** One-turn UI pins from the journal → chat (not a persistent active trade). */
  referencedTradeIds: string[];
};

export function tradeSnapshot(trade: Trade): TradeSnapshot {
  return {
    id: trade.id,
    date: trade.date,
    symbol: trade.symbol,
    side: trade.side,
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
    result: trade.result,
    session: trade.session,
    notes: trade.notes,
    tags: trade.tags,
    checklist: trade.checklist,
    hasScreenshots: Boolean(
      trade.screenshots?.some((s) => s && s !== "pending"),
    ),
    hidden: trade.hidden || undefined,
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
    updatedAt: strategy.updatedAt,
    markdown: truncate(markdownForChat(strategy.markdown), 4000),
    checklist: strategy.checklist ?? [],
  };
}

export function buildTradeIndexLine(trade: Trade) {
  const pnl =
    trade.pnlUsd != null ? ` $${trade.pnlUsd}` : "";
  return `${trade.id} | ${trade.date} | ${trade.symbol} | ${trade.side} | ${trade.result}${pnl}${trade.session ? ` | ${trade.session}` : ""}`;
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

  const hay = `${trade.session ?? ""} ${trade.notes ?? ""}`.toLowerCase();
  for (const hint of opts.setupHints) {
    if (hay.includes(hint)) score += 12;
  }

  if (opts.wantsLosses && trade.result === "loss") score += 15;
  if (opts.wantsWins && trade.result === "win") score += 15;
  if (opts.wantsOpen && trade.result === "open") score += 20;

  for (const token of opts.queryTokens) {
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
    notes.push(`Session/notes hints: ${setupHints.slice(0, 6).join(", ")}`);
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

export function buildChatContextPack(opts: {
  strategy: Strategy;
  trades: Trade[];
  reattachedScreenshotCount?: number;
  referencedTradeIds?: string[];
}): ChatContextPack {
  return {
    tradeCount: opts.trades.length,
    strategyName: opts.strategy?.name ?? null,
    reattachedScreenshotCount: opts.reattachedScreenshotCount ?? 0,
    referencedTradeIds: [...new Set((opts.referencedTradeIds ?? []).filter(Boolean))],
  };
}
