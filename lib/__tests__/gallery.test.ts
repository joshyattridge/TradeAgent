import { describe, expect, it } from "vitest";
import {
  collectGalleryShots,
  galleryShotCounts,
  isGalleryResult,
  isGalleryScreenshot,
  uniqueTradesFromShots,
} from "@/lib/gallery";
import type { Trade } from "@/lib/types";

function trade(overrides: Partial<Trade> & Pick<Trade, "id">): Trade {
  return {
    date: "2026-07-01",
    symbol: "EURUSD",
    side: "long",
    entry: 1.1,
    stop: 1.09,
    target: 1.12,
    rMultiple: 1,
    result: "win",
    ...overrides,
  };
}

describe("isGalleryScreenshot", () => {
  it("accepts real image sources and rejects pending or empty", () => {
    expect(isGalleryScreenshot("data:image/png;base64,abc")).toBe(true);
    expect(isGalleryScreenshot("https://example.com/chart.png")).toBe(true);
    expect(isGalleryScreenshot("pending")).toBe(false);
    expect(isGalleryScreenshot("")).toBe(false);
    expect(isGalleryScreenshot(undefined)).toBe(false);
  });
});

describe("isGalleryResult", () => {
  it("keeps only wins and losses", () => {
    expect(isGalleryResult("win")).toBe(true);
    expect(isGalleryResult("loss")).toBe(true);
    expect(isGalleryResult("breakeven")).toBe(false);
    expect(isGalleryResult("open")).toBe(false);
    expect(isGalleryResult("missed")).toBe(false);
  });
});

describe("collectGalleryShots", () => {
  const win = trade({
    id: "win-old",
    date: "2026-07-01",
    entryTime: "2026-07-01T08:00:00Z",
    result: "win",
    screenshots: ["https://example.com/win.png", "pending", ""],
  });
  const loss = trade({
    id: "loss-new",
    date: "2026-07-02",
    entryTime: "2026-07-02T08:00:00Z",
    symbol: "GBPUSD",
    result: "loss",
    screenshots: ["https://example.com/loss.png"],
  });

  it("skips hidden, pending, and non win/loss trades", () => {
    const shots = collectGalleryShots([
      win,
      loss,
      trade({
        id: "hidden",
        result: "win",
        hidden: true,
        screenshots: ["https://example.com/hidden.png"],
      }),
      trade({
        id: "open",
        result: "open",
        screenshots: ["https://example.com/open.png"],
      }),
      trade({ id: "none", result: "win" }),
      trade({ id: "empty", result: "loss", screenshots: [] }),
    ]);
    expect(shots.map((s) => s.id)).toEqual(["loss-new:0", "win-old:0"]);
    expect(shots[1]?.shotCount).toBe(1);
  });

  it("filters wins and losses separately", () => {
    const trades = [win, loss];
    expect(collectGalleryShots(trades, "win").map((s) => s.trade.id)).toEqual([
      "win-old",
    ]);
    expect(collectGalleryShots(trades, "loss").map((s) => s.trade.id)).toEqual([
      "loss-new",
    ]);
    expect(galleryShotCounts(trades)).toEqual({ all: 2, win: 1, loss: 1 });
  });

  it("keeps screenshot order and ties breaks by trade id", () => {
    const a = trade({
      id: "b-id",
      date: "2026-07-01",
      screenshots: ["https://example.com/a1.png", "https://example.com/a2.png"],
    });
    const b = trade({
      id: "a-id",
      date: "2026-07-01",
      screenshots: ["https://example.com/b.png"],
    });
    expect(collectGalleryShots([a, b]).map((s) => s.id)).toEqual([
      "a-id:0",
      "b-id:0",
      "b-id:1",
    ]);
  });
});

describe("uniqueTradesFromShots", () => {
  it("dedupes trades while preserving gallery order", () => {
    const first = trade({
      id: "later",
      date: "2026-07-02",
      screenshots: ["https://example.com/1.png", "https://example.com/2.png"],
    });
    const second = trade({
      id: "earlier",
      date: "2026-07-01",
      result: "loss",
      screenshots: ["https://example.com/3.png"],
    });
    const shots = collectGalleryShots([first, second]);
    expect(uniqueTradesFromShots(shots).map((t) => t.id)).toEqual([
      "later",
      "earlier",
    ]);
    expect(uniqueTradesFromShots([])).toEqual([]);
    expect(galleryShotCounts([])).toEqual({ all: 0, win: 0, loss: 0 });
  });
});
