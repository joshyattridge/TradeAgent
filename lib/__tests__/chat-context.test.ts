import { describe, expect, it } from "vitest";
import {
  MAX_REATTACH_SCREENSHOTS,
  RELEVANT_TRADES_LIMIT,
  TRADE_INDEX_LIMIT,
  buildChatContextPack,
  buildStrategyDigest,
  buildTradeIndex,
  buildTradeIndexLine,
  looksLikeFollowUpUpdate,
  mentionedJournalSymbols,
  normalizeSymbol,
  selectReattachedScreenshots,
  selectRelevantTrades,
  tradeSnapshot,
} from "@/lib/chat-context";
import { seedTrades } from "@/lib/seed-data";
import type { Strategy, Trade } from "@/lib/types";

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "tx",
    date: "2026-01-01",
    symbol: "EURUSD",
    side: "long",
    setup: "Test setup",
    entry: 1.1,
    stop: 1.09,
    target: 1.12,
    rMultiple: 1,
    result: "win",
    ...overrides,
  };
}

describe("tradeSnapshot", () => {
  it("maps trade fields and detects real screenshots", () => {
    const trade = makeTrade({
      id: "t-real",
      pnlUsd: 150,
      session: "London",
      notes: "Note",
      tags: ["A+"],
      screenshots: ["data:image/png;base64,abc"],
    });
    const snap = tradeSnapshot(trade);
    expect(snap.id).toBe("t-real");
    expect(snap.pnlUsd).toBe(150);
    expect(snap.session).toBe("London");
    expect(snap.hasScreenshots).toBe(true);
  });

  it("returns hasScreenshots false without screenshots or with pending only", () => {
    expect(tradeSnapshot(makeTrade({ screenshots: undefined })).hasScreenshots).toBe(
      false,
    );
    expect(tradeSnapshot(makeTrade({ screenshots: ["pending"] })).hasScreenshots).toBe(
      false,
    );
    expect(
      tradeSnapshot(makeTrade({ screenshots: ["pending", ""] })).hasScreenshots,
    ).toBe(false);
  });
});

describe("looksLikeFollowUpUpdate", () => {
  it("matches follow-up / correction phrasing", () => {
    expect(looksLikeFollowUpUpdate("Please update the PnL to -$50")).toBe(true);
    expect(looksLikeFollowUpUpdate("Actually it was a loss")).toBe(true);
    expect(looksLikeFollowUpUpdate("Set the result to win")).toBe(true);
  });

  it("does not match unrelated questions", () => {
    expect(looksLikeFollowUpUpdate("What is my average R this month?")).toBe(false);
    expect(looksLikeFollowUpUpdate("Summarize my journal")).toBe(false);
  });
});

describe("normalizeSymbol", () => {
  it("uppercases and strips non-alphanumeric characters", () => {
    expect(normalizeSymbol("eur/usd")).toBe("EURUSD");
    expect(normalizeSymbol("  xau-usd  ")).toBe("XAUUSD");
  });
});

describe("mentionedJournalSymbols", () => {
  it("skips symbols whose normalized token is shorter than 2 characters", () => {
    const trades = [
      makeTrade({ symbol: "X" }),
      makeTrade({ id: "t2", symbol: "Y" }),
    ];
    expect(mentionedJournalSymbols("X and Y symbols", trades)).toEqual([]);
  });

  it("returns journal symbols found as whole tokens in the message", () => {
    const trades = seedTrades;
    expect(mentionedJournalSymbols("Review EURUSD from London", trades)).toEqual([
      "EURUSD",
    ]);
  });

  it("returns empty when no journal symbol appears in the message", () => {
    expect(mentionedJournalSymbols("How am I doing overall?", seedTrades)).toEqual([]);
  });
});

describe("buildStrategyDigest", () => {
  it("passes through short markdown unchanged", () => {
    const strategy: Strategy = {
      name: "Edge",
      updatedAt: "2026-07-01T00:00:00.000Z",
      markdown: "# Edge\n\nKeep it simple.",
    };
    const digest = buildStrategyDigest(strategy);
    expect(digest.name).toBe("Edge");
    expect(digest.updatedAt).toBe(strategy.updatedAt);
    expect(digest.markdown).toBe("# Edge\n\nKeep it simple.");
    expect(digest.markdown.endsWith("…")).toBe(false);
  });

  it("truncates very long chat-safe markdown to 4000 characters", () => {
    const body = "word ".repeat(1200).trim();
    const strategy: Strategy = {
      name: "Huge",
      updatedAt: "2026-07-01T00:00:00.000Z",
      markdown: `# Huge\n\n${body}`,
    };
    const digest = buildStrategyDigest(strategy);
    expect(digest.markdown.length).toBeLessThanOrEqual(4000);
    expect(digest.markdown.endsWith("…")).toBe(true);
  });
});

