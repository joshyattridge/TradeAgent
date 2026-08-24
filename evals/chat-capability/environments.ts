import { seedStrategy, seedTrades } from "@/lib/seed-data";
import type { Strategy, Trade } from "@/lib/types";

export type JournalEnvironment = {
  id: string;
  label: string;
  description: string;
  strategy: Strategy;
  trades: Trade[];
};

const R = 100;

function trade(partial: Partial<Trade> & Pick<Trade, "id" | "date" | "symbol">): Trade {
  return {
    side: "long",
    entry: 1,
    stop: 0.99,
    target: 1.02,
    rMultiple: 0,
    result: "open",
    riskUsd: R,
    ...partial,
  };
}

const orStrategy: Strategy = {
  name: "Opening Range Breakout",
  markdown: `# Opening Range Breakout

Scalp the first 15-minute range break during New York open.

## Rules

- Only trade NAS100 and ES during New York open (09:30–10:30 ET).
- Long only above OR high; short only below OR low.
- Stop is the opposite side of the opening range.
- Target is 1.5R minimum; trail after 1R.
- Max 3 trades per day. Soft stop −4R / day.

## Checklist

Pre-trade: OR printed, volume above 20-session average, no FOMC / NFP.
`,
  checklist: [
    { id: "or-range", label: "15m opening range printed" },
    { id: "or-vol", label: "Volume above 20-session average" },
    { id: "or-news", label: "No FOMC / NFP window" },
  ],
  updatedAt: "2026-07-01T00:00:00.000Z",
};

const meanRevertStrategy: Strategy = {
  name: "London Mean Reversion",
  markdown: `# London Mean Reversion

Fade extremes into London killzone on major FX only.

## Edge

EURUSD / GBPUSD only. Fade 1H deviation ≥ 1.5 ATR back toward VWAP.

## Risk

- Risk 0.5R fixed ($50) per trade.
- Soft stop −3R / week.
- Max 4 trades / week.
- Never trade Asian session.
- Never average into a loser.

## Targets

Win rate 55–65%. Avg R ≥ 0.8. Expectancy ≥ +0.25R.
`,
  checklist: [
    { id: "mr-pair", label: "EURUSD or GBPUSD only" },
    { id: "mr-dev", label: "1H deviation ≥ 1.5 ATR from VWAP" },
    { id: "mr-session", label: "London killzone only" },
  ],
  updatedAt: "2026-06-15T00:00:00.000Z",
};

const redMonthChecklist = meanRevertStrategy.checklist!.map((item) => ({
  id: item.id,
  label: item.label,
  checked: false,
}));

/** Seed ICT book — mixed symbols, open GBPUSD, known stats. */
export const envIctSeed: JournalEnvironment = {
  id: "ict-seed",
  label: "ICT FVG seed journal",
  description: "Default seed strategy + 11 trades (10 closed, 1 open GBPUSD short).",
  strategy: structuredClone(seedStrategy),
  trades: structuredClone(seedTrades),
};

/** Strategy present, zero trades. */
export const envEmptyBook: JournalEnvironment = {
  id: "empty-book",
  label: "Empty journal",
  description: "Named strategy with checklist but no trades logged.",
  strategy: structuredClone(orStrategy),
  trades: [],
};

