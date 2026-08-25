import { describe, expect, it } from "vitest";
import {
  annotateTradeSchema,
  deleteTradeSchema,
  logTradeSchema,
  patchTradeSchema,
} from "@/lib/chat-schemas";
import { JournalSession } from "@/lib/journal-session";
import { seedStrategy } from "@/lib/seed-data";
import type { Trade } from "@/lib/types";

/** Fully populated trade used to catch accidental overwrites. */
function fullTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "trade-a",
    date: "2026-07-20",
    symbol: "EURUSD",
    side: "long",
    entry: 1.1682,
    stop: 1.1658,
    target: 1.173,
    exit: 1.17,
    slPips: 24,
    tpPips: 48,
    entryTime: "2026-07-20T08:15:00.000Z",
    exitTime: "2026-07-20T10:45:00.000Z",
    timeInTradeMinutes: 150,
    pnlUsd: 120,
    riskUsd: 100,
    size: "0.40 lots",
    feesUsd: 2.5,
    rMultiple: 1.2,
    result: "win",
    notes: "Keep this note forever",
    session: "London",
    tags: ["fvg", "london", "a+"],
    screenshots: ["data:image/png;base64,abc"],
    ...overrides,
  };
}

function siblingTrade(): Trade {
  return fullTrade({
    id: "trade-b",
    symbol: "GBPJPY",
    side: "short",
    entry: 195.5,
    stop: 196.0,
    target: 194.0,
    exit: undefined,
    slPips: 50,
    tpPips: 150,
    entryTime: "2026-07-21T13:00:00.000Z",
    exitTime: undefined,
    timeInTradeMinutes: undefined,
    pnlUsd: undefined,
    riskUsd: 80,
    size: "0.20 lots",
    feesUsd: 1,
    rMultiple: 0,
    result: "open",
    notes: "Sibling notes must survive",
    session: "New York",
    tags: ["ob", "ny"],
    screenshots: ["data:image/png;base64,sibling"],
  });
}

function makeSession(
  trades: Trade[],
  opts?: { userMessage?: string; turnHasScreenshots?: boolean },
) {
  return new JournalSession({
    trades: structuredClone(trades),
    strategy: seedStrategy,
    userMessage: opts?.userMessage ?? "please update my trade",
    turnHasScreenshots: opts?.turnHasScreenshots,
  });
}

function omitKeys<T extends Record<string, unknown>>(obj: T, keys: string[]) {
  const next = { ...obj };
  for (const key of keys) delete next[key];
  return next;
}

/** Assert every field except `changed` is deep-equal to before. */
function expectUnchangedExcept(
  before: Trade,
  after: Trade,
  changed: (keyof Trade)[],
) {
  expect(after.id).toBe(before.id);
  const ignore = new Set<string>(["id", ...changed]);
  for (const key of Object.keys(before) as (keyof Trade)[]) {
    if (ignore.has(key)) continue;
    expect(after[key], `field "${String(key)}" should be unchanged`).toEqual(
      before[key],
    );
  }
  // Also ensure no unexpected new keys beyond Trade shape from before+changed
  for (const key of Object.keys(after) as (keyof Trade)[]) {
    if (ignore.has(key)) continue;
    expect(
      Object.prototype.hasOwnProperty.call(before, key) || after[key] === undefined,
      `unexpected field mutation on "${String(key)}"`,
    ).toBe(true);
  }
}

const PATCHABLE_SCALAR_CASES: Array<{
  field: keyof Trade;
  value: unknown;
}> = [
  { field: "date", value: "2026-07-22" },
  { field: "side", value: "short" },
  { field: "entry", value: 1.1699 },
  { field: "stop", value: 1.1644 },
  { field: "target", value: 1.18 },
  { field: "exit", value: 1.175 },
  { field: "slPips", value: 30 },
  { field: "tpPips", value: 90 },
  { field: "entryTime", value: "2026-07-22T09:00:00.000Z" },
  { field: "exitTime", value: "2026-07-22T11:00:00.000Z" },
  { field: "timeInTradeMinutes", value: 120 },
  { field: "pnlUsd", value: 250 },
  { field: "riskUsd", value: 125 },
  { field: "size", value: "0.80 lots" },
  { field: "feesUsd", value: 4.25 },
  { field: "result", value: "loss" },
  { field: "session", value: "New York" },
];

