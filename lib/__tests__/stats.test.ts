import { describe, expect, it } from "vitest";
import { seedTrades } from "@/lib/seed-data";
import {
  buildChart,
  buildChartFromRequest,
  bySetup,
  bySymbol,
  closedTrades,
  compareTradesChronologically,
  computeStats,
  equityCurve,
  labelValue,
  metricLabel,
  metricValue,
  pnlCalendar,
  rByDay,
  resolvePnlUsd,
  tradeCloseMs,
  winLossBreakdown,
} from "@/lib/stats";
import type { Trade, TradeLabelField, TradeMetricField } from "@/lib/types";

function makeTrade(overrides: Partial<Trade> & Pick<Trade, "id">): Trade {
  return {
    date: "2026-07-01",
    symbol: "EURUSD",
    side: "long",
    setup: "Test Setup",
    entry: 1.1,
    stop: 1.09,
    target: 1.12,
    exit: 1.12,
    slPips: 10,
    tpPips: 20,
    timeInTradeMinutes: 60,
    pnlUsd: 100,
    riskUsd: 100,
    feesUsd: 0,
    rMultiple: 1,
    result: "win",
    session: "London",
    ...overrides,
  };
}

describe("closedTrades", () => {
  it("filters out open trades", () => {
    const trades = [
      makeTrade({ id: "a", result: "win" }),
      makeTrade({ id: "b", result: "open", rMultiple: 0 }),
      makeTrade({ id: "c", result: "loss", rMultiple: -1 }),
    ];
    const closed = closedTrades(trades);
    expect(closed).toHaveLength(2);
    expect(closed.every((t) => t.result !== "open")).toBe(true);
  });
});

describe("computeStats", () => {
  it("computes aggregate stats from seed trades", () => {
    const stats = computeStats(seedTrades);
    expect(stats.totalTrades).toBe(11);
    expect(stats.closedCount).toBe(10);
    expect(stats.openCount).toBe(1);
    expect(stats.wins).toBe(7);
    expect(stats.losses).toBe(3);
    expect(stats.winRate).toBe(70);
    expect(stats.totalR).toBeCloseTo(9.7);
    expect(stats.avgR).toBeCloseTo(0.97);
    expect(stats.expectancy).toBeCloseTo(0.97);
    expect(stats.best).toBe(2);
    expect(stats.worst).toBe(-1);
    // Gross $970 − closed fees $27.20
    expect(stats.totalPnlUsd).toBeCloseTo(942.8);
    expect(stats.avgPnlUsd).toBeCloseTo(94.28);
    expect(stats.avgTimeInTradeMinutes).toBeDefined();
  });

  it("returns zeros and undefined duration for empty trades", () => {
    const stats = computeStats([]);
    expect(stats.totalTrades).toBe(0);
    expect(stats.closedCount).toBe(0);
    expect(stats.openCount).toBe(0);
    expect(stats.wins).toBe(0);
    expect(stats.losses).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.avgR).toBe(0);
    expect(stats.totalR).toBe(0);
    expect(stats.best).toBe(0);
    expect(stats.worst).toBe(0);
    expect(stats.totalPnlUsd).toBe(0);
    expect(stats.avgPnlUsd).toBe(0);
    expect(stats.avgTimeInTradeMinutes).toBeUndefined();
  });

  it("handles all-open books", () => {
    const trades = [
      makeTrade({ id: "o1", result: "open", rMultiple: 0, pnlUsd: undefined }),
      makeTrade({ id: "o2", result: "open", rMultiple: 0 }),
    ];
    const stats = computeStats(trades);
    expect(stats.totalTrades).toBe(2);
    expect(stats.closedCount).toBe(0);
    expect(stats.openCount).toBe(2);
    expect(stats.winRate).toBe(0);
    expect(stats.avgR).toBe(0);
    expect(stats.best).toBe(0);
    expect(stats.worst).toBe(0);
    expect(stats.avgTimeInTradeMinutes).toBeUndefined();
  });

  it("skips avg time when no closed trade has a duration", () => {
    const trades = [
      makeTrade({
        id: "nd1",
        timeInTradeMinutes: undefined,
        entryTime: undefined,
        exitTime: undefined,
      }),
      makeTrade({
        id: "nd2",
        result: "loss",
        rMultiple: -1,
        timeInTradeMinutes: undefined,
        entryTime: undefined,
        exitTime: undefined,
      }),
    ];
    expect(computeStats(trades).avgTimeInTradeMinutes).toBeUndefined();
  });

  it("treats missing pnlUsd as zero in totals (no R × risk fallback)", () => {
    const stats = computeStats([
      makeTrade({
        id: "pnl-missing",
        pnlUsd: undefined,
        rMultiple: 1.5,
        riskUsd: 100,
      }),
    ]);
    expect(stats.totalPnlUsd).toBe(0);
    expect(stats.avgPnlUsd).toBe(0);
  });

  it("nets fees out of totalPnlUsd", () => {
    const stats = computeStats([
      makeTrade({ id: "net", pnlUsd: 200, feesUsd: 2.5 }),
    ]);
    expect(stats.totalPnlUsd).toBe(197.5);
    expect(stats.avgPnlUsd).toBe(197.5);
  });
});

describe("resolvePnlUsd", () => {
  it("returns stored pnlUsd when fees are zero/absent", () => {
    expect(resolvePnlUsd(makeTrade({ id: "p1", pnlUsd: 250, feesUsd: 0 }))).toBe(
      250,
    );
    expect(
      resolvePnlUsd(makeTrade({ id: "p1b", pnlUsd: 250, feesUsd: undefined })),
    ).toBe(250);
  });

  it("subtracts feesUsd from pnlUsd", () => {
    expect(
      resolvePnlUsd(makeTrade({ id: "p-fees", pnlUsd: 200, feesUsd: 2.4 })),
    ).toBe(197.6);
  });

  it("returns zero when pnlUsd is missing (no R × risk estimate)", () => {
    expect(
      resolvePnlUsd(
        makeTrade({
          id: "p2",
          pnlUsd: undefined,
          rMultiple: -1,
          riskUsd: 80,
        }),
      ),
    ).toBe(0);
  });
});