/** Heavy losing month with rule breaks and FOMO tags. */
export const envRedMonth: JournalEnvironment = {
  id: "red-month",
  label: "Red mean-reversion month",
  description: "2 wins / 8 losses, −4.4R, FOMO + Asian violations vs London-only plan.",
  strategy: structuredClone(meanRevertStrategy),
  trades: [
    trade({
      id: "rm1",
      date: "2026-07-01",
      symbol: "EURUSD",
      side: "short",
      entry: 1.172,
      stop: 1.174,
      target: 1.168,
      exit: 1.168,
      rMultiple: 2,
      result: "win",
      pnlUsd: 100,
      session: "London",
      tags: ["a+"],
      checklist: meanRevertStrategy.checklist!.map((c) => ({ ...c, checked: true })),
    }),
    trade({
      id: "rm2",
      date: "2026-07-02",
      symbol: "GBPUSD",
      side: "long",
      entry: 1.35,
      stop: 1.348,
      target: 1.354,
      exit: 1.348,
      rMultiple: -1,
      result: "loss",
      pnlUsd: -50,
      session: "London",
      tags: ["fomo"],
      notes: "Chased after missing the first touch.",
      checklist: redMonthChecklist,
    }),
    trade({
      id: "rm3",
      date: "2026-07-03",
      symbol: "EURUSD",
      side: "long",
      entry: 1.168,
      stop: 1.166,
      target: 1.172,
      exit: 1.166,
      rMultiple: -1,
      result: "loss",
      pnlUsd: -50,
      session: "Asian",
      tags: ["session-violation"],
      notes: "Traded Asian — broke London-only rule.",
      checklist: redMonthChecklist.map((c) =>
        c.id === "mr-session" ? { ...c, checked: false } : { ...c, checked: true },
      ),
    }),
    trade({
      id: "rm4",
      date: "2026-07-04",
      symbol: "USDJPY",
      side: "short",
      entry: 157.2,
      stop: 157.4,
      target: 156.8,
      exit: 157.4,
      rMultiple: -1,
      result: "loss",
      pnlUsd: -50,
      session: "London",
      tags: ["pair-violation"],
      notes: "USDJPY not on whitelist.",
      checklist: redMonthChecklist,
    }),
    trade({
      id: "rm5",
      date: "2026-07-07",
      symbol: "EURUSD",
      side: "short",
      entry: 1.175,
      stop: 1.177,
      target: 1.171,
      exit: 1.177,
      rMultiple: -1,
      result: "loss",
      pnlUsd: -50,
      session: "London",
      tags: ["revenge"],
    }),
    trade({
      id: "rm6",
      date: "2026-07-08",
      symbol: "GBPUSD",
      side: "short",
      entry: 1.356,
      stop: 1.358,
      target: 1.352,
      exit: 1.352,
      rMultiple: 2,
      result: "win",
      pnlUsd: 100,
      session: "London",
      tags: ["a+"],
      checklist: meanRevertStrategy.checklist!.map((c) => ({ ...c, checked: true })),
    }),
    trade({
      id: "rm7",
      date: "2026-07-09",
      symbol: "EURUSD",
      side: "long",
      entry: 1.17,
      stop: 1.168,
      target: 1.174,
      exit: 1.168,
      rMultiple: -1,
      result: "loss",
      pnlUsd: -50,
      session: "New York",
      tags: ["session-violation", "fomo"],
    }),
    trade({
      id: "rm8",
      date: "2026-07-10",
      symbol: "GBPUSD",
      side: "long",
      entry: 1.349,
      stop: 1.347,
      target: 1.353,
      exit: 1.347,
      rMultiple: -1,
      result: "loss",
      pnlUsd: -50,
      session: "London",
      tags: ["averaged"],
      notes: "Averaged into loser — forbidden.",
    }),
    trade({
      id: "rm9",
      date: "2026-07-11",
      symbol: "EURUSD",
      side: "short",
      entry: 1.173,
      stop: 1.175,
      target: 1.169,
      exit: 1.175,
      rMultiple: -1,
      result: "loss",
      pnlUsd: -50,
      session: "London",
      tags: ["fomo"],
    }),
    trade({
      id: "rm10",
      date: "2026-07-14",
      symbol: "GBPUSD",
      side: "short",
      entry: 1.36,
      stop: 1.362,
      target: 1.356,
      exit: 1.362,
      rMultiple: -1.4,
      result: "loss",
      pnlUsd: -70,
      session: "London",
      tags: ["oversized"],
      notes: "Moved stop — realized −1.4R.",
    }),
  ],
};

