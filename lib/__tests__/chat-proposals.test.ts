import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildChatProposal,
  chartOnlyActions,
  ensureScreenshotAttachTarget,
  formatTradeFieldValue,
  gatedActionsSlice,
  hasGatedJournalWrites,
  lineDiff,
  mergeStrategyPatch,
  mergeTradePatch,
  changedTradeKeys,
  MAX_SCREENSHOTS_PER_TRADE,
  planChatDone,
  resolvePendingProposalUpdate,
} from "@/lib/chat-proposals";
import { seedStrategy } from "@/lib/seed-data";
import { applyChatActions, useTradingStore } from "@/lib/store";
import type { ChartSpec, Trade } from "@/lib/types";

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
    notes: "Clean",
    tags: ["A+"],
    ...overrides,
  };
}

const emptyChart: ChartSpec = {
  id: "c1",
  title: "Equity",
  type: "equity",
  data: [{ label: "Jul 1", value: 1 }],
};

describe("formatTradeFieldValue", () => {
  it("formats null, empty, tags, screenshots, times, money, and numbers", () => {
    const base = sampleTrade();
    expect(formatTradeFieldValue(base, "notes")).toBe("Clean");
    expect(formatTradeFieldValue({ ...base, notes: undefined }, "notes")).toBe("—");
    expect(formatTradeFieldValue({ ...base, notes: "" }, "notes")).toBe("—");

    expect(formatTradeFieldValue({ ...base, tags: [] }, "tags")).toBe("—");
    expect(formatTradeFieldValue({ ...base, tags: ["A+", "London"] }, "tags")).toBe(
      "A+, London",
    );

    expect(
      formatTradeFieldValue({ ...base, screenshots: undefined }, "screenshots"),
    ).toBe("—");
    expect(formatTradeFieldValue({ ...base, screenshots: [] }, "screenshots")).toBe(
      "—",
    );
    expect(
      formatTradeFieldValue({ ...base, screenshots: ["data:image/jpeg;base64,a"] }, "screenshots"),
    ).toBe("1 image");
    expect(
      formatTradeFieldValue(
        { ...base, screenshots: ["data:image/jpeg;base64,a", "data:image/jpeg;base64,b"] },
        "screenshots",
      ),
    ).toBe("2 images");

    expect(
      formatTradeFieldValue(
        {
          ...base,
          checklist: [
            { id: "a", label: "Bias", checked: true },
            { id: "b", label: "PD", checked: false },
          ],
        },
        "checklist",
      ),
    ).toBe("Bias: Done; PD: Not done");
    expect(formatTradeFieldValue({ ...base, checklist: [] }, "checklist")).toBe(
      "—",
    );
    expect(
      formatTradeFieldValue(
        { ...base, checklist: ["legacy"] as never },
        "checklist",
      ),
    ).toBe("legacy");

    expect(
      formatTradeFieldValue(
        { ...base, entryTime: "2026-07-30T15:46:09" },
        "entryTime",
      ),
    ).toMatch(/Jul 30, 2026 15:46:09/);
    expect(
      formatTradeFieldValue(
        { ...base, exitTime: "2026-07-30T16:10:00" },
        "exitTime",
      ),
    ).toMatch(/Jul 30, 2026 16:10:00/);

    expect(formatTradeFieldValue({ ...base, rMultiple: 1.5 }, "rMultiple")).toBe("+1.50R");
    expect(formatTradeFieldValue({ ...base, rMultiple: -0.75 }, "rMultiple")).toBe("-0.75R");

    expect(formatTradeFieldValue({ ...base, pnlUsd: 210.5 }, "pnlUsd")).toBe("+$210.50");
    expect(formatTradeFieldValue({ ...base, pnlUsd: -50 }, "pnlUsd")).toBe("$-50.00");
    expect(formatTradeFieldValue({ ...base, riskUsd: 100 }, "riskUsd")).toBe("$100.00");
    expect(formatTradeFieldValue({ ...base, feesUsd: 2.25 }, "feesUsd")).toBe("$2.25");

    expect(formatTradeFieldValue({ ...base, slPips: 29.3 }, "slPips")).toBe("29.3");
    expect(formatTradeFieldValue({ ...base, side: "long" }, "side")).toBe("long");
  });
});