describe("compareTradesChronologically", () => {
  it("orders by entryTime (trades taken), not exitTime", () => {
    // Win entered first but closed later; loss entered later and stopped out sooner.
    const winFirst = makeTrade({
      id: "win-first",
      date: "2026-07-29",
      entryTime: "2026-07-29T10:00:00",
      exitTime: "2026-07-29T20:00:00",
      rMultiple: 2,
      result: "win",
    });
    const lossLater = makeTrade({
      id: "loss-later",
      date: "2026-07-29",
      entryTime: "2026-07-29T14:16:00",
      exitTime: "2026-07-29T14:30:00",
      rMultiple: -1.15,
      result: "loss",
    });
    expect(compareTradesChronologically(winFirst, lossLater)).toBeLessThan(0);
    const curve = equityCurve([lossLater, winFirst], "r");
    // Start at 0, then win first → positive, then loss
    expect(curve.map((p) => p.id)).toEqual([
      "__equity-start",
      "win-first",
      "loss-later",
    ]);
    expect(curve.map((p) => p.value)).toEqual([0, 2, 0.85]);
    expect(curve[1].value).toBeGreaterThan(0);
  });

  it("falls back to exitTime when entryTime is missing", () => {
    const later = makeTrade({
      id: "later",
      date: "2026-07-01",
      entryTime: undefined,
      exitTime: "2026-07-01T15:00:00Z",
      rMultiple: 2,
    });
    const earlier = makeTrade({
      id: "earlier",
      date: "2026-07-01",
      entryTime: undefined,
      exitTime: "2026-07-01T09:00:00Z",
      rMultiple: -1,
      result: "loss",
    });
    expect(compareTradesChronologically(later, earlier)).toBeGreaterThan(0);
  });

  it("falls back to id when close times match", () => {
    const a = makeTrade({
      id: "a",
      date: "2026-07-01",
      entryTime: undefined,
      exitTime: undefined,
    });
    const b = makeTrade({
      id: "b",
      date: "2026-07-01",
      entryTime: undefined,
      exitTime: undefined,
    });
    expect(compareTradesChronologically(a, b)).toBeLessThan(0);
  });

  it("exposes tradeCloseMs as an alias of trade chronology", () => {
    const trade = makeTrade({
      id: "alias",
      entryTime: "2026-07-01T10:00:00Z",
    });
    expect(tradeCloseMs(trade)).toBeGreaterThan(0);
  });
});