describe("trade mutation schemas", () => {
  it("logTradeSchema accepts full create payload including notes/tags", () => {
    const parsed = logTradeSchema.parse({
      date: "2026-07-30",
      symbol: "AUDUSD",
      side: "short",
      entry: 0.65,
      stop: 0.652,
      target: 0.64,
      rMultiple: 2,
      result: "open",
      notes: "initial",
      tags: ["ny"],
      exit: 0.641,
      slPips: 20,
      tpPips: 40,
      entryTime: "2026-07-30T01:00:00.000Z",
      exitTime: "2026-07-30T02:00:00.000Z",
      timeInTradeMinutes: 60,
      pnlUsd: 50,
      riskUsd: 25,
      size: "0.5 lots",
      feesUsd: 1,
      session: "Asian",
    });
    expect(parsed.notes).toBe("initial");
    expect(parsed.tags).toEqual(["ny"]);
    expect(parsed.session).toBe("Asian");
  });

  it("logTradeSchema accepts missed result", () => {
    const parsed = logTradeSchema.parse({
      date: "2026-08-25",
      symbol: "NAS100",
      side: "long",
      entry: 20000,
      stop: 19950,
      target: 20100,
      result: "missed",
    });
    expect(parsed.result).toBe("missed");
  });

  it("patchTradeSchema strips notes/tags so they cannot be overwritten via patch", () => {
    const parsed = patchTradeSchema.parse({
      id: "trade-a",
      result: "win",
      notes: "should be ignored",
      tags: ["wipe"],
      appendNote: "also ignored",
    } as never);
    expect(parsed.result).toBe("win");
    expect("notes" in parsed).toBe(false);
    expect("tags" in parsed).toBe(false);
    expect("appendNote" in parsed).toBe(false);
  });

  it("annotateTradeSchema ignores empty replace* filler from models", () => {
    const parsed = annotateTradeSchema.parse({
      id: "trade-a",
      appendNote: "confirmed plan-compliant",
      replaceNotes: "",
      addTags: ["strategy-followed"],
      removeTags: [],
      replaceTags: [],
    });
    expect(parsed.appendNote).toBe("confirmed plan-compliant");
    expect(parsed.replaceNotes).toBeUndefined();
    expect(parsed.addTags).toEqual(["strategy-followed"]);
    expect(parsed.replaceTags).toBeUndefined();
  });

  it("appendNote + empty replaceTags does NOT clear tags (LLM filler)", () => {
    const parsed = annotateTradeSchema.parse({
      id: "trade-a",
      appendNote: "added a lesson",
      replaceNotes: "",
      replaceTags: [],
      removeTags: [],
    });
    expect(parsed.appendNote).toBe("added a lesson");
    expect(parsed.replaceNotes).toBeUndefined();
    expect(parsed.replaceTags).toBeUndefined();
  });

  it("addTags + empty replaceNotes does NOT clear notes (LLM filler)", () => {
    const parsed = annotateTradeSchema.parse({
      id: "trade-a",
      addTags: ["reviewed"],
      replaceNotes: "",
      replaceTags: [],
      removeTags: [],
    });
    expect(parsed.addTags).toEqual(["reviewed"]);
    expect(parsed.replaceNotes).toBeUndefined();
    expect(parsed.replaceTags).toBeUndefined();
  });

  it("annotateTradeSchema rejects real conflicting note/tag styles", () => {
    expect(
      annotateTradeSchema.safeParse({
        id: "t",
        appendNote: "a",
        replaceNotes: "b",
      }).success,
    ).toBe(false);
    expect(
      annotateTradeSchema.safeParse({
        id: "t",
        addTags: ["a"],
        replaceTags: ["b"],
      }).success,
    ).toBe(false);
  });

  it("deleteTradeSchema requires id or ids", () => {
    expect(deleteTradeSchema.safeParse({}).success).toBe(false);
    expect(deleteTradeSchema.parse({ id: "t1" }).id).toBe("t1");
    expect(deleteTradeSchema.parse({ ids: ["a", "b"] }).ids).toEqual(["a", "b"]);
  });
});