describe("chat proposals", () => {
  it("detects gated journal writes vs charts-only", () => {
    expect(hasGatedJournalWrites(null)).toBe(false);
    expect(hasGatedJournalWrites(undefined)).toBe(false);
    expect(hasGatedJournalWrites({})).toBe(false);
    expect(hasGatedJournalWrites({ charts: [emptyChart] })).toBe(false);
    expect(hasGatedJournalWrites({ addTrade: sampleTrade() })).toBe(true);
    expect(hasGatedJournalWrites({ addTrades: [sampleTrade()] })).toBe(true);
    expect(hasGatedJournalWrites({ updateTrade: { id: "t1", rMultiple: 2 } })).toBe(
      true,
    );
    expect(hasGatedJournalWrites({ updateTrades: [{ id: "t1", notes: "x" }] })).toBe(
      true,
    );
    expect(hasGatedJournalWrites({ deleteTradeIds: ["t1"] })).toBe(true);
    expect(
      hasGatedJournalWrites({ updateStrategy: { markdown: "# x" } }),
    ).toBe(true);
    expect(hasGatedJournalWrites({ updateStrategy: {} })).toBe(false);
  });

  it("splits chart-only vs gated slices", () => {
    const actions = {
      addTrade: sampleTrade({ id: "new-1" }),
      addTrades: [sampleTrade({ id: "new-2" })],
      charts: [emptyChart],
      updateStrategy: { markdown: "# Hi\n" },
    };
    expect(chartOnlyActions(actions)).toEqual({ charts: [emptyChart] });
    const gated = gatedActionsSlice(actions, ["data:image/jpeg;base64,xx"]);
    expect(gated.charts).toBeUndefined();
    expect(gated.addTrades).toHaveLength(1);
    expect(gated.addTrade).toBeUndefined();
    expect(gated.updateStrategy?.markdown).toContain("# Hi");
    expect(gated.screenshots).toEqual(["data:image/jpeg;base64,xx"]);
  });

  it("planChatDone keeps charts immediate and journals pending", () => {
    const planned = planChatDone({
      actions: {
        addTrade: sampleTrade({ id: "new-1" }),
        charts: [emptyChart],
      },
      trades: [],
      strategy: seedStrategy,
    });
    expect(planned.chartActions.charts).toHaveLength(1);
    expect(planned.proposal).not.toBeNull();
    expect(planned.proposal?.changes[0].kind).toBe("add");
    expect(planned.proposal?.actions.charts).toBeUndefined();
  });

  it("planChatDone returns null proposal when only charts", () => {
    const planned = planChatDone({
      actions: { charts: [emptyChart] },
      trades: [],
      strategy: seedStrategy,
    });
    expect(planned.proposal).toBeNull();
    expect(planned.chartActions.charts).toHaveLength(1);
  });

  it("planChatDone handles missing actions", () => {
    expect(planChatDone({ actions: null, trades: [], strategy: seedStrategy })).toEqual({
      chartActions: {},
      proposal: null,
    });
    expect(
      planChatDone({ actions: undefined, trades: [], strategy: seedStrategy }),
    ).toEqual({
      chartActions: {},
      proposal: null,
    });
  });

  it("builds a new-trade proposal with screenshots", () => {
    const trade = sampleTrade({
      id: "new-1",
      rMultiple: 2,
      screenshots: ["pending"],
    });
    const proposal = buildChatProposal({
      actions: { addTrade: trade },
      trades: [],
      strategy: seedStrategy,
      screenshots: ["data:image/jpeg;base64,abc"],
    });
    expect(proposal?.changes[0].kind).toBe("add");
    if (proposal?.changes[0].kind === "add") {
      expect(proposal.changes[0].trade.screenshots).toEqual([
        "data:image/jpeg;base64,abc",
      ]);
    }
    expect(proposal?.actions.screenshots).toEqual(["data:image/jpeg;base64,abc"]);
  });

  it("generates proposed id when add trade omits id", () => {
    const { id: _id, ...withoutId } = sampleTrade({ id: "drop-me" });
    const proposal = buildChatProposal({
      actions: { addTrade: withoutId },
      trades: [],
      strategy: seedStrategy,
    });
    expect(proposal?.changes[0].kind).toBe("add");
    if (proposal?.changes[0].kind === "add") {
      expect(proposal.changes[0].trade.id).toMatch(/^proposed-/);
    }
  });

  it("builds update before/after with changed keys only", () => {
    const before = sampleTrade();
    const proposal = buildChatProposal({
      actions: {
        updateTrade: { id: "t1", rMultiple: 2.5, notes: "Updated note" },
      },
      trades: [before],
      strategy: seedStrategy,
    });
    expect(proposal?.changes).toHaveLength(1);
    const change = proposal?.changes[0];
    expect(change?.kind).toBe("update");
    if (change?.kind === "update") {
      expect(change.before.rMultiple).toBe(1.5);
      expect(change.after.rMultiple).toBe(2.5);
      expect(change.after.notes).toBe("Updated note");
      expect(change.changedKeys).toEqual(
        expect.arrayContaining(["rMultiple", "notes"]),
      );
      expect(change.changedKeys).not.toContain("symbol");
    }
  });

  it("attaches turn screenshots onto a single update preview", () => {
    const before = sampleTrade({ screenshots: undefined });
    const proposal = buildChatProposal({
      actions: { updateTrade: { id: "t1", session: "London" } },
      trades: [before],
      strategy: seedStrategy,
      screenshots: ["data:image/jpeg;base64,shot"],
    });
    const change = proposal?.changes[0];
    expect(change?.kind).toBe("update");
    if (change?.kind === "update") {
      expect(change.after.session).toBe("London");
      expect(change.after.screenshots).toEqual(["data:image/jpeg;base64,shot"]);
      expect(change.changedKeys).toEqual(
        expect.arrayContaining(["session", "screenshots"]),
      );
    }
  });

  it("attaches a screenshot-only update when no other fields change", () => {
    const before = sampleTrade({
      screenshots: ["data:image/jpeg;base64,a", "data:image/jpeg;base64,b"],
    });
    const proposal = buildChatProposal({
      actions: { updateTrade: { id: "t1" } },
      trades: [before],
      strategy: seedStrategy,
      screenshots: ["data:image/jpeg;base64,c"],
    });
    const change = proposal?.changes[0];
    expect(change?.kind).toBe("update");
    if (change?.kind === "update") {
      expect(change.after.screenshots).toEqual([
        "data:image/jpeg;base64,a",
        "data:image/jpeg;base64,b",
        "data:image/jpeg;base64,c",
      ]);
      expect(change.changedKeys).toEqual(["screenshots"]);
    }
  });

  it("caps attached screenshots at MAX_SCREENSHOTS_PER_TRADE", () => {
    const existing = Array.from(
      { length: MAX_SCREENSHOTS_PER_TRADE },
      (_, i) => `data:image/jpeg;base64,old-${i}`,
    );
    const proposal = buildChatProposal({
      actions: { updateTrade: { id: "t1" } },
      trades: [sampleTrade({ screenshots: existing })],
      strategy: seedStrategy,
      screenshots: ["data:image/jpeg;base64,new"],
    });
    expect(proposal).toBeNull();
  });

  it("ensureScreenshotAttachTarget pins shots onto the referenced trade", () => {
    expect(
      ensureScreenshotAttachTarget(null, {
        screenshots: ["data:image/png;base64,x"],
        referencedTradeIds: ["t-ref"],
      }),
    ).toEqual({
      screenshots: ["data:image/png;base64,x"],
      updateTrade: { id: "t-ref" },
    });
    expect(
      ensureScreenshotAttachTarget(
        { updateTrade: { id: "other", session: "London" } },
        {
          screenshots: ["data:image/png;base64,x"],
          referencedTradeIds: ["t-ref"],
        },
      )?.updateTrade,
    ).toEqual({ id: "other", session: "London" });
    expect(
      ensureScreenshotAttachTarget(
        { addTrade: sampleTrade({ id: "new" }) },
        {
          screenshots: ["data:image/png;base64,x"],
          referencedTradeIds: ["t-ref"],
        },
      )?.updateTrade,
    ).toBeUndefined();
    expect(
      ensureScreenshotAttachTarget(
        { addTrades: [sampleTrade({ id: "new" })] },
        {
          screenshots: ["data:image/png;base64,x"],
          referencedTradeIds: ["t-ref"],
        },
      )?.updateTrade,
    ).toBeUndefined();
    expect(
      ensureScreenshotAttachTarget(
        { updateTrades: [{ id: "other" }] },
        {
          screenshots: ["data:image/png;base64,x"],
          referencedTradeIds: ["t-ref"],
        },
      )?.updateTrade,
    ).toBeUndefined();
    expect(
      ensureScreenshotAttachTarget(
        { updateTrade: { id: "t1" } },
        { referencedTradeIds: ["t-ref"] },
      ),
    ).toEqual({ updateTrade: { id: "t1" } });
    expect(
      ensureScreenshotAttachTarget(undefined, {
        screenshots: ["data:image/png;base64,x"],
      }),
    ).toEqual({ screenshots: ["data:image/png;base64,x"] });
    expect(ensureScreenshotAttachTarget(null, {})).toBeNull();
    expect(
      ensureScreenshotAttachTarget(null, {
        screenshots: ["data:image/png;base64,x"],
        referencedTradeIds: ["t-ref", "t-other"],
      }),
    ).toEqual({ screenshots: ["data:image/png;base64,x"] });
  });

  it("builds delete + multi-change proposals", () => {
    const a = sampleTrade({ id: "a" });
    const b = sampleTrade({ id: "b", symbol: "GBPUSD" });
    const proposal = buildChatProposal({
      actions: {
        updateTrade: { id: "a", rMultiple: 3 },
        deleteTradeIds: ["b"],
        updateStrategy: { appendMarkdown: undefined, markdown: "# New\n" },
      },
      trades: [a, b],
      strategy: seedStrategy,
    });
    expect(proposal?.changes.map((c) => c.kind).sort()).toEqual([
      "delete",
      "strategy",
      "update",
    ]);
    expect(proposal?.summary).toMatch(/update/i);
    expect(proposal?.summary).toMatch(/delete/i);
    expect(proposal?.summary).toMatch(/strategy/i);
  });

  it("uses plural summary labels for multi-add/update/delete proposals", () => {
    const trades = [
      sampleTrade({ id: "a" }),
      sampleTrade({ id: "b", symbol: "GBPUSD" }),
      sampleTrade({ id: "c", symbol: "XAUUSD" }),
      sampleTrade({ id: "d", symbol: "NAS100" }),
    ];
    const proposal = buildChatProposal({
      actions: {
        addTrades: [
          sampleTrade({ id: "n1" }),
          sampleTrade({ id: "n2", symbol: "NAS100" }),
        ],
        updateTrades: [
          { id: "a", rMultiple: 2 },
          { id: "b", notes: "patched" },
        ],
        deleteTradeIds: ["c", "d"],
      },
      trades,
      strategy: seedStrategy,
    });
    expect(proposal?.summary).toBe("2 new trades · 2 updates · 2 deletes");
  });

  it("skips no-op strategy patch when markdown and name are unchanged", () => {
    const proposal = buildChatProposal({
      actions: {
        updateStrategy: { updatedAt: seedStrategy.updatedAt },
        updateTrade: { id: "t1", rMultiple: 2 },
      },
      trades: [sampleTrade()],
      strategy: seedStrategy,
    });
    expect(proposal?.changes.map((c) => c.kind)).toEqual(["update"]);
    expect(proposal?.summary).toMatch(/1 update$/);
  });

  it("skips update when trade id is missing from journal", () => {
    const proposal = buildChatProposal({
      actions: { updateTrade: { id: "missing", rMultiple: 9 } },
      trades: [sampleTrade()],
      strategy: seedStrategy,
    });
    expect(proposal).toBeNull();
  });

  it("skips delete when trade id is missing from journal", () => {
    const proposal = buildChatProposal({
      actions: { deleteTradeIds: ["missing"] },
      trades: [sampleTrade()],
      strategy: seedStrategy,
    });
    expect(proposal).toBeNull();
  });

  it("merges strategy patch and diffs markdown", () => {
    const after = mergeStrategyPatch(seedStrategy, {
      markdown: "# Renamed\n\nNew body\n",
    });
    expect(after.name).toBe("Renamed");
    expect(after.markdown).toContain("New body");

    const proposal = buildChatProposal({
      actions: { updateStrategy: { markdown: "# Renamed\n\nNew body\n" } },
      trades: [],
      strategy: seedStrategy,
    });
    expect(proposal?.changes[0].kind).toBe("strategy");
    if (proposal?.changes[0].kind === "strategy") {
      expect(proposal.changes[0].before.name).toBe(seedStrategy.name);
      expect(proposal.changes[0].after.name).toBe("Renamed");
    }

    const diff = lineDiff("a\nb\nc", "a\nx\nc");
    expect(diff.some((l) => l.type === "remove" && l.text === "b")).toBe(true);
    expect(diff.some((l) => l.type === "add" && l.text === "x")).toBe(true);
    expect(diff.filter((l) => l.type === "same").map((l) => l.text)).toEqual([
      "a",
      "c",
    ]);

    expect(lineDiff("a\nb\nc\nd", "a\nb")).toEqual([
      { type: "same", text: "a" },
      { type: "same", text: "b" },
      { type: "remove", text: "c" },
      { type: "remove", text: "d" },
    ]);
    expect(lineDiff("a\nb", "a\nb\nc\nd")).toEqual([
      { type: "same", text: "a" },
      { type: "same", text: "b" },
      { type: "add", text: "c" },
      { type: "add", text: "d" },
    ]);
    expect(lineDiff("a\r\nb", "a\nb")).toEqual([
      { type: "same", text: "a" },
      { type: "same", text: "b" },
    ]);
  });

  it("includes checklist-only strategy updates in proposals", () => {
    const checklist = [{ id: "n1", label: "New item" }];
    const proposal = buildChatProposal({
      actions: { updateStrategy: { checklist } },
      trades: [],
      strategy: { ...seedStrategy, checklist: undefined },
    });
    expect(proposal?.changes[0].kind).toBe("strategy");
    if (proposal?.changes[0].kind === "strategy") {
      expect(proposal.changes[0].after.checklist).toEqual(checklist);
    }
  });

  it("includes trade checklist in update diffs", () => {
    const trade = sampleTrade();
    const proposal = buildChatProposal({
      actions: {
        updateTrade: {
          id: trade.id,
          checklist: [{ id: "cl-bias", label: "Daily bias", checked: true }],
        },
      },
      trades: [trade],
      strategy: seedStrategy,
    });
    expect(proposal?.changes[0].kind).toBe("update");
    if (proposal?.changes[0].kind === "update") {
      expect(proposal.changes[0].changedKeys).toContain("checklist");
    }
  });

  it("mergeTradePatch normalizes entry/exit times and skips undefined patch keys", () => {
    const before = sampleTrade({ entryTime: undefined, exitTime: undefined });
    const after = mergeTradePatch(before, {
      rMultiple: 3,
      entryTime: "15:46:09",
      exitTime: "16:10:00",
      notes: undefined,
      date: null as unknown as string,
    });
    expect(after.rMultiple).toBe(3);
    expect(after.entryTime).toBe(`${before.date}T15:46:09`);
    expect(after.exitTime).toBe(`${before.date}T16:10:00`);
    expect(after.notes).toBe("Clean");
  });

  it("mergeTradePatch keeps raw times when normalization returns undefined", async () => {
    const tradeFormat = await import("@/lib/trade-format");
    const normalizeSpy = vi
      .spyOn(tradeFormat, "normalizeTradeDateTime")
      .mockReturnValue(undefined);
    const before = sampleTrade({ entryTime: undefined, exitTime: undefined });
    const after = mergeTradePatch(before, {
      entryTime: "15:46:09",
      exitTime: "16:10:00",
    });
    expect(after.entryTime).toBe("15:46:09");
    expect(after.exitTime).toBe("16:10:00");
    normalizeSpy.mockRestore();
  });

  it("changedTradeKeys compares arrays, nulls, and mismatched types", () => {
    const before = sampleTrade({ tags: ["A+"], notes: undefined });
    expect(changedTradeKeys(before, { ...before, tags: ["A+"] })).toEqual([]);
    expect(changedTradeKeys(before, { ...before, tags: ["B"] })).toEqual(["tags"]);
    expect(changedTradeKeys(before, { ...before, notes: "New" })).toEqual(["notes"]);
    expect(
      changedTradeKeys(
        { ...before, notes: null as unknown as undefined },
        { ...before, notes: undefined },
      ),
    ).toEqual([]);
    expect(
      changedTradeKeys(
        { ...before, slPips: 10 },
        { ...before, slPips: "10" as unknown as number },
      ),
    ).toEqual(["slPips"]);

    const circular: Record<string, unknown> = { self: null };
    circular.self = circular;
    expect(
      changedTradeKeys(
        { ...before, tags: circular as unknown as string[] },
        { ...before, tags: circular as unknown as string[] },
      ),
    ).toEqual([]);
    expect(
      changedTradeKeys(
        { ...before, tags: circular as unknown as string[] },
        { ...before, tags: { also: circular } as unknown as string[] },
      ),
    ).toEqual(["tags"]);
  });

  it("simulates refine: newer proposal replaces older suggestion content", () => {
    const first = buildChatProposal({
      actions: { addTrade: sampleTrade({ id: "n1", rMultiple: 1 }) },
      trades: [],
      strategy: seedStrategy,
    });
    const second = buildChatProposal({
      actions: { addTrade: sampleTrade({ id: "n1", rMultiple: 2, notes: "refined" }) },
      trades: [],
      strategy: seedStrategy,
    });
    expect(first?.id).not.toBe(second?.id);
    if (second?.changes[0].kind === "add") {
      expect(second.changes[0].trade.rMultiple).toBe(2);
      expect(second.changes[0].trade.notes).toBe("refined");
    }
  });

  it("wires JournalSession mutations into a reviewable proposal", async () => {
    const { JournalSession } = await import("@/lib/journal-session");
    const session = new JournalSession({
      trades: [sampleTrade()],
      strategy: seedStrategy,
    });
    const patched = session.patchTrade({
      id: "t1",
      rMultiple: 2.1,
      pnlUsd: 210,
    } as never);
    expect(patched.ok).toBe(true);

    const appended = session.updateStrategy({
      appendMarkdown: "## Chat tweak\n\nNo revenge trades.",
    });
    expect(appended.ok).toBe(true);

    const actions = session.toActions();
    const planned = planChatDone({
      actions: {
        ...actions,
        charts: [emptyChart],
      },
      trades: [sampleTrade()],
      strategy: seedStrategy,
    });

    expect(planned.chartActions.charts).toHaveLength(1);
    expect(planned.proposal).not.toBeNull();
    const kinds = planned.proposal?.changes.map((c) => c.kind) ?? [];
    expect(kinds).toContain("update");
    expect(kinds).toContain("strategy");
    if (planned.proposal) {
      const update = planned.proposal.changes.find((c) => c.kind === "update");
      expect(update?.kind).toBe("update");
      if (update?.kind === "update") {
        expect(update.after.rMultiple).toBe(2.1);
        expect(update.after.pnlUsd).toBe(210);
      }
      const strategy = planned.proposal.changes.find((c) => c.kind === "strategy");
      expect(strategy?.kind).toBe("strategy");
      if (strategy?.kind === "strategy") {
        expect(strategy.after.markdown).toContain("No revenge trades");
      }
    }
  });
});