describe("equityCurve", () => {
  it("builds cumulative R curve sorted by date", () => {
    const trades = [
      makeTrade({ id: "e1", date: "2026-07-02", rMultiple: 2 }),
      makeTrade({ id: "e2", date: "2026-07-01", rMultiple: -1, result: "loss" }),
    ];
    const curve = equityCurve(trades, "r");
    expect(curve).toHaveLength(3); // Start + 2 trades
    expect(curve[0]).toMatchObject({ id: "__equity-start", value: 0 });
    expect(curve[1].label).toMatch(/Jul 1/);
    expect(curve[1].value).toBe(-1);
    expect(curve[1].secondary).toBe(-1);
    expect(curve[1].id).toBe("e2");
    expect(curve[1].x).toBe(1);
    expect(curve[2].value).toBe(1);
    expect(curve[2].secondary).toBe(2);
    expect(curve[2].id).toBe("e1");
    expect(curve[2].x).toBe(2);
  });

  it("orders same-day trades by entryTime and keeps unique point ids", () => {
    const trades = [
      makeTrade({
        id: "second",
        date: "2026-07-01",
        entryTime: "2026-07-01T14:00:00Z",
        exitTime: "2026-07-01T15:00:00Z",
        rMultiple: 2,
        pnlUsd: 200,
      }),
      makeTrade({
        id: "first",
        date: "2026-07-01",
        entryTime: "2026-07-01T10:00:00Z",
        exitTime: "2026-07-01T16:00:00Z",
        rMultiple: -1,
        result: "loss",
        pnlUsd: -100,
      }),
      makeTrade({
        id: "third",
        date: "2026-07-01",
        entryTime: "2026-07-01T16:30:00Z",
        exitTime: "2026-07-01T17:00:00Z",
        rMultiple: 1,
        pnlUsd: 100,
      }),
    ];
    const curve = equityCurve(trades, "r");
    expect(curve.map((p) => p.id)).toEqual([
      "__equity-start",
      "first",
      "second",
      "third",
    ]);
    expect(curve.map((p) => p.secondary)).toEqual([0, -1, 2, 1]);
    expect(curve.map((p) => p.value)).toEqual([0, -1, 1, 2]);
    const tradeLabels = curve.slice(1).map((p) => p.label);
    expect(new Set(tradeLabels).size).toBe(3);
    expect(curve.every((p, i) => p.x === i)).toBe(true);
  });

  it("disambiguates duplicate chronology labels", () => {
    const curve = equityCurve(
      [
        makeTrade({
          id: "a",
          date: "2026-07-01",
          entryTime: "2026-07-01T20:00:00",
          exitTime: "2026-07-01T20:05:00",
          rMultiple: 1,
        }),
        makeTrade({
          id: "b",
          date: "2026-07-01",
          entryTime: "2026-07-01T20:00:00",
          exitTime: "2026-07-01T20:10:00",
          rMultiple: -1,
          result: "loss",
        }),
      ],
      "r",
    );
    const labels = curve.slice(1).map((p) => p.label);
    expect(labels[0]).not.toBe(labels[1]);
    expect(labels[0]).toContain("· 1");
    expect(labels[1]).toContain("· 2");
  });

  it("matches cumulative path to chronological trade deltas", () => {
    const trades = [
      makeTrade({
        id: "t-c",
        date: "2026-07-03",
        entryTime: "2026-07-03T12:00:00Z",
        exitTime: "2026-07-03T13:00:00Z",
        rMultiple: 0.5,
      }),
      makeTrade({
        id: "t-a",
        date: "2026-07-01",
        entryTime: "2026-07-01T18:00:00Z",
        exitTime: "2026-07-01T19:00:00Z",
        rMultiple: 2,
      }),
      makeTrade({
        id: "t-b",
        date: "2026-07-02",
        entryTime: "2026-07-02T09:00:00Z",
        exitTime: "2026-07-02T10:00:00Z",
        rMultiple: -1,
        result: "loss",
      }),
    ];
    const curve = equityCurve(trades, "r");
    expect(curve.map((p) => p.id)).toEqual([
      "__equity-start",
      "t-a",
      "t-b",
      "t-c",
    ]);
    let running = 0;
    for (let i = 1; i < curve.length; i++) {
      running += curve[i].secondary!;
      expect(curve[i].value).toBe(round2(running));
    }
  });

  it("builds cumulative USD curve", () => {
    const trades = [
      makeTrade({ id: "u1", date: "2026-07-01", pnlUsd: 100 }),
      makeTrade({ id: "u2", date: "2026-07-02", pnlUsd: -50, result: "loss", rMultiple: -0.5 }),
    ];
    const curve = equityCurve(trades, "usd");
    expect(curve[0].value).toBe(0);
    expect(curve[1].value).toBe(100);
    expect(curve[2].value).toBe(50);
  });

  it("treats missing pnlUsd as zero on the USD equity curve (no R × risk)", () => {
    const curve = equityCurve(
      [
        makeTrade({
          id: "u0",
          pnlUsd: undefined,
          rMultiple: 1.5,
          riskUsd: 100,
        }),
      ],
      "usd",
    );
    expect(curve[0].value).toBe(0);
    expect(curve[1].value).toBe(0);
    expect(curve[1].secondary).toBe(0);
  });

  it("nets fees on the USD equity curve", () => {
    const curve = equityCurve(
      [makeTrade({ id: "u-fees", pnlUsd: 100, feesUsd: 2.5 })],
      "usd",
    );
    expect(curve[1].value).toBe(97.5);
    expect(curve[1].secondary).toBe(97.5);
  });

  it("ignores open trades", () => {
    expect(equityCurve([makeTrade({ id: "open", result: "open" })])).toEqual([
      {
        id: "__equity-start",
        label: "Start",
        value: 0,
        secondary: 0,
        x: 0,
      },
    ]);
  });
});

function round2(n: number) {
  return Number(n.toFixed(2));
}

describe("rByDay", () => {
  it("aggregates R by calendar day", () => {
    const trades = [
      makeTrade({ id: "d1", date: "2026-07-01", rMultiple: 1 }),
      makeTrade({ id: "d2", date: "2026-07-01", rMultiple: 2 }),
      makeTrade({ id: "d3", date: "2026-07-02", rMultiple: -1, result: "loss" }),
    ];
    const byDay = rByDay(trades, "r");
    expect(byDay).toHaveLength(2);
    expect(byDay[0].label).toBe("Jul 1");
    expect(byDay[0].value).toBe(3);
    expect(byDay[1].value).toBe(-1);
  });

  it("aggregates USD by calendar day", () => {
    const byDay = rByDay(
      [
        makeTrade({ id: "usd1", date: "2026-07-01", pnlUsd: 200 }),
        makeTrade({ id: "usd2", date: "2026-07-02", pnlUsd: -50, result: "loss", rMultiple: -0.5 }),
      ],
      "usd",
    );
    expect(byDay[0].value).toBe(200);
    expect(byDay[1].value).toBe(-50);
  });
});

describe("pnlCalendar", () => {
  it("fills the last 30 days and pads to full weeks", () => {
    const now = new Date(2026, 7, 2); // Aug 2, 2026 (Sunday)
    const trades = [
      makeTrade({ id: "p1", date: "2026-07-14", rMultiple: 2, pnlUsd: 200 }),
      makeTrade({ id: "p2", date: "2026-07-22", rMultiple: -1, result: "loss", pnlUsd: -100 }),
      makeTrade({ id: "old", date: "2026-06-01", rMultiple: 5, pnlUsd: 500 }),
    ];
    const cells = pnlCalendar(trades, "r", 30, now);
    const inRange = cells.filter((c) => c.inRange);

    expect(inRange).toHaveLength(30);
    expect(inRange[0]!.date).toBe("2026-07-04");
    expect(inRange[inRange.length - 1]!.date).toBe("2026-08-02");
    expect(cells[0]!.date).toBe("2026-06-28"); // leading Sunday pad
    expect(cells[0]!.inRange).toBe(false);
    expect(cells.length % 7).toBe(0);

    const win = cells.find((c) => c.date === "2026-07-14")!;
    expect(win.hasTrades).toBe(true);
    expect(win.value).toBe(2);

    const loss = cells.find((c) => c.date === "2026-07-22")!;
    expect(loss.hasTrades).toBe(true);
    expect(loss.value).toBe(-1);

    const empty = cells.find((c) => c.date === "2026-07-15")!;
    expect(empty.inRange).toBe(true);
    expect(empty.hasTrades).toBe(false);
    expect(empty.value).toBe(0);

    expect(cells.some((c) => c.date === "2026-06-01" && c.hasTrades)).toBe(false);
  });

  it("aggregates USD values for calendar cells", () => {
    const now = new Date(2026, 6, 10); // Jul 10, 2026
    const cells = pnlCalendar(
      [
        makeTrade({ id: "a", date: "2026-07-09", pnlUsd: 150, rMultiple: 1.5 }),
        makeTrade({ id: "b", date: "2026-07-09", pnlUsd: 50, rMultiple: 0.5 }),
      ],
      "usd",
      7,
      now,
    );
    const day = cells.find((c) => c.date === "2026-07-09")!;
    expect(day.value).toBe(200);
    expect(day.hasTrades).toBe(true);
  });
});

