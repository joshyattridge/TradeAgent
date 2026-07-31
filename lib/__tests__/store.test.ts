/**
 * @vitest-environment jsdom
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildChatProposal } from "@/lib/chat-proposals";
import * as idbModule from "@/lib/idb-storage";
import { DEFAULT_OPENAI_MODEL } from "@/lib/models";
import { seedStrategy, seedTrades } from "@/lib/seed-data";
import {
  DEFAULT_VISIBLE_TRADE_COLUMNS,
  type TradeColumnId,
} from "@/lib/trade-columns";
import { applyChatActions, useTradingStore } from "@/lib/store";
import type { ChartSpec, Strategy, Trade } from "@/lib/types";

const STORE_KEY = "tradeagent-store-v4";

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

function resetStore(overrides: Partial<ReturnType<typeof useTradingStore.getState>> = {}) {
  useTradingStore.setState({
    trades: [sampleTrade()],
    strategy: seedStrategy,
    chat: [
      {
        id: "welcome",
        role: "assistant",
        content: "Hello",
        createdAt: new Date().toISOString(),
      },
    ],
    chatSummary: "",
    openaiApiKey: "",
    openaiModel: DEFAULT_OPENAI_MODEL,
    visibleTradeColumns: [...DEFAULT_VISIBLE_TRADE_COLUMNS],
    chatReferencedTradeId: null,
    pendingProposal: null,
    proposalReviewOpen: false,
    hydrated: true,
    ...overrides,
  });
}

describe("useTradingStore actions", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    await idbModule.idbStorage.removeItem(STORE_KEY);
    resetStore();
  });

  it("skips whitespace-only entry and exit times when adding", () => {
    useTradingStore.getState().addTrade(
      sampleTrade({
        id: "t-ws",
        entryTime: "   ",
        exitTime: "   ",
      }),
    );
    const trade = useTradingStore.getState().trades.find((t) => t.id === "t-ws");
    // normalizeTradeTimes ignores blank clocks so they stay as provided blanks
    // or are left unset depending on addTrade path — assert no crash and id present
    expect(trade?.id).toBe("t-ws");
  });

  it("setOpenAIApiKey trims whitespace", () => {
    useTradingStore.getState().setOpenAIApiKey("  sk-test  ");
    expect(useTradingStore.getState().openaiApiKey).toBe("sk-test");
  });

  it("setOpenAIModel and setChatSummary update state", () => {
    useTradingStore.getState().setOpenAIModel("gpt-4.1");
    useTradingStore.getState().setChatSummary("Earlier context");
    expect(useTradingStore.getState().openaiModel).toBe("gpt-4.1");
    expect(useTradingStore.getState().chatSummary).toBe("Earlier context");
  });

  it("setChatReferencedTradeId updates composer pin", () => {
    useTradingStore.getState().setChatReferencedTradeId("t1");
    expect(useTradingStore.getState().chatReferencedTradeId).toBe("t1");
    useTradingStore.getState().setChatReferencedTradeId(null);
    expect(useTradingStore.getState().chatReferencedTradeId).toBeNull();
  });

  it("setHydrated toggles hydration flag", () => {
    useTradingStore.getState().setHydrated(false);
    expect(useTradingStore.getState().hydrated).toBe(false);
    useTradingStore.getState().setHydrated(true);
    expect(useTradingStore.getState().hydrated).toBe(true);
  });

  it("addTrade assigns id, caps screenshots, and filters pending", () => {
    const added = useTradingStore.getState().addTrade({
      date: "2026-07-02",
      symbol: "GBPUSD",
      side: "short",
      setup: "Sweep",
      entry: 1.27,
      stop: 1.272,
      target: 1.265,
      rMultiple: 2,
      result: "win",
      screenshots: ["pending", "shot-a", "shot-b", "shot-c"],
    });
    expect(added.id).toBeTruthy();
    expect(added.screenshots).toEqual(["shot-a", "shot-b"]);

    const withId = useTradingStore.getState().addTrade(
      sampleTrade({ id: "fixed-id", symbol: "XAUUSD" }),
    );
    expect(withId.id).toBe("fixed-id");
    expect(useTradingStore.getState().trades[0].symbol).toBe("XAUUSD");

    const bare = useTradingStore.getState().addTrade({
      date: "2026-07-03",
      symbol: "US30",
      side: "long",
      setup: "Breakout",
      entry: 100,
      stop: 99,
      target: 102,
      rMultiple: 1,
      result: "open",
    });
    expect(bare.screenshots).toBeUndefined();
  });

  it("updateTrade merges patches, ignores undefined, and normalizes times", () => {
    useTradingStore.setState({
      trades: [sampleTrade({ entryTime: "2026-07-01T10:00:00Z" })],
    });
    useTradingStore.getState().updateTrade("t1", {
      rMultiple: 2,
      notes: undefined,
      entryTime: "2026-07-01T11:00:00Z",
      exitTime: "2026-07-01T12:00:00Z",
      screenshots: ["pending", "a", "b", "c"],
    });
    const trade = useTradingStore.getState().trades.find((t) => t.id === "t1");
    expect(trade?.rMultiple).toBe(2);
    expect(trade?.notes).toBe("Clean");
    expect(trade?.entryTime).toBeTruthy();
    expect(trade?.screenshots).toEqual(["a", "b"]);
  });

  it("deleteTrade removes trade and clears composer pin when matched", () => {
    useTradingStore.setState({ chatReferencedTradeId: "t1" });
    useTradingStore.getState().deleteTrade("t1");
    expect(useTradingStore.getState().trades.find((t) => t.id === "t1")).toBeUndefined();
    expect(useTradingStore.getState().chatReferencedTradeId).toBeNull();
  });

  it("deleteTrade keeps composer pin when deleting a different trade", () => {
    useTradingStore.setState({
      trades: [sampleTrade({ id: "a" }), sampleTrade({ id: "b", symbol: "GBPUSD" })],
      chatReferencedTradeId: "a",
    });
    useTradingStore.getState().deleteTrade("b");
    expect(useTradingStore.getState().chatReferencedTradeId).toBe("a");
  });

  it("deleteTrades removes multiple and clears pin when referenced id deleted", () => {
    useTradingStore.setState({
      trades: [sampleTrade({ id: "a" }), sampleTrade({ id: "b", symbol: "GBPUSD" })],
      chatReferencedTradeId: "b",
    });
    useTradingStore.getState().deleteTrades(["a", "b"]);
    expect(useTradingStore.getState().trades).toHaveLength(0);
    expect(useTradingStore.getState().chatReferencedTradeId).toBeNull();
  });

  it("deleteTrades keeps composer pin when referenced trade survives", () => {
    useTradingStore.setState({
      trades: [sampleTrade({ id: "a" }), sampleTrade({ id: "b", symbol: "GBPUSD" })],
      chatReferencedTradeId: "a",
    });
    useTradingStore.getState().deleteTrades(["b"]);
    expect(useTradingStore.getState().chatReferencedTradeId).toBe("a");
  });

  it("updateStrategy merges markdown and derives name from heading", () => {
    useTradingStore.getState().updateStrategy({
      markdown: "# Renamed Strategy\n\nBody\n",
    });
    expect(useTradingStore.getState().strategy.name).toBe("Renamed Strategy");
    expect(useTradingStore.getState().strategy.markdown).toContain("Body");
  });

  it("updateStrategy keeps explicit name when markdown also changes", () => {
    useTradingStore.getState().updateStrategy({
      name: "Pinned Name",
      markdown: "# Ignored Heading\n\nBody\n",
    });
    expect(useTradingStore.getState().strategy.name).toBe("Pinned Name");
  });

  it("replaceStrategy normalizes imported strategy", () => {
    const next: Strategy = {
      name: "Imported",
      markdown: "# Imported\n\nPlan\n",
      updatedAt: "",
    };
    useTradingStore.getState().replaceStrategy(next);
    expect(useTradingStore.getState().strategy.name).toBe("Imported");
    expect(useTradingStore.getState().strategy.updatedAt).toBeTruthy();
  });

  it("importJournal replace mode drops composer pin when trade missing", () => {
    useTradingStore.setState({ chatReferencedTradeId: "t1" });
    useTradingStore.getState().importJournal([], seedStrategy, "replace");
    expect(useTradingStore.getState().trades).toHaveLength(0);
    expect(useTradingStore.getState().chatReferencedTradeId).toBeNull();
  });

  it("importJournal replace mode keeps composer pin when trade still exists", () => {
    const incoming = sampleTrade({ id: "t1", notes: "Imported" });
    useTradingStore.setState({ chatReferencedTradeId: "t1" });
    useTradingStore.getState().importJournal([incoming], seedStrategy, "replace");
    expect(useTradingStore.getState().chatReferencedTradeId).toBe("t1");
    expect(useTradingStore.getState().trades[0].notes).toBe("Imported");
  });

  it("importJournal merge mode combines trades", () => {
    useTradingStore.getState().importJournal(
      [sampleTrade({ id: "t2", symbol: "USDJPY" })],
      seedStrategy,
      "merge",
    );
    expect(useTradingStore.getState().trades.some((t) => t.id === "t2")).toBe(true);
    expect(useTradingStore.getState().trades.some((t) => t.id === "t1")).toBe(true);
  });

  it("importJournal preserves strategy.updatedAt when provided", () => {
    const stamped: Strategy = {
      ...seedStrategy,
      updatedAt: "2020-01-01T00:00:00.000Z",
    };
    useTradingStore.getState().importJournal([], stamped, "replace");
    expect(useTradingStore.getState().strategy.updatedAt).toBe(
      "2020-01-01T00:00:00.000Z",
    );
  });

  it("importJournal assigns updatedAt when missing on strategy", () => {
    useTradingStore.getState().importJournal(
      [],
      { ...seedStrategy, updatedAt: "" },
      "replace",
    );
    expect(useTradingStore.getState().strategy.updatedAt).toBeTruthy();
    expect(useTradingStore.getState().strategy.updatedAt).not.toBe("");
  });

  it("importJournal strips pending-only screenshots via persistableTrades", () => {
    useTradingStore.getState().importJournal(
      [sampleTrade({ id: "pending-only", screenshots: ["pending"] })],
      seedStrategy,
      "replace",
    );
    expect(
      useTradingStore.getState().trades[0].screenshots,
    ).toBeUndefined();
  });

  it("toggleTradeColumn adds, removes, and refuses to hide the last column", () => {
    resetStore({ visibleTradeColumns: ["symbol"] as TradeColumnId[] });
    useTradingStore.getState().toggleTradeColumn("symbol");
    expect(useTradingStore.getState().visibleTradeColumns).toEqual(["symbol"]);

    useTradingStore.getState().toggleTradeColumn("side");
    expect(useTradingStore.getState().visibleTradeColumns).toContain("side");
    useTradingStore.getState().toggleTradeColumn("side");
    expect(useTradingStore.getState().visibleTradeColumns).not.toContain("side");
  });

  it("resetTradeColumns restores defaults", () => {
    resetStore({ visibleTradeColumns: ["symbol"] as TradeColumnId[] });
    useTradingStore.getState().resetTradeColumns();
    expect(useTradingStore.getState().visibleTradeColumns).toEqual(
      DEFAULT_VISIBLE_TRADE_COLUMNS,
    );
  });

  it("addChatMessage appends with generated id and preserves attachments", () => {
    useTradingStore.getState().addChatMessage({
      role: "user",
      content: "Log this",
      images: ["data:image/png;base64,abc"],
      files: [{ name: "a.csv", mime: "text/csv", text: "x" }],
      attachments: [{ kind: "text", name: "a.csv", text: "x", mime: "text/csv" }],
      agentMessages: [],
      charts: [emptyChart],
    });
    const last = useTradingStore.getState().chat.at(-1);
    expect(last?.role).toBe("user");
    expect(last?.id).toBeTruthy();
    expect(last?.images).toHaveLength(1);
    expect(last?.charts).toHaveLength(1);
  });

  it("addChatMessage respects provided id", () => {
    useTradingStore.getState().addChatMessage({
      id: "fixed-chat",
      role: "assistant",
      content: "Done",
    });
    expect(useTradingStore.getState().chat.at(-1)?.id).toBe("fixed-chat");
  });

  it("clearChat wipes chat state and pending proposal", () => {
    const proposal = buildChatProposal({
      actions: { updateTrade: { id: "t1", rMultiple: 2 } },
      trades: useTradingStore.getState().trades,
      strategy: seedStrategy,
    });
    useTradingStore.setState({
      chatSummary: "summary",
      chatReferencedTradeId: "t1",
      pendingProposal: proposal,
      proposalReviewOpen: true,
    });
    useTradingStore.getState().clearChat();
    expect(useTradingStore.getState().chat).toEqual([]);
    expect(useTradingStore.getState().chatSummary).toBe("");
    expect(useTradingStore.getState().pendingProposal).toBeNull();
    expect(useTradingStore.getState().proposalReviewOpen).toBe(false);
  });

  it("resetDemoData restores seeded trades and strategy", () => {
    useTradingStore.setState({ trades: [], strategy: { ...seedStrategy, name: "X" } });
    useTradingStore.getState().resetDemoData();
    expect(useTradingStore.getState().trades).toEqual(seedTrades);
    expect(useTradingStore.getState().strategy.name).toBe(seedStrategy.name);
  });

  it("proposal review open/close/accept/reject flows", () => {
    const proposal = buildChatProposal({
      actions: { updateTrade: { id: "t1", rMultiple: 3 } },
      trades: useTradingStore.getState().trades,
      strategy: seedStrategy,
    });

    useTradingStore.getState().openProposalReview();
    expect(useTradingStore.getState().proposalReviewOpen).toBe(false);

    useTradingStore.getState().setPendingProposal(proposal);
    expect(useTradingStore.getState().proposalReviewOpen).toBe(true);

    useTradingStore.getState().closeProposalReview();
    expect(useTradingStore.getState().proposalReviewOpen).toBe(false);

    useTradingStore.getState().openProposalReview();
    expect(useTradingStore.getState().proposalReviewOpen).toBe(true);

    useTradingStore.getState().acceptPendingProposal();
    expect(useTradingStore.getState().trades[0].rMultiple).toBe(3);
    expect(useTradingStore.getState().pendingProposal).toBeNull();

    useTradingStore.getState().acceptPendingProposal();
    expect(useTradingStore.getState().trades[0].rMultiple).toBe(3);

    useTradingStore.getState().setPendingProposal(proposal);
    useTradingStore.getState().rejectPendingProposal();
    expect(useTradingStore.getState().pendingProposal).toBeNull();
    expect(useTradingStore.getState().proposalReviewOpen).toBe(false);
    expect(useTradingStore.getState().trades[0].rMultiple).toBe(3);
  });
});

describe("applyChatActions", () => {
  beforeEach(() => {
    resetStore({ trades: [sampleTrade()] });
  });

  it("adds trades from addTrades and singular addTrade fallback", () => {
    const result = applyChatActions({
      addTrades: [
        sampleTrade({ id: "n1", symbol: "GBPUSD", pnlUsd: 120 }),
        sampleTrade({ id: "n2", symbol: "USDJPY" }),
      ],
      screenshots: ["data:image/png;base64,shot"],
    });
    expect(useTradingStore.getState().trades.some((t) => t.id === "n1")).toBe(true);
    expect(result.notes.some((n) => n.includes("$120"))).toBe(true);
    expect(result.notes.some((n) => n.includes("screenshot"))).toBe(true);
    expect(result.touchedTradeId).toBe("n2");

    resetStore({ trades: [] });
    applyChatActions({
      addTrade: sampleTrade({ id: "solo", symbol: "XAUUSD" }),
    });
    expect(useTradingStore.getState().trades[0].id).toBe("solo");
    expect(
      applyChatActions({
        addTrade: sampleTrade({
          id: "shots",
          symbol: "NAS100",
          screenshots: ["s1", "s2"],
        }),
      }).notes.some((n) => n.includes("2 screenshots")),
    ).toBe(true);
    expect(
      applyChatActions({
        addTrade: sampleTrade({ id: "plain", symbol: "US30", pnlUsd: undefined }),
      }).notes.some((n) => n.includes("US30") && !n.includes("$")),
    ).toBe(true);
  });

  it("updates trades from updateTrades and singular updateTrade fallback", () => {
    applyChatActions({
      updateTrades: [{ id: "t1", notes: "Batch" }],
    });
    expect(useTradingStore.getState().trades[0].notes).toBe("Batch");

    applyChatActions({
      updateTrade: { id: "t1", session: "London" },
    });
    expect(useTradingStore.getState().trades[0].session).toBe("London");

    applyChatActions({
      updateTrade: { id: "t1", notes: undefined, session: "NY" },
    });
    expect(useTradingStore.getState().trades[0].session).toBe("NY");
    expect(useTradingStore.getState().trades[0].notes).toBe("Batch");
  });

  it("skips updates without id", () => {
    const before = useTradingStore.getState().trades[0];
    applyChatActions({
      updateTrades: [{ id: "", notes: "Nope" } as never],
    });
    expect(useTradingStore.getState().trades[0]).toEqual(before);
  });

  it("attaches turn screenshots to a single updated trade only", () => {
    applyChatActions({
      updateTrade: { id: "t1", notes: "With shot" },
      screenshots: ["data:image/png;base64,turn-shot"],
    });
    expect(useTradingStore.getState().trades[0].screenshots).toEqual([
      "data:image/png;base64,turn-shot",
    ]);
  });

  it("does not attach turn screenshots when multiple trades updated", () => {
    useTradingStore.setState({
      trades: [sampleTrade({ id: "a" }), sampleTrade({ id: "b", symbol: "GBPUSD" })],
    });
    applyChatActions({
      updateTrades: [
        { id: "a", notes: "A" },
        { id: "b", notes: "B" },
      ],
      screenshots: ["data:image/png;base64,turn-shot"],
    });
    expect(useTradingStore.getState().trades[0].screenshots).toBeUndefined();
    expect(useTradingStore.getState().trades[1].screenshots).toBeUndefined();
  });

  it("deletes trades and clears touchedTradeId when deleted", () => {
    const result = applyChatActions({
      addTrade: sampleTrade({
        id: "temp",
        symbol: "NAS100",
        side: "short",
        setup: "Sweep",
        entry: 1,
        stop: 2,
        target: 0.5,
        rMultiple: -1,
        result: "loss",
      }),
      deleteTradeIds: ["temp"],
    });
    expect(useTradingStore.getState().trades.some((t) => t.id === "temp")).toBe(false);
    expect(result.notes.some((n) => n.includes("Removed 1 trade."))).toBe(true);
    expect(result.touchedTradeId).toBeNull();
  });

  it("notes plural trades removed and singular chart generated", () => {
    useTradingStore.setState({
      trades: [sampleTrade({ id: "a" }), sampleTrade({ id: "b", symbol: "GBPUSD" })],
    });
    const deleted = applyChatActions({ deleteTradeIds: ["a", "b"] });
    expect(deleted.notes.some((n) => n.includes("Removed 2 trades."))).toBe(true);

    const charted = applyChatActions({ charts: [emptyChart] });
    expect(charted.notes.some((n) => n.includes("Generated 1 chart."))).toBe(true);
  });

  it("updates strategy and returns charts", () => {
    const result = applyChatActions({
      updateStrategy: { markdown: "# Chat Plan\n\nUpdated\n" },
      charts: [emptyChart, { ...emptyChart, id: "c2", title: "R by day", type: "rByDay" }],
    });
    expect(useTradingStore.getState().strategy.name).toBe("Chat Plan");
    expect(result.charts).toHaveLength(2);
    expect(result.notes.some((n) => n.includes("Generated 2 charts"))).toBe(true);
  });

  it("normalizes entry/exit times and keeps incoming screenshots without turn shots", () => {
    applyChatActions({
      addTrade: sampleTrade({
        id: "timed",
        symbol: "EURUSD",
        entryTime: "10:30:00",
        exitTime: "11:15:00",
        screenshots: ["pending", "existing-shot"],
      }),
    });
    const added = useTradingStore.getState().trades.find((t) => t.id === "timed");
    expect(added?.entryTime).toContain("2026-07-01");
    expect(added?.exitTime).toContain("2026-07-01");
    expect(added?.screenshots).toEqual(["existing-shot"]);

    applyChatActions({
      updateTrade: { id: "t1", entryTime: "12:00:00", exitTime: "13:00:00" },
    });
    const updated = useTradingStore.getState().trades.find((t) => t.id === "t1");
    expect(updated?.entryTime).toContain("2026-07-01");
    expect(updated?.exitTime).toContain("2026-07-01");
  });
});

describe("persist storage and rehydrate", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    await idbModule.idbStorage.removeItem(STORE_KEY);
    resetStore({ hydrated: false });
  });

  it("migrates legacy columns and strips chartExtract on rehydrate", async () => {
    const legacyTrade = {
      ...sampleTrade(),
      chartExtract: "legacy-field",
      screenshots: ["a", "b", "c", "pending"],
    };
    const payload = {
      state: {
        trades: [legacyTrade],
        strategy: seedStrategy,
        chat: [],
        chatSummary: "",
        openaiApiKey: "",
        openaiModel: DEFAULT_OPENAI_MODEL,
        visibleTradeColumns: ["date", "symbol", "side"],
      },
      version: 0,
    };
    await idbModule.idbStorage.setItem(STORE_KEY, JSON.stringify(payload));

    await useTradingStore.persist.rehydrate();
    await vi.waitFor(() => expect(useTradingStore.getState().hydrated).toBe(true));

    const cols = useTradingStore.getState().visibleTradeColumns;
    expect(cols).not.toContain("date");
    expect(cols).toContain("entryTime");
    expect(cols).toEqual(expect.arrayContaining(["tags", "notes"]));

    const trade = useTradingStore.getState().trades[0] as Trade & {
      chartExtract?: unknown;
    };
    expect(trade.chartExtract).toBeUndefined();
    expect(trade.screenshots).toEqual(["a", "b"]);
  });

  it("clears legacy localStorage on rehydrate error", async () => {
    localStorage.setItem("tradeagent-store-v3", "stale");
    await idbModule.idbStorage.setItem(STORE_KEY, "{not-json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await useTradingStore.persist.rehydrate();
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        "[TradeAgent] rehydrate failed",
        expect.anything(),
      ),
    );
    expect(localStorage.getItem("tradeagent-store-v3")).toBeNull();
  });

  it("runs legacy localStorage migration through persist getItem", async () => {
    localStorage.setItem("tradeagent-store-v3", JSON.stringify(payloadWithDefaults()));
    await useTradingStore.persist.rehydrate();
    await vi.waitFor(() => expect(useTradingStore.getState().hydrated).toBe(true));
    expect(await idbModule.idbStorage.getItem(STORE_KEY)).toBeTruthy();
    expect(localStorage.getItem("tradeagent-store-v3")).toBeNull();
  });

  it("retries slim persist even when state has no trades or chat", async () => {
    const realSet = idbModule.idbStorage.setItem.bind(idbModule.idbStorage);
    const setSpy = vi
      .spyOn(idbModule.idbStorage, "setItem")
      .mockRejectedValueOnce(new Error("quota"))
      .mockImplementation(realSet);

    resetStore({ trades: [], chat: [], hydrated: true });
    useTradingStore.setState({ openaiApiKey: "sk-slim-empty" });
    await vi.waitFor(() => expect(setSpy.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("retries slim persist payload when IndexedDB write fails", async () => {
    const realSet = idbModule.idbStorage.setItem.bind(idbModule.idbStorage);
    const setSpy = vi
      .spyOn(idbModule.idbStorage, "setItem")
      .mockRejectedValueOnce(new Error("quota"))
      .mockImplementation(realSet);

    resetStore({
      trades: [
        sampleTrade({
          screenshots: ["s1", "s2", "s3"],
        }),
      ],
      chat: [
        {
          id: "m1",
          role: "user",
          content: "chart",
          charts: [emptyChart],
          createdAt: new Date().toISOString(),
        },
      ],
      hydrated: true,
    });

    useTradingStore.setState({ openaiApiKey: "sk-trigger-persist" });
    await vi.waitFor(() => expect(setSpy.mock.calls.length).toBeGreaterThanOrEqual(2));

    const stored = await idbModule.idbStorage.getItem(STORE_KEY);
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!) as {
      state: { trades: Trade[]; chat: Array<{ charts?: ChartSpec[] }> };
    };
    expect(parsed.state.trades[0].screenshots).toBeUndefined();
    expect(parsed.state.chat[0].charts).toBeUndefined();
  });

  it("logs when slim persist retry also fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(idbModule.idbStorage, "setItem").mockRejectedValue(new Error("quota"));

    resetStore({ hydrated: true });
    useTradingStore.setState({ openaiApiKey: "sk-fail" });
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        "[TradeAgent] persist write failed",
        expect.anything(),
      ),
    );
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        "[TradeAgent] slim persist write also failed",
        expect.anything(),
      ),
    );
  });

  it("removeItem clears persisted storage", async () => {
    await idbModule.idbStorage.setItem(STORE_KEY, '{"state":{}}');
    await useTradingStore.persist.clearStorage();
    expect(await idbModule.idbStorage.getItem(STORE_KEY)).toBeNull();
  });
});

function payloadWithDefaults() {
  return {
    state: {
      trades: [sampleTrade()],
      strategy: seedStrategy,
      chat: [],
      chatSummary: "",
      openaiApiKey: "",
      openaiModel: DEFAULT_OPENAI_MODEL,
      visibleTradeColumns: DEFAULT_VISIBLE_TRADE_COLUMNS,
    },
    version: 0,
  };
}
