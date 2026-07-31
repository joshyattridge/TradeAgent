import { describe, expect, it } from "vitest";
import {
  formatTradeFieldValue,
  lineDiff,
  TRADE_FIELD_LABELS,
} from "@/lib/chat-proposals";
import type { Trade } from "@/lib/types";

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    date: "2026-07-30",
    symbol: "EURUSD",
    side: "long",
    setup: "FVG",
    entry: 1.1,
    stop: 1.09,
    target: 1.12,
    rMultiple: 1.5,
    result: "win",
    ...overrides,
  };
}

describe("formatTradeFieldValue", () => {
  it("formats empty, tags, screenshots, times, money, and numbers", () => {
    expect(formatTradeFieldValue(trade({ notes: undefined }), "notes")).toBe(
      "—",
    );
    expect(formatTradeFieldValue(trade({ notes: "" }), "notes")).toBe("—");
    expect(formatTradeFieldValue(trade({ tags: [] }), "tags")).toBe("—");
    expect(
      formatTradeFieldValue(trade({ tags: ["a", "b"] }), "tags"),
    ).toBe("a, b");
    expect(formatTradeFieldValue(trade({ screenshots: [] }), "screenshots")).toBe(
      "—",
    );
    expect(
      formatTradeFieldValue(trade({ screenshots: ["data:image/png;base64,x"] }), "screenshots"),
    ).toBe("1 image");
    expect(
      formatTradeFieldValue(
        trade({ screenshots: ["a", "b"] }),
        "screenshots",
      ),
    ).toBe("2 images");
    expect(
      formatTradeFieldValue(
        trade({ entryTime: "2026-07-30T15:52:45" }),
        "entryTime",
      ),
    ).toMatch(/2026/);
    expect(formatTradeFieldValue(trade({ rMultiple: 1.25 }), "rMultiple")).toBe(
      "+1.25R",
    );
    expect(formatTradeFieldValue(trade({ rMultiple: -1 }), "rMultiple")).toBe(
      "-1.00R",
    );
    expect(formatTradeFieldValue(trade({ pnlUsd: 12.5 }), "pnlUsd")).toBe(
      "+$12.50",
    );
    expect(formatTradeFieldValue(trade({ riskUsd: 100 }), "riskUsd")).toBe(
      "$100.00",
    );
    expect(formatTradeFieldValue(trade({ feesUsd: 2 }), "feesUsd")).toBe(
      "$2.00",
    );
    expect(formatTradeFieldValue(trade({ entry: 1.2345 }), "entry")).toBe(
      "1.2345",
    );
    expect(formatTradeFieldValue(trade({ symbol: "XAUUSD" }), "symbol")).toBe(
      "XAUUSD",
    );
    expect(TRADE_FIELD_LABELS.symbol).toBe("Symbol");
  });
});

describe("lineDiff", () => {
  it("emits same, add, and remove lines including trailing leftovers", () => {
    expect(lineDiff("a\nb\nc", "a\nx\nc")).toEqual([
      { type: "same", text: "a" },
      { type: "remove", text: "b" },
      { type: "add", text: "x" },
      { type: "same", text: "c" },
    ]);
    expect(lineDiff("only-old", "only-new")).toEqual([
      { type: "remove", text: "only-old" },
      { type: "add", text: "only-new" },
    ]);
    expect(lineDiff("a\nb", "a")).toEqual([
      { type: "same", text: "a" },
      { type: "remove", text: "b" },
    ]);
    expect(lineDiff("a", "a\nb")).toEqual([
      { type: "same", text: "a" },
      { type: "add", text: "b" },
    ]);
  });
});
