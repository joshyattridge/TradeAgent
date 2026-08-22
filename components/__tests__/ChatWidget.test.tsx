/**
 * @vitest-environment jsdom
 */
import "fake-indexeddb/auto";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildChatProposal } from "@/lib/chat-proposals";
import { MAX_CHAT_ATTACHMENTS } from "@/lib/chat-attachments";
import { DEFAULT_OPENAI_MODEL, DEFAULT_REASONING_EFFORT } from "@/lib/models";
import { seedStrategy, seedTrades } from "@/lib/seed-data";
import { useTradingStore } from "@/lib/store";
import type { ChartSpec, Trade } from "@/lib/types";

const mockStreamAgentLoop = vi.fn();
const mockAppendChatLogTurnIdb = vi.fn().mockResolvedValue("log-key");

vi.mock("@/lib/chat-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat-agent")>();
  return {
    ...actual,
    streamAgentLoop: (...args: unknown[]) => mockStreamAgentLoop(...args),
  };
});

vi.mock("@/lib/chat-log-idb", () => ({
  appendChatLogTurnIdb: (...args: unknown[]) =>
    mockAppendChatLogTurnIdb(...args),
}));

vi.mock("@/components/ChartRenderer", () => ({
  ChartRenderer: ({ chart }: { chart: { id: string } }) => (
    <div data-testid={`chart-${chart.id}`}>{chart.id}</div>
  ),
}));

vi.mock("@/lib/chat-attachments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat-attachments")>();
  return {
    ...actual,
    fileToChatAttachment: vi.fn(),
  };
});

import { ChatWidget } from "@/components/ChatWidget";
import {
  attachmentMeta,
  fileToChatAttachment,
  type ChatAttachment,
} from "@/lib/chat-attachments";

const mockFileToChatAttachment = vi.mocked(fileToChatAttachment);

function sampleTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t-ref",
    date: "2026-07-01",
    symbol: "EURUSD",
    side: "long",
    setup: "1H FVG Continuation",
    entry: 1.1682,
    stop: 1.1658,
    target: 1.173,
    rMultiple: 1.5,
    result: "win",
    entryTime: "2026-07-01T09:30:00Z",
    ...overrides,
  };
}

const sampleChart: ChartSpec = {
  id: "equity-1",
  title: "Equity",
  type: "equity",
  data: [{ label: "Jul 1", value: 1 }],
};

function resetStore(overrides: Partial<ReturnType<typeof useTradingStore.getState>> = {}) {
  useTradingStore.setState({
    trades: seedTrades,
    strategy: seedStrategy,
    chat: [],
    openaiApiKey: "sk-test",
    openaiModel: DEFAULT_OPENAI_MODEL,
    openaiReasoningEffort: DEFAULT_REASONING_EFFORT,
    chatReferencedTradeIds: [],
    pendingProposal: null,
    proposalReviewOpen: false,
    hydrated: true,
    chatLogId: "test-chat-log",
    ...overrides,
  });
}

function mockLoop(events: object[]) {
  mockStreamAgentLoop.mockImplementation(async function* () {
    for (const event of events) yield event;
  });
}

function makeImageAttachment(
  id = "att-img",
  name = "chart.png",
): ChatAttachment {
  return {
    id,
    kind: "image",
    name,
    mime: "image/png",
    dataUrl: "data:image/png;base64,abc",
  };
}

function makeTextAttachment(id = "att-txt"): ChatAttachment {
  return {
    id,
    kind: "text",
    name: "notes.csv",
    mime: "text/csv",
    text: "symbol,side\nEURUSD,long",
  };
}

