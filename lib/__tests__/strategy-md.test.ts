import { describe, expect, it } from "vitest";
import {
  legacyStrategyToMarkdown,
  markdownForChat,
  normalizeStrategy,
  strategyNameFromMarkdown,
} from "@/lib/strategy-md";

describe("strategy markdown helpers", () => {
  it("derives name from first heading", () => {
    expect(strategyNameFromMarkdown("# My Edge\n\nBody")).toBe("My Edge");
    expect(strategyNameFromMarkdown("no heading")).toBe("Trading strategy");
  });

  it("normalizes legacy structured strategy", () => {
    const normalized = normalizeStrategy({
      name: "Plan A",
      version: "2",
      summary: "Summary line",
      edge: "Only A+",
      approach: "Wait",
      timeframes: [],
      rules: [{ title: "Rule 1", body: "Do the thing" }],
      risk: [],
      targets: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(normalized.name).toBe("Plan A");
    expect(normalized.markdown).toContain("# Plan A");
    expect(normalized.markdown).toContain("### Rule 1");
    expect(normalized.markdown).toContain("Do the thing");
  });

  it("keeps existing markdown", () => {
    const md = "# Already markdown\n\nHello\n";
    expect(legacyStrategyToMarkdown({ markdown: md, name: "X" })).toBe(md);
  });

  it("strips data-url images for chat", () => {
    const md = "See ![setup](data:image/jpeg;base64,AAAA) then text";
    expect(markdownForChat(md)).toBe(
      "See ![setup]([embedded image in strategy doc]) then text",
    );
  });
});