describe("log_trade", () => {
  it("creates a new trade with all provided fields", () => {
    const session = makeSession([]);
    const res = session.logTrade({
      date: "2026-07-30",
      symbol: "XAUUSD",
      side: "long",
      entry: 2400,
      stop: 2390,
      target: 2420,
      rMultiple: 0,
      result: "open",
      notes: "opened from screenshot",
      tags: ["gold"],
      session: "London",
      size: "0.10 lots",
      riskUsd: 100,
      slPips: 100,
      tpPips: 200,
      entryTime: "2026-07-30T08:00:00.000Z",
    });
    expect(res.ok).toBe(true);
    expect(res.action).toBe("log_trade");
    expect(res.trade.symbol).toBe("XAUUSD");
    expect(res.trade.notes).toBe("opened from screenshot");
    expect(res.trade.tags).toEqual(["gold"]);
    expect(res.trade.session).toBe("London");
    expect(res.trade.entry).toBe(2400);
    expect(session.trades).toHaveLength(1);
  });

  it("never morphs into an update even when the message looks like a follow-up", () => {
    const existing = fullTrade();
    const session = makeSession([existing], {
      userMessage: "update my EURUSD trade lost -$120 reflect the pnl",
    });
    const res = session.logTrade({
      date: "2026-07-30",
      symbol: "EURUSD",
      side: "long",
      entry: 1.1682,
      stop: 1.1658,
      target: 1.173,
      rMultiple: -1.2,
      result: "loss",
      notes: "should be a NEW row",
    });
    expect(res.ok).toBe(true);
    expect(res.trade.id).not.toBe(existing.id);
    expect(session.trades).toHaveLength(2);
    const original = session.trades.find((t) => t.id === existing.id)!;
    expect(original).toEqual(existing);
  });

  it("does not mutate sibling trades when logging", () => {
    const sibling = siblingTrade();
    const session = makeSession([sibling]);
    session.logTrade({
      date: "2026-07-30",
      symbol: "NQ",
      side: "long",
      entry: 21000,
      stop: 20950,
      target: 21100,
      rMultiple: 0,
      result: "open",
    });
    expect(session.trades.find((t) => t.id === sibling.id)).toEqual(sibling);
  });

  it("marks screenshots pending when the turn has images", () => {
    const session = makeSession([], { turnHasScreenshots: true });
    const res = session.logTrade({
      date: "2026-07-30",
      symbol: "EURUSD",
      side: "long",
      entry: 1.1,
      stop: 1.09,
      target: 1.12,
      rMultiple: 0,
      result: "open",
    });
    expect(session.trades[0].screenshots).toEqual(["pending"]);
    // pending marker is stripped from client actions
    expect(session.toActions().addTrade?.screenshots).toBeUndefined();
    expect(res.ok).toBe(true);
  });
});

describe("patch_trade — per-field updates preserve everything else", () => {
  it.each(PATCHABLE_SCALAR_CASES)(
    "updates only $field",
    ({ field, value }) => {
      const before = fullTrade();
      const sibling = siblingTrade();
      const session = makeSession([before, sibling]);
      const res = session.patchTrade({
        id: before.id,
        [field]: value,
      } as never);
      expect(res.ok).toBe(true);
      const after = session.trades.find((t) => t.id === before.id)!;
      expect(after[field]).toEqual(value);
      expectUnchangedExcept(before, after, [field]);
      // notes/tags always preserved by patch
      expect(after.notes).toBe(before.notes);
      expect(after.tags).toEqual(before.tags);
      expect(after.screenshots).toEqual(before.screenshots);
      expect(session.trades.find((t) => t.id === sibling.id)).toEqual(sibling);
    },
  );

  it("can close a trade with many outcome fields at once without touching notes/tags", () => {
    const before = fullTrade({
      result: "open",
      exit: undefined,
      exitTime: undefined,
      pnlUsd: undefined,
      rMultiple: 0,
      timeInTradeMinutes: undefined,
    });
    const session = makeSession([before]);
    const res = session.patchTrade({
      id: before.id,
      result: "win",
      exit: 1.173,
      exitTime: "2026-07-20T12:00:00.000Z",
      rMultiple: 2,
      pnlUsd: 200,
      feesUsd: 3,
      timeInTradeMinutes: 180,
    });
    expect(res.ok).toBe(true);
    const after = session.trades.find((t) => t.id === before.id)!;
    expect(after.result).toBe("win");
    expect(after.exit).toBe(1.173);
    expect(after.rMultiple).toBe(2);
    expect(after.pnlUsd).toBe(200);
    expect(after.notes).toBe("Keep this note forever");
    expect(after.tags).toEqual(["fvg", "london", "a+"]);
    expect(after.entry).toBe(before.entry);
    expect(after.screenshots).toEqual(before.screenshots);
  });

  it("fails on missing id with no silent redirect and leaves journal untouched", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const res = session.patchTrade({
      id: "missing-id",
      result: "loss",
      symbol: "EURUSD",
      entry: 1.1682,
      notes: "ignored anyway" as never,
    } as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/No trade found/);
    expect(session.trades[0]).toEqual(before);
  });

  it("refuses cross-symbol overwrite and leaves the trade untouched", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const res = session.patchTrade({
      id: before.id,
      symbol: "AUDUSD",
      entry: 0.65,
      stop: 0.64,
      notes: "nope" as never,
    } as never);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Refused/);
    expect(session.trades[0]).toEqual(before);
  });

  it("allows same-pair symbol casing without changing the stored symbol or other fields", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const res = session.patchTrade({
      id: before.id,
      symbol: "eurusd",
      session: "Asian",
    });
    expect(res.ok).toBe(true);
    const after = session.trades.find((t) => t.id === before.id)!;
    expect(after.symbol).toBe("EURUSD");
    expect(after.session).toBe("Asian");
    expect(after.notes).toBe(before.notes);
    expect(after.tags).toEqual(before.tags);
    expectUnchangedExcept(before, after, ["session"]);
  });

  it("fails when no fields are provided", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const res = session.patchTrade({ id: before.id });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/No fields to patch/);
    expect(session.trades[0]).toEqual(before);
  });

  it("cannot wipe notes/tags even if a raw patch somehow includes them at runtime", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    // Runtime bypass of schema — session API must still protect notes/tags
    const res = session.patchTrade({
      id: before.id,
      result: "breakeven",
      notes: "WIPED",
      tags: [],
    } as never);
    expect(res.ok).toBe(true);
    const after = session.trades.find((t) => t.id === before.id)!;
    expect(after.result).toBe("breakeven");
    expect(after.notes).toBe(before.notes);
    expect(after.tags).toEqual(before.tags);
  });
});

