import { describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFilename,
  buildJournalBackup,
  gunzipUtf8,
  gzipUtf8,
  isGzipBuffer,
  mergeTrades,
  parseJournalBackup,
  readBackupText,
  serializeJournalBackup,
  u8ToArrayBuffer,
} from "@/lib/backup";
import { seedStrategy } from "@/lib/seed-data";
import type { Trade } from "@/lib/types";

function sampleTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    date: "2026-07-01",
    symbol: "EURUSD",
    side: "long",
    entry: 1.1682,
    stop: 1.1658,
    target: 1.173,
    rMultiple: 1.5,
    result: "win",
    ...overrides,
  };
}

describe("journal backup", () => {
  it("preserves hidden trades and drops hidden:false", () => {
    const hidden = sampleTrade({ id: "hid", hidden: true });
    const parsed = parseJournalBackup({
      ...buildJournalBackup([hidden], seedStrategy),
      trades: [hidden, { ...sampleTrade({ id: "vis" }), hidden: false }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.trades.find((t) => t.id === "hid")?.hidden).toBe(true);
    expect(
      Object.prototype.hasOwnProperty.call(
        parsed.backup.trades.find((t) => t.id === "vis"),
        "hidden",
      ),
    ).toBe(false);
  });

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
    expect(parsed.backup.strategy.markdown).toContain("# 1H Fair Value Gap Continuation");
    expect(parsed.backup.strategy.checklist).toEqual(seedStrategy.checklist);
  });

  it("round-trips trade checklist answers", () => {
    const trades = [
      sampleTrade({
        checklist: [
          { id: "cl-bias", label: "Daily bias", checked: true },
          { id: "cl-pd", label: "PD zone", checked: false },
        ],
      }),
    ];
    const backup = buildJournalBackup(trades, seedStrategy);
    const parsed = parseJournalBackup(serializeJournalBackup(backup));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.trades[0].checklist).toEqual(trades[0].checklist);
  });

  it("round-trips missed result", () => {
    const trades = [sampleTrade({ id: "miss", result: "missed", pnlUsd: 0 })];
    const parsed = parseJournalBackup(
      serializeJournalBackup(buildJournalBackup(trades, seedStrategy)),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.trades[0].result).toBe("missed");
  });

  it("migrates legacy structured strategy on import", () => {
    const backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: "2026-07-01T00:00:00.000Z",
      trades: [sampleTrade()],
      strategy: {
        name: "Legacy Plan",
        version: "1.0",
        summary: "Old summary",
        edge: "Trade the open",
        approach: "Checklist first",
        timeframes: [{ role: "Bias", tf: "Daily", job: "Direction" }],
        rules: [{ title: "Bias", body: "Need BOS" }],
        risk: [{ title: "Risk", body: "1R max" }],
        targets: [{ metric: "Win rate", value: "50%" }],
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    };
    const parsed = parseJournalBackup(JSON.stringify(backup));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.strategy.name).toBe("Legacy Plan");
    expect(parsed.backup.strategy.markdown).toContain("# Legacy Plan");
    expect(parsed.backup.strategy.markdown).toContain("## Edge");
    expect(parsed.backup.strategy.markdown).toContain("Need BOS");
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

  it("rejects invalid trade and strategy checklist shapes", () => {
    const backup = buildJournalBackup([sampleTrade()], seedStrategy);
    const badTrade = parseJournalBackup({
      ...backup,
      trades: [{ ...sampleTrade(), checklist: "nope" }],
    });
    expect(badTrade.ok).toBe(false);
    if (!badTrade.ok) {
      expect(badTrade.error).toMatch(/invalid checklist/i);
    }

    const badStrategy = parseJournalBackup({
      ...backup,
      strategy: {
        name: "Plan",
        markdown: "# Plan\n",
        updatedAt: "2026-01-01T00:00:00.000Z",
        checklist: "nope",
      },
    });
    expect(badStrategy.ok).toBe(false);
    if (!badStrategy.ok) {
      expect(badStrategy.error).toMatch(/checklist must be an array/i);
    }
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

  it("builds gzip backup filenames by default", () => {
    expect(backupFilename(new Date("2026-08-27T12:00:00.000Z"))).toBe(
      "tradeagent-backup-2026-08-27.json.gz",
    );
    expect(backupFilename(new Date("2026-08-27T12:00:00.000Z"), false)).toBe(
      "tradeagent-backup-2026-08-27.json",
    );
    expect(backupFilename()).toMatch(/^tradeagent-backup-.*\.json\.gz$/);
  });

  it("rejects wrong version and invalid strategy / exportedAt", () => {
    const base = buildJournalBackup([sampleTrade()], seedStrategy);
    expect(
      parseJournalBackup({ ...base, version: 999 }).ok,
    ).toBe(false);
    expect(
      parseJournalBackup({ ...base, exportedAt: 123 }).ok,
    ).toBe(false);
    expect(
      parseJournalBackup({ ...base, strategy: null }).ok,
    ).toBe(false);
    expect(
      parseJournalBackup({ ...base, strategy: { name: 1 } }).ok,
    ).toBe(false);
    expect(
      parseJournalBackup({ ...base, trades: "nope" }).ok,
    ).toBe(false);
  });

  it("rejects non-object backup root", () => {
    expect(parseJournalBackup(42).ok).toBe(false);
    if (parseJournalBackup(42).ok) return;
    expect(parseJournalBackup(42).error).toMatch(/JSON object/i);

    expect(parseJournalBackup([]).ok).toBe(false);
    if (parseJournalBackup([]).ok) return;
    expect(parseJournalBackup([]).error).toMatch(/JSON object/i);
  });

  it("rejects trade that is not an object", () => {
    const base = buildJournalBackup([sampleTrade()], seedStrategy);
    const parsed = parseJournalBackup({ ...base, trades: ["not-an-object"] });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/Trade 1 must be an object/i);
  });

  it("rejects invalid required number fields", () => {
    const cases: Array<[Partial<Trade>, RegExp]> = [
      [{ entry: NaN }, /invalid entry/i],
      [{ stop: "bad" as unknown as number }, /invalid stop/i],
      [{ target: Infinity }, /invalid target/i],
      [{ rMultiple: "bad" as unknown as number }, /invalid rMultiple/i],
      [{ exit: "bad" as unknown as number }, /invalid exit/i],
    ];
    for (const [patch, pattern] of cases) {
      const base = buildJournalBackup([sampleTrade()], seedStrategy);
      const parsed = parseJournalBackup({
        ...base,
        trades: [{ ...sampleTrade(), ...patch }],
      });
      expect(parsed.ok, JSON.stringify(patch)).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.error).toMatch(pattern);
    }
  });

  it("rejects trades missing required string fields", () => {
    const cases: Array<[Partial<Trade> & Record<string, unknown>, RegExp]> = [
      [{ id: "" }, /missing a valid id/i],
      [{ date: "" }, /missing a date/i],
      [{ symbol: "" }, /missing a symbol/i],
      [{ result: "unknown" as Trade["result"] }, /invalid result/i],
    ];
    for (const [patch, pattern] of cases) {
      const base = buildJournalBackup([sampleTrade()], seedStrategy);
      const parsed = parseJournalBackup({
        ...base,
        trades: [{ ...sampleTrade(), ...patch }],
      });
      expect(parsed.ok, JSON.stringify(patch)).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.error).toMatch(pattern);
    }
  });

  it("rejects invalid optional trade fields one-by-one", () => {
    const cases: Array<[Partial<Trade>, RegExp]> = [
      [{ entryTime: 123 as unknown as string }, /invalid entryTime/i],
      [{ exitTime: 123 as unknown as string }, /invalid exitTime/i],
      [{ slPips: "bad" as unknown as number }, /invalid slPips/i],
      [{ tpPips: "bad" as unknown as number }, /invalid tpPips/i],
      [{ timeInTradeMinutes: "bad" as unknown as number }, /invalid timeInTradeMinutes/i],
      [{ pnlUsd: "bad" as unknown as number }, /invalid pnlUsd/i],
      [{ riskUsd: "bad" as unknown as number }, /invalid riskUsd/i],
      [{ size: 123 as unknown as string }, /invalid size/i],
      [{ feesUsd: "bad" as unknown as number }, /invalid feesUsd/i],
      [{ notes: 123 as unknown as string }, /invalid notes/i],
      [{ session: 123 as unknown as string }, /invalid session/i],
      [{ tags: [1] as unknown as string[] }, /invalid tags/i],
      [{ screenshots: ["ok", 2] as unknown as string[] }, /invalid screenshots/i],
    ];
    for (const [patch, pattern] of cases) {
      const base = buildJournalBackup([sampleTrade()], seedStrategy);
      const parsed = parseJournalBackup({
        ...base,
        trades: [{ ...sampleTrade(), ...patch }],
      });
      expect(parsed.ok, JSON.stringify(patch)).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.error).toMatch(pattern);
    }
  });

  it("strips legacy chartExtract on import", () => {
    const base = buildJournalBackup([sampleTrade()], seedStrategy);
    const withLegacy = {
      ...base,
      trades: [
        {
          ...sampleTrade(),
          chartExtract: { foo: "bar" },
        },
      ],
    };
    const parsed = parseJournalBackup(JSON.stringify(withLegacy));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.backup.trades[0]).toEqual(sampleTrade());
    expect(parsed.backup.trades[0]).not.toHaveProperty("chartExtract");
  });

  it("rejects markdown strategy missing updatedAt", () => {
    const base = buildJournalBackup([sampleTrade()], seedStrategy);
    const parsed = parseJournalBackup({
      ...base,
      strategy: { markdown: "# Plan\n", name: "Plan" },
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/updatedAt/i);
  });

  it("defaults markdown strategy name when missing or blank", () => {
    const base = buildJournalBackup([sampleTrade()], seedStrategy);
    for (const strategy of [
      { markdown: "# Plan\n", updatedAt: "2026-07-01T00:00:00.000Z" },
      { markdown: "# Plan\n", name: "  ", updatedAt: "2026-07-01T00:00:00.000Z" },
    ]) {
      const parsed = parseJournalBackup({ ...base, strategy });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.backup.strategy.name).toBe("Trading strategy");
    }
  });

  it("rejects legacy strategy missing array fields", () => {
    const base = buildJournalBackup([sampleTrade()], seedStrategy);
    const legacy = {
      name: "Legacy",
      summary: "s",
      edge: "e",
      approach: "a",
      updatedAt: "2026-07-01T00:00:00.000Z",
      timeframes: [{ role: "Bias", tf: "Daily", job: "Direction" }],
      rules: [{ title: "Bias", body: "Need BOS" }],
      risk: [{ title: "Risk", body: "1R max" }],
      targets: [{ metric: "Win rate", value: "50%" }],
    };
    for (const key of ["timeframes", "rules", "risk", "targets"] as const) {
      const parsed = parseJournalBackup({
        ...base,
        strategy: { ...legacy, [key]: "not-an-array" },
      });
      expect(parsed.ok, key).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.error).toMatch(new RegExp(`Strategy\\.${key}`, "i"));
    }
  });
});