/** High win-rate NQ ORB scalps. */
export const envNqScalper: JournalEnvironment = {
  id: "nq-scalper",
  label: "NQ opening-range scalper",
  description: "12 closed NAS100 trades + 1 open ES; 9 wins / 2 losses / 1 BE.",
  strategy: structuredClone(orStrategy),
  trades: [
    trade({
      id: "nq1",
      date: "2026-07-20",
      symbol: "NAS100",
      side: "long",
      entry: 20500,
      stop: 20470,
      target: 20545,
      exit: 20545,
      rMultiple: 1.5,
      result: "win",
      pnlUsd: 150,
      session: "New York",
      tags: ["orb"],
    }),
    trade({
      id: "nq2",
      date: "2026-07-20",
      symbol: "NAS100",
      side: "short",
      entry: 20560,
      stop: 20590,
      target: 20515,
      exit: 20590,
      rMultiple: -1,
      result: "loss",
      pnlUsd: -100,
      session: "New York",
      tags: ["orb", "late"],
    }),
    trade({
      id: "nq3",
      date: "2026-07-21",
      symbol: "NAS100",
      side: "long",
      entry: 20610,
      stop: 20585,
      target: 20647,
      exit: 20647,
      rMultiple: 1.5,
      result: "win",
      pnlUsd: 150,
      session: "New York",
    }),
    trade({
      id: "nq4",
      date: "2026-07-21",
      symbol: "NAS100",
      side: "long",
      entry: 20650,
      stop: 20625,
      target: 20687,
      exit: 20687,
      rMultiple: 1.5,
      result: "win",
      pnlUsd: 150,
      session: "New York",
    }),
    trade({
      id: "nq5",
      date: "2026-07-22",
      symbol: "NAS100",
      side: "short",
      entry: 20700,
      stop: 20725,
      target: 20662,
      exit: 20662,
      rMultiple: 1.5,
      result: "win",
      pnlUsd: 150,
      session: "New York",
    }),
    trade({
      id: "nq6",
      date: "2026-07-22",
      symbol: "NAS100",
      side: "short",
      entry: 20680,
      stop: 20705,
      target: 20642,
      exit: 20680,
      rMultiple: 0,
      result: "breakeven",
      pnlUsd: 0,
      session: "New York",
      tags: ["be"],
      notes: "Scratched at entry after news spike.",
    }),
    trade({
      id: "nq7",
      date: "2026-07-23",
      symbol: "NAS100",
      side: "long",
      entry: 20800,
      stop: 20770,
      target: 20845,
      exit: 20845,
      rMultiple: 1.5,
      result: "win",
      pnlUsd: 150,
      session: "New York",
    }),
    trade({
      id: "nq8",
      date: "2026-07-23",
      symbol: "NAS100",
      side: "long",
      entry: 20820,
      stop: 20795,
      target: 20857,
      exit: 20795,
      rMultiple: -1,
      result: "loss",
      pnlUsd: -100,
      session: "New York",
      tags: ["fourth-trade"],
      notes: "4th trade of day — over daily max of 3.",
    }),
    trade({
      id: "nq9",
      date: "2026-07-24",
      symbol: "NAS100",
      side: "short",
      entry: 20910,
      stop: 20935,
      target: 20872,
      exit: 20872,
      rMultiple: 1.5,
      result: "win",
      pnlUsd: 150,
      session: "New York",
    }),
    trade({
      id: "nq10",
      date: "2026-07-24",
      symbol: "NAS100",
      side: "long",
      entry: 20850,
      stop: 20825,
      target: 20887,
      exit: 20887,
      rMultiple: 1.5,
      result: "win",
      pnlUsd: 150,
      session: "New York",
    }),
    trade({
      id: "nq11",
      date: "2026-07-27",
      symbol: "NAS100",
      side: "long",
      entry: 21000,
      stop: 20970,
      target: 21045,
      exit: 21045,
      rMultiple: 1.5,
      result: "win",
      pnlUsd: 150,
      session: "New York",
    }),
    trade({
      id: "nq12",
      date: "2026-07-27",
      symbol: "NAS100",
      side: "short",
      entry: 21040,
      stop: 21065,
      target: 21002,
      exit: 21002,
      rMultiple: 1.5,
      result: "win",
      pnlUsd: 150,
      session: "New York",
    }),
    trade({
      id: "es-open",
      date: "2026-07-28",
      symbol: "ES",
      side: "long",
      entry: 5420,
      stop: 5412,
      target: 5432,
      rMultiple: 0,
      result: "open",
      session: "New York",
      notes: "Live ES ORB long — targeting 1.5R.",
      size: "2 contracts",
    }),
  ],
};

