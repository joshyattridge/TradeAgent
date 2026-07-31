import { describe, expect, it, vi } from "vitest";

vi.mock("date-fns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("date-fns")>();
  return {
    ...actual,
    format: vi.fn(actual.format),
  };
});

import * as dateFns from "date-fns";
import {
  coerceDateTimeString,
  formatClock,
  formatDuration,
  formatPips,
  formatPnlUsd,
  formatTradeDate,
  formatTradeDateTime,
  getSlPips,
  getTimeInTradeMinutes,
  getTpPips,
  hasExplicitTimezone,
  normalizeTradeDateTime,
  parseTradeDateTime,
  pipSize,
  priceToPips,
} from "@/lib/trade-format";
import type { Trade } from "@/lib/types";

describe("coerceDateTimeString", () => {
  it("converts UTC+1 prose to numeric offset", () => {
    expect(coerceDateTimeString("2026-07-30 15:52:45 UTC+1")).toBe(
      "2026-07-30T15:52:45+01:00",
    );
    expect(coerceDateTimeString("2026-07-30T16:44:26 UTC+1")).toBe(
      "2026-07-30T16:44:26+01:00",
    );
  });

  it("handles UTC/GMT Z and space-separated local times", () => {
    expect(coerceDateTimeString("2026-07-30 15:52:45 UTC")).toBe(
      "2026-07-30T15:52:45Z",
    );
    expect(coerceDateTimeString("2026-07-30 15:52:45")).toBe(
      "2026-07-30T15:52:45",
    );
  });
});