describe("journal backup gzip", () => {
  it("detects gzip magic bytes", () => {
    expect(isGzipBuffer(new Uint8Array())).toBe(false);
    expect(isGzipBuffer(new Uint8Array([0x1f]))).toBe(false);
    expect(isGzipBuffer(new Uint8Array([0x1f, 0x8b]))).toBe(true);
    expect(isGzipBuffer(new Uint8Array([0x1f, 0x8c]))).toBe(false);
  });

  it("copies bytes into a standalone ArrayBuffer for Blob", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const buffer = u8ToArrayBuffer(bytes);
    expect(buffer.byteLength).toBe(3);
    expect(new Uint8Array(buffer)).toEqual(bytes);
    expect(new Blob([buffer]).size).toBe(3);
  });

  it("round-trips JSON through gzip", async () => {
    const backup = buildJournalBackup([sampleTrade()], seedStrategy);
    const json = serializeJournalBackup(backup);
    const gz = await gzipUtf8(json);
    expect(isGzipBuffer(gz)).toBe(true);
    expect(gz.byteLength).toBeLessThan(json.length);
    expect(await gunzipUtf8(gz)).toBe(json);
    expect(parseJournalBackup(await gunzipUtf8(gz)).ok).toBe(true);
  });

  it("gzip-compresses a larger payload in chunks", async () => {
    const bulky = `${"EURUSD long notes. ".repeat(4000)}\n`;
    const gz = await gzipUtf8(bulky);
    expect(await gunzipUtf8(gz)).toBe(bulky);
    expect(gz.byteLength).toBeLessThan(bulky.length);
  });

  it("reads plain JSON bytes and gzip bytes", async () => {
    const backup = buildJournalBackup([sampleTrade()], seedStrategy);
    const json = serializeJournalBackup(backup);
    expect(await readBackupText(new TextEncoder().encode(json))).toBe(json);

    const gz = await gzipUtf8(json);
    expect(await readBackupText(gz, "backup.json")).toBe(json);
    expect(await readBackupText(gz, "backup.json.gz")).toBe(json);
  });

  it("treats .gz filenames as gzip even without relying on the caller", async () => {
    const json = serializeJournalBackup(
      buildJournalBackup([sampleTrade()], seedStrategy),
    );
    const gz = await gzipUtf8(json);
    expect(await readBackupText(gz, "TRADEAGENT.JSON.GZ")).toBe(json);
  });

  it("rejects corrupt gzip payloads", async () => {
    await expect(
      readBackupText(new Uint8Array([0x1f, 0x8b, 0x00, 0xff]), "x.json.gz"),
    ).rejects.toThrow("Could not decompress gzip backup");
  });

  it("tries gzip when the filename ends in .gz even without magic bytes", async () => {
    await expect(
      readBackupText(new TextEncoder().encode("{not gzip}"), "backup.json.gz"),
    ).rejects.toThrow("Could not decompress gzip backup");
  });

  it("throws when CompressionStream is missing", async () => {
    const original = globalThis.CompressionStream;
    try {
      // @ts-expect-error -- delete for the missing-API branch
      delete globalThis.CompressionStream;
      await expect(gzipUtf8("hi")).rejects.toThrow(
        "Gzip is not supported in this browser",
      );
    } finally {
      globalThis.CompressionStream = original;
    }
  });

  it("throws when DecompressionStream is missing", async () => {
    const original = globalThis.DecompressionStream;
    const gz = await gzipUtf8("hello");
    try {
      // @ts-expect-error -- delete for the missing-API branch
      delete globalThis.DecompressionStream;
      await expect(gunzipUtf8(gz)).rejects.toThrow(
        "Gzip is not supported in this browser",
      );
      await expect(readBackupText(gz, "backup.json.gz")).rejects.toThrow(
        "Gzip is not supported in this browser",
      );
    } finally {
      globalThis.DecompressionStream = original;
    }
  });
});