describe("strategy surgical edits", () => {
  it("applies replacements without wiping the rest of the plan", async () => {
    const { JournalSession } = await import("@/lib/journal-session");
    const session = new JournalSession({
      trades: [],
      strategy: seedStrategy,
    });
    const beforeLen = session.strategy.markdown.length;
    const res = session.updateStrategy({
      replacements: [
        {
          find: "**Win rate:** 40–55%",
          replace: "**Win rate:** 45–60%",
        },
      ],
    });
    expect(res.ok).toBe(true);
    expect(session.strategy.markdown).toContain("**Win rate:** 45–60%");
    expect(session.strategy.markdown).toContain("## Rules");
    expect(session.strategy.markdown).toContain("## Edge");
    expect(session.strategy.markdown.length).toBeGreaterThan(beforeLen * 0.8);
  });

  it("refuses a short markdown snippet that would wipe the strategy", async () => {
    const { JournalSession } = await import("@/lib/journal-session");
    const session = new JournalSession({
      trades: [],
      strategy: seedStrategy,
    });
    const before = session.strategy.markdown;
    const res = session.updateStrategy({
      markdown: "## New rule\n\nNo revenge trades.\n",
    });
    expect(res.ok).toBe(true);
    // Short snippet is folded in — does not wipe Edge/Rules/etc.
    expect(session.strategy.markdown).toContain("## Edge");
    expect(session.strategy.markdown).toContain("## Rules");
    expect(session.strategy.markdown).toContain("No revenge trades");
    expect(session.strategy.markdown.length).toBeGreaterThan(before.length * 0.8);
  });

  it("replaces an existing ## section when short markdown matches its heading", async () => {
    const { JournalSession } = await import("@/lib/journal-session");
    const session = new JournalSession({
      trades: [],
      strategy: seedStrategy,
    });
    const res = session.updateStrategy({
      markdown:
        "## Edge\n\nOnly trade A+ FVGs in London with clear displacement.\n",
    });
    expect(res.ok).toBe(true);
    expect(session.strategy.markdown).toContain(
      "Only trade A+ FVGs in London with clear displacement.",
    );
    expect(session.strategy.markdown).toContain("## Approach");
    expect(session.strategy.markdown).toContain("## Rules");
    // Old edge body should be gone
    expect(session.strategy.markdown).not.toContain(
      "Trade only 1H FVGs that form after a liquidity sweep + displacement, aligned with Daily/4H structure",
    );
  });

  it("rejects find text that is missing or ambiguous", async () => {
    const { JournalSession } = await import("@/lib/journal-session");
    const session = new JournalSession({
      trades: [],
      strategy: seedStrategy,
    });
    const missing = session.updateStrategy({
      replacements: [{ find: "this text is not in the plan", replace: "x" }],
    });
    expect(missing.ok).toBe(false);

    const ambiguous = session.updateStrategy({
      replacements: [{ find: "FVG", replace: "Fair Value Gap" }],
    });
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.error).toMatch(/matches \d+ times/i);
  });
});

