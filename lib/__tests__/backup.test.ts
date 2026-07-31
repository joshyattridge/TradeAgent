import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  buildJournalBackup,
  mergeTrades,
  parseJournalBackup,
  serializeJournalBackup,
} from "@/lib/backup";
import { seedStrategy } from "@/lib/seed-data";
import type { Trade } from "@/lib/types";

function sampleTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    date: "2026-07-01",
    symbol: "EURUSD",
    side: "long",
    setup: "1H FVG Continuation",
    entry: 1.1682,
    stop: 1.1658,
    target: 1.173,
    rMultiple: 1.5,
    result: "win",
    ...overrides,
  };
}

describe("journal backup", () => {
  it("round-trips trades and strategy", () => {
    const trades = [sampleTrade(), sampleTrade({ id: "t2", symbol: "GBPJPY" })];
    const backup = buildJournalBackup(trades, seedStrategy);
    const json = serializeJournalBackup(backup);
    const parsed = parseJournalBackup(json);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.format).toBe(BACKUP_FORMAT);
    expect(parsed.backup.version).toBe(BACKUP_VERSION);
    expect(parsed.backup.trades).toEqual(trades);
    expect(parsed.backup.strategy.name).toBe(seedStrategy.name);
  });

  it("rejects invalid JSON and wrong format", () => {
    expect(parseJournalBackup("{").ok).toBe(false);
    expect(
      parseJournalBackup({
        format: "other",
        version: 1,
        exportedAt: "2026-07-01T00:00:00.000Z",
        trades: [],
        strategy: seedStrategy,
      }).ok,
    ).toBe(false);
  });

  it("rejects trades missing required fields", () => {
    const backup = buildJournalBackup([sampleTrade()], seedStrategy);
    const bad = {
      ...backup,
      trades: [{ ...sampleTrade(), side: "sideways" }],
    };
    const parsed = parseJournalBackup(JSON.stringify(bad));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/side/i);
  });

  it("merges by id with incoming winning", () => {
    const current = [
      sampleTrade({ id: "a", notes: "keep-me" }),
      sampleTrade({ id: "b", symbol: "XAUUSD" }),
    ];
    const incoming = [
      sampleTrade({ id: "a", notes: "updated", rMultiple: 2 }),
      sampleTrade({ id: "c", symbol: "NAS100" }),
    ];
    const merged = mergeTrades(current, incoming);
    expect(merged.map((t) => t.id)).toEqual(["a", "c", "b"]);
    expect(merged[0].notes).toBe("updated");
    expect(merged[0].rMultiple).toBe(2);
    expect(merged[2].symbol).toBe("XAUUSD");
  });
});