/** Multiple EURUSD rows with distinctive levels for find/disambiguation. */
export const envDuplicateEur: JournalEnvironment = {
  id: "duplicate-eurusd",
  label: "Duplicate EURUSD week",
  description: "Four EURUSD trades same week + one XAUUSD; tests identity / find_trade.",
  strategy: structuredClone(seedStrategy),
  trades: [
    trade({
      id: "dup-a",
      date: "2026-07-28",
      symbol: "EURUSD",
      side: "long",
      entry: 1.161,
      stop: 1.1585,
      target: 1.166,
      exit: 1.166,
      rMultiple: 2,
      result: "win",
      pnlUsd: 200,
      session: "London",
      notes: "First EURUSD — entry 1.1610.",
      tags: ["morning"],
    }),
    trade({
      id: "dup-b",
      date: "2026-07-28",
      symbol: "EURUSD",
      side: "long",
      entry: 1.1645,
      stop: 1.162,
      target: 1.1695,
      exit: 1.162,
      rMultiple: -1,
      result: "loss",
      pnlUsd: -100,
      session: "New York",
      notes: "Second EURUSD same day — entry 1.1645, stopped.",
      tags: ["afternoon"],
    }),
    trade({
      id: "dup-c",
      date: "2026-07-29",
      symbol: "EURUSD",
      side: "short",
      entry: 1.167,
      stop: 1.1695,
      target: 1.162,
      exit: undefined,
      rMultiple: 0,
      result: "open",
      session: "London",
      notes: "Open EURUSD short from 1.1670.",
      tags: ["live"],
    }),
    trade({
      id: "dup-d",
      date: "2026-07-30",
      symbol: "EURUSD",
      side: "short",
      entry: 1.17,
      stop: 1.1725,
      target: 1.165,
      exit: 1.17,
      rMultiple: 0,
      result: "breakeven",
      pnlUsd: 0,
      session: "London",
      notes: "Scratched IFVG short at 1.1700.",
      tags: ["be"],
    }),
    trade({
      id: "dup-xau",
      date: "2026-07-29",
      symbol: "XAUUSD",
      side: "long",
      entry: 2390,
      stop: 2382,
      target: 2406,
      exit: 2406,
      rMultiple: 2,
      result: "win",
      pnlUsd: 200,
      session: "London",
      notes: "Only gold trade this week.",
    }),
  ],
};

/** Mixed results including breakevens and two opens. */
export const envMixedBook: JournalEnvironment = {
  id: "mixed-book",
  label: "Mixed results book",
  description: "Wins, losses, BE, and two open positions across FX + gold.",
  strategy: {
    name: "Multi-Asset Swing",
    markdown: `# Multi-Asset Swing

Hold 1–3 days. Majors + gold only. No indices.

## Risk

Risk 1R ($100). Soft stop −5R / month. Never more than 2 open trades.
`,
    checklist: [
      { id: "sw-htf", label: "Daily bias clear" },
      { id: "sw-risk", label: "Risk sized to 1R" },
    ],
    updatedAt: "2026-07-01T00:00:00.000Z",
  },
  trades: [
    trade({
      id: "mx1",
      date: "2026-07-01",
      symbol: "EURUSD",
      side: "long",
      entry: 1.15,
      stop: 1.145,
      target: 1.16,
      exit: 1.16,
      rMultiple: 2,
      result: "win",
      pnlUsd: 200,
      session: "London",
    }),
    trade({
      id: "mx2",
      date: "2026-07-05",
      symbol: "GBPUSD",
      side: "short",
      entry: 1.34,
      stop: 1.345,
      target: 1.33,
      exit: 1.345,
      rMultiple: -1,
      result: "loss",
      pnlUsd: -100,
      session: "London",
    }),
    trade({
      id: "mx3",
      date: "2026-07-08",
      symbol: "XAUUSD",
      side: "long",
      entry: 2350,
      stop: 2335,
      target: 2380,
      exit: 2350,
      rMultiple: 0,
      result: "breakeven",
      pnlUsd: 0,
      session: "New York",
      tags: ["be"],
    }),
    trade({
      id: "mx4",
      date: "2026-07-12",
      symbol: "EURUSD",
      side: "short",
      entry: 1.162,
      stop: 1.167,
      target: 1.152,
      exit: 1.157,
      rMultiple: 1,
      result: "win",
      pnlUsd: 100,
      session: "New York",
    }),
    trade({
      id: "mx-open-1",
      date: "2026-07-28",
      symbol: "GBPUSD",
      side: "long",
      entry: 1.348,
      stop: 1.342,
      target: 1.36,
      rMultiple: 0,
      result: "open",
      session: "London",
      notes: "Open long GBPUSD from 1.3480.",
    }),
    trade({
      id: "mx-open-2",
      date: "2026-07-29",
      symbol: "XAUUSD",
      side: "short",
      entry: 2415,
      stop: 2430,
      target: 2385,
      rMultiple: 0,
      result: "open",
      session: "New York",
      notes: "Open short gold from 2415.",
    }),
  ],
};

