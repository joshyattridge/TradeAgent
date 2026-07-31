import { describe, expect, it } from "vitest";
import {
  annotateTradeSchema,
  chartRequestSchema,
  compareToStrategySchema,
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
  });

  it("parses chart and generateCharts schemas", () => {
    expect(
      chartRequestSchema.parse({
        type: "scatter",
        xField: "slPips",
        yField: "rMultiple",
        data: [{ label: "a", value: 1, x: 1, y: 2 }],
      }).type,
    ).toBe("scatter");
    expect(
      generateChartsSchema.parse({
        charts: [{ type: "equity" }, { type: "bar", aggregate: "winRate" }],
      }).charts,
    ).toHaveLength(2);
  });

  it("parses query/stats/compare/find/get schemas", () => {
    expect(queryTradesSchema.parse({}).sort).toBe("newest");
    expect(queryTradesSchema.parse({ sort: "bestR", limit: 5 }).limit).toBe(5);
    expect(getStatsSchema.parse({ closedOnly: false }).closedOnly).toBe(false);
    expect(compareToStrategySchema.parse({}).limit).toBe(5);
    expect(getStrategySchema.parse({}).section).toBe("all");
    expect(getTradeSchema.parse({ id: "t1" }).id).toBe("t1");
    expect(findTradeSchema.parse({ symbol: "EURUSD" }).limit).toBe(8);
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
