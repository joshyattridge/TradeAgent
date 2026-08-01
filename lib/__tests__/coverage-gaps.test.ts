/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fileToChatAttachment, parseDataUrl } from "@/lib/chat-attachments";
import { expandHistoryToModelMessages } from "@/lib/chat-history";
import { JournalSession, filterTrades } from "@/lib/journal-session";
import { seedStrategy } from "@/lib/seed-data";
import {
  applyShortStrategyMarkdown,
  legacyStrategyToMarkdown,
} from "@/lib/strategy-md";
import {
  coerceDateTimeString,
  getSlPips,
  getTimeInTradeMinutes,
  getTpPips,
  normalizeTradeDateTime,
  parseTradeDateTime,
} from "@/lib/trade-format";
import type { Trade } from "@/lib/types";

function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    date: "2026-07-20",
    symbol: "EURUSD",
    side: "long",
    setup: "FVG",
    entry: 1.1,
    stop: 1.09,
    target: 1.12,
    rMultiple: 1,
    result: "win",
    ...overrides,
  };
}

describe("coverage gap fills", () => {
  it("chat-attachments: pdf ext mime, empty name text, parseDataUrl defaults", async () => {
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "doc.pdf", {
      type: "application/octet-stream",
    });
    await expect(fileToChatAttachment(pdf)).resolves.toMatchObject({
      kind: "file",
      mime: "application/pdf",
    });

    const unnamed = new File([new Uint8Array([0x61])], "", {
      type: "application/octet-stream",
    });
    const textAtt = await fileToChatAttachment(unnamed);
    expect(textAtt.kind).toBe("text");
    if (textAtt.kind === "text") {
      expect(textAtt.name).toBe("attachment.txt");
    }

    expect(parseDataUrl("data:;base64,YQ==")).toEqual({
      mime: "application/octet-stream",
      base64: "YQ==",
    });
  });

  it("chat-history: expands plain text user messages", () => {
    const out = expandHistoryToModelMessages([
      { role: "user", content: "hello only" },
    ]);
    expect(out).toEqual([{ role: "user", content: "hello only" }]);
  });

  it("strategy-md: section replace when result already ends with newline", () => {
    const current = "# Plan\n\n## Edge\n\nOld\n\n## Rules\n\nBody\n";
    const replaced = applyShortStrategyMarkdown(current, "## Edge\n\nNew edge\n");
    expect(replaced.markdown.endsWith("\n")).toBe(true);
  });

  it("trade-format: null start/end and missing sl/tp inputs", () => {
    expect(
      getTimeInTradeMinutes(
        trade({
          timeInTradeMinutes: undefined,
          date: "not-a-date",
          entryTime: "nope",
          exitTime: "also-nope",
        }),
      ),
    ).toBeUndefined();
    expect(
      getSlPips(
        trade({
          slPips: undefined,
          entry: undefined as unknown as number,
          stop: undefined as unknown as number,
        }),
      ),
    ).toBeUndefined();
    expect(
      getTpPips(
        trade({
          tpPips: undefined,
          entry: undefined as unknown as number,
          target: undefined as unknown as number,
        }),
      ),
    ).toBeUndefined();
    expect(parseTradeDateTime("", "2026-07-30")).not.toBeNull();
  });

  it("journal: symbol mismatch, removeTags on empty, append blank notes, filters, charts", () => {
    const session = new JournalSession({
      trades: [
        trade({
          id: "a",
          symbol: "EURUSD",
          tags: undefined,
          notes: undefined,
          session: undefined,
        }),
        trade({
          id: "b",
          symbol: "EURUSD",
          date: "2026-07-20",
          entry: 1.1,
          rMultiple: 1,
          tags: undefined,
          notes: undefined,
        }),
        trade({ id: "c", symbol: "GBPJPY", tags: ["x"] }),
      ],
      strategy: seedStrategy,
      userMessage: "find eurusd",
    });

    const mismatch = session.findTrade({ symbol: "XAUUSD", entry: 1.1 });
    expect(mismatch).toBeTruthy();

    expect(
      session.annotateTrade({ id: "a", removeTags: ["missing"] }),
    ).toMatchObject({ ok: true });

    session.annotateTrade({ id: "a", replaceNotes: "   " });
    expect(
      session.annotateTrade({ id: "a", appendNote: "First real note" }),
    ).toMatchObject({ ok: true });

    expect(filterTrades(session.trades, { tags: ["nope"] })).toEqual([]);
    expect(
      filterTrades([trade({ tags: undefined, notes: undefined })], {
        text: "missing",
      }),
    ).toEqual([]);

    expect(session.findTrade({ symbol: "EURUSD" })).toBeTruthy();
    expect(session.generateCharts([{ type: "bar", data: [] }]).ok).toBe(true);

    session.patchTrade({ id: "a", session: "London" });
    expect(session.toActions().updateTrades?.some((u) => u.id === "a")).toBe(
      true,
    );
  });

  it("rejects FileReader failures including null reader.error", async () => {
    const Original = FileReader;
    class BoomReader {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = null;
      onload: ((ev: ProgressEvent<FileReader>) => void) | null = null;
      onerror: ((ev: ProgressEvent<FileReader>) => void) | null = null;
      readAsDataURL() {
        queueMicrotask(() => this.onerror?.({} as ProgressEvent<FileReader>));
      }
    }
    vi.stubGlobal("FileReader", BoomReader as unknown as typeof FileReader);
    const pdf = new File([new Uint8Array([1])], "x.pdf", {
      type: "application/pdf",
    });
    await expect(fileToChatAttachment(pdf)).rejects.toThrow(/Could not read file/);
    vi.stubGlobal("FileReader", Original);
  });

  it("normalizes time-only with and without seconds", () => {
    expect(normalizeTradeDateTime("15:30", "2026-07-30")).toBe(
      "2026-07-30T15:30:00",
    );
    expect(normalizeTradeDateTime("15:30:45", "2026-07-30")).toBe(
      "2026-07-30T15:30:45",
    );
    expect(normalizeTradeDateTime("9:05")).toBe("09:05:00");
  });

  it("journal findTrade text match without tags", () => {
    const session = new JournalSession({
      trades: [trade({ id: "z", notes: "unique-needle", tags: undefined })],
      strategy: seedStrategy,
      userMessage: "x",
    });
    const res = session.findTrade({ text: "unique-needle" });
    expect(res.bestMatchId || (res.candidates?.length ?? 0) > 0).toBeTruthy();
  });

  it("journal: equal-score date tie-break and tags coalesce both sides", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      trade({
        id: `eq-${i}`,
        symbol: "EURUSD",
        date: `2026-07-${String(10 + i).padStart(2, "0")}`,
        entryTime: `2026-07-${String(10 + i).padStart(2, "0")}T12:00:00.000Z`,
        notes: i === 9 ? "haystack-needle" : undefined,
        tags: i === 9 ? ["tagged"] : undefined,
      }),
    );
    const session = new JournalSession({
      trades: many,
      strategy: seedStrategy,
      userMessage: "x",
    });
    expect(session.findTrade({ symbol: "EURUSD", limit: 10 }).ok).toBe(true);
    expect(session.findTrade({ text: "haystack-needle" }).ok).toBe(true);

    session.annotateTrade({ id: "eq-0", replaceTags: ["live"] });
    expect(session.toActions().updateTrades?.[0]).toMatchObject({
      tags: ["live"],
    });

    session.annotateTrade({ id: "eq-1", addTags: ["a", "b"] });
    session.annotateTrade({ id: "eq-1", removeTags: ["a", "b"] });
    const cleared = session.toActions().updateTrades?.find((u) => u.id === "eq-1");
    expect(cleared?.tags).toEqual([]);
  });

  it("hits remaining branch edges for coerce, legacy md, and log without times", () => {
    expect(coerceDateTimeString("2026-07-30 15:52:45+0100")).toBe(
      "2026-07-30T15:52:45+01:00",
    );
    expect(coerceDateTimeString("2026-07-30 15:52:45+01:00")).toBe(
      "2026-07-30T15:52:45+01:00",
    );

    expect(
      legacyStrategyToMarkdown({
        name: "X",
        summary: "",
        edge: "",
        approach: "",
      }),
    ).toContain("# X");

    // entry/exit clock mismatch in findTrade scoring (a && b but a !== b)
    const timed = new JournalSession({
      trades: [
        trade({
          id: "timed",
          symbol: "EURUSD",
          entryTime: "2026-07-30T12:00:00.000Z",
          exitTime: "2026-07-30T13:00:00.000Z",
        }),
      ],
      strategy: seedStrategy,
      userMessage: "x",
    });
    expect(
      timed.findTrade({
        symbol: "EURUSD",
        entryTime: "2026-07-30T09:00:00.000Z",
        exitTime: "2026-07-30T09:00:00.000Z",
      }).ok,
    ).toBe(true);

    const session = new JournalSession({
      trades: [],
      strategy: seedStrategy,
      userMessage: "log",
    });
    const logged = session.logTrade({
      date: "2026-07-30",
      symbol: "EURUSD",
      side: "long",
      setup: "FVG",
      entry: 1.1,
      stop: 1.09,
      target: 1.12,
      rMultiple: 0,
      result: "open",
    });
    expect(logged.ok).toBe(true);
  });
});