describe("annotate_trade — notes/tags only, never field overwrites", () => {
  const FIELD_KEYS: (keyof Trade)[] = [
    "date",
    "symbol",
    "side",
    "entry",
    "stop",
    "target",
    "exit",
    "slPips",
    "tpPips",
    "entryTime",
    "exitTime",
    "timeInTradeMinutes",
    "pnlUsd",
    "riskUsd",
    "size",
    "feesUsd",
    "rMultiple",
    "result",
    "session",
    "screenshots",
  ];

  function expectFieldsUntouched(before: Trade, after: Trade) {
    for (const key of FIELD_KEYS) {
      expect(after[key], `annotate must not change ${String(key)}`).toEqual(
        before[key],
      );
    }
  }

  it("appends a note without touching tags or trade fields", () => {
    const before = fullTrade();
    const sibling = siblingTrade();
    const session = makeSession([before, sibling]);
    const res = session.annotateTrade({
      id: before.id,
      appendNote: "lesson: waited for CE",
    });
    expect(res.ok).toBe(true);
    const after = session.trades.find((t) => t.id === before.id)!;
    expect(after.notes).toBe("Keep this note forever\nlesson: waited for CE");
    expect(after.tags).toEqual(before.tags);
    expectFieldsUntouched(before, after);
    expect(session.trades.find((t) => t.id === sibling.id)).toEqual(sibling);
  });

  it("replaceNotes overwrites notes wholesale without touching tags/fields", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const res = session.annotateTrade({
      id: before.id,
      replaceNotes: "fully rewritten notes",
    });
    expect(res.ok).toBe(true);
    const after = session.trades.find((t) => t.id === before.id)!;
    expect(after.notes).toBe("fully rewritten notes");
    expect(after.tags).toEqual(before.tags);
    expectFieldsUntouched(before, after);
  });

  it("replaceNotes empty string clears notes without touching tags/fields", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const input = annotateTradeSchema.parse({
      id: before.id,
      replaceNotes: "",
    });
    const res = session.annotateTrade(input);
    expect(res.ok).toBe(true);
    const after = session.trades.find((t) => t.id === before.id)!;
    expect(after.notes).toBe("");
    expect(after.tags).toEqual(before.tags);
    expectFieldsUntouched(before, after);
  });

  it("addTags merges without wiping existing tags or fields", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const res = session.annotateTrade({
      id: before.id,
      addTags: ["mss", "london"],
    });
    expect(res.ok).toBe(true);
    const after = session.trades.find((t) => t.id === before.id)!;
    expect(after.tags?.sort()).toEqual(["a+", "fvg", "london", "mss"]);
    expect(after.notes).toBe(before.notes);
    expectFieldsUntouched(before, after);
  });

  it("removeTags drops specific tags case-insensitively", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const res = session.annotateTrade({
      id: before.id,
      removeTags: ["LONDON", "a+"],
    });
    expect(res.ok).toBe(true);
    const after = session.trades.find((t) => t.id === before.id)!;
    expect(after.tags).toEqual(["fvg"]);
    expect(after.notes).toBe(before.notes);
    expectFieldsUntouched(before, after);
  });

  it("replaceTags overwrites the full list", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const res = session.annotateTrade({
      id: before.id,
      replaceTags: ["reviewed"],
    });
    expect(res.ok).toBe(true);
    const after = session.trades.find((t) => t.id === before.id)!;
    expect(after.tags).toEqual(["reviewed"]);
    expect(after.notes).toBe(before.notes);
    expectFieldsUntouched(before, after);
  });

  it("replaceTags [] clears tags and ships empty array via toActions", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const input = annotateTradeSchema.parse({
      id: before.id,
      replaceTags: [],
    });
    const res = session.annotateTrade(input);
    expect(res.ok).toBe(true);
    expect(session.trades[0].tags).toEqual([]);
    const update = session.toActions().updateTrades?.find((u) => u.id === before.id);
    expect(update?.tags).toEqual([]);
  });

  it("can append note and add tags in one call", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const res = session.annotateTrade({
      id: before.id,
      appendNote: "plan compliant",
      addTags: ["strategy-followed"],
    });
    expect(res.ok).toBe(true);
    const after = session.trades.find((t) => t.id === before.id)!;
    expect(after.notes).toBe("Keep this note forever\nplan compliant");
    expect(after.tags).toContain("strategy-followed");
    expect(after.tags).toContain("fvg");
    expectFieldsUntouched(before, after);
  });

  it("handles the exact LLM filler payload that previously failed validation", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const input = annotateTradeSchema.parse({
      id: before.id,
      appendNote:
        "User-confirmed: this GBPJPY long was the only trade that followed the strategy.",
      replaceNotes: "",
      addTags: ["strategy-followed", "plan-compliant"],
      removeTags: [],
      replaceTags: [],
    });
    const res = session.annotateTrade(input);
    expect(res.ok).toBe(true);
    const after = session.trades.find((t) => t.id === before.id)!;
    expect(after.notes).toContain("User-confirmed");
    expect(after.notes?.startsWith("Keep this note forever")).toBe(true);
    expect(after.tags?.sort()).toEqual([
      "a+",
      "fvg",
      "london",
      "plan-compliant",
      "strategy-followed",
    ]);
    expectFieldsUntouched(before, after);
  });

  it("appending a note with empty replaceTags filler keeps existing tags", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const input = annotateTradeSchema.parse({
      id: before.id,
      appendNote: "new lesson only",
      replaceNotes: "",
      addTags: [],
      removeTags: [],
      replaceTags: [],
    });
    const res = session.annotateTrade(input);
    expect(res.ok).toBe(true);
    const after = session.trades.find((t) => t.id === before.id)!;
    expect(after.notes).toBe("Keep this note forever\nnew lesson only");
    expect(after.tags).toEqual(["fvg", "london", "a+"]);
    const actions = session.toActions();
    const update = actions.updateTrades?.find((u) => u.id === before.id);
    expect(update?.notes).toBe(after.notes);
    // notes-only update must NOT ship tags (avoids client wipe)
    expect(Object.prototype.hasOwnProperty.call(update ?? {}, "tags")).toBe(
      false,
    );
  });

  it("adding tags with empty replaceNotes filler keeps existing notes", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const input = annotateTradeSchema.parse({
      id: before.id,
      appendNote: "",
      replaceNotes: "",
      addTags: ["reviewed"],
      removeTags: [],
      replaceTags: [],
    });
    const res = session.annotateTrade(input);
    expect(res.ok).toBe(true);
    const after = session.trades.find((t) => t.id === before.id)!;
    expect(after.notes).toBe("Keep this note forever");
    expect(after.tags?.sort()).toEqual(["a+", "fvg", "london", "reviewed"]);
    const update = session
      .toActions()
      .updateTrades?.find((u) => u.id === before.id);
    expect(update?.tags?.sort()).toEqual(["a+", "fvg", "london", "reviewed"]);
    expect(Object.prototype.hasOwnProperty.call(update ?? {}, "notes")).toBe(
      false,
    );
  });

  it("fails on missing id and leaves journal untouched", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const res = session.annotateTrade({
      id: "missing",
      appendNote: "x",
    });
    expect(res.ok).toBe(false);
    expect(session.trades[0]).toEqual(before);
  });
});

