import { computeStats } from "@/lib/stats";
import type { ScenarioExpectation } from "./assert";
import { envEdgeLab, envIctSeed, envRedMonth } from "./environments";
import {
  checklistCheckedCount,
  checklistCompletion,
  closedOnly,
  hasChecklistAnswers,
  plannedRewardRisk,
} from "./ground-truth";
import type { ChatScenario } from "./scenarios";

const lab = envEdgeLab;
const labClosed = closedOnly(lab.trades);
const ict = envIctSeed;
const red = envRedMonth;

function completion(t: (typeof lab.trades)[0]) {
  return checklistCompletion(t, lab.strategy);
}

function rr(t: (typeof lab.trades)[0]) {
  return plannedRewardRisk(t);
}

const labFullChecklist = lab.trades.filter((t) => completion(t) === 1);
const labFullClosed = closedOnly(labFullChecklist);
const labFullStats = computeStats(labFullClosed);

const labExactly80 = lab.trades.filter((t) => {
  const c = completion(t);
  return c != null && Math.abs(c - 0.8) < 0.001;
});
const labAtLeast80 = lab.trades.filter((t) => (completion(t) ?? -1) >= 0.8);
const labBelow80 = lab.trades.filter((t) => {
  const c = completion(t);
  return c != null && c < 0.8;
});
const labNoChecklist = lab.trades.filter((t) => !hasChecklistAnswers(t));
const labRrLt2SlGe10 = lab.trades.filter((t) => {
  const r = rr(t);
  return r != null && r < 2 && (t.slPips ?? 0) >= 10;
});
const labRrGe2 = lab.trades.filter((t) => (rr(t) ?? 0) >= 2);
const labSlLt10 = lab.trades.filter((t) => (t.slPips ?? 0) < 10 && t.slPips != null);
const labSlGe10 = lab.trades.filter((t) => (t.slPips ?? 0) >= 10);
const labFomo = lab.trades.filter((t) => t.tags?.includes("fomo"));
const labAsian = lab.trades.filter((t) => t.session === "Asian");
const labAPlus = lab.trades.filter((t) => t.tags?.includes("a+"));
const labZeroChecklist = lab.trades.filter(
  (t) => hasChecklistAnswers(t) && checklistCheckedCount(t, lab.strategy) === 0,
);

function countFact(
  label: string,
  value: number,
  near: string[],
): NonNullable<ScenarioExpectation["facts"]>[number] {
  return { type: "number", label, value, near };
}

function symbolsFact(
  label: string,
  symbols: string[],
  mode: "anyOf" | "allOf" = "allOf",
): NonNullable<ScenarioExpectation["facts"]>[number] {
  return {
    type: mode,
    label,
    patterns: symbols.map((s) => new RegExp(s, "i")),
  };
}

function readTools(...extra: string[]): ScenarioExpectation {
  return {
    requireTools: ["query_trades", ...extra.filter((t) => t !== "query_trades")],
    minSteps: 1,
    minReplyLength: 25,
  };
}

function strategyTools(): ScenarioExpectation {
  return {
    requireTools: ["get_strategy", "query_trades"],
    minSteps: 1,
    minReplyLength: 40,
  };
}

/**
 * ~100 hard analytical / weird-user edge cases.
 * Ground truth is computed from the fixture journals.
 */