describe("winLossBreakdown", () => {
  it("returns wins, losses, and open counts", () => {
    const trades = [
      makeTrade({ id: "w", result: "win" }),
      makeTrade({ id: "l", result: "loss", rMultiple: -1 }),
      makeTrade({ id: "o", result: "open", rMultiple: 0 }),
    ];
    expect(winLossBreakdown(trades)).toEqual([
      { id: "wins", label: "Wins", value: 1 },
      { id: "losses", label: "Losses", value: 1 },
      { id: "open", label: "Open", value: 1 },
    ]);
  });
});

describe("bySymbol", () => {
  it("sums R by symbol descending", () => {
    const trades = [
      makeTrade({ id: "s1", symbol: "EURUSD", rMultiple: 2 }),
      makeTrade({ id: "s2", symbol: "GBPUSD", rMultiple: 1 }),
      makeTrade({ id: "s3", symbol: "EURUSD", rMultiple: -1, result: "loss" }),
    ];
    const rows = bySymbol(trades, "r");
    expect(rows[0]).toEqual({
      id: "EURUSD",
      label: "EURUSD",
      value: 1,
      count: 2,
    });
    expect(rows[1]).toEqual({
      id: "GBPUSD",
      label: "GBPUSD",
      value: 1,
      count: 1,
    });
  });

  it("sums USD by symbol", () => {
    const rows = bySymbol(
      [
        makeTrade({ id: "su1", symbol: "XAUUSD", pnlUsd: 150 }),
        makeTrade({ id: "su2", symbol: "XAUUSD", pnlUsd: 50 }),
      ],
      "usd",
    );
    expect(rows[0].value).toBe(200);
    expect(rows[0].count).toBe(2);
  });

  it("nets multiple wins and losses on the same symbol", () => {
    const rows = bySymbol(
      [
        makeTrade({ id: "g1", symbol: "GBPJPY", rMultiple: 1.1, result: "win" }),
        makeTrade({
          id: "g2",
          symbol: "GBPJPY",
          rMultiple: -1.02,
          result: "loss",
        }),
        makeTrade({ id: "g3", symbol: "GBPJPY", rMultiple: 1.89, result: "win" }),
      ],
      "r",
    );
    expect(rows).toEqual([
      {
        id: "GBPJPY",
        label: "GBPJPY",
        value: 1.97,
        count: 3,
      },
    ]);
  });

  it("lists a symbol with missing pnlUsd as $0 (no R × risk)", () => {
    const trades = [
      makeTrade({
        id: "eur",
        symbol: "EURUSD",
        pnlUsd: 100,
        rMultiple: 1,
        riskUsd: 100,
      }),
      makeTrade({
        id: "nas-missing-$",
        symbol: "NAS100",
        pnlUsd: undefined,
        rMultiple: 2,
        riskUsd: 100,
        result: "win",
      }),
    ];
    const rows = bySymbol(trades, "usd");
    expect(rows.find((r) => r.label === "NAS100")).toMatchObject({
      value: 0,
      count: 1,
    });
    expect(rows.find((r) => r.label === "EURUSD")).toMatchObject({
      value: 100,
      count: 1,
    });
  });

  it("still lists a symbol when pnlUsd is missing (visible $0 bar)", () => {
    const rows = bySymbol(
      [
        makeTrade({
          id: "orphan",
          symbol: "AUDUSD",
          pnlUsd: undefined,
          riskUsd: undefined,
          rMultiple: 1.2,
        }),
      ],
      "usd",
    );
    expect(rows).toEqual([
      {
        id: "AUDUSD",
        label: "AUDUSD",
        value: 0,
        count: 1,
      },
    ]);
  });

  it("excludes open trades from symbol totals", () => {
    const rows = bySymbol(
      [
        makeTrade({ id: "closed", symbol: "GBPUSD", pnlUsd: 50, rMultiple: 0.5 }),
        makeTrade({
          id: "open",
          symbol: "USDJPY",
          result: "open",
          pnlUsd: undefined,
          rMultiple: 0,
        }),
      ],
      "usd",
    );
    expect(rows.map((r) => r.label)).toEqual(["GBPUSD"]);
  });

  it("matches sum of $ by symbol to totalPnlUsd (fees netted, missing $ = 0)", () => {
    const trades = [
      makeTrade({ id: "a", symbol: "EURUSD", pnlUsd: 100, feesUsd: 2, rMultiple: 1 }),
      makeTrade({
        id: "b",
        symbol: "XAUUSD",
        pnlUsd: undefined,
        rMultiple: -1,
        riskUsd: 100,
        result: "loss",
      }),
      makeTrade({ id: "c", symbol: "EURUSD", pnlUsd: 50, feesUsd: 1, rMultiple: 0.5 }),
      makeTrade({ id: "open", symbol: "NAS100", result: "open", rMultiple: 0 }),
    ];
    const rows = bySymbol(trades, "usd");
    const chartTotal = rows.reduce((sum, r) => sum + r.value, 0);
    expect(chartTotal).toBe(computeStats(trades).totalPnlUsd);
    expect(chartTotal).toBe(147); // (100-2) + 0 + (50-1)
  });
});