describe("parse / format / normalize trade datetimes", () => {
  it("parses LLM UTC+1 strings instead of falling back to midnight", () => {
    const d = parseTradeDateTime("2026-07-30 15:52:45 UTC+1", "2026-07-30");
    expect(d).not.toBeNull();
    expect(formatTradeDateTime("2026-07-30 15:52:45 UTC+1", "2026-07-30")).not.toMatch(
      /00:00/,
    );
    expect(
      formatTradeDateTime("2026-07-30 15:52:45 UTC+1", "2026-07-30", "HH:mm"),
    ).toMatch(/15:52|14:52/);
  });

  it("preserves timezone-naive CSV wall clocks without shifting via Z", () => {
    expect(normalizeTradeDateTime("2026-07-30 15:46:09")).toBe(
      "2026-07-30T15:46:09",
    );
    expect(normalizeTradeDateTime("2026-07-30T15:46:09")).toBe(
      "2026-07-30T15:46:09",
    );
    // Mis-tagged Z would display +1h in UTC+1 — naive path must not invent Z
    expect(normalizeTradeDateTime("2026-07-30 15:46:09")?.endsWith("Z")).toBe(
      false,
    );
    expect(formatTradeDateTime("2026-07-30T15:46:09", undefined, "HH:mm")).toBe(
      "15:46",
    );
  });

  it("keeps explicit UTC+1 offset wall clock", () => {
    expect(normalizeTradeDateTime("2026-07-30 15:52:45 UTC+1")).toBe(
      "2026-07-30T15:52:45+01:00",
    );
  });

  it("keeps explicit Z as a real UTC instant", () => {
    const iso = normalizeTradeDateTime("2026-07-30T15:52:45Z");
    expect(iso).toBe("2026-07-30T15:52:45.000Z");
  });

  it("formats date-only without inventing a clock time label pattern still ok", () => {
    expect(formatTradeDateTime("2026-07-30")).toBe("Jul 30, 2026");
  });

  it("keeps time-only with fallback date", () => {
    const d = parseTradeDateTime("15:52:45", "2026-07-30");
    expect(d).not.toBeNull();
    expect(formatTradeDateTime("15:52:45", "2026-07-30", "HH:mm")).toBe("15:52");
  });

  it("handles more coerce / parse edge cases", () => {
    expect(coerceDateTimeString("")).toBe("");
    expect(coerceDateTimeString("2026-07-30 15:52:45+0100")).toBe(
      "2026-07-30T15:52:45+01:00",
    );
    expect(coerceDateTimeString("2026-07-30T9:05:01")).toBe(
      "2026-07-30T09:05:01",
    );
    expect(coerceDateTimeString("not-a-date")).toBe("not-a-date");
    expect(parseTradeDateTime(undefined)).toBeNull();
    expect(parseTradeDateTime(undefined, "not-iso")).toBeNull();
    expect(parseTradeDateTime("15:52")).not.toBeNull();
    expect(parseTradeDateTime("bogus", "also-bad")).toBeNull();
    expect(normalizeTradeDateTime(undefined)).toBeUndefined();
    expect(normalizeTradeDateTime("15:52:45")).toBe("15:52:45");
    expect(formatTradeDateTime("")).toBe("—");
    expect(formatTradeDateTime("15:52")).toBe("15:52");
    expect(formatTradeDateTime("not-parseable")).toBe("—");
  });

  it("detects explicit timezones", () => {
    expect(hasExplicitTimezone("2026-07-30T15:52:45Z")).toBe(true);
    expect(hasExplicitTimezone("2026-07-30 15:52:45 UTC")).toBe(true);
    expect(hasExplicitTimezone("2026-07-30 15:52:45 UTC+1")).toBe(true);
    expect(hasExplicitTimezone("2026-07-30 15:52:45")).toBe(false);
  });

  it("formats dates, durations, clocks, pnl, pips", () => {
    expect(formatTradeDate("")).toBe("—");
    expect(formatTradeDate("not-a-date")).toBe("not-a-date");
    expect(formatTradeDate("2026-07-30")).toBe("Jul 30, 2026");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(60 * 25)).toBe("1d 1h");
    expect(formatDuration(60 * 24)).toBe("1d");
    expect(formatClock(undefined)).toBe("—");
    expect(formatClock("9:05:00")).toBe("09:05");
    expect(formatClock("2026-07-30T15:52:45")).toBe("15:52");
    expect(formatClock("nope")).toBe("—");
    expect(formatPnlUsd(undefined)).toBe("—");
    expect(formatPnlUsd(12.5)).toBe("+$12.50");
    expect(formatPnlUsd(-3)).toBe("$-3.00");
    expect(formatPips(undefined)).toBe("—");
    expect(formatPips(10)).toBe("10");
    expect(formatPips(10.5)).toBe("10.5");
  });

  it("computes pip sizes and distances", () => {
    expect(pipSize("XAUUSD")).toBe(0.1);
    expect(pipSize("XAGUSD")).toBe(0.01);
    expect(pipSize("NAS100")).toBe(1);
    // Note: USDJPY contains "DJ" and hits the index pip size branch
    expect(pipSize("EURJPY")).toBe(0.01);
    expect(pipSize("EURUSD")).toBe(0.0001);
    expect(pipSize("BTC")).toBe(0.0001);
    expect(priceToPips("EURUSD", 0.001)).toBe(10);
    const trade: Trade = {
      id: "t",
      date: "2026-07-30",
      symbol: "EURUSD",
      side: "long",
      setup: "x",
      entry: 1.1,
      stop: 1.09,
      target: 1.12,
      rMultiple: 1,
      result: "win",
      slPips: 12,
      tpPips: 24,
      timeInTradeMinutes: 5,
    };
    expect(getSlPips(trade)).toBe(12);
    expect(getTpPips(trade)).toBe(24);
    expect(getTimeInTradeMinutes(trade)).toBe(5);
    const derived = {
      ...trade,
      slPips: undefined,
      tpPips: undefined,
      timeInTradeMinutes: undefined,
      entryTime: "2026-07-30T10:00:00",
      exitTime: "2026-07-30T10:30:00",
    };
    expect(getSlPips(derived)).toBe(100);
    expect(getTpPips(derived)).toBe(200);
    expect(getTimeInTradeMinutes(derived)).toBe(30);
    expect(
      getTimeInTradeMinutes({
        ...trade,
        timeInTradeMinutes: undefined,
        entryTime: undefined,
      }),
    ).toBeUndefined();
  });

  it("pads hour-only times and handles parse/normalize fallbacks", () => {
    expect(coerceDateTimeString("2026-07-30 9:05")).toBe("2026-07-30T09:05:00");
    expect(parseTradeDateTime(undefined, "not-a-date")).toBeNull();
    expect(normalizeTradeDateTime("not-parseable-at-all")).toBe(
      "not-parseable-at-all",
    );
  });

  it("returns undefined pip distances when levels are missing", () => {
    const base: Trade = {
      id: "t",
      date: "2026-07-30",
      symbol: "EURUSD",
      side: "long",
      setup: "x",
      entry: undefined as never,
      stop: undefined as never,
      target: undefined,
      rMultiple: 0,
      result: "open",
      slPips: undefined,
      tpPips: undefined,
    };
    expect(getSlPips(base)).toBeUndefined();
    expect(getTpPips(base)).toBeUndefined();
    expect(
      getTimeInTradeMinutes({
        ...base,
        entryTime: "2026-07-30T10:00:00",
        exitTime: undefined,
      }),
    ).toBeUndefined();
  });

  it("returns em dash or raw date when format() throws", () => {
    vi.mocked(dateFns.format).mockImplementation(() => {
      throw new Error("format failed");
    });
    expect(formatTradeDateTime("2026-07-30T15:52:45")).toBe("—");
    expect(formatTradeDate("2026-07-30")).toBe("2026-07-30");
    expect(formatClock("2026-07-30T15:52:45")).toBe("—");
    vi.mocked(dateFns.format).mockRestore();
  });

  it("falls back to calendar date when clock string is nonsense", () => {
    const d = parseTradeDateTime("25:99:99", "2026-07-30");
    expect(d).not.toBeNull();
    expect(parseTradeDateTime("garbage", "also-bad")).toBeNull();
    expect(parseTradeDateTime("garbage", "2026-07-30")).not.toBeNull();
  });
});