describe("buildTradeIndexLine", () => {
  it("includes pnl and session when present", () => {
    const line = buildTradeIndexLine(
      makeTrade({
        id: "t1",
        pnlUsd: 200,
        session: "London",
        setup: "FVG",
        rMultiple: 2,
      }),
    );
    expect(line).toBe(
      "t1 | 2026-01-01 | EURUSD | long | win | 2R $200 | FVG | London",
    );
  });

  it("omits pnl and session when absent", () => {
    const line = buildTradeIndexLine(
      makeTrade({
        id: "t-open",
        pnlUsd: undefined,
        session: undefined,
        result: "open",
        rMultiple: 0,
      }),
    );
    expect(line).toBe("t-open | 2026-01-01 | EURUSD | long | open | 0R | Test setup");
  });
});

describe("selectRelevantTrades", () => {
  it("returns empty selection and note when there are no trades", () => {
    expect(selectRelevantTrades([], "anything")).toEqual({
      trades: [],
      notes: ["No trades in log."],
    });
  });

  it("ranks by symbol, date, setup, result intent, and query tokens", () => {
    const trades = [
      makeTrade({
        id: "low",
        date: "2026-07-01",
        symbol: "AUDUSD",
        setup: "Range",
        result: "breakeven",
        notes: "Unrelated",
      }),
      makeTrade({
        id: "winner",
        date: "2026-07-10",
        symbol: "EURUSD",
        setup: "1H FVG Continuation",
        result: "win",
        session: "London",
        notes: "London liquidity sweep",
      }),
      makeTrade({
        id: "loser",
        date: "2026-07-10",
        symbol: "EURUSD",
        setup: "IFVG reversal",
        result: "loss",
        notes: "Bad fill",
      }),
      makeTrade({
        id: "open-one",
        date: "2026-07-11",
        symbol: "GBPUSD",
        setup: "Continuation",
        result: "open",
      }),
    ];

    const symbolPick = selectRelevantTrades(trades, "How did EURUSD do?");
    expect(symbolPick.trades[0]?.id).toBe("winner");
    expect(symbolPick.notes).toContain("Symbol filters: EURUSD");

    const datePick = selectRelevantTrades(trades, "Trades on 2026-07-10");
    expect(datePick.trades.map((t) => t.id)).toEqual(
      expect.arrayContaining(["winner", "loser"]),
    );
    expect(datePick.notes).toContain("Date filters: 2026-07-10");

    const setupPick = selectRelevantTrades(
      trades,
      "Show fvg and london session examples",
    );
    expect(setupPick.trades[0]?.id).toBe("winner");
    expect(setupPick.notes.some((n) => n.startsWith("Setup/session hints:"))).toBe(
      true,
    );

    const lossPick = selectRelevantTrades(trades, "My losses and red days");
    expect(lossPick.trades[0]?.id).toBe("loser");

    const winPick = selectRelevantTrades(trades, "Green winners only");
    expect(winPick.trades[0]?.id).toBe("winner");

    const openPick = selectRelevantTrades(trades, "Any open active trades?");
    expect(openPick.trades[0]?.id).toBe("open-one");

    const tokenPick = selectRelevantTrades(trades, "Tell me about liquidity sweep");
    expect(tokenPick.trades[0]?.id).toBe("winner");
  });

  it("resolves alias symbols and partial symbol matches while scoring", () => {
    const trades = [
      makeTrade({ id: "nas", symbol: "NAS100", setup: "Index continuation" }),
      makeTrade({ id: "btc", symbol: "BTCUSD", setup: "Crypto breakout" }),
    ];
    const aliasPick = selectRelevantTrades(trades, "Review NQ performance");
    expect(aliasPick.trades[0]?.id).toBe("nas");
    expect(aliasPick.notes).toContain("Symbol filters: NQ");

    const unknownAliasPick = selectRelevantTrades(
      [makeTrade({ id: "only", symbol: "EURUSD" })],
      "Thoughts on ETHUSD?",
    );
    expect(unknownAliasPick.notes).toContain("Symbol filters: ETHUSD");
  });

  it("sorts by score then date then original index and fills remaining slots", () => {
    const trades = Array.from({ length: 12 }, (_, i) =>
      makeTrade({
        id: `t${i}`,
        date: `2026-07-${String(i + 1).padStart(2, "0")}`,
        symbol: `SYM${i}`,
        setup: "Generic",
        result: "breakeven",
        notes: `note-${i}`,
      }),
    );

    const { trades: picked, notes } = selectRelevantTrades(
      trades,
      "hello there",
      RELEVANT_TRADES_LIMIT,
    );
    expect(picked).toHaveLength(RELEVANT_TRADES_LIMIT);
    expect(notes.at(-1)).toBe(`Selected ${RELEVANT_TRADES_LIMIT} of 12 trades for detail.`);

    const tieTrades = [
      makeTrade({ id: "a", date: "2026-07-01", symbol: "AAA", setup: "x" }),
      makeTrade({ id: "b", date: "2026-07-02", symbol: "AAA", setup: "x" }),
      makeTrade({ id: "c", date: "2026-07-02", symbol: "AAA", setup: "x" }),
    ];
    const tied = selectRelevantTrades(tieTrades, "AAA", 3);
    expect(tied.trades.map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("skips extra zero-score rows after five picks then backfills", () => {
    const zeroScoreTrades = Array.from({ length: 8 }, (_, i) =>
      makeTrade({
        id: `z${i}`,
        date: `2026-06-${String(i + 1).padStart(2, "0")}`,
        symbol: `ZZ${i}`,
      }),
    );
    const { trades: picked } = selectRelevantTrades(zeroScoreTrades, "misc", 7);
    expect(picked).toHaveLength(7);
    expect(picked.map((t) => t.id)).toEqual([
      "z7",
      "z6",
      "z5",
      "z4",
      "z3",
      "z0",
      "z1",
    ]);
  });

  it("ignores query tokens shorter than three characters", () => {
    const trades = [
      makeTrade({ id: "hit", notes: "liquidity sweep detail" }),
      makeTrade({ id: "miss", notes: "nothing special" }),
    ];
    const result = selectRelevantTrades(trades, "do it on liquidity");
    expect(result.trades[0]?.id).toBe("hit");
  });

  it("scores query tokens against trade ids when notes do not match", () => {
    const trades = [
      makeTrade({ id: "special-id-9001", notes: "plain" }),
      makeTrade({ id: "other", notes: "plain" }),
    ];
    const result = selectRelevantTrades(trades, "Review special-id-9001");
    expect(result.trades[0]?.id).toBe("special-id-9001");
  });

  it("ignores one-character journal symbols during symbol extraction", () => {
    const trades = [
      makeTrade({ id: "short-symbol", symbol: "X" }),
      makeTrade({ id: "real", symbol: "EURUSD" }),
    ];
    const result = selectRelevantTrades(trades, "EURUSD day");
    expect(result.notes).toContain("Symbol filters: EURUSD");
  });

  it("stops the scored pass once the limit is reached", () => {
    const trades = Array.from({ length: 8 }, (_, i) =>
      makeTrade({
        id: `eur-${i}`,
        symbol: "EURUSD",
        date: `2026-07-${String(i + 1).padStart(2, "0")}`,
      }),
    );
    const { trades: picked } = selectRelevantTrades(trades, "EURUSD stats", 5);
    expect(picked).toHaveLength(5);
  });

  it("skips duplicate trade ids in the scored list", () => {
    const duplicate = makeTrade({ id: "dup", symbol: "AAA" });
    const { trades: picked } = selectRelevantTrades(
      [duplicate, { ...duplicate, setup: "Other" }],
      "AAA",
      10,
    );
    expect(picked.filter((t) => t.id === "dup")).toHaveLength(1);
  });
});

describe("buildTradeIndex", () => {
  it("maps trades to index lines respecting the limit", () => {
    const many = Array.from({ length: TRADE_INDEX_LIMIT + 5 }, (_, i) =>
      makeTrade({ id: `row-${i}` }),
    );
    const defaultIndex = buildTradeIndex(many);
    expect(defaultIndex).toHaveLength(TRADE_INDEX_LIMIT);
    expect(defaultIndex[0]).toContain("row-0");

    const smallIndex = buildTradeIndex(many, 3);
    expect(smallIndex).toHaveLength(3);
  });
});

describe("selectReattachedScreenshots", () => {
  const screenshot = "data:image/png;base64,abc";

  it("returns empty when new images are already attached", () => {
    expect(
      selectReattachedScreenshots({
        userMessage: "Review EURUSD chart",
        hasNewImages: true,
        trades: seedTrades,
      }),
    ).toEqual([]);
  });

  it("returns empty when there are no trades", () => {
    expect(
      selectReattachedScreenshots({
        userMessage: "Review EURUSD chart",
        hasNewImages: false,
        trades: [],
      }),
    ).toEqual([]);
  });

  it("returns empty when zero or multiple journal symbols are mentioned", () => {
    expect(
      selectReattachedScreenshots({
        userMessage: "How is my month going?",
        hasNewImages: false,
        trades: seedTrades,
      }),
    ).toEqual([]);

    expect(
      selectReattachedScreenshots({
        userMessage: "Compare EURUSD and GBPUSD charts",
        hasNewImages: false,
        trades: seedTrades,
      }),
    ).toEqual([]);
  });

  it("returns empty when more than one trade matches the symbol", () => {
    expect(
      selectReattachedScreenshots({
        userMessage: "Review the EURUSD entry",
        hasNewImages: false,
        trades: seedTrades,
      }),
    ).toEqual([]);
  });

  it("returns empty when the trade has no real data:image screenshots", () => {
    const trades = [
      makeTrade({
        id: "pending-only",
        symbol: "SOLUSD",
        screenshots: ["pending", "https://example.com/chart.png"],
      }),
    ];
    expect(
      selectReattachedScreenshots({
        userMessage: "Look at SOLUSD levels",
        hasNewImages: false,
        trades,
      }),
    ).toEqual([]);
  });

  it("returns empty when the message does not need visual context", () => {
    const trades = [
      makeTrade({
        id: "solo",
        symbol: "SOLUSD",
        screenshots: [screenshot],
      }),
    ];
    expect(
      selectReattachedScreenshots({
        userMessage: "How many SOLUSD trades do I have?",
        hasNewImages: false,
        trades,
      }),
    ).toEqual([]);
  });

  it("reattaches screenshots for a uniquely matched trade needing visuals", () => {
    const trades = [
      makeTrade({
        id: "solo",
        symbol: "SOLUSD",
        screenshots: [screenshot, "data:image/jpeg;base64,def", "pending"],
      }),
    ];

    const followUp = selectReattachedScreenshots({
      userMessage: "Update SOLUSD stop",
      hasNewImages: false,
      trades,
    });
    expect(followUp).toEqual([screenshot, "data:image/jpeg;base64,def"]);

    const visual = selectReattachedScreenshots({
      userMessage: "Please review the SOLUSD chart levels",
      hasNewImages: false,
      trades,
      max: 1,
    });
    expect(visual).toEqual([screenshot]);
    expect(MAX_REATTACH_SCREENSHOTS).toBe(2);
  });

  it("ignores non-string screenshot entries when reattaching", () => {
    const trades = [
      makeTrade({
        id: "solo",
        symbol: "SOLUSD",
        screenshots: [
          null,
          42,
          "",
          screenshot,
        ] as unknown as string[],
      }),
    ];
    expect(
      selectReattachedScreenshots({
        userMessage: "Review SOLUSD chart",
        hasNewImages: false,
        trades,
      }),
    ).toEqual([screenshot]);
  });

  it("returns empty when the matched trade has undefined screenshots", () => {
    const trades = [
      makeTrade({
        id: "solo",
        symbol: "SOLUSD",
        screenshots: undefined,
      }),
    ];
    expect(
      selectReattachedScreenshots({
        userMessage: "Review SOLUSD chart",
        hasNewImages: false,
        trades,
      }),
    ).toEqual([]);
  });
});

describe("buildChatContextPack", () => {
  it("builds defaults when optional fields are omitted", () => {
    const strategy: Strategy = {
      name: "My Plan",
      markdown: "# My Plan",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };
    expect(
      buildChatContextPack({
        strategy,
        trades: seedTrades,
      }),
    ).toEqual({
      tradeCount: seedTrades.length,
      strategyName: "My Plan",
      reattachedScreenshotCount: 0,
      referencedTradeIds: [],
    });
  });

  it("honors optional counts and nullish strategy names", () => {
    const strategy = {
      name: undefined,
      markdown: "",
      updatedAt: "2026-07-01T00:00:00.000Z",
    } as Strategy;

    expect(
      buildChatContextPack({
        strategy,
        trades: [],
        reattachedScreenshotCount: 2,
        referencedTradeIds: ["t99"],
      }),
    ).toEqual({
      tradeCount: 0,
      strategyName: null,
      reattachedScreenshotCount: 2,
      referencedTradeIds: ["t99"],
    });

    expect(
      buildChatContextPack({
        strategy,
        trades: [],
        referencedTradeIds: ["t1", "t1", "t2"],
      }).referencedTradeIds,
    ).toEqual(["t1", "t2"]);
  });
});
