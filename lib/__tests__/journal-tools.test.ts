import { describe, expect, it } from "vitest";
import { filterTrades, JournalSession } from "@/lib/journal-session";
import { seedStrategy, seedTrades } from "@/lib/seed-data";
import type { Strategy, Trade } from "@/lib/types";

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "base",
    date: "2026-07-10",
    symbol: "EURUSD",
    side: "long",
    setup: "1H FVG Continuation",
    entry: 1.17,
    stop: 1.168,
    target: 1.174,
    rMultiple: 1.5,
    result: "win",
    notes: "London sweep into CE",
    session: "London",
    tags: ["fvg", "a+"],
    riskUsd: 100,
    size: "0.40 lots",
    ...overrides,
  };
}

function makeSession(
  trades: Trade[] = structuredClone(seedTrades),
  strategy: Strategy = seedStrategy,
) {
  return new JournalSession({
    trades: structuredClone(trades),
    strategy: structuredClone(strategy),
  });
}

describe("filterTrades", () => {
  const pool = [
    trade({ id: "a", date: "2026-07-01", symbol: "EURUSD", side: "long", result: "win", setup: "FVG", session: "London", tags: ["fvg", "a+"], notes: "alpha note" }),
    trade({ id: "b", date: "2026-07-05", symbol: "GBPUSD", side: "short", result: "loss", setup: "Order Block", session: "New York", tags: ["ob"], notes: "beta sweep" }),
    trade({ id: "c", date: "2026-07-15", symbol: "XAUUSD", side: "long", result: "open", setup: "Continuation", session: "Asian", tags: ["gold", "a+"], notes: "gamma open" }),
  ];

  it("returns all trades when filter is empty", () => {
    expect(filterTrades(pool, {})).toHaveLength(3);
  });

  it("filters by symbol (case-insensitive substring)", () => {
    expect(filterTrades(pool, { symbol: "eur" }).map((t) => t.id)).toEqual(["a"]);
    expect(filterTrades(pool, { symbol: "gbp" }).map((t) => t.id)).toEqual(["b"]);
  });

  it("filters by side, result, setup, and session", () => {
    expect(filterTrades(pool, { side: "short" }).map((t) => t.id)).toEqual(["b"]);
    expect(filterTrades(pool, { result: "open" }).map((t) => t.id)).toEqual(["c"]);
    expect(filterTrades(pool, { setup: "order" }).map((t) => t.id)).toEqual(["b"]);
    expect(filterTrades(pool, { session: "asian" }).map((t) => t.id)).toEqual(["c"]);
  });

  it("filters by dateFrom and dateTo", () => {
    const mid = filterTrades(pool, { dateFrom: "2026-07-05", dateTo: "2026-07-10" });
    expect(mid.map((t) => t.id)).toEqual(["b"]);
    expect(filterTrades(pool, { dateFrom: "2026-07-20" })).toEqual([]);
  });

  it("requires every tag (case-insensitive)", () => {
    expect(filterTrades(pool, { tags: ["fvg"] }).map((t) => t.id)).toEqual(["a"]);
    expect(filterTrades(pool, { tags: ["FVG", "A+"] }).map((t) => t.id)).toEqual(["a"]);
    expect(filterTrades(pool, { tags: ["fvg", "missing"] })).toEqual([]);
  });

  it("filters by text across notes, setup, symbol, and tags", () => {
    expect(filterTrades(pool, { text: "alpha" }).map((t) => t.id)).toEqual(["a"]);
    expect(filterTrades(pool, { text: "order block" }).map((t) => t.id)).toEqual(["b"]);
    expect(filterTrades(pool, { text: "xauusd" }).map((t) => t.id)).toEqual(["c"]);
    expect(filterTrades(pool, { text: "gold" }).map((t) => t.id)).toEqual(["c"]);
  });

  it("filters by explicit ids", () => {
    expect(filterTrades(pool, { ids: ["b", "c"] }).map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("excludes trades with missing session when session filter is set", () => {
    const pool = [
      trade({ id: "no-session", session: undefined }),
      trade({ id: "has-session", session: "London", symbol: "GBPUSD" }),
    ];
    expect(filterTrades(pool, { session: "london" }).map((t) => t.id)).toEqual([
      "has-session",
    ]);
  });

  it("combines multiple dimensions", () => {
    const hits = filterTrades(pool, {
      symbol: "EUR",
      side: "long",
      result: "win",
      dateFrom: "2026-06-01",
      dateTo: "2026-07-31",
      tags: ["fvg"],
      text: "alpha",
    });
    expect(hits.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("JournalSession.queryTrades", () => {
  it("reports full journal counts separate from filtered counts", () => {
    const session = makeSession();
    const res = session.queryTrades({ symbol: "EURUSD", limit: 2 });
    expect(res.ok).toBe(true);
    expect(res.journal.total).toBe(seedTrades.length);
    expect(res.journal.open).toBe(1);
    expect(res.journal.closed).toBe(seedTrades.length - 1);
    expect(res.count).toBeGreaterThan(res.returned);
    expect(res.returned).toBe(2);
    expect(res.trades.every((t) => t.symbol === "EURUSD")).toBe(true);
  });

  it("sorts newest, oldest, bestR, and worstR", () => {
    const trades = [
      trade({ id: "old", date: "2026-07-01", rMultiple: 0.5 }),
      trade({ id: "mid", date: "2026-07-10", rMultiple: 2.0 }),
      trade({ id: "new", date: "2026-07-20", rMultiple: -1.0 }),
    ];
    const session = makeSession(trades);

    expect(session.queryTrades({ sort: "newest" }).trades.map((t) => t.id)).toEqual([
      "new",
      "mid",
      "old",
    ]);
    expect(session.queryTrades({ sort: "oldest" }).trades.map((t) => t.id)).toEqual([
      "old",
      "mid",
      "new",
    ]);
    expect(session.queryTrades({ sort: "bestR" }).trades.map((t) => t.id)).toEqual([
      "mid",
      "old",
      "new",
    ]);
    expect(session.queryTrades({ sort: "worstR" }).trades.map((t) => t.id)).toEqual([
      "new",
      "old",
      "mid",
    ]);
  });

  it("defaults sort to newest and limit to 10", () => {
    const session = makeSession();
    const res = session.queryTrades({});
    expect(res.returned).toBeLessThanOrEqual(10);
    const dates = res.trades.map((t) => t.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe("getStats and getStatsTool", () => {
  it("getStats respects filter and closedOnly", () => {
    const session = makeSession();
    const all = session.getStats();
    expect(all.totalTrades).toBe(seedTrades.length);
    expect(all.openCount).toBe(1);

    const eurOnly = session.getStats({ symbol: "EURUSD" });
    expect(eurOnly.totalTrades).toBe(
      seedTrades.filter((t) => t.symbol.includes("EURUSD")).length,
    );

    const closedEur = session.getStats({ symbol: "EURUSD" }, true);
    expect(closedEur.closedCount).toBe(
      seedTrades.filter((t) => t.symbol.includes("EURUSD") && t.result !== "open").length,
    );
    expect(closedEur.openCount).toBe(0);
  });

  it("getStatsTool surfaces journal, matched, poolSize, and closedOnly", () => {
    const session = makeSession();
    const res = session.getStatsTool({ symbol: "GBPUSD", closedOnly: true });
    expect(res.ok).toBe(true);
    expect(res.action).toBe("get_stats");
    expect(res.journal.total).toBe(seedTrades.length);
    expect(res.journal.open).toBe(1);
    expect(res.matched).toBe(seedTrades.filter((t) => t.symbol.includes("GBPUSD")).length);
    expect(res.poolSize).toBe(
      seedTrades.filter((t) => t.symbol.includes("GBPUSD") && t.result !== "open").length,
    );
    expect(res.closedOnly).toBe(true);
    expect(res.stats.closedCount).toBe(res.poolSize);
  });
});

describe("getTrade", () => {
  it("returns a snapshot for a known id", () => {
    const session = makeSession();
    const res = session.getTrade("t1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.trade.id).toBe("t1");
      expect(res.trade.symbol).toBe("EURUSD");
    }
  });

  it("errors when id is missing", () => {
    const session = makeSession();
    const res = session.getTrade("missing-id");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/No trade found/);
      expect(res.action).toBe("get_trade");
    }
  });
});

describe("findTrade", () => {
  it("returns no match when symbol pool is empty", () => {
    const session = makeSession([trade({ id: "only-eur", symbol: "EURUSD" })]);
    const res = session.findTrade({ symbol: "AUDUSD" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("No matching trades");
      expect(res.journal.total).toBe(1);
    }
  });

  it("confidently matches symbol + price + side hints", () => {
    const session = makeSession([
      trade({
        id: "hit",
        symbol: "EURUSD",
        side: "long",
        entry: 1.1682,
        stop: 1.1658,
        target: 1.173,
        date: "2026-07-20",
        entryTime: "2026-07-20T08:15:00.000Z",
        exitTime: "2026-07-20T10:45:00.000Z",
        pnlUsd: 120,
        size: "0.40 lots",
        notes: "CE fill",
        tags: ["fvg"],
      }),
      trade({
        id: "noise",
        symbol: "EURUSD",
        side: "short",
        entry: 1.18,
        date: "2026-07-19",
      }),
    ]);
    const res = session.findTrade({
      symbol: "EURUSD",
      side: "long",
      entry: 1.1682,
      stop: 1.1658,
      target: 1.173,
      date: "2026-07-20",
      pnlUsd: 120,
      size: "0.40",
      entryTime: "2026-07-20T08:15:00.000Z",
      exitTime: "2026-07-20T10:45:00.000Z",
      text: "CE fill",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.confident).toBe(true);
      expect(res.bestMatchId).toBe("hit");
      expect(res.bestScore).toBeGreaterThanOrEqual(50);
      expect(res.matchedOn).toContain("symbol");
      expect(res.matchedOn).toContain("entry");
    }
  });

  it("returns ambiguous candidates when scores are too close", () => {
    const session = makeSession([
      trade({ id: "a", symbol: "EURUSD", date: "2026-07-20" }),
      trade({ id: "b", symbol: "EURUSD", date: "2026-07-19" }),
    ]);
    const res = session.findTrade({ symbol: "EURUSD" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.confident).toBe(false);
      expect(res.bestMatchId).toBeUndefined();
      expect(res.candidates.length).toBe(2);
      expect(res.note).toMatch(/No single confident match/);
    }
  });

  it("scores result, stop, target, and exit hints", () => {
    const session = makeSession([
      trade({
        id: "closed",
        symbol: "EURUSD",
        side: "long",
        result: "loss",
        date: "2026-07-21",
        entry: 1.1,
        stop: 1.095,
        target: 1.12,
        exit: 1.095,
        pnlUsd: -100,
      }),
    ]);
    const res = session.findTrade({
      symbol: "EURUSD",
      result: "loss",
      stop: 1.095,
      target: 1.12,
      exit: 1.095,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.confident).toBe(true);
      expect(res.matchedOn).toEqual(
        expect.arrayContaining(["result", "stop", "target", "exit"]),
      );
    }
  });

  it("ranks across the book without a symbol hint", () => {
    const session = makeSession([
      trade({ id: "x", symbol: "NQ", notes: "unique keyword alpha" }),
      trade({ id: "y", symbol: "ES", notes: "other" }),
    ]);
    const res = session.findTrade({ text: "unique keyword", limit: 3 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.candidates[0].id).toBe("x");
      expect(res.candidates[0].matched).toContain("text");
    }
  });
});

describe("compareToStrategy", () => {
  const richStrategy: Strategy = {
    name: "London FVG Plan",
    updatedAt: "2026-07-01T00:00:00.000Z",
    markdown: `# London FVG Plan

Trade during London or New York. Target ≥2R and 1:2 minimum.

Use fair value gap / order block / sweep / continuation setups only.
`,
  };

  it("returns error when filter matches nothing", () => {
    const session = makeSession([], richStrategy);
    const res = session.compareToStrategy({ symbol: "ZZZZ" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/No trades matched/);
  });

  it("maps fits, gaps, and unclear branches from strategy rules", () => {
    const complete = trade({
      id: "complete",
      setup: "FVG continuation after sweep",
      session: "London",
      entry: 1.1,
      stop: 1.09,
      target: 1.12,
      rMultiple: 2.5,
      result: "win",
      riskUsd: 100,
      size: "0.5 lots",
      screenshots: ["img"],
    });
    const sparse = trade({
      id: "sparse",
      setup: "Discretionary",
      session: undefined,
      tags: [],
      entry: undefined as never,
      stop: undefined as never,
      target: undefined,
      rMultiple: 0.8,
      result: "win",
      riskUsd: undefined,
      size: undefined,
      screenshots: undefined,
    });
    const loss = trade({
      id: "loss",
      setup: "FVG",
      session: "New York",
      entry: 1.1,
      stop: 1.09,
      target: 1.12,
      rMultiple: -1,
      result: "loss",
      riskUsd: 50,
    });

    const session = makeSession([complete, sparse, loss], richStrategy);
    const res = session.compareToStrategy({ limit: 3 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const byId = Object.fromEntries(res.comparisons.map((c) => [c.tradeId, c]));

    expect(byId.complete.fits).toEqual(
      expect.arrayContaining([
        "Has defined entry and stop",
        "Has a target",
        "Session noted: London",
        "Setup labeling aligns with strategy vocabulary",
        "Closed at 2.5R (≥2R target language in plan)",
        "Size/risk field present",
        "Has screenshots for visual review",
      ]),
    );

    expect(byId.sparse.gaps).toEqual(
      expect.arrayContaining([
        "Missing entry/stop levels",
        "No take-profit / target set",
        "Strategy prefers London/NY — session not recorded",
        "No risk $ or size recorded",
      ]),
    );
    expect(byId.sparse.unclear).toEqual(
      expect.arrayContaining([
        "Setup text does not clearly map to strategy rule names",
        "Win R is below common ≥2R target language — check management",
        "No screenshots on file",
      ]),
    );

    expect(byId.loss.fits).toContain(
      "Loss is journaled with R — reviewable against risk plan",
    );
  });

  it("does not treat open trades as closed ≥2R wins", () => {
    const openWinner = trade({
      id: "open-big",
      result: "open",
      rMultiple: 3,
      setup: "FVG",
      session: "London",
      entry: 1.1,
      stop: 1.09,
      target: 1.12,
      riskUsd: 100,
    });
    const session = makeSession([openWinner], richStrategy);
    const res = session.compareToStrategy({});
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.comparisons[0].fits).not.toContain(
        "Closed at 3R (≥2R target language in plan)",
      );
    }
  });

  it("respects ids filter and limit", () => {
    const session = makeSession(seedTrades.slice(0, 4));
    const res = session.compareToStrategy({ ids: ["t1", "t2"], limit: 1 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.comparisons).toHaveLength(1);
      expect(res.comparisons[0].tradeId).toBe("t1");
    }
  });
});

describe("generateCharts", () => {
  it("builds charts from trades and exposes them via toActions", () => {
    const session = makeSession();
    const res = session.generateCharts([
      { type: "equity", title: "Equity curve" },
      { type: "winLoss", title: "Outcomes" },
    ]);
    expect(res.ok).toBe(true);
    expect(res.action).toBe("generate_charts");
    expect(res.charts).toHaveLength(2);
    expect(res.charts[0].type).toBe("equity");
    expect(res.tradeCountUsed).toBe(seedTrades.length);

    const actions = session.toActions();
    expect(actions.chartRequests).toHaveLength(2);
    expect(actions.charts).toHaveLength(2);
    expect(actions.charts?.[0].title).toBe("Equity curve");
  });
});

describe("updateStrategy edge cases", () => {
  it("reports replaced once for a unique single occurrence", () => {
    const session = makeSession([], {
      ...seedStrategy,
      markdown: "UniqueToken only here\n",
    });
    const res = session.updateStrategy({
      replacements: [{ find: "UniqueToken", replace: "Swapped" }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.applied).toContain("replaced once");
    expect(session.strategy.markdown).toContain("Swapped");
  });

  it("replaceAll replaces every occurrence", () => {
    const session = makeSession([], {
      ...seedStrategy,
      markdown: "FVG rule\n\nAnother FVG mention\n",
    });
    const res = session.updateStrategy({
      replacements: [{ find: "FVG", replace: "GAP", replaceAll: true }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.applied).toContain("replaced all (2)");
    expect(session.strategy.markdown).toBe("GAP rule\n\nAnother GAP mention\n");
  });

  it("refuses ambiguous replacement without replaceAll", () => {
    const session = makeSession([], {
      ...seedStrategy,
      markdown: "FVG one\nFVG two\n",
    });
    const res = session.updateStrategy({
      replacements: [{ find: "FVG", replace: "X" }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/matches 2 times/);
  });

  it("errors on empty find or missing find text", () => {
    const session = makeSession([], seedStrategy);
    expect(session.updateStrategy({ replacements: [{ find: "", replace: "x" }] }).ok).toBe(
      false,
    );
    const missing = session.updateStrategy({
      replacements: [{ find: "NOT IN DOC", replace: "x" }],
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/find text not found/);
  });

  it("performs full markdown replace when payload is not a short snippet", () => {
    const session = makeSession([], seedStrategy);
    const fullDoc = `${seedStrategy.markdown}\n\n## Extra section\n\nMore rules.\n`;
    const res = session.updateStrategy({ markdown: fullDoc });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.applied).toContain("full replace");
    expect(session.strategy.markdown).toBe(fullDoc);
  });

  it("rejects empty append-only payloads", () => {
    const session = makeSession([], seedStrategy);
    const res = session.updateStrategy({ appendMarkdown: "   \n" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no valid fields/);
  });

  it("updates name explicitly or derives from markdown", () => {
    const session = makeSession([], seedStrategy);
    const named = session.updateStrategy({ name: "Custom Name" });
    expect(named.ok).toBe(true);
    expect(session.strategy.name).toBe("Custom Name");

    const derived = session.updateStrategy({
      replacements: [{ find: seedStrategy.name, replace: "Renamed Plan" }],
    });
    expect(derived.ok).toBe(true);
    expect(session.strategy.name).toBe("Renamed Plan");
  });
});

describe("toActions read-path branches", () => {
  it("ships live setup/session when those fields were patched", () => {
    const before = trade({ id: "patch-me" });
    const session = makeSession([before]);
    session.patchTrade({ id: before.id, setup: "Liquidity Sweep", session: "New York" });
    const update = session.toActions().updateTrades?.find((u) => u.id === before.id);
    expect(update?.setup).toBe("Liquidity Sweep");
    expect(update?.session).toBe("New York");
  });

  it("returns patch rest when live row was deleted before flush", () => {
    const before = trade({ id: "ghost" });
    const session = makeSession([before]);
    session.patchTrade({ id: before.id, rMultiple: 2, result: "win" });
    session.deleteTrade({ id: before.id });
    const update = session.toActions().updateTrades?.find((u) => u.id === before.id);
    expect(update?.rMultiple).toBe(2);
    expect(update?.result).toBe("win");
    expect(Object.prototype.hasOwnProperty.call(update ?? {}, "notes")).toBe(false);
  });
});

describe("deleteTrade edge cases", () => {
  it("reports missingIds when some ids are unknown", () => {
    const session = makeSession([trade({ id: "keep" }), trade({ id: "drop" })]);
    const res = session.deleteTrade({ ids: ["drop", "missing"] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.deletedIds).toEqual(["drop"]);
      expect(res.missingIds).toEqual(["missing"]);
    }
  });
});

describe("getStrategy and session utilities", () => {
  it("returns markdown regardless of requested section", () => {
    const session = makeSession();
    const res = session.getStrategy("rules");
    expect(res.ok).toBe(true);
    expect(res.section).toBe("all");
    expect(res.strategy.markdown).toContain("## Rules");
    expect(res.note).toMatch(/Full strategy markdown/);
  });

  it("clones incoming trades on construction", () => {
    const trades = [trade({ id: "mut" })];
    const session = makeSession(trades);
    trades[0].symbol = "CHANGED";
    expect(session.trades[0].symbol).toBe("EURUSD");
  });
});

describe("annotateTrade and patchTrade edge paths", () => {
  it("appends notes onto empty existing notes", () => {
    const session = makeSession([trade({ id: "blank-notes", notes: "   " })]);
    const res = session.annotateTrade({ id: "blank-notes", appendNote: "First note" });
    expect(res.ok).toBe(true);
    expect(session.trades[0].notes).toBe("First note");
  });

  it("removeTags on trades without tags is a no-op", () => {
    const session = makeSession([trade({ id: "no-tags", tags: undefined })]);
    const res = session.annotateTrade({ id: "no-tags", removeTags: ["fvg"] });
    expect(res.ok).toBe(true);
    expect(session.trades[0].tags).toBeUndefined();
  });

  it("patchTrade skips undefined patch fields", () => {
    const session = makeSession([trade({ id: "patch-skip" })]);
    const res = session.patchTrade({
      id: "patch-skip",
      notes: undefined as never,
      rMultiple: 2,
    });
    expect(res.ok).toBe(true);
    expect(session.trades[0].rMultiple).toBe(2);
    expect(session.trades[0].notes).toBe("London sweep into CE");
  });

  it("getStatsTool includes open trades when closedOnly is false", () => {
    const session = makeSession();
    const res = session.getStatsTool({ symbol: "EURUSD", closedOnly: false });
    expect(res.closedOnly).toBe(false);
    expect(res.poolSize).toBe(res.matched);
  });

  it("generateCharts exposes sample points in the response", () => {
    const session = makeSession();
    const res = session.generateCharts([{ type: "equity", title: "Equity" }]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.charts[0].samplePoints.length).toBeGreaterThan(0);
      expect(res.charts[0].pointCount).toBeGreaterThan(0);
    }
  });

  it("toActions ships live tags when tags were patched", () => {
    const before = trade({ id: "tagged", tags: ["a"] });
    const session = makeSession([before]);
    session.annotateTrade({ id: before.id, addTags: ["b"] });
    const update = session.toActions().updateTrades?.find((u) => u.id === before.id);
    expect(update?.tags).toEqual(expect.arrayContaining(["a", "b"]));
  });
});
