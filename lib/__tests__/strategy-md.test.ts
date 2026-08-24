import { describe, expect, it } from "vitest";
import {
  applyShortStrategyMarkdown,
  insertMarkdownImage,
  isShortStrategySnippet,
  joinStrategyImages,
  legacyStrategyToMarkdown,
  markdownForChat,
  normalizeStrategy,
  splitStrategyImages,
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
      timeframes: [{ role: "Bias", tf: "D", job: "Dir" }],
      rules: [{ title: "Rule 1", body: "Do the thing" }],
      risk: [{ title: "Risk", body: "1R" }],
      targets: [{ metric: "WR", value: "50%" }],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(normalized.name).toBe("Plan A");
    expect(normalized.markdown).toContain("# Plan A");
    expect(normalized.markdown).toContain("### Rule 1");
    expect(normalized.markdown).toContain("Do the thing");
    expect(normalized.markdown).toContain("## Timeframes");
    expect(normalized.markdown).toContain("## Risk");
    expect(normalized.markdown).toContain("## Targets");
  });

  it("normalizes invalid raw to empty strategy", () => {
    expect(normalizeStrategy(null).name).toBe("Trading strategy");
    expect(normalizeStrategy([]).markdown).toContain("# Trading strategy");
    expect(normalizeStrategy("x").name).toBe("Trading strategy");
    expect(normalizeStrategy(null).checklist).toEqual([]);
  });

  it("derives name from markdown when legacy name missing", () => {
    const normalized = normalizeStrategy({
      markdown: "# From Heading\n\nBody\n",
    });
    expect(normalized.name).toBe("From Heading");
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
    expect(markdownForChat("![](data:image/png;base64,AA)")).toContain(
      "![image]",
    );
  });

  it("applyShortStrategyMarkdown noops, replaces section, or appends", () => {
    const current = "# Plan\n\n## Edge\n\nOld edge\n\n## Rules\n\nBody\n";
    expect(applyShortStrategyMarkdown(current, "   ").mode).toBe("noop");
    const replaced = applyShortStrategyMarkdown(
      current,
      "## Edge\n\nNew edge\n",
    );
    expect(replaced.mode).toContain("section replace");
    expect(replaced.markdown).toContain("New edge");
    expect(replaced.markdown).toContain("## Rules");
    const appended = applyShortStrategyMarkdown(current, "## Notes\n\nExtra\n");
    expect(appended.mode).toContain("append");
    expect(appended.markdown).toContain("## Notes");
  });

  it("replaces the final section when it is the last heading in the doc", () => {
    const current = "# Plan\n\n## Edge\n\nOld edge\n\n## Rules\n\nOld rules\n";
    const replaced = applyShortStrategyMarkdown(current, "## Rules\n\nNew rules\n");
    expect(replaced.mode).toContain("section replace (Rules)");
    expect(replaced.markdown).toContain("New rules");
    expect(replaced.markdown).not.toContain("Old rules");
    expect(replaced.markdown.endsWith("\n")).toBe(true);
  });

  it("section replace keeps trailing newline when markdown already ends with one", () => {
    const current = "# Plan\n\n## Edge\n\nOld\n";
    const replaced = applyShortStrategyMarkdown(current, "## Edge\n\nNew\n");
    expect(replaced.markdown.endsWith("\n")).toBe(true);
    expect(replaced.markdown).toContain("## Edge\n\nNew");
    expect(replaced.markdown).not.toContain("Old");
  });

  it("legacyStrategyToMarkdown uses defaults for missing name and version", () => {
    const md = legacyStrategyToMarkdown({ summary: "Only summary" });
    expect(md).toContain("# Trading strategy");
    expect(md).toContain("Only summary");
    expect(md).not.toContain("*Version");
  });

  it("detects short strategy snippets", () => {
    const long = "x".repeat(250);
    expect(isShortStrategySnippet(long, "short")).toBe(true);
    expect(isShortStrategySnippet("tiny", "also tiny")).toBe(false);
  });

  it("inserts markdown images at cursor", () => {
    const result = insertMarkdownImage("hello", 5, "data:image/png;base64,x", "shot");
    expect(result.markdown).toBe("hello![shot](data:image/png;base64,x)");
    expect(result.cursor).toBeGreaterThan(5);
    const clamped = insertMarkdownImage("ab", 99, "data:image/png;base64,y");
    expect(clamped.markdown).toContain("![strategy image]");
  });

  it("splits data-url images for editor display and joins them back", () => {
    const md = "# Plan\n\n![chart](data:image/png;base64,abc)\n\ntext";
    const split = splitStrategyImages(md);
    expect(split.display).toBe("# Plan\n\n![chart](strategy-image-1)\n\ntext");
    expect(split.display).not.toContain("base64");
    expect(split.images).toHaveLength(1);
    expect(split.images[0]?.dataUrl).toBe("data:image/png;base64,abc");
    expect(joinStrategyImages(split.display, split.images)).toBe(md);
    expect(splitStrategyImages("![ ](data:image/png;base64,z)").images[0]?.alt).toBe(
      "strategy image",
    );
    expect(joinStrategyImages("keep", [{ id: "unused", alt: "x", dataUrl: "data:x" }])).toBe(
      "keep",
    );
  });
});