describe("bySetup", () => {
  it("sums R by setup descending", () => {
    const trades = [
      makeTrade({ id: "p1", setup: "A", rMultiple: 3 }),
      makeTrade({ id: "p2", setup: "B", rMultiple: 1 }),
    ];
    expect(bySetup(trades, "r")[0]).toEqual({
      id: "A",
      label: "A",
      value: 3,
      count: 1,
    });
  });

  it("sums USD by setup", () => {
    const rows = bySetup(
      [makeTrade({ id: "pu1", setup: "IFVG", pnlUsd: 80 })],
      "usd",
    );
    expect(rows[0].value).toBe(80);
  });
});

describe("dashboard chart correctness", () => {
  it("equity final point matches total R / $ for the seed book", () => {
    const stats = computeStats(seedTrades);
    const rCurve = equityCurve(seedTrades, "r");
    const usdCurve = equityCurve(seedTrades, "usd");
    expect(rCurve[0]?.value).toBe(0);
    expect(rCurve.at(-1)?.value).toBe(round2(stats.totalR));
    expect(usdCurve.at(-1)?.value).toBe(round2(stats.totalPnlUsd));
    expect(rCurve).toHaveLength(stats.closedCount + 1); // Start + closed
    expect(new Set(rCurve.slice(1).map((p) => p.id)).size).toBe(stats.closedCount);
  });

  it("bySymbol $ sums to totalPnlUsd for the seed book", () => {
    const stats = computeStats(seedTrades);
    const rows = bySymbol(seedTrades, "usd");
    const sum = rows.reduce((s, r) => s + r.value, 0);
    expect(round2(sum)).toBe(round2(stats.totalPnlUsd));
    // Every closed symbol appears
    const closedSymbols = new Set(
      seedTrades.filter((t) => t.result !== "open").map((t) => t.symbol),
    );
    expect(new Set(rows.map((r) => r.label))).toEqual(closedSymbols);
  });
});

describe("metricLabel", () => {
  it("returns known labels for every metric field", () => {
    expect(metricLabel("entry")).toBe("Entry");
    expect(metricLabel("stop")).toBe("Stop");
    expect(metricLabel("target")).toBe("Target");
    expect(metricLabel("exit")).toBe("Exit");
    expect(metricLabel("slPips")).toBe("SL (pips)");
    expect(metricLabel("tpPips")).toBe("TP (pips)");
    expect(metricLabel("stopDistance")).toBe("SL distance");
    expect(metricLabel("targetDistance")).toBe("TP distance");
    expect(metricLabel("timeInTradeMinutes")).toBe("Time in trade (min)");
    expect(metricLabel("pnlUsd")).toBe("P&L ($)");
    expect(metricLabel("riskUsd")).toBe("Risk ($)");
    expect(metricLabel("feesUsd")).toBe("Fees (comm+swap $)");
    expect(metricLabel("rMultiple")).toBe("R");
  });

  it("falls back to the field name for unknown keys", () => {
    expect(metricLabel("notAField" as TradeMetricField)).toBe("notAField");
  });
});

describe("metricValue", () => {
  const trade = makeTrade({ id: "mv" });

  it("reads direct numeric fields", () => {
    expect(metricValue(trade, "entry")).toBe(1.1);
    expect(metricValue(trade, "stop")).toBe(1.09);
    expect(metricValue(trade, "target")).toBe(1.12);
    expect(metricValue(trade, "exit")).toBe(1.12);
    expect(metricValue(trade, "slPips")).toBe(10);
    expect(metricValue(trade, "tpPips")).toBe(20);
    expect(metricValue(trade, "timeInTradeMinutes")).toBe(60);
    expect(metricValue(trade, "pnlUsd")).toBe(100);
    expect(metricValue(trade, "riskUsd")).toBe(100);
    expect(metricValue(trade, "feesUsd")).toBe(0);
    expect(metricValue(trade, "rMultiple")).toBe(1);
  });

  it("returns null for optional missing fields", () => {
    const sparse = makeTrade({
      id: "sparse",
      exit: undefined,
      slPips: undefined,
      tpPips: undefined,
      timeInTradeMinutes: undefined,
      entryTime: undefined,
      exitTime: undefined,
      pnlUsd: undefined,
      riskUsd: undefined,
      feesUsd: undefined,
    });
    expect(metricValue(sparse, "exit")).toBeNull();
    expect(metricValue(sparse, "slPips")).toBeNull();
    expect(metricValue(sparse, "tpPips")).toBeNull();
    expect(metricValue(sparse, "timeInTradeMinutes")).toBeNull();
    expect(metricValue(sparse, "pnlUsd")).toBeNull();
    expect(metricValue(sparse, "riskUsd")).toBeNull();
    expect(metricValue(sparse, "feesUsd")).toBeNull();
  });

  it("computes stopDistance and targetDistance when finite", () => {
    expect(metricValue(trade, "stopDistance")).toBeCloseTo(0.01);
    expect(metricValue(trade, "targetDistance")).toBeCloseTo(0.02);
  });

  it("returns null for stopDistance/targetDistance when entry/stop/target non-finite", () => {
    expect(
      metricValue(makeTrade({ id: "nan-e", entry: NaN }), "stopDistance"),
    ).toBeNull();
    expect(
      metricValue(makeTrade({ id: "nan-s", stop: NaN }), "stopDistance"),
    ).toBeNull();
    expect(
      metricValue(makeTrade({ id: "inf-e", entry: Infinity }), "targetDistance"),
    ).toBeNull();
    expect(
      metricValue(makeTrade({ id: "inf-t", target: -Infinity }), "targetDistance"),
    ).toBeNull();
  });

  it("derives timeInTradeMinutes from entry and exit times", () => {
    const derived = makeTrade({
      id: "derived-time",
      timeInTradeMinutes: undefined,
      entryTime: "2026-07-01T08:00:00Z",
      exitTime: "2026-07-01T10:30:00Z",
    });
    expect(metricValue(derived, "timeInTradeMinutes")).toBe(150);
  });

  it("returns null for unknown metric fields via default branch", () => {
    expect(metricValue(trade, "bogus" as TradeMetricField)).toBeNull();
  });
});

