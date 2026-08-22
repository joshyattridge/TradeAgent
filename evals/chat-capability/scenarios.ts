import { computeStats } from "@/lib/stats";
import type { ScenarioExpectation } from "./assert";
import {
  envDuplicateEur,
  envEmptyBook,
  envIctSeed,
  envMixedBook,
  envNqScalper,
  envRedMonth,
  getEnvironment,
  type JournalEnvironment,
} from "./environments";

export type ChatScenario = {
  id: string;
  envId: string;
  title: string;
  /** User message for this turn (or first turn). */
  message: string;
  /** Optional follow-up user message (multi-turn). */
  followUp?: string;
  referencedTradeId?: string;
  referencedTradeIds?: string[];
  /** Expectations for the first (or only) turn. */
  expect: ScenarioExpectation;
  /** Expectations for followUp turn when present. */
  expectFollowUp?: ScenarioExpectation;
};

function statsFacts(
  env: JournalEnvironment,
  opts: { includePnl?: boolean; includeOpen?: boolean } = {},
): ScenarioExpectation["facts"] {
  const s = computeStats(env.trades);
  const facts: NonNullable<ScenarioExpectation["facts"]> = [
    {
      type: "number",
      label: "closed-count",
      value: s.closedCount,
      near: ["closed", "trades", "total"],
    },
    {
      type: "number",
      label: "wins",
      value: s.wins,
      near: ["win", "wins", "winners"],
    },
    {
      type: "number",
      label: "losses",
      value: s.losses,
      near: ["loss", "losses", "losers"],
    },
    {
      type: "number",
      label: "win-rate",
      value: s.winRate,
      tolerance: 1.5,
      allowRoundedInt: true,
      near: ["win rate", "winrate", "hit rate", "%"],
    },
    {
      type: "number",
      label: "total-r",
      value: s.totalR,
      tolerance: 0.25,
      allowRoundedInt: true,
      near: ["total r", "r multiple", "net r", "total", "expectancy"],
    },
  ];
  if (opts.includePnl !== false) {
    facts.push({
      type: "number",
      label: "total-pnl",
      value: s.totalPnlUsd,
      tolerance: Math.max(5, Math.abs(s.totalPnlUsd) * 0.05),
      allowRoundedInt: true,
      near: ["pnl", "p&l", "profit", "loss", "$", "usd", "dollars"],
    });
  }
  if (opts.includeOpen) {
    facts.push({
      type: "number",
      label: "open-count",
      value: s.openCount,
      near: ["open", "live", "active"],
    });
  }
  return facts;
}

function readStatsExpect(extra?: Partial<ScenarioExpectation>): ScenarioExpectation {
  return {
    requireTools: ["get_stats"],
    requireToolOk: ["get_stats"],
    minSteps: 1,
    minReplyLength: 30,
    ...extra,
    facts: [...(extra?.facts ?? [])],
  };
}

const ict = envIctSeed;
const ictStats = computeStats(ict.trades);
const red = envRedMonth;
const redStats = computeStats(red.trades);
const nq = envNqScalper;
const dup = envDuplicateEur;
const mixed = envMixedBook;
const mixedStats = computeStats(mixed.trades);
const empty = envEmptyBook;