export const HARD_CHAT_SCENARIOS: ChatScenario[] = [
  // ── Checklist % ───────────────────────────────────────────────────
  {
    id: "hard-checklist-exactly-80",
    envId: lab.id,
    title: "Count trades meeting exactly 80% checklist (4/5)",
    message:
      "How many of my trades meet exactly 80% of checklist items (4 out of 5 checked)? List their ids or symbols+dates.",
    expect: {
      ...readTools(),
      facts: [
        countFact("exactly-80-count", labExactly80.length, [
          "80%",
          "80",
          "exactly",
          "4/5",
          "trades",
        ]),
        symbolsFact(
          "exactly-80-symbols",
          [...new Set(labExactly80.map((t) => t.symbol))],
          "anyOf",
        ),
      ],
    },
  },
  {
    id: "hard-checklist-at-least-80",
    envId: lab.id,
    title: "Count trades at ≥80% checklist completion",
    message:
      "How many trades have at least 80% of checklist items checked? Include open trades.",
    expect: {
      ...readTools(),
      facts: [
        countFact("ge80-count", labAtLeast80.length, [
          "80%",
          "at least",
          "trades",
          "checklist",
        ]),
      ],
    },
  },
  {
    id: "hard-checklist-below-80",
    envId: lab.id,
    title: "Trades below 80% checklist",
    message:
      "Which trades are under 80% checklist completion? Give a count.",
    expect: {
      ...readTools(),
      facts: [
        countFact("lt80-count", labBelow80.length, [
          "under",
          "below",
          "less",
          "80",
          "trades",
        ]),
      ],
    },
  },
  {
    id: "hard-checklist-100",
    envId: lab.id,
    title: "Full 5/5 checklist trades",
    message: "How many trades have every checklist item checked (100% / 5 of 5)?",
    expect: {
      ...readTools(),
      facts: [
        countFact("full-count", labFullChecklist.length, [
          "100%",
          "5/5",
          "every",
          "full",
          "trades",
        ]),
      ],
    },
  },
  {
    id: "hard-checklist-none-answered",
    envId: lab.id,
    title: "Trades with no checklist answers recorded",
    message:
      "Do I have any trades with no checklist answers at all? How many and which symbol?",
    expect: {
      ...readTools(),
      facts: [
        countFact("no-cl-count", labNoChecklist.length, [
          "no checklist",
          "none",
          "0",
          "without",
          "trades",
        ]),
        { type: "anyOf", label: "no-cl-symbol", patterns: [/EURUSD/i, /el18/i] },
      ],
    },
  },
  {
    id: "hard-checklist-zero-checked",
    envId: lab.id,
    title: "Trades with checklist present but 0 checked",
    message:
      "Which trades have a checklist recorded but zero items checked?",
    expect: {
      ...readTools(),
      facts: [
        { type: "anyOf", label: "zero-cl", patterns: [/NAS100/i, /el08/i, /revenge/i] },
        countFact("zero-cl-count", labZeroChecklist.length, [
          "zero",
          "0",
          "none checked",
          "trades",
        ]),
      ],
    },
  },
  {
    id: "hard-checklist-skipped-entry",
    envId: lab.id,
    title: "Which trades skipped the entry-model checklist item",
    message:
      "Which trades did not check the 'Entry model followed' checklist item? Count them.",
    expect: {
      ...readTools("get_strategy"),
      facts: [
        {
          type: "number",
          label: "skipped-entry-count",
          value: lab.trades.filter((t) => {
            if (!hasChecklistAnswers(t)) return false;
            return t.checklist?.find((a) => a.id === "el-entry")?.checked !== true;
          }).length,
          near: ["entry", "skipped", "not checked", "trades", "without"],
        },
      ],
    },
  },
  {
    id: "hard-checklist-winrate-full-only",
    envId: lab.id,
    title: "Win rate only on full-checklist closed trades",
    message:
      "What is my win rate if I only count closed trades where the full checklist was checked?",
    expect: {
      ...readTools("get_stats"),
      facts: [
        {
          type: "number",
          label: "full-wr",
          value: labFullStats.winRate,
          tolerance: 2,
          allowRoundedInt: true,
          near: ["win rate", "%", "full", "checklist"],
        },
        {
          type: "number",
          label: "full-closed-n",
          value: labFullStats.closedCount,
          near: ["closed", "trades", "full"],
        },
      ],
    },
  },
  {
    id: "hard-counterfactual-followed-plan",
    envId: lab.id,
    title: "Counterfactual: results if only full-checklist trades",
    message:
      "What would my trading results look like if I only took trades that fully followed the strategy checklist? Give closed count, wins, losses, win rate, and total R for that subset.",
    expect: {
      ...strategyTools(),
      facts: [
        countFact("cf-closed", labFullStats.closedCount, [
          "closed",
          "trades",
          "only",
        ]),
        countFact("cf-wins", labFullStats.wins, ["win", "wins"]),
        countFact("cf-losses", labFullStats.losses, ["loss", "losses"]),
        {
          type: "number",
          label: "cf-wr",
          value: labFullStats.winRate,
          tolerance: 2,
          allowRoundedInt: true,
          near: ["win rate", "%"],
        },
        {
          type: "number",
          label: "cf-r",
          value: labFullStats.totalR,
          tolerance: 0.35,
          near: ["total r", "r", "net"],
        },
      ],
    },
  },
  {
    id: "hard-counterfactual-drop-incomplete",
    envId: lab.id,
    title: "How much R did incomplete-checklist trades cost",
    message:
      "How much total R did I lose (or make) on closed trades that were NOT 100% checklist complete?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "number",
          label: "incomplete-r",
          value: computeStats(
            labClosed.filter((t) => completion(t) !== 1),
          ).totalR,
          tolerance: 0.4,
          near: ["r", "total", "incomplete", "not", "checklist"],
        },
      ],
    },
  },

  // ── RR + SL geometry ──────────────────────────────────────────────
  {
    id: "hard-rr-lt2-sl-ge10",
    envId: lab.id,
    title: "Trades with planned RR < 2 and SL ≥ 10 pips",
    message:
      "Which trades have less than 2R planned reward:risk (tp/sl) AND a stop of at least 10 pips? Give the count and symbols.",
    expect: {
      ...readTools(),
      facts: [
        countFact("rr-sl-count", labRrLt2SlGe10.length, [
          "trades",
          "less than 2",
          "RR",
          "10",
        ]),
        symbolsFact(
          "rr-sl-symbols",
          [...new Set(labRrLt2SlGe10.map((t) => t.symbol))],
          "anyOf",
        ),
      ],
    },
  },
  {
    id: "hard-rr-ge2-count",
    envId: lab.id,
    title: "Count planned RR ≥ 2 trades",
    message: "How many trades have a planned RR of 2.0 or better based on tpPips/slPips?",
    expect: {
      ...readTools(),
      facts: [
        countFact("rr2-count", labRrGe2.length, ["2", "RR", "trades", "planned"]),
      ],
    },
  },
  {
    id: "hard-sl-under-10",
    envId: lab.id,
    title: "Stops tighter than 10 pips",
    message: "List every trade whose SL is under 10 pips. How many are there?",
    expect: {
      ...readTools(),
      facts: [
        countFact("sl-lt10", labSlLt10.length, ["under", "below", "less", "10", "pips"]),
        {
          type: "anyOf",
          label: "sl-lt10-symbols",
          patterns: [/GBPUSD/i, /USDJPY/i, /EURUSD/i, /8 pip/i, /9 pip/i, /5 pip/i],
        },
      ],
    },
  },
  {
    id: "hard-sl-ge10-and-loss",
    envId: lab.id,
    title: "Losing trades with SL ≥ 10",
    message: "How many losing trades had a stop of at least 10 pips?",
    expect: {
      ...readTools(),
      facts: [
        countFact(
          "loss-sl10",
          lab.trades.filter((t) => t.result === "loss" && (t.slPips ?? 0) >= 10)
            .length,
          ["loss", "losing", "10", "pips", "trades"],
        ),
      ],
    },
  },
  {
    id: "hard-realized-vs-planned-rr",
    envId: lab.id,
    title: "Trade where realized R beat planned RR",
    message:
      "Is there a trade where realized R-multiple is higher than the planned tp/sl RR? Which one?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "realized-gt-planned",
          // el14: planned 1.5, realized 2
          patterns: [/XAUUSD/i, /el14/i, /1\.5/i, /realized/i],
        },
      ],
    },
  },
  {
    id: "hard-worst-planned-rr-win",
    envId: lab.id,
    title: "Winning trade with worst planned RR",
    message:
      "Among winning trades, which had the worst (lowest) planned RR from tp/sl?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "worst-rr-win",
          // el17 planned 0.5
          patterns: [/GBPUSD/i, /el17/i, /0\.5/i],
        },
      ],
    },
  },
  {
    id: "hard-best-planned-rr",
    envId: lab.id,
    title: "Best planned RR trade",
    message: "Which trade has the highest planned RR (tp/sl)?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "best-rr",
          // el20 planned 4.0
          patterns: [/EURUSD/i, /el20/i, /\b4(\.0)?\b/],
        },
      ],
    },
  },
  {
    id: "hard-rr-lt2-fomo",
    envId: lab.id,
    title: "FOMO + planned RR < 2",
    message:
      "Do I have any FOMO-tagged trades with planned RR under 2? Identify them.",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "fomo-rr",
          // el13: FOMO, RR 1.5; el06 FOMO RR 2.0 — only el13
          patterns: [/EURUSD/i, /el13/i, /1\.5/i, /fomo/i],
        },
      ],
    },
  },
  {
    id: "hard-rule-planned-rr-violations",
    envId: lab.id,
    title: "Strategy says RR≥2 — how many violate",
    message:
      "My strategy requires planned RR ≥ 2.0. How many trades violate that rule?",
    expect: {
      ...strategyTools(),
      facts: [
        countFact(
          "rr-violations",
          lab.trades.filter((t) => (rr(t) ?? 99) < 2).length,
          ["violate", "below", "under", "RR", "trades", "planned"],
        ),
      ],
    },
  },
  {
    id: "hard-rule-sl-violations",
    envId: lab.id,
    title: "Strategy says SL≥10 — how many violate",
    message:
      "My plan says stop must be at least 10 pips. How many trades break that?",
    expect: {
      ...strategyTools(),
      facts: [
        countFact("sl-violations", labSlLt10.length, [
          "break",
          "violate",
          "under",
          "10",
          "trades",
        ]),
      ],
    },
  },

  // ── Multi-filter combos ───────────────────────────────────────────
  {
    id: "hard-combo-london-loss-ge80",
    envId: lab.id,
    title: "London losses with ≥80% checklist",
    message:
      "How many London-session losses have at least 80% checklist completion?",
    expect: {
      ...readTools(),
      facts: [
        countFact(
          "london-loss-80",
          lab.trades.filter(
            (t) =>
              t.session === "London" &&
              t.result === "loss" &&
              (completion(t) ?? 0) >= 0.8,
          ).length,
          ["London", "loss", "80", "trades"],
        ),
      ],
    },
  },
  {
    id: "hard-combo-ny-win-full",
    envId: lab.id,
    title: "NY wins with full checklist",
    message:
      "List New York wins that have a full checklist. Count?",
    expect: {
      ...readTools(),
      facts: [
        countFact(
          "ny-win-full",
          lab.trades.filter(
            (t) =>
              t.session === "New York" &&
              t.result === "win" &&
              completion(t) === 1,
          ).length,
          ["New York", "NY", "win", "full", "trades"],
        ),
        { type: "anyOf", label: "ny-win-sym", patterns: [/NAS100/i, /el15/i] },
      ],
    },
  },
  {
    id: "hard-combo-a-plus-stats",
    envId: lab.id,
    title: "Stats on A+ tagged trades only",
    message:
      "For A+-tagged trades only: closed count, wins, total R.",
    expect: {
      ...readTools("get_stats"),
      facts: (() => {
        const s = computeStats(labAPlus.filter((t) => t.result !== "open"));
        return [
          countFact("aplus-closed", s.closedCount, ["closed", "A+", "trades"]),
          countFact("aplus-wins", s.wins, ["win", "wins", "A+"]),
          {
            type: "number",
            label: "aplus-r",
            value: s.totalR,
            tolerance: 0.3,
            near: ["total r", "r", "A+"],
          },
        ];
      })(),
    },
  },
  {
    id: "hard-combo-asian-or-fomo",
    envId: lab.id,
    title: "Asian session OR FOMO tag",
    message:
      "How many trades are either Asian session OR tagged FOMO (union, not double-count)?",
    expect: {
      ...readTools(),
      facts: [
        countFact(
          "asian-or-fomo",
          lab.trades.filter(
            (t) => t.session === "Asian" || t.tags?.includes("fomo"),
          ).length,
          ["Asian", "FOMO", "trades", "either", "or"],
        ),
      ],
    },
  },
  {
    id: "hard-combo-short-rr2-loss",
    envId: lab.id,
    title: "Shorts that lost with planned RR ≥ 2",
    message:
      "Which short trades lost despite a planned RR of 2 or higher?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "short-loss-rr2",
          patterns: [/XAUUSD/i, /NAS100/i, /EURUSD/i, /el06/i, /el08/i, /el16/i],
        },
      ],
    },
  },
  {
    id: "hard-only-audusd",
    envId: lab.id,
    title: "Only AUDUSD trade identity",
    message: "Summarize my AUDUSD trade — result, checklist %, planned RR.",
    expect: {
      ...readTools(),
      facts: [
        { type: "allOf", label: "aud", patterns: [/AUDUSD/i, /loss/i] },
        {
          type: "anyOf",
          label: "aud-80",
          patterns: [/80%/i, /4\s*\/\s*5/i, /0\.8/],
        },
        {
          type: "anyOf",
          label: "aud-rr2",
          patterns: [/\b2(\.0)?\b/, /2R/i],
        },
      ],
    },
  },
  {
    id: "hard-open-checklist-pct",
    envId: lab.id,
    title: "Open trade checklist percentage",
    message: "What checklist completion % is my open trade at?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "open-80",
          patterns: [/80%/i, /4\s*\/\s*5/i, /GBPUSD/i],
        },
      ],
    },
  },
  {
    id: "hard-breakeven-checklist",
    envId: lab.id,
    title: "Breakeven trade checklist state",
    message: "Did my breakeven trade complete the checklist? What %?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "be-80",
          patterns: [/80%/i, /4\s*\/\s*5/i, /EURUSD/i, /el09/i],
        },
      ],
    },
  },
  {
    id: "hard-tight-stop-a-plus",
    envId: lab.id,
    title: "A+ with SL under 10",
    message: "Any A+ trades with stop under 10 pips?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "aplus-tight",
          patterns: [/el20/i, /EURUSD/i, /5 pip/i, /tight-stop/i],
        },
      ],
    },
  },
  {
    id: "hard-fees-highest",
    envId: lab.id,
    title: "Honest about missing fees",
    message: "Which trade had the highest fees?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "fees-unknown",
          patterns: [
            /no fee/i,
            /don'?t have fee/i,
            /fees? (not|aren'?t|missing)/i,
            /no fees recorded/i,
            /not recorded/i,
            /can'?t (tell|find|see)/i,
            /none/i,
            /0/,
            /unavailable/i,
          ],
        },
      ],
    },
  },

  // ── Session / symbol deep cuts ────────────────────────────────────
  {
    id: "hard-london-total-r",
    envId: lab.id,
    title: "Total R for London closed trades",
    message: "What is my total R across closed London-session trades only?",
    expect: {
      ...readTools("get_stats"),
      facts: [
        {
          type: "number",
          label: "london-r",
          value: computeStats(
            labClosed.filter((t) => t.session === "London"),
          ).totalR,
          tolerance: 0.4,
          near: ["London", "total r", "r", "net"],
        },
      ],
    },
  },
  {
    id: "hard-eurusd-winrate",
    envId: lab.id,
    title: "EURUSD closed win rate in edge lab",
    message: "What is my EURUSD win rate on closed trades?",
    expect: {
      ...readTools("get_stats"),
      facts: (() => {
        const s = computeStats(
          labClosed.filter((t) => t.symbol === "EURUSD"),
        );
        return [
          {
            type: "number",
            label: "eur-wr",
            value: s.winRate,
            tolerance: 2,
            allowRoundedInt: true,
            near: ["win rate", "%", "EURUSD"],
          },
        ];
      })(),
    },
  },
  {
    id: "hard-gold-only-r",
    envId: lab.id,
    title: "XAUUSD total R",
    message: "Net R on all closed XAUUSD trades?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "number",
          label: "xau-r",
          value: computeStats(
            labClosed.filter((t) => t.symbol === "XAUUSD"),
          ).totalR,
          tolerance: 0.3,
          near: ["XAUUSD", "gold", "r", "net", "total"],
        },
      ],
    },
  },
  {
    id: "hard-nas100-revenge",
    envId: lab.id,
    title: "Find revenge-tagged NAS100",
    message: "Did I take a revenge trade on NAS100? What was the result?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "allOf",
          label: "revenge-nas",
          patterns: [/NAS100/i, /revenge/i, /loss/i],
        },
      ],
    },
  },
  {
    id: "hard-same-day-two-gbpusd",
    envId: lab.id,
    title: "Two GBPUSD on 2026-07-03",
    message: "How many GBPUSD trades did I take on 2026-07-03 and what were the results?",
    expect: {
      ...readTools(),
      facts: [
        countFact("gbp-july3", 2, ["2", "two", "GBPUSD", "July"]),
        {
          type: "allOf",
          label: "gbp-results",
          patterns: [/win/i, /loss/i],
        },
      ],
    },
  },
  {
    id: "hard-july-week-soft-stop",
    envId: lab.id,
    title: "Soft stop −4R vs early July R",
    message:
      "My soft stop is −4R per week. Looking at trades from July 1–4 only, am I past that soft stop on total R?",
    expect: {
      ...strategyTools(),
      facts: (() => {
        const s = computeStats(
          labClosed.filter((t) => t.date >= "2026-07-01" && t.date <= "2026-07-04"),
        );
        return [
          {
            type: "number",
            label: "early-r",
            value: s.totalR,
            tolerance: 0.4,
            near: ["r", "total", "July", "net"],
          },
          {
            type: "anyOf",
            label: "soft-stop-call",
            patterns:
              s.totalR <= -4
                ? [/yes/i, /past/i, /beyond/i, /breached/i]
                : [/no/i, /not past/i, /within/i, /under/i, /still/i],
          },
        ];
      })(),
    },
  },
  {
    id: "hard-longest-sl-pips",
    envId: lab.id,
    title: "Largest SL in pips",
    message: "Which trade has the largest stop distance in pips?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "largest-sl",
          patterns: [/XAUUSD/i, /50/i, /el05/i, /el06/i],
        },
      ],
    },
  },
  {
    id: "hard-smallest-sl-pips",
    envId: lab.id,
    title: "Smallest SL in pips",
    message: "Which trade has the tightest stop in pips?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "tightest-sl",
          patterns: [/el20/i, /\b5\b/, /EURUSD/i],
        },
      ],
    },
  },
  {
    id: "hard-count-unique-symbols",
    envId: lab.id,
    title: "Unique symbol count",
    message: "How many unique symbols are in my journal?",
    expect: {
      ...readTools(),
      facts: [
        countFact(
          "unique-symbols",
          new Set(lab.trades.map((t) => t.symbol)).size,
          ["unique", "symbols", "different", "instruments"],
        ),
      ],
    },
  },
  {
    id: "hard-no-btc-in-edge",
    envId: lab.id,
    title: "No inventing BTC in edge lab",
    message: "How did my BTCUSD trades do this month?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "no-btc",
          patterns: [
            /no .*btc/i,
            /don'?t have/i,
            /do not have/i,
            /none/i,
            /0 /,
            /zero/i,
            /not in/i,
            /no trades/i,
          ],
        },
      ],
    },
  },

  // ── Rule-break / coaching weirdness ───────────────────────────────
  {
    id: "hard-list-all-rule-breaks",
    envId: lab.id,
    title: "Catalog major rule breaks",
    message:
      "List every clear rule break vs my Edge Lab plan: Asian trades, FOMO tags, SL under 10, planned RR under 2, incomplete checklist. Be specific.",
    expect: {
      ...strategyTools(),
      facts: [
        { type: "anyOf", label: "asian", patterns: [/asian/i] },
        { type: "anyOf", label: "fomo", patterns: [/fomo/i] },
        {
          type: "anyOf",
          label: "sl-or-rr",
          patterns: [/10 pip/i, /under 10/i, /RR/i, /reward/i],
        },
      ],
    },
  },
  {
    id: "hard-followed-vs-broke-expectancy",
    envId: lab.id,
    title: "Compare expectancy full checklist vs broken",
    message:
      "Compare average R (expectancy) on closed full-checklist trades vs closed trades that broke at least one of: Asian, FOMO, SL<10, RR<2, or checklist <100%.",
    expect: {
      ...strategyTools(),
      facts: [
        {
          type: "number",
          label: "full-avg-r",
          value: labFullStats.avgR,
          tolerance: 0.35,
          near: ["full", "checklist", "average", "expectancy", "avg"],
        },
      ],
    },
  },
  {
    id: "hard-should-i-have-skipped",
    envId: lab.id,
    title: "Which wins still broke the plan",
    message:
      "Which winning trades still violated the plan (SL<10, RR<2, incomplete checklist, or Asian)?",
    expect: {
      ...strategyTools(),
      facts: [
        {
          type: "anyOf",
          label: "bad-wins",
          // el03 SL8+60%cl, el07 RR1+80%, el14 RR1.5+60%, el17 RR0.5, el18 no cl, el20 SL5
          patterns: [/GBPUSD/i, /NAS100/i, /XAUUSD/i, /EURUSD/i, /el03/i, /el17/i, /el20/i],
        },
      ],
    },
  },
  {
    id: "hard-perfect-process-losses",
    envId: lab.id,
    title: "Full checklist losses (process wins)",
    message:
      "Which losses were full checklist / process-correct? Count them.",
    expect: {
      ...readTools(),
      facts: [
        countFact(
          "process-losses",
          lab.trades.filter((t) => t.result === "loss" && completion(t) === 1)
            .length,
          ["loss", "full", "checklist", "process", "trades"],
        ),
        {
          type: "anyOf",
          label: "process-loss-sym",
          patterns: [/GBPUSD/i, /USDJPY/i, /el04/i, /el10/i],
        },
      ],
    },
  },
  {
    id: "hard-soft-stop-full-book",
    envId: lab.id,
    title: "Whole-book R vs −4R soft stop",
    message:
      "Is my overall closed total R past the −4R weekly soft stop?",
    expect: {
      ...strategyTools(),
      requireTools: ["get_stats", "get_strategy"],
      facts: (() => {
        const totalR = computeStats(labClosed).totalR;
        return [
          {
            type: "number",
            label: "book-r",
            value: totalR,
            tolerance: 0.5,
            near: ["total", "r", "net", "overall"],
          },
          {
            type: "anyOf",
            label: "stop-call",
            patterns:
              totalR <= -4
                ? [/yes/i, /past/i, /beyond/i, /breached/i]
                : [/no/i, /not/i, /within/i, /above/i, /still/i],
          },
        ];
      })(),
    },
  },

  // ── ICT / red / cross-env hard asks ───────────────────────────────
  {
    id: "hard-ict-checklist-partial",
    envId: ict.id,
    title: "ICT trade with incomplete checklist",
    message:
      "Which of my ICT journal trades has a checklist that is not fully checked? What was skipped?",
    expect: {
      ...readTools("get_strategy"),
      facts: [
        {
          type: "anyOf",
          label: "partial-t2",
          patterns: [/GBPUSD/i, /t2/i, /entry/i, /cl-entry/i],
        },
      ],
    },
  },
  {
    id: "hard-ict-rr-from-pips",
    envId: ict.id,
    title: "ICT trades with planned RR exactly 2 from pips",
    message:
      "How many of my trades have tpPips exactly 2× slPips (planned 2R geometry)?",
    expect: {
      ...readTools(),
      facts: [
        countFact(
          "ict-2r-geo",
          ict.trades.filter(
            (t) =>
              typeof t.tpPips === "number" &&
              typeof t.slPips === "number" &&
              Math.abs(t.tpPips / t.slPips - 2) < 0.01,
          ).length,
          ["2", "twice", "2×", "2x", "planned", "trades"],
        ),
      ],
    },
  },
  {
    id: "hard-ict-sl-24-pips",
    envId: ict.id,
    title: "ICT trades with exactly 24 SL pips",
    message: "How many trades used a 24-pip stop?",
    expect: {
      ...readTools(),
      facts: [
        countFact(
          "sl24",
          ict.trades.filter((t) => t.slPips === 24).length,
          ["24", "pip", "stop", "trades"],
        ),
      ],
    },
  },
  {
    id: "hard-ict-if-followed-second-touch",
    envId: ict.id,
    title: "Counterfactual skipping second-touch USDJPY",
    message:
      "If I had skipped the USDJPY second-touch loss, what would my closed total R be?",
    expect: {
      ...readTools("get_stats"),
      facts: [
        {
          type: "number",
          label: "r-without-usdjpy",
          value: computeStats(
            ict.trades.filter((t) => t.result !== "open" && t.id !== "t5"),
          ).totalR,
          tolerance: 0.3,
          near: ["r", "total", "without", "skip", "USDJPY"],
        },
      ],
    },
  },
  {
    id: "hard-red-if-no-fomo",
    envId: red.id,
    title: "Red month R without FOMO trades",
    message:
      "What would my total R be if I deleted every FOMO-tagged trade from the journal?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "number",
          label: "r-no-fomo",
          value: computeStats(
            red.trades.filter((t) => !t.tags?.includes("fomo")),
          ).totalR,
          tolerance: 0.4,
          near: ["r", "total", "without", "fomo", "deleted"],
        },
      ],
    },
  },
  {
    id: "hard-red-checklist-all-no",
    envId: red.id,
    title: "Red trades with all checklist unchecked",
    message:
      "How many trades have every checklist item marked not done / unchecked?",
    expect: {
      ...readTools("get_strategy"),
      facts: [
        countFact(
          "all-unchecked",
          red.trades.filter((t) => {
            if (!t.checklist?.length) return false;
            return t.checklist.every((a) => a.checked === false);
          }).length,
          ["all", "unchecked", "not done", "zero", "trades"],
        ),
      ],
    },
  },
  {
    id: "hard-red-pair-violations",
    envId: red.id,
    title: "Non-whitelist pairs",
    message:
      "My plan only allows EURUSD and GBPUSD. Which trades are off-whitelist pairs?",
    expect: {
      ...strategyTools(),
      facts: [
        {
          type: "anyOf",
          label: "usdjpy",
          patterns: [/USDJPY/i],
        },
        {
          type: "noneOf",
          label: "no-fake-pair",
          patterns: [/BTCUSD/i, /AAPL/i],
        },
      ],
    },
  },

  // ── Weird phrasing / traps ────────────────────────────────────────
  {
    id: "hard-phrase-eighty-percent",
    envId: lab.id,
    title: "Colloquial 'four fifths of the checklist'",
    message:
      "How many trades only hit four fifths of the checklist — not full, not less?",
    expect: {
      ...readTools(),
      facts: [
        countFact("four-fifths", labExactly80.length, [
          "four fifths",
          "4/5",
          "80",
          "trades",
        ]),
      ],
    },
  },
  {
    id: "hard-phrase-two-to-one",
    envId: lab.id,
    title: "Colloquial 'worse than two-to-one'",
    message:
      "Show me trades set up worse than two-to-one on the planned stop/target distance, but only if the stop was 10 pips or more.",
    expect: {
      ...readTools(),
      facts: [
        countFact("worse-2to1", labRrLt2SlGe10.length, [
          "trades",
          "worse",
          "two-to-one",
          "2",
        ]),
      ],
    },
  },
  {
    id: "hard-phrase-process-edge",
    envId: lab.id,
    title: "Did process edge hold on A+ only",
    message:
      "On A+ tagged closed trades only, is expectancy positive?",
    expect: {
      ...readTools("get_stats"),
      facts: (() => {
        const avg = computeStats(
          labAPlus.filter((t) => t.result !== "open"),
        ).avgR;
        return [
          {
            type: "anyOf",
            label: "aplus-pos",
            patterns:
              avg > 0
                ? [/yes/i, /positive/i, /\+/]
                : [/no/i, /negative/i, /flat/i],
          },
        ];
      })(),
    },
  },
  {
    id: "hard-trap-all-checklist-means-wins",
    envId: lab.id,
    title: "Reject 'full checklist always wins' myth",
    message:
      "Is it true that every full-checklist trade in my journal was a win?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "not-true",
          patterns: [/no/i, /false/i, /not true/i, /loss/i],
        },
        {
          type: "anyOf",
          label: "cite-loss",
          patterns: [/GBPUSD/i, /USDJPY/i, /el04/i, /el10/i, /loss/i],
        },
      ],
    },
  },
  {
    id: "hard-trap-open-in-winrate",
    envId: lab.id,
    title: "Open trade must not inflate win rate",
    message:
      "When you quote my win rate, confirm whether the open GBPUSD is included in the denominator.",
    expect: {
      ...readTools("get_stats"),
      facts: [
        {
          type: "anyOf",
          label: "open-excluded",
          patterns: [
            /not included/i,
            /exclud/i,
            /closed only/i,
            /open .*not/i,
            /doesn't count/i,
            /do not count/i,
            /closed trades/i,
          ],
        },
      ],
    },
  },
  {
    id: "hard-multiturn-filter-then-stats",
    envId: lab.id,
    title: "Multi-turn: list RR<2 SL≥10 then their net R",
    message:
      "List trades with planned RR under 2 and SL at least 10 pips.",
    followUp: "What is the combined total R of just those trades (closed only)?",
    expect: {
      ...readTools(),
      facts: [
        countFact("list-count", labRrLt2SlGe10.length, ["trades"]),
      ],
    },
    expectFollowUp: {
      requireTools: ["query_trades"],
      facts: [
        {
          type: "number",
          label: "subset-r",
          value: computeStats(
            labRrLt2SlGe10.filter((t) => t.result !== "open"),
          ).totalR,
          tolerance: 0.4,
          near: ["r", "total", "combined", "net"],
        },
      ],
    },
  },
  {
    id: "hard-referenced-checklist-pct",
    envId: lab.id,
    title: "Referenced trade checklist %",
    message: "What % of checklist items are checked on this trade?",
    referencedTradeId: "el02",
    expect: {
      requireTools: ["get_trade"],
      facts: [
        {
          type: "anyOf",
          label: "ref-80",
          patterns: [/80%/i, /4\s*\/\s*5/i, /0\.8/],
        },
      ],
    },
  },
  {
    id: "hard-patch-wrong-id-guard",
    envId: lab.id,
    title: "Update the 80% EURUSD loss not the A+ win",
    message:
      "On the EURUSD long that only had 80% checklist and lost, add tag process-leak.",
    expect: {
      requireTools: ["annotate_trade"],
      actions: { mustProposeUpdateId: "el02" },
      custom: (r) => {
        const tools = new Set(r.tools.map((t) => t.name));
        if (!tools.has("find_trade") && !tools.has("query_trades") && !tools.has("get_trade")) {
          return ["Expected a lookup tool before annotate"];
        }
        const updates = [
          ...(r.actions.updateTrades ?? []),
          ...(r.actions.updateTrade ? [r.actions.updateTrade] : []),
        ];
        if (updates.some((u) => u.id === "el01")) {
          return ["Incorrectly targeted A+ win el01"];
        }
        return [];
      },
    },
  },

  // ── More combinatorial grinders (fill to ~100) ────────────────────
  {
    id: "hard-count-wins-rr-ge2-full-cl",
    envId: lab.id,
    title: "Wins with RR≥2 and full checklist",
    message:
      "How many wins have planned RR ≥ 2 and a full checklist?",
    expect: {
      ...readTools(),
      facts: [
        countFact(
          "win-rr2-full",
          lab.trades.filter(
            (t) =>
              t.result === "win" &&
              completion(t) === 1 &&
              (rr(t) ?? 0) >= 2,
          ).length,
          ["win", "wins", "RR", "full", "checklist", "trades"],
        ),
      ],
    },
  },
  {
    id: "hard-count-losses-incomplete",
    envId: lab.id,
    title: "Losses with incomplete checklist",
    message: "Count losses where checklist completion is under 100%.",
    expect: {
      ...readTools(),
      facts: [
        countFact(
          "loss-incomplete",
          lab.trades.filter(
            (t) => t.result === "loss" && completion(t) !== 1,
          ).length,
          ["loss", "losses", "incomplete", "under", "trades"],
        ),
      ],
    },
  },
  {
    id: "hard-pct-of-book-full-cl",
    envId: lab.id,
    title: "What % of all trades are full checklist",
    message:
      "What percentage of all journal trades (including open) are 100% checklist complete? Round to nearest whole percent.",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "number",
          label: "pct-full",
          value: Math.round((labFullChecklist.length / lab.trades.length) * 100),
          tolerance: 1,
          allowRoundedInt: true,
          near: ["%", "percent", "full", "checklist"],
        },
      ],
    },
  },
  {
    id: "hard-median-sl",
    envId: lab.id,
    title: "Median SL pips",
    message: "What is the median stop distance in pips across all trades that have slPips?",
    expect: {
      ...readTools(),
      facts: (() => {
        const vals = lab.trades
          .map((t) => t.slPips)
          .filter((n): n is number => typeof n === "number")
          .sort((a, b) => a - b);
        const mid = Math.floor(vals.length / 2);
        const median =
          vals.length % 2 === 0
            ? (vals[mid - 1]! + vals[mid]!) / 2
            : vals[mid]!;
        return [
          {
            type: "number",
            label: "median-sl",
            value: median,
            tolerance: 1,
            allowRoundedInt: true,
            near: ["median", "pips", "stop", "sl"],
          },
        ];
      })(),
    },
  },
  {
    id: "hard-avg-planned-rr-wins",
    envId: lab.id,
    title: "Average planned RR on wins",
    message: "Average planned RR (tp/sl) among winning trades?",
    expect: {
      ...readTools(),
      facts: (() => {
        const wins = lab.trades.filter((t) => t.result === "win");
        const avg =
          wins.reduce((s, t) => s + (rr(t) ?? 0), 0) / (wins.length || 1);
        return [
          {
            type: "number",
            label: "avg-rr-wins",
            value: avg,
            tolerance: 0.25,
            near: ["average", "avg", "planned", "RR", "win"],
          },
        ];
      })(),
    },
  },
  {
    id: "hard-symbols-never-full-cl",
    envId: lab.id,
    title: "Symbols with zero full-checklist trades",
    message:
      "Which symbols never appear with a 100% checklist trade?",
    expect: {
      ...readTools(),
      facts: (() => {
        const fullSyms = new Set(
          labFullChecklist.map((t) => t.symbol),
        );
        const never = [
          ...new Set(lab.trades.map((t) => t.symbol)),
        ].filter((s) => !fullSyms.has(s));
        return [
          {
            type: "allOf",
            label: "never-full",
            patterns: never.map((s) => new RegExp(s, "i")),
          },
        ];
      })(),
    },
  },
  {
    id: "hard-date-most-trades",
    envId: lab.id,
    title: "Busiest trade date",
    message: "Which date has the most trades logged?",
    expect: {
      ...readTools(),
      facts: (() => {
        const counts = new Map<string, number>();
        for (const t of lab.trades) {
          counts.set(t.date, (counts.get(t.date) ?? 0) + 1);
        }
        let best = "";
        let n = 0;
        for (const [d, c] of counts) {
          if (c > n) {
            best = d;
            n = c;
          }
        }
        return [
          {
            type: "anyOf",
            label: "busiest",
            patterns: [best, /July 3/i, /July 8/i, /July 9/i, /July 11/i, /July 14/i],
          },
          countFact("busiest-n", n, ["trades", "most", String(n)]),
        ];
      })(),
    },
  },
  {
    id: "hard-net-pnl-incomplete-only",
    envId: lab.id,
    title: "PnL on incomplete checklist closed trades",
    message:
      "Total $ PnL for closed trades that are not 100% checklist complete?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "number",
          label: "pnl-incomplete",
          value: computeStats(
            labClosed.filter((t) => completion(t) !== 1),
          ).totalPnlUsd,
          tolerance: 25,
          allowRoundedInt: true,
          near: ["pnl", "p&l", "$", "usd", "incomplete"],
        },
      ],
    },
  },
  {
    id: "hard-risk-usd-uniform",
    envId: lab.id,
    title: "Is riskUsd always 100?",
    message: "Is every trade risking exactly $100?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "risk-100",
          patterns: [/yes/i, /all .*100/i, /every .*100/i, /\$100/],
        },
      ],
    },
  },
  {
    id: "hard-side-long-ge80-wr",
    envId: lab.id,
    title: "Win rate of long trades with ≥80% checklist",
    message:
      "Win rate for closed LONGs that have at least 80% checklist completion?",
    expect: {
      ...readTools("get_stats"),
      facts: (() => {
        const pool = labClosed.filter(
          (t) => t.side === "long" && (completion(t) ?? 0) >= 0.8,
        );
        const s = computeStats(pool);
        return [
          {
            type: "number",
            label: "long80-wr",
            value: s.winRate,
            tolerance: 2.5,
            allowRoundedInt: true,
            near: ["win rate", "%", "long"],
          },
        ];
      })(),
    },
  },
  {
    id: "hard-shorts-asian-forbidden",
    envId: lab.id,
    title: "Any shorts in Asian?",
    message: "Did I short anything during Asian session?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "allOf",
          label: "asian-short",
          patterns: [/yes/i, /XAUUSD/i],
        },
      ],
    },
  },
  {
    id: "hard-count-tags-a-plus",
    envId: lab.id,
    title: "A+ tag count",
    message: "How many trades are tagged A+?",
    expect: {
      ...readTools(),
      facts: [countFact("aplus-n", labAPlus.length, ["A+", "tagged", "trades"])],
    },
  },
  {
    id: "hard-live-tag-open",
    envId: lab.id,
    title: "Live tag should be the open",
    message: "Which trade has the live tag, and is it open?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "allOf",
          label: "live-open",
          patterns: [/GBPUSD/i, /open/i, /live/i],
        },
      ],
    },
  },
  {
    id: "hard-compare-eur-vs-gbp-r",
    envId: lab.id,
    title: "EURUSD vs GBPUSD net R",
    message:
      "Compare total R for closed EURUSD vs closed GBPUSD — which is better?",
    expect: {
      ...readTools(),
      facts: (() => {
        const eur = computeStats(
          labClosed.filter((t) => t.symbol === "EURUSD"),
        ).totalR;
        const gbp = computeStats(
          labClosed.filter((t) => t.symbol === "GBPUSD"),
        ).totalR;
        const better = eur >= gbp ? /EURUSD/i : /GBPUSD/i;
        return [
          {
            type: "number",
            label: "eur-r",
            value: eur,
            tolerance: 0.4,
            near: ["EURUSD", "r"],
          },
          {
            type: "number",
            label: "gbp-r",
            value: gbp,
            tolerance: 0.4,
            near: ["GBPUSD", "r"],
          },
          { type: "anyOf", label: "winner-pair", patterns: [better] },
        ];
      })(),
    },
  },
  {
    id: "hard-missed-sweep-item",
    envId: lab.id,
    title: "Trades missing liquidity sweep check",
    message:
      "How many trades failed to check 'Liquidity sweep confirmed'?",
    expect: {
      ...readTools("get_strategy"),
      facts: [
        countFact(
          "miss-sweep",
          lab.trades.filter((t) => {
            if (!hasChecklistAnswers(t)) return true;
            return t.checklist?.find((a) => a.id === "el-sweep")?.checked !== true;
          }).length,
          ["sweep", "liquidity", "failed", "unchecked", "trades"],
        ),
      ],
    },
  },
  {
    id: "hard-el20-violations-despite-win",
    envId: lab.id,
    title: "el20 win still broke SL≥10 rule",
    message:
      "My +4R EURUSD win with the 5-pip stop — did it follow the plan's minimum stop rule?",
    expect: {
      ...strategyTools(),
      facts: [
        {
          type: "anyOf",
          label: "broke-sl-rule",
          patterns: [/no/i, /not/i, /broke/i, /violat/i, /under 10/i, /5 pip/i],
        },
      ],
    },
  },
  {
    id: "hard-empty-intersection",
    envId: lab.id,
    title: "Empty intersection honesty",
    message:
      "How many Asian-session A+-tagged full-checklist wins do I have?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "zero-intersection",
          patterns: [/\b0\b/, /none/i, /zero/i, /no trades/i, /don't have/i],
        },
      ],
    },
  },
  {
    id: "hard-breakeven-in-winrate-denom",
    envId: lab.id,
    title: "Explain BE in win-rate denominator",
    message:
      "I have a breakeven trade. Does it count in the win-rate denominator for get_stats?",
    expect: {
      ...readTools("get_stats"),
      facts: [
        {
          type: "anyOf",
          label: "be-in-denom",
          patterns: [
            /yes/i,
            /included/i,
            /counts/i,
            /denominator/i,
            /closed/i,
          ],
        },
      ],
    },
  },
  {
    id: "hard-strategy-max-fomo",
    envId: lab.id,
    title: "FOMO max 1/week rule breach",
    message:
      "Plan says max 1 FOMO-tagged trade per week. How many FOMO trades do I have in the whole journal, and is that a breach if they fall in one week?",
    expect: {
      ...strategyTools(),
      facts: [
        countFact("fomo-n", labFomo.length, ["FOMO", "trades"]),
        {
          type: "anyOf",
          label: "breach-or-note",
          patterns: [/breach/i, /over/i, /more than/i, /2/i, /yes/i, /violate/i],
        },
      ],
    },
  },
  {
    id: "hard-ict-london-wins-r",
    envId: ict.id,
    title: "ICT London wins total R",
    message: "Total R from London-session wins only.",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "number",
          label: "ict-london-win-r",
          value: computeStats(
            ict.trades.filter(
              (t) => t.session === "London" && t.result === "win",
            ),
          ).totalR,
          tolerance: 0.3,
          near: ["London", "win", "r", "total"],
        },
      ],
    },
  },
  {
    id: "hard-ict-open-not-in-rr-filter",
    envId: ict.id,
    title: "Open trade excluded from closed RR ask",
    message:
      "Among CLOSED trades with planned RR of 2 from pips, how many are still open? (trick question)",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "zero-open-in-closed",
          patterns: [/\b0\b/, /none/i, /zero/i, /no .*open/i, /contradiction/i, /closed/i],
        },
      ],
    },
  },
  {
    id: "hard-red-session-violation-r",
    envId: red.id,
    title: "R from session-violation tagged trades",
    message: "Net R on trades tagged session-violation.",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "number",
          label: "session-viol-r",
          value: computeStats(
            red.trades.filter((t) => t.tags?.includes("session-violation")),
          ).totalR,
          tolerance: 0.3,
          near: ["r", "session", "violation", "net", "total"],
        },
      ],
    },
  },
  {
    id: "hard-lab-wins-with-sl-lt10",
    envId: lab.id,
    title: "Wins that used illegal tight stops",
    message: "Which wins used a stop under 10 pips?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "win-tight",
          patterns: [/el03/i, /el20/i, /GBPUSD/i, /EURUSD/i, /8/i, /5/i],
        },
      ],
    },
  },
  {
    id: "hard-lab-count-closed",
    envId: lab.id,
    title: "Edge lab closed trade count",
    message: "Exact closed trade count in this journal?",
    expect: {
      ...readTools("get_stats"),
      facts: [
        countFact("closed-n", labClosed.length, ["closed", "trades"]),
      ],
    },
  },
  {
    id: "hard-lab-open-count",
    envId: lab.id,
    title: "Edge lab open count",
    message: "How many open trades?",
    expect: {
      ...readTools(),
      facts: [
        countFact(
          "open-n",
          lab.trades.filter((t) => t.result === "open").length,
          ["open", "live", "trades"],
        ),
      ],
    },
  },
  {
    id: "hard-lab-best-r-trade",
    envId: lab.id,
    title: "Best realized R trade",
    message: "Which trade has the best realized R-multiple?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "best-r",
          patterns: [/el20/i, /\+?4(\.0)?\s*r/i, /EURUSD/i],
        },
      ],
    },
  },
  {
    id: "hard-lab-worst-r-trade",
    envId: lab.id,
    title: "Worst realized R trade",
    message: "Which trade has the worst realized R-multiple?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "worst-r",
          patterns: [/el16/i, /-1\.5/i, /EURUSD/i],
        },
      ],
    },
  },
  {
    id: "hard-lab-setup-all-same",
    envId: lab.id,
    title: "Are all setups Edge Lab?",
    message: "Do all trades share the same setup name?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "same-setup",
          patterns: [/yes/i, /Edge Lab/i, /all .*Edge Lab/i],
        },
      ],
    },
  },
  {
    id: "hard-lab-notes-contain-fomo-word",
    envId: lab.id,
    title: "Notes mentioning FOMO vs tag",
    message:
      "How many trades mention FOMO in notes or tags combined (unique trades)?",
    expect: {
      ...readTools(),
      facts: [
        countFact(
          "fomo-mentions",
          lab.trades.filter(
            (t) =>
              t.tags?.includes("fomo") ||
              (t.notes ?? "").toLowerCase().includes("fomo"),
          ).length,
          ["FOMO", "trades", "notes", "tags"],
        ),
      ],
    },
  },
  {
    id: "hard-lab-rr2-sl10-full-cl-wins",
    envId: lab.id,
    title: "Perfect-process wins: RR≥2 SL≥10 full CL",
    message:
      "How many wins satisfy ALL of: planned RR ≥ 2, SL ≥ 10 pips, full checklist?",
    expect: {
      ...readTools(),
      facts: [
        countFact(
          "perfect-wins",
          lab.trades.filter(
            (t) =>
              t.result === "win" &&
              completion(t) === 1 &&
              (rr(t) ?? 0) >= 2 &&
              (t.slPips ?? 0) >= 10,
          ).length,
          ["win", "wins", "all", "RR", "checklist", "trades"],
        ),
      ],
    },
  },
  {
    id: "hard-lab-counterfactual-perfect-only-pnl",
    envId: lab.id,
    title: "PnL if only perfect-process wins+losses (RR≥2 SL≥10 full CL)",
    message:
      "If I only kept closed trades that had full checklist AND planned RR ≥ 2 AND SL ≥ 10, what is total PnL and total R?",
    expect: {
      ...strategyTools(),
      facts: (() => {
        const pool = labClosed.filter(
          (t) =>
            completion(t) === 1 &&
            (rr(t) ?? 0) >= 2 &&
            (t.slPips ?? 0) >= 10,
        );
        const s = computeStats(pool);
        return [
          {
            type: "number",
            label: "perfect-r",
            value: s.totalR,
            tolerance: 0.4,
            near: ["r", "total", "net"],
          },
          {
            type: "number",
            label: "perfect-pnl",
            value: s.totalPnlUsd,
            tolerance: 30,
            allowRoundedInt: true,
            near: ["pnl", "p&l", "$", "usd"],
          },
        ];
      })(),
    },
  },
  {
    id: "hard-lab-share-of-losses-from-lt80",
    envId: lab.id,
    title: "What share of losses are <80% checklist",
    message:
      "Of my losing trades, what fraction had under 80% checklist completion? Answer as a percentage.",
    expect: {
      ...readTools(),
      facts: (() => {
        const losses = lab.trades.filter((t) => t.result === "loss");
        const lt80 = losses.filter((t) => (completion(t) ?? 1) < 0.8);
        const pct = Math.round((lt80.length / losses.length) * 100);
        return [
          {
            type: "number",
            label: "loss-lt80-pct",
            value: pct,
            tolerance: 2,
            allowRoundedInt: true,
            near: ["%", "percent", "loss", "80", "fraction"],
          },
        ];
      })(),
    },
  },
  {
    id: "hard-lab-three-filters-empty",
    envId: lab.id,
    title: "Triple filter that should be empty",
    message:
      "How many Asian FOMO wins with full checklist and SL under 5 pips?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "anyOf",
          label: "empty-triple",
          patterns: [/\b0\b/, /none/i, /zero/i, /no trades/i],
        },
      ],
    },
  },
  {
    id: "hard-lab-checklist-item-count",
    envId: lab.id,
    title: "Strategy checklist length",
    message: "How many checklist items does my strategy define?",
    expect: {
      requireTools: ["get_strategy"],
      facts: [
        countFact("cl-items", lab.strategy.checklist!.length, [
          "checklist",
          "items",
          "5",
        ]),
      ],
    },
  },
  {
    id: "hard-lab-avg-completion",
    envId: lab.id,
    title: "Average checklist completion across answered trades",
    message:
      "Average checklist completion % across trades that have checklist answers (ignore trades with no checklist). Round to nearest percent.",
    expect: {
      ...readTools(),
      facts: (() => {
        const answered = lab.trades.filter((t) => hasChecklistAnswers(t));
        const avg =
          answered.reduce((s, t) => s + (completion(t) ?? 0), 0) /
          answered.length;
        return [
          {
            type: "number",
            label: "avg-completion",
            value: Math.round(avg * 100),
            tolerance: 3,
            allowRoundedInt: true,
            near: ["average", "avg", "%", "completion", "checklist"],
          },
        ];
      })(),
    },
  },
  {
    id: "hard-lab-ny-vs-london-wr",
    envId: lab.id,
    title: "London vs NY closed win rate",
    message:
      "Compare closed win rate London vs New York. Which session is higher?",
    expect: {
      ...readTools("get_stats"),
      facts: (() => {
        const london = computeStats(
          labClosed.filter((t) => t.session === "London"),
        ).winRate;
        const ny = computeStats(
          labClosed.filter((t) => t.session === "New York"),
        ).winRate;
        return [
          {
            type: "number",
            label: "london-wr",
            value: london,
            tolerance: 3,
            allowRoundedInt: true,
            near: ["London", "win rate", "%"],
          },
          {
            type: "number",
            label: "ny-wr",
            value: ny,
            tolerance: 3,
            allowRoundedInt: true,
            near: ["New York", "NY", "win rate", "%"],
          },
          {
            type: "anyOf",
            label: "higher-session",
            patterns:
              london >= ny
                ? [/London/i]
                : [/New York/i, /\bNY\b/],
          },
        ];
      })(),
    },
  },
  {
    id: "hard-lab-if-skipped-all-asian",
    envId: lab.id,
    title: "Total R if all Asian trades removed",
    message:
      "What would closed total R be if I never took the Asian-session trades?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "number",
          label: "r-no-asian",
          value: computeStats(
            labClosed.filter((t) => t.session !== "Asian"),
          ).totalR,
          tolerance: 0.4,
          near: ["r", "total", "without", "Asian", "skip"],
        },
      ],
    },
  },
  {
    id: "hard-lab-if-skipped-fomo-and-revenge",
    envId: lab.id,
    title: "R without FOMO or revenge tags",
    message:
      "Closed total R excluding any trade tagged fomo or revenge?",
    expect: {
      ...readTools(),
      facts: [
        {
          type: "number",
          label: "r-clean-tags",
          value: computeStats(
            labClosed.filter(
              (t) =>
                !t.tags?.includes("fomo") && !t.tags?.includes("revenge"),
            ),
          ).totalR,
          tolerance: 0.4,
          near: ["r", "total", "excluding", "without", "fomo", "revenge"],
        },
      ],
    },
  },
  {
    id: "hard-lab-sl10-rr2-incomplete-losses",
    envId: lab.id,
    title: "Losses: SL≥10 RR≥2 but incomplete checklist",
    message:
      "Losing trades that met SL≥10 and planned RR≥2 but did NOT finish the checklist — count?",
    expect: {
      ...readTools(),
      facts: [
        countFact(
          "geo-ok-process-bad",
          lab.trades.filter(
            (t) =>
              t.result === "loss" &&
              (t.slPips ?? 0) >= 10 &&
              (rr(t) ?? 0) >= 2 &&
              completion(t) !== 1,
          ).length,
          ["loss", "losses", "checklist", "trades", "incomplete"],
        ),
      ],
    },
  },
  {
    id: "hard-lab-dual-condition-count-match",
    envId: lab.id,
    title: "Verify count of RR<2 & SL≥10 matches list length",
    message:
      "Give me ONLY the integer count of trades with planned RR < 2 and SL ≥ 10 pips — no other numbers.",
    expect: {
      ...readTools(),
      facts: [
        countFact("only-count", labRrLt2SlGe10.length, [
          "trades",
          String(labRrLt2SlGe10.length),
        ]),
      ],
      custom: (r) => {
        // Soft: reply should contain the count; don't fail on extra numbers too harshly
        if (!r.reply.includes(String(labRrLt2SlGe10.length))) {
          return [`Reply missing count ${labRrLt2SlGe10.length}`];
        }
        return [];
      },
    },
  },
];

// Ensure we actually shipped ~100 hard scenarios.
if (HARD_CHAT_SCENARIOS.length < 100) {
  throw new Error(
    `Expected ≥100 hard scenarios, got ${HARD_CHAT_SCENARIOS.length}`,
  );
}