describe("labelValue", () => {
  const trade = makeTrade({ id: "lv", date: "2026-07-15" });

  it("returns symbol, formatted date, setup, session, side, and result", () => {
    expect(labelValue(trade, "symbol")).toBe("EURUSD");
    expect(labelValue(trade, "date")).toBe("Jul 15");
    expect(labelValue(trade, "setup")).toBe("Test Setup");
    expect(labelValue(trade, "session")).toBe("London");
    expect(labelValue(trade, "side")).toBe("long");
    expect(labelValue(trade, "result")).toBe("win");
  });

  it("uses em dash for empty setup and session", () => {
    const empty = makeTrade({ id: "empty-labels", setup: "", session: "" });
    expect(labelValue(empty, "setup")).toBe("—");
    expect(labelValue(empty, "session")).toBe("—");
  });

  it("returns raw date when formatting throws", () => {
    const badDate = makeTrade({ id: "bad-date", date: "not-a-valid-date" });
    expect(labelValue(badDate, "date")).toBe("not-a-valid-date");
  });

  it("defaults to symbol for unknown label fields", () => {
    expect(labelValue(trade, "bogus" as TradeLabelField)).toBe("EURUSD");
  });

  it("defaults label field to symbol when omitted", () => {
    expect(labelValue(trade)).toBe("EURUSD");
  });
});

describe("buildChart", () => {
  const trades = seedTrades.slice(0, 3);
  const customData = [{ label: "A", value: 1 }];

  it("builds equity preset with R defaults and custom title", () => {
    const chart = buildChart("equity", trades);
    expect(chart.type).toBe("equity");
    expect(chart.title).toBe("Equity curve (R)");
    expect(chart.description).toBe("Cumulative R across closed trades");
    expect(chart.yLabel).toBe("R");
    expect(chart.valueUnit).toBe("r");
    expect(chart.data?.length).toBeGreaterThan(0);

    const usd = buildChart("equity", trades, "My equity", undefined, "usd");
    expect(usd.title).toBe("My equity");
    expect(usd.description).toBe("Cumulative $ P&L across closed trades");
    expect(usd.yLabel).toBe("$");
    expect(usd.valueUnit).toBe("usd");

    const usdDefaultTitle = buildChart("equity", trades, undefined, undefined, "usd");
    expect(usdDefaultTitle.title).toBe("Equity curve ($)");
  });

  it("builds rByDay preset with R and USD", () => {
    const r = buildChart("rByDay", trades);
    expect(r.title).toBe("Daily R");
    expect(r.yLabel).toBe("R");

    const usd = buildChart("rByDay", trades, undefined, undefined, "usd");
    expect(usd.title).toBe("Daily $");
    expect(usd.yLabel).toBe("$");
  });

  it("builds winLoss preset", () => {
    const chart = buildChart("winLoss", trades, "Mix");
    expect(chart.title).toBe("Mix");
    expect(chart.data).toEqual(winLossBreakdown(trades));
  });

  it("builds bySymbol preset with R and USD", () => {
    const r = buildChart("bySymbol", trades);
    expect(r.title).toBe("R by symbol");
    expect(r.yLabel).toBe("R");

    const usd = buildChart("bySymbol", trades, "Symbols $", undefined, "usd");
    expect(usd.title).toBe("Symbols $");
    expect(usd.yLabel).toBe("$");

    const usdDefaultTitle = buildChart("bySymbol", trades, undefined, undefined, "usd");
    expect(usdDefaultTitle.title).toBe("$ by symbol");
  });

  it("builds bySetup preset with R and USD", () => {
    const r = buildChart("bySetup", trades);
    expect(r.title).toBe("R by setup");

    const usd = buildChart("bySetup", trades, undefined, undefined, "usd");
    expect(usd.title).toBe("$ by setup");
    expect(usd.yLabel).toBe("$");
  });

  it("builds bar, line, and scatter with custom data and titles", () => {
    for (const type of ["bar", "line", "scatter"] as const) {
      const defaultChart = buildChart(type, trades);
      expect(defaultChart.title).toBe("Custom chart");
      expect(defaultChart.data).toEqual([]);

      const custom = buildChart(type, trades, "Custom", customData);
      expect(custom.title).toBe("Custom");
      expect(custom.data).toEqual(customData);
    }
  });
});