describe("delete_trade", () => {
  it("deletes one trade by id without touching siblings", () => {
    const a = fullTrade();
    const b = siblingTrade();
    const session = makeSession([a, b]);
    const res = session.deleteTrade({ id: a.id });
    expect(res.ok).toBe(true);
    expect(res.deletedIds).toEqual([a.id]);
    expect(session.trades).toEqual([b]);
  });

  it("deletes multiple ids", () => {
    const a = fullTrade({ id: "a" });
    const b = siblingTrade();
    const c = fullTrade({ id: "c", symbol: "NQ" });
    const session = makeSession([a, b, c]);
    const res = session.deleteTrade({ ids: ["a", "c"] });
    expect(res.ok).toBe(true);
    expect(res.deletedIds?.sort()).toEqual(["a", "c"]);
    expect(session.trades).toEqual([b]);
  });

  it("fails when none exist", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const res = session.deleteTrade({ id: "nope" });
    expect(res.ok).toBe(false);
    expect(session.trades[0]).toEqual(before);
  });
});

describe("combined workflows and overwrite safety", () => {
  it("log → patch → annotate preserves data at each step", () => {
    const session = makeSession([]);
    const logged = session.logTrade({
      date: "2026-07-30",
      symbol: "GBPJPY",
      side: "long",
      entry: 195,
      stop: 194.5,
      target: 196,
      rMultiple: 0,
      result: "open",
      notes: "opened",
      tags: ["yen"],
      session: "London",
      riskUsd: 100,
    });
    expect(logged.ok).toBe(true);
    const id = logged.trade.id;

    const patched = session.patchTrade({
      id,
      result: "win",
      exit: 196,
      rMultiple: 2,
      pnlUsd: 200,
    });
    expect(patched.ok).toBe(true);
    expect(patched.trade.notes).toBe("opened");
    expect(patched.trade.tags).toEqual(["yen"]);
    expect(patched.trade.session).toBe("London");
    expect(patched.trade.riskUsd).toBe(100);

    const annotated = session.annotateTrade({
      id,
      appendNote: "followed plan",
      addTags: ["strategy-followed"],
    });
    expect(annotated.ok).toBe(true);
    expect(annotated.trade.notes).toBe("opened\nfollowed plan");
    expect(annotated.trade.tags?.sort()).toEqual(["strategy-followed", "yen"]);
    expect(annotated.trade.result).toBe("win");
    expect(annotated.trade.exit).toBe(196);
    expect(annotated.trade.entry).toBe(195);
    expect(annotated.trade.session).toBe("London");
  });

  it("patching trade A never mutates trade B fields", () => {
    const a = fullTrade();
    const b = siblingTrade();
    const bClone = structuredClone(b);
    const session = makeSession([a, b]);
    for (const { field, value } of PATCHABLE_SCALAR_CASES) {
      session.patchTrade({ id: a.id, [field]: value } as never);
      expect(session.trades.find((t) => t.id === b.id)).toEqual(bClone);
    }
    session.annotateTrade({
      id: a.id,
      replaceNotes: "changed A",
      replaceTags: ["only-a"],
    });
    expect(session.trades.find((t) => t.id === b.id)).toEqual(bClone);
  });

  it("toActions coalesce preserves live notes/tags after annotate then patch", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    session.annotateTrade({
      id: before.id,
      appendNote: "extra",
      addTags: ["new-tag"],
    });
    session.patchTrade({
      id: before.id,
      result: "loss",
      rMultiple: -1,
    });
    const actions = session.toActions();
    const update = actions.updateTrades?.find((u) => u.id === before.id);
    expect(update?.result).toBe("loss");
    expect(update?.notes).toBe("Keep this note forever\nextra");
    expect(update?.tags?.sort()).toEqual(["a+", "fvg", "london", "new-tag"]);
  });

  it("omit helper sanity — protected snapshot stays stable across random patches", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    session.patchTrade({ id: before.id, pnlUsd: 999 });
    session.patchTrade({ id: before.id, size: "2 lots" });
    session.patchTrade({ id: before.id, session: "Asian" });
    const after = session.trades[0];
    expect(omitKeys(after as never, ["pnlUsd", "size", "session"])).toEqual(
      omitKeys(before as never, ["pnlUsd", "size", "session"]),
    );
  });
});

