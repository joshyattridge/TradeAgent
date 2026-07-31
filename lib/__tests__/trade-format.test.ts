import { describe, expect, it } from "vitest";
import {
  coerceDateTimeString,
  formatTradeDateTime,
  normalizeTradeDateTime,
  parseTradeDateTime,
} from "@/lib/trade-format";

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

  it("normalizes to ISO for storage", () => {
    const iso = normalizeTradeDateTime("2026-07-30 15:52:45 UTC+1");
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // 15:52 +01:00 → 14:52 UTC
    expect(iso).toBe("2026-07-30T14:52:45.000Z");
  });

  it("formats date-only without inventing a clock time label pattern still ok", () => {
    expect(formatTradeDateTime("2026-07-30")).toBe("Jul 30, 2026");
  });

  it("keeps time-only with fallback date", () => {
    const d = parseTradeDateTime("15:52:45", "2026-07-30");
    expect(d).not.toBeNull();
    expect(formatTradeDateTime("15:52:45", "2026-07-30", "HH:mm")).toBe("15:52");
  });
});