describe("buildChartFromRequest", () => {
  it("builds preset charts and applies description override", () => {
    for (const type of ["equity", "rByDay", "winLoss", "bySymbol", "bySetup"] as const) {
      const chart = buildChartFromRequest(
        { type, description: `About ${type}` },
        seedTrades,
      );
      expect(chart.type).toBe(type);
      expect(chart.description).toBe(`About ${type}`);
    }

    const withoutOverride = buildChartFromRequest({ type: "equity" }, seedTrades);
    expect(withoutOverride.description).toBe("Cumulative R across closed trades");
  });

  it("returns explicit custom data when provided", () => {
    const data = [{ label: "pt", value: 42 }];
    const chart = buildChartFromRequest(
      {
        type: "bar",
        title: "Explicit",
        description: "From request",
        xLabel: "X",
        yLabel: "Y",
        data,
      },
      seedTrades,
    );
    expect(chart.title).toBe("Explicit");
    expect(chart.description).toBe("From request");
    expect(chart.xLabel).toBe("X");
    expect(chart.yLabel).toBe("Y");
    expect(chart.data).toEqual(data);

    const defaultTitle = buildChartFromRequest({ type: "line", data }, seedTrades);
    expect(defaultTitle.title).toBe("Custom chart");
  });

  it("builds scatter with defaults and skips trades missing metrics", () => {
    const pool = [
      makeTrade({ id: "sc1", slPips: 10, rMultiple: 1.5 }),
      makeTrade({ id: "sc2", slPips: undefined, rMultiple: 2 }),
      makeTrade({ id: "sc3", slPips: 20, rMultiple: NaN }),
    ];
    const chart = buildChartFromRequest({ type: "scatter" }, pool);
    expect(chart.title).toBe("SL (pips) vs R");
    expect(chart.description).toBe("Each point is one closed trade");
    expect(chart.xLabel).toBe("SL (pips)");
    expect(chart.yLabel).toBe("R");
    expect(chart.data).toHaveLength(1);
    expect(chart.data![0]).toMatchObject({
      label: "EURUSD",
      value: 10,
      secondary: 1.5,
      x: 10,
      y: 1.5,
    });
  });

  it("builds scatter using xField entry to skip non-finite x values", () => {
    const chart = buildChartFromRequest(
      {
        type: "scatter",
        xField: "entry",
        yField: "rMultiple",
      },
      [makeTrade({ id: "sc-x", entry: Infinity, rMultiple: 2 })],
    );
    expect(chart.data).toEqual([]);
  });

  it("builds scatter with custom fields and labelField", () => {
    const chart = buildChartFromRequest(
      {
        type: "scatter",
        xField: "tpPips",
        yField: "pnlUsd",
        labelField: "setup",
        title: "Scatter custom",
        description: "Custom scatter",
        xLabel: "TP",
        yLabel: "PnL",
      },
      [makeTrade({ id: "sc-c", tpPips: 30, pnlUsd: 120, setup: "IFVG" })],
    );
    expect(chart.title).toBe("Scatter custom");
    expect(chart.description).toBe("Custom scatter");
    expect(chart.xLabel).toBe("TP");
    expect(chart.yLabel).toBe("PnL");
    expect(chart.data![0].label).toBe("IFVG");
  });

  it("builds bucketed bar with winRate aggregate and default bucket size fallback", () => {
    const trades = [
      makeTrade({ id: "b1", slPips: 5, result: "win" }),
      makeTrade({ id: "b2", slPips: 7, result: "loss", rMultiple: -1 }),
      makeTrade({ id: "b3", slPips: 15, result: "win" }),
      makeTrade({ id: "b4", slPips: 18, result: "win" }),
    ];
    const chart = buildChartFromRequest(
      {
        type: "bar",
        bucketField: "slPips",
        bucketSize: 0,
        aggregate: "winRate",
      },
      trades,
    );
    expect(chart.title).toBe("Win rate by SL (pips)");
    expect(chart.description).toBe("Buckets of 0 on SL (pips)");
    expect(chart.yLabel).toBe("Win rate %");
    expect(chart.data).toEqual([
      { label: "0–10", value: 50 },
      { label: "10–20", value: 100 },
    ]);

    const defaultAgg = buildChartFromRequest(
      { type: "bar", bucketField: "slPips", bucketSize: 10 },
      trades,
    );
    expect(defaultAgg.title).toBe("Win rate by SL (pips)");
    expect(defaultAgg.yLabel).toBe("Win rate %");

    const withDesc = buildChartFromRequest(
      {
        type: "bar",
        bucketField: "slPips",
        aggregate: "winRate",
        description: "Custom bucket description",
      },
      trades,
    );
    expect(withDesc.description).toBe("Custom bucket description");
  });

  it("maps null winRate in open-only buckets to zero", () => {
    const trades = [
      makeTrade({ id: "open-b", slPips: 5, result: "open", rMultiple: 0 }),
    ];
    const chart = buildChartFromRequest(
      {
        type: "bar",
        bucketField: "slPips",
        bucketSize: 10,
        aggregate: "winRate",
        closedOnly: false,
      },
      trades,
    );
    expect(chart.data).toEqual([{ label: "0–10", value: 0 }]);
  });

  it("builds bucketed bar with count, avg, and sum aggregates", () => {
    const trades = [
      makeTrade({ id: "c1", slPips: 12, rMultiple: 2 }),
      makeTrade({ id: "c2", slPips: 14, rMultiple: 1 }),
      makeTrade({ id: "c3", slPips: 22, rMultiple: -1, result: "loss" }),
    ];

    const count = buildChartFromRequest(
      {
        type: "bar",
        bucketField: "slPips",
        bucketSize: 10,
        aggregate: "count",
      },
      trades,
    );
    expect(count.title).toBe("count R by SL (pips)");
    expect(count.yLabel).toBe("Trades");
    expect(count.data).toEqual([
      { label: "10–20", value: 2 },
      { label: "20–30", value: 1 },
    ]);

    const avg = buildChartFromRequest(
      {
        type: "bar",
        bucketField: "slPips",
        bucketSize: 10,
        aggregate: "avg",
      },
      trades,
    );
    expect(avg.title).toBe("avg R by SL (pips)");
    expect(avg.yLabel).toBe("R");
    expect(avg.data![0].value).toBe(1.5);

    const sum = buildChartFromRequest(
      {
        type: "bar",
        bucketField: "slPips",
        bucketSize: 10,
        aggregate: "sum",
        valueField: "rMultiple",
        yLabel: "Total R",
      },
      trades,
    );
    expect(sum.data![0].value).toBe(3);
    expect(sum.yLabel).toBe("Total R");
  });

  it("returns zero when bucket aggregate has no finite metric values", () => {
    const chart = buildChartFromRequest(
      {
        type: "bar",
        bucketField: "slPips",
        bucketSize: 10,
        aggregate: "avg",
        valueField: "exit",
      },
      [makeTrade({ id: "no-exit", slPips: 5, exit: undefined })],
    );
    expect(chart.data).toEqual([{ label: "0–10", value: 0 }]);
  });

  it("builds grouped line series sorted by abs value except for date labels", () => {
    const trades = [
      makeTrade({ id: "g1", symbol: "AAA", rMultiple: 1 }),
      makeTrade({ id: "g2", symbol: "BBB", rMultiple: -3, result: "loss" }),
      makeTrade({ id: "g3", date: "2026-07-02", rMultiple: 0.5 }),
    ];

    const bySymbolChart = buildChartFromRequest(
      { type: "line", aggregate: "sum", valueField: "rMultiple" },
      trades,
    );
    expect(bySymbolChart.title).toBe("R by symbol");
    expect(bySymbolChart.yLabel).toBe("R");
    expect(bySymbolChart.data![0].label).toBe("BBB");
    expect(bySymbolChart.data![0].value).toBe(-3);

    const avgChart = buildChartFromRequest(
      {
        type: "line",
        labelField: "symbol",
        aggregate: "avg",
        valueField: "rMultiple",
      },
      trades,
    );
    expect(avgChart.yLabel).toBe("R");

    const byDateChart = buildChartFromRequest(
      {
        type: "line",
        labelField: "date",
        aggregate: "sum",
        valueField: "rMultiple",
        description: "Grouped by day",
      },
      trades,
    );
    expect(byDateChart.data!.map((p) => p.label)).toEqual(["Jul 1", "Jul 2"]);
    expect(byDateChart.description).toBe("Grouped by day");
  });

  it("sets winRate and count yLabels on grouped series", () => {
    const trades = [
      makeTrade({ id: "wr1", symbol: "EURUSD", result: "win" }),
      makeTrade({ id: "wr2", symbol: "EURUSD", result: "loss", rMultiple: -1 }),
      makeTrade({ id: "wr3", symbol: "GBPUSD", result: "win" }),
      makeTrade({ id: "wr4", symbol: "ONLYBE", result: "breakeven", rMultiple: 0 }),
    ];

    const winRate = buildChartFromRequest(
      { type: "bar", labelField: "symbol", aggregate: "winRate" },
      trades,
    );
    expect(winRate.title).toBe("Win rate by symbol");
    expect(winRate.yLabel).toBe("Win rate %");
    expect(winRate.data).toEqual([
      { label: "GBPUSD", value: 100 },
      { label: "EURUSD", value: 50 },
      { label: "ONLYBE", value: 0 },
    ]);

    const count = buildChartFromRequest(
      { type: "bar", labelField: "symbol", aggregate: "count" },
      trades,
    );
    expect(count.yLabel).toBe("Trades");
    expect(count.data!.find((p) => p.label === "EURUSD")!.value).toBe(2);
  });

  it("respects custom yLabel and includes open trades when closedOnly is false", () => {
    const chart = buildChartFromRequest(
      {
        type: "bar",
        labelField: "symbol",
        aggregate: "count",
        closedOnly: false,
        yLabel: "Custom count axis",
      },
      [
        makeTrade({ id: "inc1", result: "win" }),
        makeTrade({ id: "inc2", result: "open", rMultiple: 0 }),
      ],
    );
    expect(chart.yLabel).toBe("Custom count axis");
    expect(chart.data![0].value).toBe(2);
  });

  it("uses provided title on bucketed non-winRate charts", () => {
    const chart = buildChartFromRequest(
      {
        type: "bar",
        bucketField: "slPips",
        bucketSize: 10,
        aggregate: "sum",
        valueField: "rMultiple",
        title: "My bucket chart",
        description: "Bucket desc",
        yLabel: "Custom Y",
      },
      [makeTrade({ id: "titled", slPips: 5, rMultiple: 2 })],
    );
    expect(chart.title).toBe("My bucket chart");
    expect(chart.description).toBe("Bucket desc");
    expect(chart.yLabel).toBe("Custom Y");
  });

  it("skips trades with non-finite bucket values", () => {
    const chart = buildChartFromRequest(
      {
        type: "bar",
        bucketField: "slPips",
        bucketSize: 10,
        aggregate: "count",
      },
      [
        makeTrade({ id: "skip1", slPips: undefined }),
        makeTrade({ id: "skip2", slPips: 5 }),
      ],
    );
    expect(chart.data).toEqual([{ label: "0–10", value: 1 }]);
  });

  it("uses grouped defaults for aggregate and valueField", () => {
    const chart = buildChartFromRequest(
      { type: "line", labelField: "symbol" },
      [makeTrade({ id: "def1", symbol: "ZZZ", rMultiple: 2 })],
    );
    expect(chart.title).toBe("R by symbol");
    expect(chart.yLabel).toBe("R");
    expect(chart.data).toEqual([{ label: "ZZZ", value: 2 }]);
  });

  it("uses default bucket description when bucketSize omitted", () => {
    const chart = buildChartFromRequest(
      { type: "bar", bucketField: "slPips", aggregate: "count" },
      [makeTrade({ id: "bd1", slPips: 5 })],
    );
    expect(chart.description).toBe("Buckets of 10 on SL (pips)");
  });
});