describe("ChatWidget", () => {
  beforeEach(() => {
    resetStore();
    mockStreamAgentLoop.mockReset();
    mockAppendChatLogTurnIdb.mockReset();
    mockAppendChatLogTurnIdb.mockResolvedValue("log-key");
    mockFileToChatAttachment.mockReset();
    mockFileToChatAttachment.mockImplementation(async (file: File) => {
      if (file.name.endsWith(".csv")) return makeTextAttachment();
      return makeImageAttachment();
    });
    mockLoop([{ type: "done", reply: "OK", actions: {} }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns null when store is not hydrated", () => {
    resetStore({ hydrated: false });
    const { container } = render(<ChatWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it("runs the local agent loop with journal + proxy baseURL", async () => {
    mockLoop([
      { type: "status", message: "Thinking…" },
      { type: "text-delta", text: "Hello " },
      { type: "text-delta", text: "world" },
      { type: "done", reply: "Hello world", actions: {}, llmCalls: [] },
    ]);

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Hi");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByText("Hello world")).toBeInTheDocument();
    });

    expect(mockStreamAgentLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-test",
        baseURL: "/api/openai/v1",
        userText: "Hi",
        model: DEFAULT_OPENAI_MODEL,
      }),
    );
    expect(mockAppendChatLogTurnIdb).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: "Hi",
        reply: "Hello world",
      }),
    );
  });

  it("blocks send without an API key", async () => {
    resetStore({ openaiApiKey: "" });
    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Hi");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(
        screen.getByText(/No OpenAI API key found/),
      ).toBeInTheDocument();
    });
    expect(mockStreamAgentLoop).not.toHaveBeenCalled();
  });

  it("shows tool progress and stream errors", async () => {
    mockLoop([
      {
        type: "tool-start",
        toolCallId: "c1",
        name: "get_stats",
        label: "Computing stats",
      },
      {
        type: "tool-result",
        toolCallId: "c1",
        name: "get_stats",
        label: "Computing stats",
        ok: true,
        detail: "ok",
      },
      { type: "error", reply: "OpenAI error: boom", llmCalls: [] },
    ]);

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Stats");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByText("OpenAI error: boom")).toBeInTheDocument();
    });
    expect(mockAppendChatLogTurnIdb).toHaveBeenCalledWith(
      expect.objectContaining({ error: "OpenAI error: boom" }),
    );
  });

  it("survives agent loop throw", async () => {
    mockStreamAgentLoop.mockImplementation(async function* () {
      throw new Error("network down");
    });

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Hi");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(
        screen.getByText(/Couldn't reach the AI endpoint: network down/),
      ).toBeInTheDocument();
    });
  });

  it("applies chart actions from done events", async () => {
    mockLoop([
      {
        type: "done",
        reply: "Chart ready.",
        actions: { charts: [sampleChart] },
      },
    ]);

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "equity");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByTestId("chart-equity-1")).toBeInTheDocument();
    });
  });

  it("opens a proposal for journal mutations", async () => {
    mockLoop([
      {
        type: "done",
        reply: "Proposed trade.",
        actions: {
          addTrade: {
            date: "2026-08-01",
            symbol: "NQ",
            side: "long",
            setup: "breakout",
            entry: 1,
            stop: 0.9,
            target: 1.2,
            rMultiple: 2,
            result: "open",
          },
        },
      },
    ]);

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "log nq");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(useTradingStore.getState().pendingProposal).not.toBeNull();
    });
  });

  it("proposes attaching a turn screenshot to the referenced trade", async () => {
    resetStore({
      trades: [sampleTrade()],
      chatReferencedTradeIds: ["t-ref"],
    });
    mockLoop([
      {
        type: "done",
        reply: "I proposed attaching the screenshot.",
        actions: {},
      },
    ]);
    const user = userEvent.setup();
    render(<ChatWidget />);
    mockFileToChatAttachment.mockResolvedValueOnce(
      makeImageAttachment("img-1", "chart.png"),
    );
    const fileInput = document.querySelector(
      'input[type="file"][hidden]',
    ) as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(["img"], "chart.png", { type: "image/png" }),
    );
    await waitFor(() => {
      expect(screen.getByAltText("chart.png")).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText("Message TradeAgent"), "attach this");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      const proposal = useTradingStore.getState().pendingProposal;
      expect(proposal).not.toBeNull();
      expect(proposal?.changes[0]).toMatchObject({
        kind: "update",
        id: "t-ref",
      });
    });
  });

  it("sends referenced trade prefix and clears the pin", async () => {
    resetStore({
      trades: [sampleTrade()],
      chatReferencedTradeIds: ["t-ref"],
    });
    mockLoop([{ type: "done", reply: "Seen.", actions: {} }]);

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "partials?");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(mockStreamAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          userText: expect.stringContaining("[Referenced trade:"),
          referencedTradeIds: ["t-ref"],
        }),
      );
    });
    expect(useTradingStore.getState().chatReferencedTradeIds).toEqual([]);
  });

  it("sends multiple referenced trades in one message", async () => {
    resetStore({
      trades: [
        sampleTrade({ id: "t-a", symbol: "EURUSD" }),
        sampleTrade({
          id: "t-b",
          symbol: "GBPUSD",
          side: "short",
          date: "2026-07-02",
        }),
      ],
      chatReferencedTradeIds: ["t-a", "t-b"],
    });
    mockLoop([{ type: "done", reply: "Compared.", actions: {} }]);

    const user = userEvent.setup();
    render(<ChatWidget />);
    expect(screen.getByLabelText("Remove trade reference EURUSD")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove trade reference GBPUSD")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Message TradeAgent"), "compare these");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(mockStreamAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          userText: expect.stringContaining("[Referenced trades:"),
          referencedTradeIds: ["t-a", "t-b"],
        }),
      );
    });
    expect(useTradingStore.getState().chatReferencedTradeIds).toEqual([]);
  });

  it("sends a default prompt when only multiple trade refs are pinned", async () => {
    resetStore({
      trades: [
        sampleTrade({ id: "t-a", symbol: "EURUSD" }),
        sampleTrade({ id: "t-b", symbol: "GBPUSD", side: "short" }),
      ],
      chatReferencedTradeIds: ["t-a", "t-b"],
    });
    mockLoop([{ type: "done", reply: "Noted.", actions: {} }]);

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(mockStreamAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          userText: expect.stringContaining("Regarding these trades."),
          referencedTradeIds: ["t-a", "t-b"],
        }),
      );
    });
  });

  it("submits attachments-only messages", async () => {
    mockLoop([{ type: "done", reply: "Got file.", actions: {} }]);
    const user = userEvent.setup();
    render(<ChatWidget />);

    mockFileToChatAttachment.mockResolvedValueOnce(makeTextAttachment());
    const fileInput = document.querySelector(
      'input[type="file"][hidden]',
    ) as HTMLInputElement;
    await user.upload(fileInput, new File(["a"], "data.csv", { type: "text/csv" }));
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByText("Got file.")).toBeInTheDocument();
    });
    expect(mockStreamAgentLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: "Review the attached file(s).",
        attachments: expect.any(Array),
      }),
    );
  });

  it("expands on input focus when chat has history and collapses via close", async () => {
    resetStore({
      chat: [
        {
          id: "m1",
          role: "user",
          content: "Hello",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    const user = userEvent.setup();
    render(<ChatWidget />);

    expect(screen.queryByText("Hello")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Message TradeAgent"));
    expect(screen.getByText("Hello")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Close chat"));
    expect(screen.queryByText("Hello")).not.toBeInTheDocument();
  });

  it("clears chat from the panel", async () => {
    resetStore({
      trades: [sampleTrade()],
      chatReferencedTradeIds: ["t-ref"],
      chat: [
        {
          id: "m1",
          role: "assistant",
          content: "Old message",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    mockFileToChatAttachment.mockResolvedValueOnce(
      makeImageAttachment("keep-1", "shot.png"),
    );
    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.click(screen.getByLabelText("Message TradeAgent"));
    expect(screen.getByText("Old message")).toBeInTheDocument();

    const fileInput = document.querySelector(
      'input[type="file"][hidden]',
    ) as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(["img"], "shot.png", { type: "image/png" }),
    );
    await waitFor(() => {
      expect(screen.getByAltText("shot.png")).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText("Clear chat"));
    expect(useTradingStore.getState().chat).toHaveLength(0);
    expect(screen.queryByText("Old message")).not.toBeInTheDocument();
    expect(useTradingStore.getState().chatReferencedTradeIds).toEqual(["t-ref"]);
    expect(screen.getByAltText("shot.png")).toBeInTheDocument();
  });

  it("handles attach errors and max attachments", async () => {
    mockFileToChatAttachment.mockRejectedValueOnce(new Error("bad file"));
    const user = userEvent.setup();
    render(<ChatWidget />);
    const fileInput = document.querySelector(
      'input[type="file"][hidden]',
    ) as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(["x"], "bad.bin", { type: "application/octet-stream" }),
    );
    await waitFor(() => {
      expect(screen.getByText("bad file")).toBeInTheDocument();
    });

    mockFileToChatAttachment.mockResolvedValue(makeImageAttachment());
    for (let i = 0; i < MAX_CHAT_ATTACHMENTS; i++) {
      mockFileToChatAttachment.mockResolvedValueOnce(
        makeImageAttachment(`a${i}`, `c${i}.png`),
      );
      await user.upload(
        fileInput,
        new File([`img${i}`], `c${i}.png`, { type: "image/png" }),
      );
    }
    await waitFor(() => {
      expect(screen.getByAltText("c0.png")).toBeInTheDocument();
    });
    await user.upload(
      fileInput,
      new File(["extra"], "extra.png", { type: "image/png" }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(`Max ${MAX_CHAT_ATTACHMENTS} attachments per message`),
      ).toBeInTheDocument();
    });
    void attachmentMeta;
  });

  it("expands when a proposal is pending", async () => {
    const proposal = buildChatProposal({
      actions: {
        updateTrade: { id: "t1", notes: "x" },
      },
      trades: [sampleTrade({ id: "t1" })],
      strategy: seedStrategy,
    });
    resetStore({
      trades: [sampleTrade({ id: "t1" })],
      pendingProposal: proposal,
      proposalReviewOpen: true,
    });
    render(<ChatWidget />);
    expect(screen.getByLabelText("TradeAgent chat")).toBeInTheDocument();
  });

  it("uses accumulated text when the loop ends without done", async () => {
    mockLoop([
      { type: "status", message: "Working" },
      { type: "text-delta", text: "Partial only" },
    ]);
    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Go");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(screen.getByText("Partial only")).toBeInTheDocument();
    });
  });

  it("survives chat log write failures", async () => {
    mockAppendChatLogTurnIdb.mockRejectedValue(new Error("idb full"));
    mockLoop([{ type: "done", reply: "Still ok", actions: {} }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Hi");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(screen.getByText("Still ok")).toBeInTheDocument();
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("shows tool error state", async () => {
    mockLoop([
      {
        type: "tool-start",
        toolCallId: "c1",
        name: "query_trades",
        label: "Searching trades",
      },
      {
        type: "tool-result",
        toolCallId: "c1",
        name: "query_trades",
        label: "Searching trades",
        ok: false,
        detail: "failed",
      },
      { type: "done", reply: "Could not search.", actions: {} },
    ]);
    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "find");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(screen.getByText("Could not search.")).toBeInTheDocument();
    });
  });

  it("drag-drop attaches files when expanded", async () => {
    mockFileToChatAttachment.mockResolvedValueOnce(
      makeImageAttachment("drop-1", "shot.png"),
    );
    render(<ChatWidget />);
    const shell = screen.getByLabelText("TradeAgent chat");
    const file = new File(["a"], "shot.png", { type: "image/png" });
    fireEvent.dragEnter(shell, {
      dataTransfer: { types: ["Files"], files: [file] },
    });
    fireEvent.drop(shell, {
      dataTransfer: { types: ["Files"], files: [file] },
    });
    await waitFor(() => {
      expect(mockFileToChatAttachment).toHaveBeenCalled();
      expect(screen.getByAltText("shot.png")).toBeInTheDocument();
    });
  });

  it("pointer outside closes the expanded chat", async () => {
    resetStore({
      chat: [
        {
          id: "m1",
          role: "user",
          content: "Outside test",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">Outside</button>
        <ChatWidget />
      </div>,
    );
    await user.click(screen.getByLabelText("Message TradeAgent"));
    expect(screen.getByText("Outside test")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByText("Outside test")).not.toBeInTheDocument();
  });

  it("ignores outside pointerdown when target is not a Node", async () => {
    resetStore({
      chat: [
        {
          id: "m1",
          role: "user",
          content: "Stay open",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.click(screen.getByLabelText("Message TradeAgent"));
    expect(screen.getByText("Stay open")).toBeInTheDocument();

    const event = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: {} });
    document.dispatchEvent(event);

    expect(screen.getByText("Stay open")).toBeInTheDocument();
  });

  it("clears a stale trade reference and focuses for pending proposals", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const proposal = buildChatProposal({
      actions: { updateTrade: { id: "t1", notes: "x" } },
      trades: [sampleTrade({ id: "t1" })],
      strategy: seedStrategy,
    });
    resetStore({
      trades: [sampleTrade({ id: "t1" })],
      chatReferencedTradeIds: ["missing"],
      pendingProposal: proposal,
    });
    render(<ChatWidget />);
    expect(useTradingStore.getState().chatReferencedTradeIds).toEqual([]);
    await vi.runAllTimersAsync();
    expect(screen.getByLabelText("TradeAgent chat")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("removes attachments, handles paste, and input drop", async () => {
    const user = userEvent.setup();
    render(<ChatWidget />);
    const shell = screen.getByLabelText("TradeAgent chat");
    const fileInput = document.querySelector(
      'input[type="file"][hidden]',
    ) as HTMLInputElement;

    mockFileToChatAttachment.mockResolvedValueOnce(
      makeImageAttachment("img-1", "chart.png"),
    );
    await user.upload(
      fileInput,
      new File(["img"], "chart.png", { type: "image/png" }),
    );
    await waitFor(() => {
      expect(screen.getByAltText("chart.png")).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText("Remove chart.png"));
    expect(screen.queryByAltText("chart.png")).not.toBeInTheDocument();

    mockFileToChatAttachment.mockResolvedValueOnce({
      id: "file-1",
      kind: "file",
      name: "report.pdf",
      mime: "application/pdf",
      dataUrl: "data:application/pdf;base64,xyz",
    });
    await user.upload(
      fileInput,
      new File(["pdf"], "report.pdf", { type: "application/pdf" }),
    );
    await waitFor(() => {
      expect(screen.getByText("report.pdf")).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText("Remove report.pdf"));

    mockFileToChatAttachment.mockRejectedValueOnce("not an error object");
    await user.upload(
      fileInput,
      new File(["x"], "weird.bin", { type: "application/octet-stream" }),
    );
    await waitFor(() => {
      expect(screen.getByText("Could not attach weird.bin")).toBeInTheDocument();
    });

    fireEvent.dragEnter(shell, {
      dataTransfer: { types: ["Files"], files: [] },
    });
    fireEvent.dragEnter(shell, {
      dataTransfer: { types: ["Files"], files: [] },
    });
    expect(screen.getByText("Drop files to attach")).toBeInTheDocument();
    fireEvent.dragOver(shell, {
      dataTransfer: { types: ["Files"], files: [], dropEffect: "none" },
    });
    fireEvent.dragLeave(shell, {
      dataTransfer: { types: ["Files"], files: [] },
    });
    fireEvent.dragLeave(shell, {
      dataTransfer: { types: ["Files"], files: [] },
    });

    const input = screen.getByLabelText("Message TradeAgent");
    mockFileToChatAttachment.mockResolvedValueOnce(makeTextAttachment("paste"));
    fireEvent.paste(input, {
      clipboardData: {
        files: [new File(["p"], "paste.csv", { type: "text/csv" })],
      },
    });
    await waitFor(() => {
      expect(screen.getByText("notes.csv")).toBeInTheDocument();
    });

    fireEvent.dragOver(input, {
      dataTransfer: { types: ["Files"], dropEffect: "none" },
    });
    mockFileToChatAttachment.mockResolvedValueOnce(
      makeImageAttachment("input-drop", "input.png"),
    );
    fireEvent.drop(input, {
      dataTransfer: {
        types: ["Files"],
        files: [new File(["i"], "input.png", { type: "image/png" })],
      },
    });
    await waitFor(() => {
      expect(screen.getByAltText("input.png")).toBeInTheDocument();
    });
  });

  it("ignores drag-drop while loading", async () => {
    mockStreamAgentLoop.mockImplementation(async function* () {
      yield { type: "status", message: "Thinking…" };
      await new Promise(() => {
        /* hang */
      });
    });
    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Loading");
    await user.click(screen.getByLabelText("Send message"));

    const shell = screen.getByLabelText("TradeAgent chat");
    const input = screen.getByLabelText("Message TradeAgent");
    mockFileToChatAttachment.mockClear();
    fireEvent.drop(shell, {
      dataTransfer: {
        types: ["Files"],
        files: [new File(["x"], "blocked.png", { type: "image/png" })],
      },
    });
    fireEvent.drop(input, {
      dataTransfer: {
        types: ["Files"],
        files: [new File(["y"], "blocked2.png", { type: "image/png" })],
      },
    });
    expect(mockFileToChatAttachment).not.toHaveBeenCalled();
  });

  it("builds charts from chartRequests and clears a no-op proposal", async () => {
    const proposal = buildChatProposal({
      actions: {
        addTrade: {
          date: "2026-07-03",
          symbol: "XAUUSD",
          side: "long",
          setup: "FVG",
          entry: 2400,
          stop: 2390,
          target: 2420,
          rMultiple: 2,
          result: "win",
        },
      },
      trades: seedTrades,
      strategy: seedStrategy,
    });
    resetStore({ pendingProposal: proposal });

    const proposals = await import("@/lib/chat-proposals");
    vi.spyOn(proposals, "resolvePendingProposalUpdate").mockReturnValue({
      chartActions: {},
      nextProposal: null,
      clearPending: true,
    });

    mockLoop([
      {
        type: "done",
        reply: "No real changes.",
        actions: {
          updateTrade: { id: "t1", notes: "same" },
          chartRequests: [{ type: "equity" }],
        },
      },
    ]);

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.click(
      screen.getByRole("button", { name: /Pending review/i }),
    );
    expect(useTradingStore.getState().proposalReviewOpen).toBe(true);

    await user.type(screen.getByLabelText("Message TradeAgent"), "ignore");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByText("No real changes.")).toBeInTheDocument();
    });
    expect(useTradingStore.getState().pendingProposal).toBeNull();
    expect(document.querySelector(".chat-chart")).toBeTruthy();
  });

  it("renders history images, files, tools and referenced-trade-only send", async () => {
    resetStore({
      trades: [sampleTrade({ id: "t-ref", entryTime: undefined })],
      chatReferencedTradeIds: ["t-ref"],
      chat: [
        {
          id: "h1",
          role: "user",
          content: "Prior",
          createdAt: new Date().toISOString(),
          images: ["data:image/png;base64,abc"],
          files: [{ name: "log.csv", mime: "text/csv" }],
        },
        {
          id: "h2",
          role: "assistant",
          content: "Answer",
          createdAt: new Date().toISOString(),
          agentMessages: [
            {
              role: "assistant",
              content: [
                {
                  type: "tool-call",
                  toolName: "query_trades",
                  toolCallId: "x",
                  input: {},
                },
              ],
            },
          ],
        },
      ],
    });
    mockLoop([{ type: "done", reply: "Regarding noted.", actions: {} }]);
    const user = userEvent.setup();
    render(<ChatWidget />);
    expect(screen.getByText("Prior")).toBeInTheDocument();
    expect(screen.getByAltText("Uploaded chart")).toBeInTheDocument();
    expect(screen.getByText("log.csv")).toBeInTheDocument();
    expect(screen.getByText(/Used 1 tool/)).toBeInTheDocument();

    await user.click(screen.getByLabelText("Remove trade reference EURUSD"));
    expect(useTradingStore.getState().chatReferencedTradeIds).toEqual([]);

    useTradingStore.setState({ chatReferencedTradeIds: ["t-ref"] });
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(mockStreamAgentLoop).toHaveBeenCalledWith(
        expect.objectContaining({
          userText: expect.stringContaining("Regarding this trade."),
        }),
      );
    });
  });

  it("expands via attach when history exists and logs stream errors", async () => {
    resetStore({
      chat: [
        {
          id: "m1",
          role: "user",
          content: "Hi",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    mockAppendChatLogTurnIdb.mockRejectedValueOnce(new Error("idb full"));
    mockLoop([
      {
        type: "tool-start",
        toolCallId: "c1",
        name: "get_stats",
        label: "Computing stats",
      },
      {
        type: "tool-result",
        toolCallId: "c1",
        name: "get_stats",
        label: "Computing stats",
        ok: true,
        detail: "ok",
      },
      { type: "error", reply: "boom", llmCalls: [] },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.click(screen.getByLabelText("Attach file"));
    expect(screen.getByText("Hi")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Message TradeAgent"), "fail");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(screen.getByText(/boom|OpenAI|error/i)).toBeInTheDocument();
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("survives done-path chat log failures and empty paste", async () => {
    mockAppendChatLogTurnIdb.mockRejectedValue(new Error("idb full"));
    mockLoop([{ type: "done", reply: "Logged fail ok", actions: {} }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<ChatWidget />);
    const input = screen.getByLabelText("Message TradeAgent");
    fireEvent.paste(input, { clipboardData: { files: [] } });
    await user.type(input, "Hi");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(screen.getByText("Logged fail ok")).toBeInTheDocument();
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("sends image attachments and ignores non-file drag events", async () => {
    mockLoop([{ type: "done", reply: "Saw image", actions: {} }]);
    const user = userEvent.setup();
    render(<ChatWidget />);
    const shell = screen.getByLabelText("TradeAgent chat");
    const input = screen.getByLabelText("Message TradeAgent");
    const fileInput = document.querySelector(
      'input[type="file"][hidden]',
    ) as HTMLInputElement;

    fireEvent.dragEnter(shell, { dataTransfer: { types: ["text/plain"], files: [] } });
    fireEvent.dragOver(shell, { dataTransfer: { types: ["text/plain"], files: [] } });
    fireEvent.dragLeave(shell, { dataTransfer: { types: ["text/plain"], files: [] } });
    fireEvent.dragOver(input, { dataTransfer: { types: ["text/plain"] } });
    fireEvent.drop(input, {
      dataTransfer: { types: ["text/plain"], files: [] },
    });
    fireEvent.change(fileInput, { target: { files: null } });
    fireEvent.drop(shell, {
      dataTransfer: { types: ["Files"], files: [] },
    });

    mockFileToChatAttachment.mockResolvedValueOnce(
      makeImageAttachment("send-img", "shot.png"),
    );
    await user.upload(
      fileInput,
      new File(["img"], "shot.png", { type: "image/png" }),
    );
    await waitFor(() => {
      expect(screen.getByAltText("shot.png")).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(screen.getByText("Saw image")).toBeInTheDocument();
    });
    expect(mockStreamAgentLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        images: expect.arrayContaining([expect.stringContaining("data:image")]),
      }),
    );
  });

  it("falls back to Done. and shows plural tool counts", async () => {
    mockLoop([
      {
        type: "tool-start",
        toolCallId: "a",
        name: "query_trades",
        label: "Search A",
      },
      {
        type: "tool-start",
        toolCallId: "b",
        name: "get_stats",
        label: "Stats B",
      },
      {
        type: "tool-result",
        toolCallId: "a",
        name: "query_trades",
        label: "Search A",
        ok: true,
      },
      {
        type: "tool-result",
        toolCallId: "b",
        name: "get_stats",
        label: "Stats B",
        ok: true,
        detail: "n=1",
      },
      {
        type: "done",
        reply: "   ",
        agentMessages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "a",
                toolName: "query_trades",
                input: {},
              },
              {
                type: "tool-call",
                toolCallId: "b",
                toolName: "get_stats",
                input: {},
              },
            ],
          },
        ],
      },
    ]);
    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "go");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(screen.getByText("Done.")).toBeInTheDocument();
    });
    expect(screen.getByText(/Used 2 tools/)).toBeInTheDocument();
  });

  it("logs failure when stream ends with text only", async () => {
    mockAppendChatLogTurnIdb.mockRejectedValue(new Error("idb full"));
    mockLoop([
      { type: "status", message: "Working" },
      { type: "text-delta", text: "Partial only path" },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Go");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(screen.getByText("Partial only path")).toBeInTheDocument();
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("expands attach for referenced trade and empty-content history", async () => {
    resetStore({
      trades: [sampleTrade()],
      chatReferencedTradeIds: ["t-ref"],
      chat: [
        {
          id: "empty",
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          charts: [sampleChart],
        },
      ],
    });
    const user = userEvent.setup();
    render(<ChatWidget />);
    expect(screen.getByTestId("chart-equity-1")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Attach file"));
    expect(screen.getByLabelText("Remove trade reference EURUSD")).toBeInTheDocument();
  });

  it("covers empty submit, loading guard, attach expand edges, and running tools", async () => {
    const user = userEvent.setup();
    render(<ChatWidget />);

    // Empty form submit hits the early return
    fireEvent.submit(screen.getByLabelText("Message TradeAgent").closest("form")!);

    // Attach with no history does not expand via the history branch
    await user.click(screen.getByLabelText("Attach file"));

    // Pending-only expand path on attach
    mockFileToChatAttachment.mockResolvedValueOnce(
      makeImageAttachment("pend", "p.png"),
    );
    await user.upload(
      document.querySelector('input[type="file"][hidden]') as HTMLInputElement,
      new File(["p"], "p.png", { type: "image/png" }),
    );
    await waitFor(() => {
      expect(screen.getByAltText("p.png")).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText("Attach file"));

    // Input drop with Files type but empty list
    fireEvent.drop(screen.getByLabelText("Message TradeAgent"), {
      dataTransfer: { types: ["Files"], files: [] },
    });

    // Hang after tool-start so running label renders; second submit ignored while loading
    mockStreamAgentLoop.mockImplementation(async function* () {
      yield {
        type: "tool-start",
        toolCallId: "run1",
        name: "query_trades",
        label: "Searching",
      };
      await new Promise(() => {
        /* hang */
      });
    });
    await user.clear(screen.getByLabelText("Message TradeAgent"));
    await user.type(screen.getByLabelText("Message TradeAgent"), "search");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(screen.getByText("Searching…")).toBeInTheDocument();
    });
    fireEvent.submit(screen.getByLabelText("Message TradeAgent").closest("form")!);
  });

  it("ignores stream events that do not match handled shapes", async () => {
    mockLoop([
      { type: "status" },
      { type: "text-delta" },
      { type: "done", reply: "After noise" },
    ]);
    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "hi");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(screen.getByText("After noise")).toBeInTheDocument();
    });
  });
});