export const CHAT_SCENARIOS: ChatScenario[] = [
  // ── ICT seed: performance & journal size ──────────────────────────
  {
    id: "ict-overall-performance",
    envId: ict.id,
    title: "Overall performance matches seed journal stats",
    message:
      "How am I doing overall? Give me closed trade count, wins, losses, win rate, total R, and total PnL from my journal.",
    expect: readStatsExpect({
      requireTools: ["get_stats", "query_trades"],
      facts: statsFacts(ict, { includeOpen: true }),
    }),
  },
  {
    id: "ict-win-rate-only",
    envId: ict.id,
    title: "Win rate question uses get_stats not mental math",
    message: "What is my exact win rate on closed trades?",
    expect: {
      requireTools: ["get_stats"],
      facts: [
        {
          type: "number",
          label: "win-rate",
          value: ictStats.winRate,
          tolerance: 1.5,
          allowRoundedInt: true,
          near: ["win rate", "%", "percent"],
        },
      ],
    },
  },
  {
    id: "ict-open-trade",
    envId: ict.id,
    title: "Identifies the live GBPUSD open short",
    message: "Do I have any open trades? If so, which symbol and side?",
    expect: {
      requireTools: ["query_trades"],
      facts: [
        { type: "allOf", label: "open-gbpusd-short", patterns: ["GBPUSD", /short/i] },
        {
          type: "anyOf",
          label: "open-count-cue",
          patterns: [
            /\bone\s+open\b/i,
            /\b1\s+open\b/i,
            /\bonly\s+(one|1)\b/i,
            /\bsingle\s+open\b/i,
            /you have one open/i,
          ],
        },
      ],
      custom: (r) => {
        const reply = r.reply.toLowerCase();
        if (reply.includes("no open") || reply.includes("0 open")) {
          return ["Reply denied the open GBPUSD trade"];
        }
        return [];
      },
    },
  },
  {
    id: "ict-losing-trades",
    envId: ict.id,
    title: "Lists losing symbols from the seed book",
    message: "Which of my trades were losses? List the symbols.",
    expect: {
      requireTools: ["query_trades"],
      facts: [
        {
          type: "allOf",
          label: "loss-symbols",
          patterns: ["GBPUSD", "USDJPY", "XAUUSD"],
        },
        {
          type: "number",
          label: "loss-count",
          value: ictStats.losses,
          near: ["loss", "losses", "losers"],
        },
      ],
    },
  },
  {
    id: "ict-eurusd-count",
    envId: ict.id,
    title: "Counts EURUSD rows correctly",
    message: "How many EURUSD trades do I have in the journal (including open)?",
    expect: {
      requireTools: ["query_trades"],
      facts: [
        {
          type: "number",
          label: "eurusd-count",
          value: ict.trades.filter((t) => t.symbol === "EURUSD").length,
          near: ["EURUSD", "euro", "trades", "count"],
        },
      ],
    },
  },
  {
    id: "ict-strategy-risk-rules",
    envId: ict.id,
    title: "Reads strategy soft stop and weekly volume from get_strategy",
    message:
      "What are my strategy risk rules for weekly trade volume and monthly drawdown soft stop?",
    expect: {
      requireTools: ["get_strategy"],
      requireToolOk: ["get_strategy"],
      facts: [
        {
          type: "anyOf",
          label: "weekly-volume",
          patterns: [/2\s*[–-]\s*6/, /2-6/, /2 to 6/, /max 2/, /2–6/],
        },
        {
          type: "anyOf",
          label: "soft-stop",
          patterns: [/-6\s*r/i, /−6\s*r/i, /6r/i, /soft stop/i],
        },
      ],
    },
  },
  {
    id: "ict-checklist-items",
    envId: ict.id,
    title: "Returns strategy checklist labels",
    message: "What checklist items are on my strategy plan?",
    expect: {
      requireTools: ["get_strategy"],
      facts: [
        {
          type: "allOf",
          label: "checklist-labels",
          patterns: [/bias/i, /premium|discount/i, /poi|fvg|order block/i],
        },
      ],
    },
  },
  {
    id: "ict-london-session",
    envId: ict.id,
    title: "Filters London-session trades without inventing symbols",
    message: "How many of my closed trades were London session, and which symbols?",
    expect: {
      requireTools: ["query_trades"],
      facts: [
        {
          type: "number",
          label: "london-closed",
          value: ict.trades.filter((t) => t.session === "London" && t.result !== "open")
            .length,
          near: ["London", "session", "trades", "closed"],
        },
        {
          type: "anyOf",
          label: "london-symbol",
          patterns: ["EURUSD", "XAUUSD", "GBPUSD"],
        },
        {
          type: "noneOf",
          label: "no-fake-btc",
          patterns: [/\bBTC\b/i, /\bBTCUSD\b/i, /\bAAPL\b/i],
        },
      ],
    },
  },
  {
    id: "ict-worst-r",
    envId: ict.id,
    title: "Worst R matches journal (−1.0 losses)",
    message: "What is my worst R multiple on a closed trade?",
    expect: {
      requireTools: ["get_stats"],
      facts: [
        {
          type: "number",
          label: "worst-r",
          value: ictStats.worst,
          tolerance: 0.1,
          near: ["worst", "lowest", "r"],
        },
      ],
    },
  },
  {
    id: "ict-coaching-second-touch",
    envId: ict.id,
    title: "Coaches USDJPY second-touch loss against strategy",
    message:
      "Did my USDJPY loss fit the plan? Check notes and strategy rules about fresh vs second-touch FVGs.",
    expect: {
      requireTools: ["get_strategy", "query_trades"],
      facts: [
        { type: "anyOf", label: "mentions-usdjpy", patterns: [/USDJPY/i] },
        {
          type: "anyOf",
          label: "rule-or-second-touch",
          patterns: [/second touch/i, /fresh/i, /should have waited/i, /plan/i, /rule/i],
        },
      ],
    },
  },
  {
    id: "ict-no-invent-nasdaq-loss",
    envId: ict.id,
    title: "Does not invent a NAS100 loss when asked about crypto",
    message: "Summarize my Bitcoin and Solana trades from this journal.",
    expect: {
      requireTools: ["query_trades"],
      facts: [
        {
          type: "anyOf",
          label: "honest-empty",
          patterns: [
            /no .*bitcoin/i,
            /no .*btc/i,
            /don'?t have/i,
            /do not have/i,
            /none/i,
            /no trades/i,
            /0 /,
            /zero/i,
            /not in/i,
            /no bitcoin/i,
            /no solana/i,
          ],
        },
        {
          type: "noneOf",
          label: "no-fake-fills",
          patterns: [/bought btc/i, /shorted sol/i, /solana win/i],
        },
      ],
    },
  },
  {
    id: "ict-referenced-trade",
    envId: ict.id,
    title: "Uses UI referenced trade id for 'this trade'",
    message: "What were entry, stop, target, and result on this trade?",
    referencedTradeId: "t1",
    expect: {
      requireTools: ["get_trade"],
      facts: [
        {
          type: "anyOf",
          label: "t1-identity-or-levels",
          // Model may omit symbol/side when the UI pin already identified the row.
          patterns: ["EURUSD", /long/i, /1\.1682/, /entry:\s*1\.168/i],
        },
        {
          type: "number",
          label: "t1-entry",
          value: 1.1682,
          tolerance: 0.0005,
          near: ["entry", "1.168"],
        },
        {
          type: "anyOf",
          label: "t1-result-win",
          patterns: [/win/i, /\+?2(\.0)?\s*r/i],
        },
      ],
    },
  },
  {
    id: "ict-multiturn-stats-then-worst",
    envId: ict.id,
    title: "Follow-up still uses live journal for worst loss symbol",
    message: "Give me my overall win rate and total R.",
    followUp: "Which symbol was my worst loss, and what does the note say?",
    expect: {
      requireTools: ["get_stats"],
      facts: [
        {
          type: "number",
          label: "win-rate",
          value: ictStats.winRate,
          tolerance: 1.5,
          allowRoundedInt: true,
          near: ["win rate", "%"],
        },
      ],
    },
    expectFollowUp: {
      requireTools: ["query_trades"],
      facts: [
        {
          type: "anyOf",
          label: "worst-loss-symbol",
          // All −1R losses are equal; accept any of the three loss symbols + note cues
          patterns: [/USDJPY/i, /GBPUSD/i, /XAUUSD/i],
        },
      ],
    },
  },
  {
    id: "ict-patch-open-trade",
    envId: ict.id,
    title: "Proposes patch on the open GBPUSD by id after find",
    message:
      "Close my open GBPUSD short as a win at 1.3512 for +2R and +$200 PnL.",
    expect: {
      requireTools: ["patch_trade"],
      actions: { mustProposeUpdateId: "t11" },
      custom: (r) => {
        const tools = new Set(r.tools.map((t) => t.name));
        if (!tools.has("find_trade") && !tools.has("query_trades") && !tools.has("get_trade")) {
          return ["Expected find_trade, query_trades, or get_trade before patch"];
        }
        const u = [
          ...(r.actions.updateTrades ?? []),
          ...(r.actions.updateTrade ? [r.actions.updateTrade] : []),
        ].find((x) => x.id === "t11");
        if (!u) return ["Missing update for t11"];
        const issues: string[] = [];
        if (u.result && u.result !== "win") issues.push(`result=${u.result}`);
        if (typeof u.rMultiple === "number" && Math.abs(u.rMultiple - 2) > 0.01) {
          issues.push(`rMultiple=${u.rMultiple}`);
        }
        if (typeof u.exit === "number" && Math.abs(u.exit - 1.3512) > 0.0005) {
          issues.push(`exit=${u.exit}`);
        }
        return issues;
      },
    },
  },

  // ── Empty book ────────────────────────────────────────────────────
  {
    id: "empty-performance",
    envId: empty.id,
    title: "Empty journal reports zero closed trades honestly",
    message: "How am I doing? Win rate, total R, how many trades?",
    expect: {
      requireTools: ["get_stats"],
      facts: [
        {
          type: "anyOf",
          label: "zero-trades",
          patterns: [/0 trades/i, /no trades/i, /zero/i, /empty/i, /haven'?t logged/i],
        },
        {
          type: "number",
          label: "total-trades-0",
          value: 0,
          near: ["trade", "trades", "closed"],
        },
        {
          type: "noneOf",
          label: "no-invented-wins",
          patterns: [/7 wins/i, /nas100/i, /\$1200/i],
        },
      ],
    },
  },
  {
    id: "empty-strategy-name",
    envId: empty.id,
    title: "Reads Opening Range Breakout strategy with empty book",
    message: "What is my strategy called and what instruments am I allowed to trade?",
    expect: {
      requireTools: ["get_strategy"],
      facts: [
        {
          type: "allOf",
          label: "orb-identity",
          patterns: [/opening range/i, /NAS100|ES/i],
        },
        {
          type: "anyOf",
          label: "ny-window",
          patterns: [/new york/i, /09:30/i, /9:30/i],
        },
      ],
    },
  },
  {
    id: "empty-log-proposal",
    envId: empty.id,
    title: "Can propose logging a first NAS100 trade",
    message:
      "Log a new NAS100 long ORB: entry 21100, stop 21070, target 21145, New York session, result open, risk $100, size 1 contract.",
    expect: {
      requireTools: ["log_trade"],
      actions: { mustProposeAdd: true, addSymbol: "NAS100" },
      facts: [
        {
          type: "anyOf",
          label: "proposal-language",
          patterns: [/propos/i, /accept/i, /review/i],
        },
      ],
    },
  },

  // ── Red month ─────────────────────────────────────────────────────
  {
    id: "red-drawdown-vs-soft-stop",
    envId: red.id,
    title: "Recognizes −4.4R vs −3R weekly soft stop breach",
    message:
      "Am I past my strategy soft stop? Compare my total R to the plan risk limits.",
    expect: {
      requireTools: ["get_stats", "get_strategy"],
      facts: [
        {
          type: "anyOf",
          label: "total-r-neg-4-4",
          patterns: [/-4\.4\s*r/i, /−4\.4\s*r/i, /total is\s*[−\-]?4\.4/i],
        },
        {
          type: "anyOf",
          label: "soft-stop-3r",
          patterns: [/-3\s*r/i, /−3\s*r/i, /3r/i, /soft stop/i],
        },
        {
          type: "anyOf",
          label: "breach-language",
          patterns: [/past/i, /beyond/i, /breached/i, /over/i, /exceed/i, /yes/i, /stopped/i],
        },
      ],
    },
  },
  {
    id: "red-rule-breaks",
    envId: red.id,
    title: "Surfaces Asian + USDJPY + average-down rule breaks",
    message:
      "Which trades clearly broke my London mean-reversion rules? Be specific with symbols and tags.",
    expect: {
      requireTools: ["get_strategy", "query_trades"],
      facts: [
        {
          type: "anyOf",
          label: "asian-or-session",
          patterns: [/asian/i, /session-violation/i, /london-only/i],
        },
        {
          type: "anyOf",
          label: "usdjpy-or-pair",
          patterns: [/USDJPY/i, /pair-violation/i, /whitelist/i],
        },
        {
          type: "anyOf",
          label: "average-down",
          patterns: [/average/i, /averaged/i],
        },
      ],
    },
  },
  {
    id: "red-fomo-tags",
    envId: red.id,
    title: "Counts FOMO-tagged trades",
    message: "How many of my trades are tagged FOMO?",
    expect: {
      requireTools: ["query_trades"],
      facts: [
        {
          type: "number",
          label: "fomo-count",
          value: red.trades.filter((t) => t.tags?.includes("fomo")).length,
          near: ["fomo", "tag", "trades"],
        },
      ],
    },
  },
  {
    id: "red-win-loss-split",
    envId: red.id,
    title: "2 wins and 8 losses reported accurately",
    message: "How many wins and losses do I have?",
    expect: {
      requireTools: ["get_stats"],
      facts: [
        {
          type: "number",
          label: "wins-2",
          value: 2,
          near: ["win", "wins"],
        },
        {
          type: "number",
          label: "losses-8",
          value: 8,
          near: ["loss", "losses"],
        },
      ],
    },
  },

  // ── NQ scalper ────────────────────────────────────────────────────
  {
    id: "nq-performance",
    envId: nq.id,
    title: "NQ book win rate and total R",
    message:
      "From my journal stats: closed count, wins, losses, breakevens if mentioned, win rate, and total R.",
    expect: readStatsExpect({
      requireTools: ["get_stats"],
      facts: [
        ...statsFacts(nq, { includeOpen: true, includePnl: false })!,
        {
          type: "anyOf",
          label: "breakeven-mention",
          patterns: [/breakeven/i, /\bbe\b/i, /scratch/i, /0\s*r/i],
        },
      ],
    }),
  },
  {
    id: "nq-open-es",
    envId: nq.id,
    title: "Finds open ES long among NAS100 book",
    message: "What is currently open in my journal?",
    expect: {
      requireTools: ["query_trades"],
      facts: [
        { type: "allOf", label: "open-es-long", patterns: [/\bES\b/, /long/i] },
        {
          type: "number",
          label: "entry-5420",
          value: 5420,
          near: ["entry", "5420", "ES"],
        },
      ],
    },
  },
  {
    id: "nq-daily-max-violation",
    envId: nq.id,
    title: "Flags 4th trade of day vs max 3 rule",
    message:
      "Did I violate my max 3 trades per day rule anywhere? Check July 23.",
    expect: {
      requireTools: ["get_strategy", "query_trades"],
      facts: [
        {
          type: "anyOf",
          label: "july-23-or-fourth",
          patterns: [/july 23/i, /2026-07-23/i, /4th/i, /fourth/i, /max 3/i],
        },
        {
          type: "anyOf",
          label: "violation",
          patterns: [/violat/i, /over/i, /broke/i, /exceed/i, /yes/i],
        },
      ],
    },
  },
  {
    id: "nq-only-nas100-closed",
    envId: nq.id,
    title: "Closed book is NAS100-only (ES is open)",
    message: "Which symbols appear in my closed trades?",
    expect: {
      requireTools: ["query_trades"],
      facts: [
        { type: "anyOf", label: "nas100", patterns: [/NAS100/i, /NQ/i] },
        {
          type: "noneOf",
          label: "no-closed-es-as-only",
          // Allow mentioning ES as open, but don't claim closed ES wins
          patterns: [/closed ES win/i, /ES wins/i],
        },
      ],
    },
  },

  // ── Duplicate EURUSD ──────────────────────────────────────────────
  {
    id: "dup-count-eurusd",
    envId: dup.id,
    title: "Counts four EURUSD trades correctly",
    message: "How many EURUSD trades are in my journal?",
    expect: {
      requireTools: ["query_trades"],
      facts: [
        {
          type: "number",
          label: "eur-4",
          value: 4,
          near: ["EURUSD", "euro", "trades"],
        },
      ],
    },
  },
  {
    id: "dup-disambiguate-entry",
    envId: dup.id,
    title: "Finds the 1.1645 EURUSD loss, not the 1.161 win",
    message:
      "Tell me the result and notes for my EURUSD long that entered at 1.1645.",
    expect: {
      custom: (r) => {
        const tools = new Set(r.tools.map((t) => t.name));
        if (!tools.has("find_trade") && !tools.has("query_trades") && !tools.has("get_trade")) {
          return ["Expected find_trade, query_trades, or get_trade"];
        }
        return [];
      },
      facts: [
        {
          type: "anyOf",
          label: "loss-result",
          patterns: [/loss/i, /stopped/i, /-1\s*r/i],
        },
        {
          type: "anyOf",
          label: "afternoon-note",
          patterns: [/afternoon/i, /1\.1645/i, /stopped/i],
        },
        {
          type: "noneOf",
          label: "not-first-win",
          patterns: [/first EURUSD — entry 1\.161/i, /\+2\s*r win from 1\.161/i],
        },
      ],
    },
  },
  {
    id: "dup-open-short",
    envId: dup.id,
    title: "Identifies open EURUSD short at 1.1670",
    message: "What is my open EURUSD trade? Side and entry.",
    expect: {
      requireTools: ["query_trades"],
      facts: [
        { type: "allOf", label: "open-short", patterns: ["EURUSD", /short/i] },
        {
          type: "number",
          label: "entry-1.167",
          value: 1.167,
          tolerance: 0.001,
          near: ["entry", "1.167"],
        },
      ],
    },
  },
  {
    id: "dup-patch-specific",
    envId: dup.id,
    title: "Patches only the 1.1645 EURUSD loss with a FOMO tag",
    message:
      "On the EURUSD long entered at 1.1645, add a FOMO tag and append note: chased NY continuation.",
    expect: {
      requireTools: ["annotate_trade"],
      actions: { mustProposeUpdateId: "dup-b" },
      custom: (r) => {
        const tools = new Set(r.tools.map((t) => t.name));
        if (!tools.has("find_trade") && !tools.has("query_trades") && !tools.has("get_trade")) {
          return ["Expected find_trade, query_trades, or get_trade before annotate"];
        }
        return [];
      },
    },
  },
  {
    id: "dup-gold-only",
    envId: dup.id,
    title: "XAUUSD is the only gold trade",
    message: "Summarize my XAUUSD trade this week.",
    expect: {
      requireTools: ["query_trades"],
      facts: [
        {
          type: "allOf",
          label: "gold-win",
          patterns: [/XAUUSD/i, /win/i],
        },
        {
          type: "number",
          label: "entry-2390",
          value: 2390,
          near: ["entry", "2390"],
        },
      ],
    },
  },

  // ── Mixed book ────────────────────────────────────────────────────
  {
    id: "mixed-two-opens",
    envId: mixed.id,
    title: "Reports both open positions (GBPUSD + XAUUSD)",
    message: "List every open trade with symbol and side.",
    expect: {
      requireTools: ["query_trades"],
      facts: [
        {
          type: "allOf",
          label: "both-opens",
          patterns: [/GBPUSD/i, /XAUUSD/i, /long/i, /short/i],
        },
        {
          type: "anyOf",
          label: "open-count-cue",
          patterns: [
            /\b2\s+open\b/i,
            /\btwo\s+open\b/i,
            /both open/i,
            /XAUUSD[\s\S]{0,80}GBPUSD/i,
            /GBPUSD[\s\S]{0,80}XAUUSD/i,
          ],
        },
      ],
    },
  },
  {
    id: "mixed-breakeven",
    envId: mixed.id,
    title: "Mentions the XAUUSD breakeven",
    message: "Did I have any breakeven trades? Which symbol?",
    expect: {
      requireTools: ["query_trades"],
      facts: [
        {
          type: "allOf",
          label: "be-gold",
          patterns: [/XAUUSD/i, /breakeven|break-even|\bbe\b/i],
        },
      ],
    },
  },
  {
    id: "mixed-stats",
    envId: mixed.id,
    title: "Mixed book closed stats (2W / 1L / 1BE)",
    message: "Give me wins, losses, closed count, and total R.",
    expect: {
      requireTools: ["get_stats"],
      facts: [
        {
          type: "number",
          label: "wins",
          value: mixedStats.wins,
          near: ["win", "wins"],
        },
        {
          type: "number",
          label: "losses",
          value: mixedStats.losses,
          near: ["loss", "losses"],
        },
        {
          type: "number",
          label: "closed",
          value: mixedStats.closedCount,
          near: ["closed", "trades"],
        },
        {
          type: "number",
          label: "total-r",
          value: mixedStats.totalR,
          tolerance: 0.2,
          near: ["total", "r", "net"],
        },
      ],
    },
  },
  {
    id: "mixed-max-open-rule",
    envId: mixed.id,
    title: "Two opens equals the strategy max of 2",
    message:
      "My strategy says never more than 2 open trades. Am I at the limit right now?",
    expect: {
      requireTools: ["get_strategy", "query_trades"],
      facts: [
        {
          type: "anyOf",
          label: "at-limit",
          patterns: [/at the limit/i, /yes/i, /2 open/i, /max/i, /full/i],
        },
      ],
    },
  },
  {
    id: "mixed-delete-be",
    envId: mixed.id,
    title: "Proposes deleting the breakeven XAUUSD trade by id",
    message: "Delete my XAUUSD breakeven trade from the journal.",
    expect: {
      requireTools: ["delete_trade"],
      actions: { mustProposeDeleteId: "mx3" },
      custom: (r) => {
        const tools = new Set(r.tools.map((t) => t.name));
        if (!tools.has("find_trade") && !tools.has("query_trades") && !tools.has("get_trade")) {
          return ["Expected find_trade, query_trades, or get_trade before delete"];
        }
        return [];
      },
      facts: [
        {
          type: "anyOf",
          label: "proposal",
          patterns: [/propos/i, /accept/i, /review/i, /delete/i],
        },
      ],
    },
  },
  {
    id: "mixed-strategy-no-indices",
    envId: mixed.id,
    title: "Strategy forbids indices — answers from get_strategy",
    message: "Am I allowed to trade NAS100 on this strategy?",
    expect: {
      requireTools: ["get_strategy"],
      facts: [
        {
          type: "anyOf",
          label: "no-indices",
          patterns: [/no indices/i, /not allowed/i, /majors \+ gold/i, /only/i, /no\b/i],
        },
      ],
    },
  },
];

export function scenarioEnvironment(scenario: ChatScenario) {
  return getEnvironment(scenario.envId);
}

/** Quick sanity: every scenario envId resolves. */
export function assertScenarioCatalog() {
  for (const s of CHAT_SCENARIOS) {
    getEnvironment(s.envId);
  }
}