describe("LLM misuse / accidental wipe defenses", () => {
  it("normalizes UTC+1 prose entry/exit times to offset ISO on patch", () => {
    const before = fullTrade({
      entryTime: "2026-07-30",
      exitTime: undefined,
      timeInTradeMinutes: undefined,
    });
    const session = makeSession([before]);
    const res = session.patchTrade({
      id: before.id,
      entryTime: "2026-07-30 15:52:45 UTC+1",
      exitTime: "2026-07-30 16:44:26 UTC+1",
      timeInTradeMinutes: 51,
    });
    expect(res.ok).toBe(true);
    const after = session.trades[0];
    expect(after.entryTime).toBe("2026-07-30T15:52:45+01:00");
    expect(after.exitTime).toBe("2026-07-30T16:44:26+01:00");
    expect(after.timeInTradeMinutes).toBe(51);
  });

  it("preserves naive CSV clocks on patch without adding an hour via Z", () => {
    const before = fullTrade({
      entryTime: "2026-07-30T15:46:09.000Z",
      exitTime: "2026-07-30T16:40:00.000Z",
    });
    const session = makeSession([before]);
    const res = session.patchTrade({
      id: before.id,
      entryTime: "2026-07-30T15:46:09",
      exitTime: "2026-07-30T16:40:00",
    });
    expect(res.ok).toBe(true);
    expect(session.trades[0].entryTime).toBe("2026-07-30T15:46:09");
    expect(session.trades[0].exitTime).toBe("2026-07-30T16:40:00");
  });

  it("empty-string filler on patch does not wipe session/size", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const res = session.patchTrade({
      id: before.id,
      result: "loss",
      session: "",
      size: "",
      entryTime: "",
      exitTime: "",
    } as never);
    expect(res.ok).toBe(true);
    const after = session.trades[0];
    expect(after.result).toBe("loss");
    expect(after.session).toBe("London");
    expect(after.size).toBe(before.size);
    expect(after.entryTime).toBe(before.entryTime);
    expect(after.exitTime).toBe(before.exitTime);
    expect(after.notes).toBe(before.notes);
    expect(after.tags).toEqual(before.tags);
  });

  it("patch with only empty-string fillers fails instead of wiping", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const res = session.patchTrade({
      id: before.id,
      session: "",
      size: "",
    } as never);
    expect(res.ok).toBe(false);
    expect(session.trades[0]).toEqual(before);
  });

  it("runtime notes/tags/screenshots keys on patch are ignored and stripped from actions", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const res = session.patchTrade({
      id: before.id,
      pnlUsd: 1,
      notes: "WIPED",
      tags: [],
      screenshots: ["data:image/png;base64,evil"],
    } as never);
    expect(res.ok).toBe(true);
    const after = session.trades[0];
    expect(after.pnlUsd).toBe(1);
    expect(after.notes).toBe(before.notes);
    expect(after.tags).toEqual(before.tags);
    expect(after.screenshots).toEqual(before.screenshots);
    const update = session.toActions().updateTrades?.[0];
    expect(update).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(update!, "notes")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(update!, "tags")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(update!, "screenshots")).toBe(
      false,
    );
  });

  it("wrong-id patch cannot retarget via symbol/entry hints", () => {
    const a = fullTrade();
    const b = siblingTrade();
    const session = makeSession([a, b]);
    const res = session.patchTrade({
      id: "totally-wrong",
      symbol: a.symbol,
      entry: a.entry,
      stop: a.stop,
      result: "loss",
    });
    expect(res.ok).toBe(false);
    expect(session.trades.find((t) => t.id === a.id)).toEqual(a);
    expect(session.trades.find((t) => t.id === b.id)).toEqual(b);
  });

  it("cross-symbol patch cannot rewrite levels onto the wrong pair", () => {
    const a = fullTrade();
    const session = makeSession([a, siblingTrade()]);
    const res = session.patchTrade({
      id: a.id,
      symbol: "GBPJPY",
      entry: 195.5,
      stop: 196,
      target: 194,
    });
    expect(res.ok).toBe(false);
    expect(session.trades.find((t) => t.id === a.id)).toEqual(a);
  });

  it("annotate replaceNotes does not clear tags; replaceTags does not clear notes", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    session.annotateTrade({ id: before.id, replaceNotes: "only notes changed" });
    expect(session.trades[0].tags).toEqual(before.tags);
    session.annotateTrade({ id: before.id, replaceTags: ["only-tags"] });
    expect(session.trades[0].notes).toBe("only notes changed");
    expect(session.trades[0].tags).toEqual(["only-tags"]);
  });

  it("full LLM kitchen-sink annotate filler preserves the non-targeted side", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    // Model fills every field; only appendNote is real
    const noteOnly = annotateTradeSchema.parse({
      id: before.id,
      appendNote: "keep my tags please",
      replaceNotes: "",
      addTags: [],
      removeTags: [],
      replaceTags: [],
    });
    session.annotateTrade(noteOnly);
    expect(session.trades[0].notes).toContain("keep my tags please");
    expect(session.trades[0].tags).toEqual(before.tags);

    const tagOnly = annotateTradeSchema.parse({
      id: before.id,
      appendNote: "",
      replaceNotes: "",
      addTags: ["safe"],
      removeTags: [],
      replaceTags: [],
    });
    session.annotateTrade(tagOnly);
    expect(session.trades[0].notes).toContain("keep my tags please");
    expect(session.trades[0].tags).toContain("safe");
    expect(session.trades[0].tags).toContain("fvg");
  });

  it("log_trade cannot overwrite an existing id even if caller tries", () => {
    const existing = fullTrade({ id: "fixed-id" });
    const session = makeSession([existing]);
    const res = session.logTrade({
      date: "2026-07-30",
      symbol: "EURUSD",
      side: "long",
      entry: 1.1,
      stop: 1.09,
      target: 1.12,
      rMultiple: 0,
      result: "open",
      notes: "new",
    });
    expect(res.ok).toBe(true);
    expect(res.trade.id).not.toBe("fixed-id");
    expect(session.trades.find((t) => t.id === "fixed-id")).toEqual(existing);
  });

  it("delete of missing ids does not remove other trades", () => {
    const a = fullTrade();
    const b = siblingTrade();
    const session = makeSession([a, b]);
    const res = session.deleteTrade({ ids: ["missing-1", "missing-2"] });
    expect(res.ok).toBe(false);
    expect(session.trades).toHaveLength(2);
  });

  it("patch then annotate in one turn does not drop notes/tags in toActions", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    session.patchTrade({ id: before.id, result: "breakeven", rMultiple: 0 });
    session.annotateTrade({
      id: before.id,
      appendNote: "be exit",
      addTags: ["be"],
    });
    const update = session.toActions().updateTrades?.find((u) => u.id === before.id);
    expect(update?.result).toBe("breakeven");
    expect(update?.notes).toBe("Keep this note forever\nbe exit");
    expect(update?.tags?.sort()).toEqual(["a+", "be", "fvg", "london"]);
    // live row intact
    expect(session.trades[0].screenshots).toEqual(before.screenshots);
    expect(session.trades[0].entry).toBe(before.entry);
  });
});