/**
 * Dense edge-lab journal — engineered for checklist %, planned RR, SL filters,
 * counterfactuals, and weird multi-condition asks.
 * Strategy checklist has 5 items → 80% = exactly 4/5 checked.
 */
export const envEdgeLab: JournalEnvironment = (() => {
  const strategy: Strategy = {
    name: "Edge Lab Continuity",
    markdown: `# Edge Lab Continuity

Hard-mode test plan. Majors + gold + NAS100.

## Rules

- Planned RR must be ≥ 2.0 (tpPips / slPips).
- Stop distance must be ≥ 10 pips (or points).
- Full checklist (5/5) required before entry.
- London or New York only — never Asian.
- Max 1 FOMO-tagged trade per week; treat FOMO as a rule break.
- Soft stop −4R / week.

## Targets

Win rate ≥ 50% on full-checklist trades only. Expectancy ≥ +0.4R on A+ tags.
`,
    checklist: [
      { id: "el-bias", label: "HTF bias locked" },
      { id: "el-pd", label: "Premium/discount correct" },
      { id: "el-poi", label: "Valid POI" },
      { id: "el-sweep", label: "Liquidity sweep confirmed" },
      { id: "el-entry", label: "Entry model followed" },
    ],
    updatedAt: "2026-07-01T00:00:00.000Z",
  };

  const all = strategy.checklist!.map((c) => c.id);
  const pct80 = ["el-bias", "el-pd", "el-poi", "el-sweep"]; // 4/5
  const pct60 = ["el-bias", "el-pd", "el-poi"]; // 3/5
  const pct40 = ["el-bias", "el-pd"]; // 2/5
  const pct20 = ["el-bias"]; // 1/5

  const mk = (
    partial: Partial<Trade> & Pick<Trade, "id" | "date" | "symbol">,
    checkedIds?: string[] | null,
  ): Trade => ({
    side: "long",
    entry: 1.1,
    stop: 1.09,
    target: 1.12,
    rMultiple: 0,
    result: "open",
    riskUsd: 100,
    session: "London",
    ...partial,
    checklist:
      checkedIds === null
        ? undefined
        : answersFor(strategy, checkedIds ?? all),
  });

  const trades: Trade[] = [
    mk(
      {
        id: "el01",
        date: "2026-07-01",
        symbol: "EURUSD",
        side: "long",
        entry: 1.16,
        stop: 1.159,
        target: 1.162,
        slPips: 10,
        tpPips: 20,
        rMultiple: 2,
        result: "win",
        pnlUsd: 200,
        tags: ["a+"],
        notes: "Full checklist A+ London long.",
      },
      all,
    ),
    mk(
      {
        id: "el02",
        date: "2026-07-02",
        symbol: "EURUSD",
        side: "long",
        entry: 1.161,
        stop: 1.16,
        target: 1.163,
        slPips: 10,
        tpPips: 20,
        rMultiple: -1,
        result: "loss",
        pnlUsd: -100,
        notes: "80% checklist — skipped entry model.",
      },
      pct80,
    ),
    mk(
      {
        id: "el03",
        date: "2026-07-03",
        symbol: "GBPUSD",
        side: "short",
        entry: 1.35,
        stop: 1.3508,
        target: 1.3484,
        slPips: 8,
        tpPips: 16,
        rMultiple: 1.5,
        result: "win",
        pnlUsd: 150,
        notes: "60% checklist and SL only 8 pips.",
      },
      pct60,
    ),
    mk(
      {
        id: "el04",
        date: "2026-07-03",
        symbol: "GBPUSD",
        side: "long",
        entry: 1.348,
        stop: 1.3468,
        target: 1.3492,
        slPips: 12,
        tpPips: 12,
        rMultiple: -1,
        result: "loss",
        pnlUsd: -100,
        session: "New York",
        notes: "Full checklist but planned RR only 1.0.",
      },
      all,
    ),
    mk(
      {
        id: "el05",
        date: "2026-07-04",
        symbol: "XAUUSD",
        side: "long",
        entry: 2380,
        stop: 2375,
        target: 2395,
        slPips: 50,
        tpPips: 150,
        rMultiple: 3,
        result: "win",
        pnlUsd: 300,
        tags: ["a+"],
        notes: "Gold A+ 3R.",
      },
      all,
    ),
    mk(
      {
        id: "el06",
        date: "2026-07-07",
        symbol: "XAUUSD",
        side: "short",
        entry: 2400,
        stop: 2405,
        target: 2390,
        slPips: 50,
        tpPips: 100,
        rMultiple: -1,
        result: "loss",
        pnlUsd: -100,
        session: "Asian",
        tags: ["fomo"],
        notes: "Asian FOMO — broke session rule.",
      },
      pct40,
    ),
    mk(
      {
        id: "el07",
        date: "2026-07-08",
        symbol: "NAS100",
        side: "long",
        entry: 20500,
        stop: 20485,
        target: 20515,
        slPips: 15,
        tpPips: 15,
        rMultiple: 1,
        result: "win",
        pnlUsd: 100,
        session: "New York",
        notes: "80% checklist, planned RR 1.0.",
      },
      pct80,
    ),
    mk(
      {
        id: "el08",
        date: "2026-07-08",
        symbol: "NAS100",
        side: "short",
        entry: 20550,
        stop: 20565,
        target: 20520,
        slPips: 15,
        tpPips: 30,
        rMultiple: -1,
        result: "loss",
        pnlUsd: -100,
        session: "New York",
        tags: ["revenge"],
        notes: "Zero checklist revenge short.",
      },
      [],
    ),
    mk(
      {
        id: "el09",
        date: "2026-07-09",
        symbol: "EURUSD",
        side: "short",
        entry: 1.17,
        stop: 1.171,
        target: 1.1675,
        slPips: 10,
        tpPips: 25,
        rMultiple: 0,
        result: "breakeven",
        pnlUsd: 0,
        notes: "80% checklist scratch.",
      },
      pct80,
    ),
    mk(
      {
        id: "el10",
        date: "2026-07-09",
        symbol: "USDJPY",
        side: "long",
        entry: 157.4,
        stop: 157.31,
        target: 157.67,
        slPips: 9,
        tpPips: 27,
        rMultiple: -1,
        result: "loss",
        pnlUsd: -100,
        session: "Asian",
        notes: "Full checklist but SL 9 pips + Asian.",
      },
      all,
    ),
    mk(
      {
        id: "el11",
        date: "2026-07-10",
        symbol: "EURUSD",
        side: "long",
        entry: 1.155,
        stop: 1.153,
        target: 1.16,
        slPips: 20,
        tpPips: 50,
        rMultiple: 2.5,
        result: "win",
        pnlUsd: 250,
        tags: ["a+"],
        notes: "Full checklist 2.5R.",
      },
      all,
    ),
    mk(
      {
        id: "el12",
        date: "2026-07-11",
        symbol: "GBPUSD",
        side: "short",
        entry: 1.356,
        stop: 1.357,
        target: 1.354,
        slPips: 10,
        tpPips: 20,
        rMultiple: 0,
        result: "open",
        tags: ["live"],
        notes: "Open 80% checklist short.",
      },
      pct80,
    ),
    mk(
      {
        id: "el13",
        date: "2026-07-11",
        symbol: "EURUSD",
        side: "long",
        entry: 1.158,
        stop: 1.157,
        target: 1.1595,
        slPips: 10,
        tpPips: 15,
        rMultiple: -1,
        result: "loss",
        pnlUsd: -100,
        session: "New York",
        tags: ["fomo"],
        notes: "80% checklist, planned RR 1.5, FOMO tag.",
      },
      pct80,
    ),
    mk(
      {
        id: "el14",
        date: "2026-07-14",
        symbol: "XAUUSD",
        side: "long",
        entry: 2390,
        stop: 2386,
        target: 2396,
        slPips: 40,
        tpPips: 60,
        rMultiple: 2,
        result: "win",
        pnlUsd: 200,
        notes: "60% checklist, planned RR 1.5, realized +2R.",
      },
      pct60,
    ),
    mk(
      {
        id: "el15",
        date: "2026-07-14",
        symbol: "NAS100",
        side: "long",
        entry: 20600,
        stop: 20575,
        target: 20650,
        slPips: 25,
        tpPips: 50,
        rMultiple: 2,
        result: "win",
        pnlUsd: 200,
        session: "New York",
        tags: ["a+"],
        notes: "Full checklist NAS100.",
      },
      all,
    ),
    mk(
      {
        id: "el16",
        date: "2026-07-15",
        symbol: "EURUSD",
        side: "short",
        entry: 1.165,
        stop: 1.166,
        target: 1.162,
        slPips: 10,
        tpPips: 30,
        rMultiple: -1.5,
        result: "loss",
        pnlUsd: -150,
        notes: "20% checklist oversized loss.",
      },
      pct20,
    ),
    mk(
      {
        id: "el17",
        date: "2026-07-16",
        symbol: "GBPUSD",
        side: "long",
        entry: 1.34,
        stop: 1.3376,
        target: 1.3412,
        slPips: 24,
        tpPips: 12,
        rMultiple: 0.5,
        result: "win",
        pnlUsd: 50,
        notes: "Full checklist but planned RR 0.5 — still scraped a win.",
      },
      all,
    ),
    mk(
      {
        id: "el18",
        date: "2026-07-17",
        symbol: "EURUSD",
        side: "long",
        entry: 1.15,
        stop: 1.149,
        target: 1.152,
        slPips: 10,
        tpPips: 20,
        rMultiple: 2,
        result: "win",
        pnlUsd: 200,
        notes: "No checklist answers recorded at all.",
      },
      null,
    ),
    mk(
      {
        id: "el19",
        date: "2026-07-18",
        symbol: "AUDUSD",
        side: "short",
        entry: 0.66,
        stop: 0.661,
        target: 0.658,
        slPips: 10,
        tpPips: 20,
        rMultiple: -1,
        result: "loss",
        pnlUsd: -100,
        notes: "Only AUDUSD in the book — 80% checklist.",
      },
      pct80,
    ),
    mk(
      {
        id: "el20",
        date: "2026-07-21",
        symbol: "EURUSD",
        side: "long",
        entry: 1.14,
        stop: 1.1395,
        target: 1.142,
        slPips: 5,
        tpPips: 20,
        rMultiple: 4,
        result: "win",
        pnlUsd: 400,
        tags: ["a+", "tight-stop"],
        notes: "Full checklist, SL only 5 pips, planned RR 4.",
      },
      all,
    ),
  ];

  return {
    id: "edge-lab",
    label: "Edge lab analytical book",
    description:
      "20 trades engineered for checklist %, planned RR, SL filters, FOMO, Asian violations.",
    strategy,
    trades,
  };
})();

export const ALL_ENVIRONMENTS: JournalEnvironment[] = [
  envIctSeed,
  envEmptyBook,
  envRedMonth,
  envNqScalper,
  envDuplicateEur,
  envMixedBook,
  envEdgeLab,
];

export function getEnvironment(id: string) {
  const env = ALL_ENVIRONMENTS.find((e) => e.id === id);
  if (!env) throw new Error(`Unknown journal environment: ${id}`);
  return {
    ...env,
    strategy: structuredClone(env.strategy),
    trades: structuredClone(env.trades),
  };
}

// Local import used by edge-lab IIFE — keep after helpers would cycle; inline answersFor.
function answersFor(
  strategy: Strategy,
  checkedIds: string[],
): Trade["checklist"] {
  const set = new Set(checkedIds);
  return (strategy.checklist ?? []).map((item) => ({
    id: item.id,
    label: item.label,
    checked: set.has(item.id),
  }));
}