describe("pending proposal accept / reject store flow", () => {
  beforeEach(() => {
    useTradingStore.setState({
      trades: [sampleTrade()],
      strategy: seedStrategy,
      pendingProposal: null,
      proposalReviewOpen: false,
      chatReferencedTradeIds: [],
      hydrated: true,
    });
  });

  it("does not mutate journal until Accept", () => {
    const proposal = buildChatProposal({
      actions: { updateTrade: { id: "t1", rMultiple: 9 } },
      trades: useTradingStore.getState().trades,
      strategy: useTradingStore.getState().strategy,
    });
    expect(proposal).not.toBeNull();
    useTradingStore.getState().setPendingProposal(proposal);
    expect(useTradingStore.getState().proposalReviewOpen).toBe(true);
    expect(useTradingStore.getState().trades[0].rMultiple).toBe(1.5);

    useTradingStore.getState().rejectPendingProposal();
    expect(useTradingStore.getState().pendingProposal).toBeNull();
    expect(useTradingStore.getState().trades[0].rMultiple).toBe(1.5);
  });

  it("Accept applies update to the journal", () => {
    const proposal = buildChatProposal({
      actions: { updateTrade: { id: "t1", rMultiple: 2.25, notes: "Accepted" } },
      trades: useTradingStore.getState().trades,
      strategy: useTradingStore.getState().strategy,
    });
    useTradingStore.getState().setPendingProposal(proposal);
    useTradingStore.getState().acceptPendingProposal();

    const trade = useTradingStore.getState().trades.find((t) => t.id === "t1");
    expect(trade?.rMultiple).toBe(2.25);
    expect(trade?.notes).toBe("Accepted");
    expect(useTradingStore.getState().pendingProposal).toBeNull();
    expect(useTradingStore.getState().proposalReviewOpen).toBe(false);
  });

  it("Accept applies new trade and strategy", () => {
    const proposal = buildChatProposal({
      actions: {
        addTrade: sampleTrade({ id: "t2", symbol: "XAUUSD", rMultiple: 1 }),
        updateStrategy: { markdown: "# Accepted Plan\n\nBody\n" },
      },
      trades: useTradingStore.getState().trades,
      strategy: useTradingStore.getState().strategy,
    });
    useTradingStore.getState().setPendingProposal(proposal);
    useTradingStore.getState().acceptPendingProposal();

    expect(useTradingStore.getState().trades.some((t) => t.id === "t2")).toBe(
      true,
    );
    expect(useTradingStore.getState().strategy.name).toBe("Accepted Plan");
  });

  it("Accept applies delete", () => {
    const proposal = buildChatProposal({
      actions: { deleteTradeIds: ["t1"] },
      trades: useTradingStore.getState().trades,
      strategy: useTradingStore.getState().strategy,
    });
    useTradingStore.getState().setPendingProposal(proposal);
    useTradingStore.getState().acceptPendingProposal();
    expect(useTradingStore.getState().trades.find((t) => t.id === "t1")).toBe(
      undefined,
    );
  });

  it("applyChatActions charts do not require proposal", () => {
    const beforeCount = useTradingStore.getState().trades.length;
    const result = applyChatActions({ charts: [emptyChart] });
    expect(result.charts).toHaveLength(1);
    expect(useTradingStore.getState().trades).toHaveLength(beforeCount);
  });

  it("replacing pending proposal keeps journal untouched until accept", () => {
    const first = buildChatProposal({
      actions: { updateTrade: { id: "t1", rMultiple: 2 } },
      trades: useTradingStore.getState().trades,
      strategy: useTradingStore.getState().strategy,
    });
    useTradingStore.getState().setPendingProposal(first);

    const second = buildChatProposal({
      actions: { updateTrade: { id: "t1", rMultiple: 4 } },
      trades: useTradingStore.getState().trades,
      strategy: useTradingStore.getState().strategy,
    });
    useTradingStore.getState().setPendingProposal(second);

    expect(useTradingStore.getState().trades[0].rMultiple).toBe(1.5);
    expect(useTradingStore.getState().pendingProposal?.id).toBe(second?.id);

    useTradingStore.getState().acceptPendingProposal();
    expect(useTradingStore.getState().trades[0].rMultiple).toBe(4);
  });

  it("replacing a proposal reopens the review panel after it was hidden", () => {
    const first = buildChatProposal({
      actions: { updateTrade: { id: "t1", rMultiple: 2 } },
      trades: useTradingStore.getState().trades,
      strategy: useTradingStore.getState().strategy,
    });
    useTradingStore.getState().setPendingProposal(first);
    useTradingStore.getState().closeProposalReview();
    expect(useTradingStore.getState().proposalReviewOpen).toBe(false);

    const second = buildChatProposal({
      actions: { updateTrade: { id: "t1", pnlUsd: 50 } },
      trades: useTradingStore.getState().trades,
      strategy: useTradingStore.getState().strategy,
    });
    useTradingStore.getState().setPendingProposal(second);
    expect(useTradingStore.getState().proposalReviewOpen).toBe(true);
    expect(useTradingStore.getState().pendingProposal?.id).toBe(second?.id);
  });

  it("resolvePendingProposalUpdate clears stale pending when tools ran but no diffs", () => {
    const trades = useTradingStore.getState().trades;
    const first = buildChatProposal({
      actions: { updateTrade: { id: "t1", entryTime: "2026-07-30T15:46:09" } },
      trades,
      strategy: useTradingStore.getState().strategy,
    });
    useTradingStore.getState().setPendingProposal(first);

    // Same rMultiple as live journal → no net change
    const resolved = resolvePendingProposalUpdate({
      actions: { updateTrade: { id: "t1", rMultiple: trades[0].rMultiple } },
      trades,
      strategy: useTradingStore.getState().strategy,
    });
    expect(resolved.nextProposal).toBeNull();
    expect(resolved.clearPending).toBe(true);
  });

  it("resolvePendingProposalUpdate replaces with a new proposal when diffs exist", () => {
    const resolved = resolvePendingProposalUpdate({
      actions: { updateTrade: { id: "t1", rMultiple: 9 } },
      trades: useTradingStore.getState().trades,
      strategy: useTradingStore.getState().strategy,
    });
    expect(resolved.nextProposal).not.toBeNull();
    expect(resolved.clearPending).toBe(false);
  });

  it("resolvePendingProposalUpdate handles missing actions", () => {
    const resolved = resolvePendingProposalUpdate({
      actions: null,
      trades: useTradingStore.getState().trades,
      strategy: useTradingStore.getState().strategy,
    });
    expect(resolved.nextProposal).toBeNull();
    expect(resolved.clearPending).toBe(false);
    expect(resolved.chartActions).toEqual({});
  });

  it("refine omitting timestamps replaces pending with remaining field diffs only", () => {
    const trades = [
      sampleTrade({
        id: "t1",
        entryTime: "2026-07-30T15:46:09",
        exitTime: "2026-07-30T16:10:00",
        rMultiple: 1.95,
        slPips: 29.3,
      }),
    ];
    useTradingStore.setState({ trades });

    const withTimes = resolvePendingProposalUpdate({
      actions: {
        updateTrade: {
          id: "t1",
          entryTime: "2026-07-30T15:46:09Z",
          exitTime: "2026-07-30T16:10:00Z",
          rMultiple: 1.97,
          slPips: 29.7,
        },
      },
      trades,
      strategy: useTradingStore.getState().strategy,
    });
    expect(withTimes.nextProposal).not.toBeNull();
    useTradingStore.getState().setPendingProposal(withTimes.nextProposal);
    useTradingStore.getState().closeProposalReview();

    // User: "ignore entry/exit times" — only non-time fields remain
    const refined = resolvePendingProposalUpdate({
      actions: {
        updateTrade: {
          id: "t1",
          rMultiple: 1.97,
          slPips: 29.7,
        },
      },
      trades,
      strategy: useTradingStore.getState().strategy,
    });
    expect(refined.clearPending).toBe(false);
    expect(refined.nextProposal).not.toBeNull();
    const keys =
      refined.nextProposal!.changes[0].kind === "update"
        ? refined.nextProposal!.changes[0].changedKeys
        : [];
    expect(keys).toEqual(expect.arrayContaining(["rMultiple", "slPips"]));
    expect(keys).not.toContain("entryTime");
    expect(keys).not.toContain("exitTime");

    useTradingStore.getState().setPendingProposal(refined.nextProposal);
    expect(useTradingStore.getState().proposalReviewOpen).toBe(true);
    expect(useTradingStore.getState().pendingProposal?.id).toBe(
      refined.nextProposal?.id,
    );
  });

  it("clearChat drops pending proposal", () => {
    const proposal = buildChatProposal({
      actions: { updateTrade: { id: "t1", rMultiple: 2 } },
      trades: useTradingStore.getState().trades,
      strategy: useTradingStore.getState().strategy,
    });
    useTradingStore.getState().setPendingProposal(proposal);
    useTradingStore.getState().clearChat();
    expect(useTradingStore.getState().pendingProposal).toBeNull();
    expect(useTradingStore.getState().proposalReviewOpen).toBe(false);
  });
});
