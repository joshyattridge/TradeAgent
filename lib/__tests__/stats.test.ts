import { describe, expect, it } from "vitest";
import { seedTrades } from "@/lib/seed-data";
import {
  buildChart,
  buildChartFromRequest,
  bySetup,
  bySymbol,
  closedTrades,
  computeStats,
  equityCurve,
  labelValue,
  metricLabel,
  metricValue,
  rByDay,
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
    feesUsd: 1,
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
    expect(stats.totalPnlUsd).toBe(970);
    expect(stats.avgPnlUsd).toBe(97);
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

  it("treats missing pnlUsd as zero in totals", () => {
    const stats = computeStats([
      makeTrade({ id: "pnl-missing", pnlUsd: undefined, rMultiple: 1 }),
    ]);
    expect(stats.totalPnlUsd).toBe(0);
    expect(stats.avgPnlUsd).toBe(0);
  });
});

describe("equityCurve", () => {
  it("builds cumulative R curve sorted by date", () => {
    const trades = [
      makeTrade({ id: "e1", date: "2026-07-02", rMultiple: 2 }),
      makeTrade({ id: "e2", date: "2026-07-01", rMultiple: -1, result: "loss" }),
    ];
    const curve = equityCurve(trades, "r");
    expect(curve).toHaveLength(2);
    expect(curve[0].label).toBe("Jul 1");
    expect(curve[0].value).toBe(-1);
    expect(curve[0].secondary).toBe(-1);
    expect(curve[1].value).toBe(1);
    expect(curve[1].secondary).toBe(2);
  });

  it("builds cumulative USD curve", () => {
    const trades = [
      makeTrade({ id: "u1", date: "2026-07-01", pnlUsd: 100 }),
      makeTrade({ id: "u2", date: "2026-07-02", pnlUsd: -50, result: "loss", rMultiple: -0.5 }),
    ];
    const curve = equityCurve(trades, "usd");
    expect(curve[0].value).toBe(100);
    expect(curve[1].value).toBe(50);
  });

  it("treats missing pnlUsd as zero in USD mode", () => {
    const curve = equityCurve(
      [makeTrade({ id: "u0", pnlUsd: undefined, rMultiple: 1 })],
      "usd",
    );
    expect(curve[0].value).toBe(0);
    expect(curve[0].secondary).toBe(0);
  });

  it("ignores open trades", () => {
    expect(equityCurve([makeTrade({ id: "open", result: "open" })])).toEqual([]);
  });
});

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

describe("winLossBreakdown", () => {
  it("returns wins, losses, and open counts", () => {
    const trades = [
      makeTrade({ id: "w", result: "win" }),
      makeTrade({ id: "l", result: "loss", rMultiple: -1 }),
      makeTrade({ id: "o", result: "open", rMultiple: 0 }),
    ];
    expect(winLossBreakdown(trades)).toEqual([
      { label: "Wins", value: 1 },
      { label: "Losses", value: 1 },
      { label: "Open", value: 1 },
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
    expect(rows[0]).toEqual({ label: "EURUSD", value: 1 });
    expect(rows[1]).toEqual({ label: "GBPUSD", value: 1 });
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
  });
});

describe("bySetup", () => {
  it("sums R by setup descending", () => {
    const trades = [
      makeTrade({ id: "p1", setup: "A", rMultiple: 3 }),
      makeTrade({ id: "p2", setup: "B", rMultiple: 1 }),
    ];
    expect(bySetup(trades, "r")[0]).toEqual({ label: "A", value: 3 });
  });

  it("sums USD by setup", () => {
    const rows = bySetup(
      [makeTrade({ id: "pu1", setup: "IFVG", pnlUsd: 80 })],
      "usd",
    );
    expect(rows[0].value).toBe(80);
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
    expect(metricLabel("feesUsd")).toBe("Fees ($)");
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
    expect(metricValue(trade, "feesUsd")).toBe(1);
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