describe("strategy checklist on trades", () => {
  it("logTradeSchema accepts checklist answers", () => {
    const parsed = logTradeSchema.parse({
      date: "2026-07-30",
      symbol: "EURUSD",
      side: "long",
      entry: 1.1,
      stop: 1.09,
      target: 1.12,
      rMultiple: 0,
      result: "open",
      checklist: [
        { id: "cl-bias", checked: true },
        { id: "cl-pd", checked: false },
      ],
    });
    expect(parsed.checklist).toEqual([
      { id: "cl-bias", checked: true },
      { id: "cl-pd", checked: false },
    ]);
  });

  it("log_trade snapshots checklist labels from strategy", () => {
    const session = makeSession([]);
    const res = session.logTrade({
      date: "2026-07-30",
      symbol: "EURUSD",
      side: "long",
      entry: 1.1,
      stop: 1.09,
      target: 1.12,
      rMultiple: 0,
      result: "open",
      checklist: [
        { id: "cl-bias", checked: true },
        { id: "cl-entry", checked: false },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.trade.checklist).toEqual([
      {
        id: "cl-bias",
        label: "Daily bias locked (HH/HL or LH/LL + BOS)",
        checked: true,
      },
      {
        id: "cl-entry",
        label: "Entry at CE of fresh/first-touch 1H FVG",
        checked: false,
      },
    ]);
  });

  it("log_trade rejects unknown checklist ids", () => {
    const session = makeSession([]);
    const res = session.logTrade({
      date: "2026-07-30",
      symbol: "EURUSD",
      side: "long",
      entry: 1.1,
      stop: 1.09,
      target: 1.12,
      rMultiple: 0,
      result: "open",
      checklist: [{ id: "nope", checked: true }],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/Unknown checklist/);
    expect(session.trades).toHaveLength(0);
  });

  it("log_trade omits checklist when all answer ids are blank", () => {
    const session = makeSession([]);
    const res = session.logTrade({
      date: "2026-07-30",
      symbol: "EURUSD",
      side: "long",
      entry: 1.1,
      stop: 1.09,
      target: 1.12,
      rMultiple: 0,
      result: "open",
      checklist: [{ id: "   ", checked: true }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.trade.checklist).toBeUndefined();
  });

  it("get_strategy and update_strategy handle missing checklist", () => {
    const session = makeSession([]);
    session.strategy = { ...session.strategy, checklist: undefined };
    expect(session.getStrategy().strategy.checklist).toEqual([]);
    const res = session.updateStrategy({ name: "Renamed Only" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.strategy.checklistCount).toBe(0);
  });

  it("patch_trade merges checklist answers by id", () => {
    const before = fullTrade({
      checklist: [
        {
          id: "cl-bias",
          label: "Daily bias locked (HH/HL or LH/LL + BOS)",
          checked: true,
        },
      ],
    });
    const session = makeSession([before]);
    const res = session.patchTrade({
      id: before.id,
      checklist: [
        { id: "cl-bias", checked: false },
        { id: "cl-pd", checked: true },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.trade.checklist).toEqual([
      {
        id: "cl-bias",
        label: "Daily bias locked (HH/HL or LH/LL + BOS)",
        checked: false,
      },
      {
        id: "cl-pd",
        label: "Correct premium/discount zone for side",
        checked: true,
      },
    ]);
  });

  it("patch_trade rejects unknown checklist ids", () => {
    const before = fullTrade();
    const session = makeSession([before]);
    const res = session.patchTrade({
      id: before.id,
      checklist: [{ id: "missing", checked: true }],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/Unknown checklist/);
  });

  it("update_strategy can replace checklist", () => {
    const session = makeSession([]);
    const res = session.updateStrategy({
      checklist: [{ id: "x", label: "Only this" }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.applied).toContain("checklist");
    expect(session.strategy.checklist).toEqual([{ id: "x", label: "Only this" }]);
    expect(session.getStrategy().strategy.checklist).toEqual([
      { id: "x", label: "Only this" },
    ]);
  });
});
