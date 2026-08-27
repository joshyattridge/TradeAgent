import { describe, expect, it } from "vitest";
import {
  calculatePositionSizeSchema,
  annotateTradeSchema,
  chartRequestSchema,
  findTradeSchema,
  generateChartsSchema,
  getStatsSchema,
  getStrategySchema,
  getTradeSchema,
  queryTradesSchema,
  updateStrategySchema,
} from "@/lib/chat-schemas";

describe("remaining chat schemas", () => {
  it("parses updateStrategySchema", () => {
    expect(
      updateStrategySchema.parse({
        replacements: [{ find: "a", replace: "b", replaceAll: true }],
        appendMarkdown: "## More",
        name: "Plan",
      }),
    ).toMatchObject({ name: "Plan" });
    expect(updateStrategySchema.parse({ markdown: "# Full\n" }).markdown).toBe(
      "# Full\n",
    );
    expect(
      updateStrategySchema.parse({
        checklist: [{ id: "cl-1", label: "Bias locked" }],
      }).checklist,
    ).toEqual([{ id: "cl-1", label: "Bias locked" }]);
  });

  it("parses chart and generateCharts schemas", () => {
    expect(
      chartRequestSchema.parse({
        type: "scatter",
        xField: "slPips",
        yField: "pnlUsd",
        data: [{ label: "a", value: 1, x: 1, y: 2 }],
      }).type,
    ).toBe("scatter");
    expect(
      generateChartsSchema.parse({
        charts: [
          { type: "equity" },
          { type: "bar", aggregate: "winRate" },
          { type: "lossStreak" },
          { type: "winWithin" },
          { type: "equityFan" },
        ],
      }).charts,
    ).toHaveLength(5);
  });

  it("parses query/stats/find/get schemas", () => {
    expect(queryTradesSchema.parse({}).sort).toBe("newest");
    expect(queryTradesSchema.parse({}).side).toBe("any");
    expect(queryTradesSchema.parse({}).result).toBe("any");
    expect(queryTradesSchema.parse({ result: "missed" }).result).toBe("missed");
    expect(queryTradesSchema.parse({ sort: "bestPnl", limit: 5 }).limit).toBe(5);
    expect(getStatsSchema.parse({}).closedOnly).toBe(true);
    expect(getStatsSchema.parse({ closedOnly: false }).closedOnly).toBe(false);
    expect(getStrategySchema.parse({}).section).toBe("all");
    expect(getTradeSchema.parse({ id: "t1" }).id).toBe("t1");
    expect(findTradeSchema.parse({ symbol: "EURUSD" }).limit).toBe(8);
    expect(
      calculatePositionSizeSchema.parse({
        symbol: "EURUSD",
        entry: 1.17,
        stop: 1.165,
        riskUsd: 100,
      }),
    ).toMatchObject({ symbol: "EURUSD", riskUsd: 100 });
    expect(
      calculatePositionSizeSchema.parse({
        symbol: "EURUSD",
        stopPips: 24,
        riskUsd: 100,
      }),
    ).toMatchObject({ stopPips: 24, riskUsd: 100 });
    expect(
      calculatePositionSizeSchema.safeParse({
        symbol: "EURUSD",
        riskUsd: 100,
      }).success,
    ).toBe(false);
  });

  it("keeps empty replaceNotes/replaceTags when they are the only op", () => {
    expect(
      annotateTradeSchema.parse({ id: "t1", replaceNotes: "" }),
    ).toMatchObject({ replaceNotes: "" });
    expect(
      annotateTradeSchema.parse({ id: "t1", replaceTags: [] }),
    ).toMatchObject({ replaceTags: [] });
    expect(
      annotateTradeSchema.safeParse({
        id: "t1",
        replaceNotes: "",
        addTags: ["x"],
      }).success,
    ).toBe(true);
  });

  it("trims removeTags in the transform output", () => {
    expect(
      annotateTradeSchema.parse({
        id: "t1",
        removeTags: ["  london  ", "a+"],
      }),
    ).toMatchObject({
      removeTags: ["london", "a+"],
    });
  });
});
