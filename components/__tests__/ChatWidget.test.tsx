/**
 * @vitest-environment jsdom
 */
import "fake-indexeddb/auto";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatWidget } from "@/components/ChatWidget";
import { buildChatProposal } from "@/lib/chat-proposals";
import { MAX_CHAT_ATTACHMENTS } from "@/lib/chat-attachments";
import { DEFAULT_OPENAI_MODEL, DEFAULT_REASONING_EFFORT } from "@/lib/models";
import { seedStrategy, seedTrades } from "@/lib/seed-data";
import { useTradingStore } from "@/lib/store";
import type { ChartSpec, Trade } from "@/lib/types";

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
    chatReferencedTradeId: null,
    pendingProposal: null,
    proposalReviewOpen: false,
    hydrated: true,
    ...overrides,
  });
}

function ndjsonResponse(lines: object[]) {
  const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

function jsonResponse(data: object) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
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
    mockFileToChatAttachment.mockReset();
    mockFileToChatAttachment.mockImplementation(async (file: File) => {
      if (file.name.endsWith(".csv")) return makeTextAttachment();
      return makeImageAttachment();
    });
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

  it("collapses when pointerdown outside the chat shell", async () => {
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

  it("submits text and handles NDJSON streaming events", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ndjsonResponse([
        { type: "status", message: "Analyzing journal…" },
        { type: "text-delta", text: "Here is " },
        { type: "text-delta", text: "your curve." },
        {
          type: "tool-start",
          toolCallId: "tc1",
          name: "buildChart",
          label: "Building chart",
        },
        {
          type: "tool-result",
          toolCallId: "tc1",
          name: "buildChart",
          label: "Building chart",
          ok: true,
          detail: "equity curve",
        },
        {
          type: "done",
          reply: "Here is your curve.",
          actions: { charts: [sampleChart] },
        },
      ]),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);

    await user.type(screen.getByLabelText("Message TradeAgent"), "Show equity");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/chat",
        expect.objectContaining({ method: "POST" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Here is your curve.")).toBeInTheDocument();
      expect(screen.getByTestId("chart-equity-1")).toBeInTheDocument();
    });

    const chat = useTradingStore.getState().chat;
    expect(chat.some((m) => m.role === "user" && m.content === "Show equity")).toBe(
      true,
    );
    expect(chat.some((m) => m.role === "assistant" && m.content.includes("curve"))).toBe(
      true,
    );
  });

  it("handles JSON non-stream responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ reply: "Add your API key in Settings." }),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);

    await user.type(screen.getByLabelText("Message TradeAgent"), "Hi");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByText("Add your API key in Settings.")).toBeInTheDocument();
    });
  });

  it("handles stream error events and missing response body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      ndjsonResponse([
        { type: "error", reply: "Model not found." },
      ]),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Bad model");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByText("Model not found.")).toBeInTheDocument();
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        headers: { "Content-Type": "application/x-ndjson" },
      }),
    );

    await user.type(screen.getByLabelText("Message TradeAgent"), "No body");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(
        screen.getByText(/Couldn't reach the AI endpoint/),
      ).toBeInTheDocument();
    });
  });

  it("flushes trailing done buffer from stream tail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ type: "done", reply: "Trailing done." }) + "\n",
        { headers: { "Content-Type": "application/x-ndjson" } },
      ),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Trail");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByText("Trailing done.")).toBeInTheDocument();
    });
  });

  it("handles trailing buffer error and invalid JSON lines", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ type: "error", reply: "Buffer error." }),
        { headers: { "Content-Type": "application/x-ndjson" } },
      ),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Buf err");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByText("Buffer error.")).toBeInTheDocument();
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("not-json\n", {
        headers: { "Content-Type": "application/x-ndjson" },
      }),
    );

    await user.type(screen.getByLabelText("Message TradeAgent"), "Bad json");
    await user.click(screen.getByLabelText("Send message"));
  });

  it("shows tool error state and agent tool counts on messages", async () => {
    resetStore({
      chat: [
        {
          id: "a1",
          role: "assistant",
          content: "Used tools",
          createdAt: new Date().toISOString(),
          agentMessages: [
            {
              role: "assistant",
              content: [
                { type: "tool-call", toolCallId: "x", toolName: "t", args: {} },
                { type: "tool-call", toolCallId: "y", toolName: "t2", args: {} },
              ],
            },
          ],
        },
        {
          id: "u1",
          role: "user",
          content: "With files",
          createdAt: new Date().toISOString(),
          images: ["data:image/png;base64,img"],
          files: [attachmentMeta(makeTextAttachment())],
        },
      ],
    });

    let resolveFetch!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);

    await user.click(screen.getByLabelText("Message TradeAgent"));
    expect(screen.getByText("Used 2 tools this turn")).toBeInTheDocument();
    expect(screen.getByAltText("Uploaded chart")).toBeInTheDocument();
    expect(screen.getByText("notes.csv")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Message TradeAgent"), "Update");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByText("Thinking…")).toBeInTheDocument();
    });

    resolveFetch(
      ndjsonResponse([
        {
          type: "tool-start",
          toolCallId: "tc2",
          name: "updateTrade",
          label: "Updating trade",
        },
        {
          type: "tool-result",
          toolCallId: "tc2",
          name: "updateTrade",
          label: "Updating trade",
          ok: false,
          detail: "Trade missing",
        },
        { type: "done", reply: "Could not update." },
      ]),
    );

    await waitFor(() => {
      expect(screen.getByText("Could not update.")).toBeInTheDocument();
    });
  });

  it("adds, removes, and limits attachments including drag-drop and paste", async () => {
    const user = userEvent.setup();
    render(<ChatWidget />);

    const shell = screen.getByLabelText("TradeAgent chat");
    const fileInput = document.querySelector(
      'input[type="file"][hidden]',
    ) as HTMLInputElement;

    await user.click(screen.getByLabelText("Attach file"));
    const imgFile = new File(["img"], "chart.png", { type: "image/png" });
    await user.upload(fileInput, imgFile);

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

    mockFileToChatAttachment.mockRejectedValueOnce(new Error("File too large"));
    await user.upload(fileInput, imgFile);
    await waitFor(() => {
      expect(screen.getByText("File too large")).toBeInTheDocument();
    });

    mockFileToChatAttachment.mockImplementation(async () => makeImageAttachment());
    for (let i = 0; i < MAX_CHAT_ATTACHMENTS; i++) {
      mockFileToChatAttachment.mockResolvedValueOnce(
        makeImageAttachment(`att-${i}`),
      );
    }
    await user.upload(
      fileInput,
      Array.from({ length: MAX_CHAT_ATTACHMENTS }, (_, i) =>
        new File(["x"], `f${i}.png`, { type: "image/png" }),
      ),
    );

    await waitFor(() => {
      expect(screen.getAllByRole("img").length).toBeGreaterThanOrEqual(
        MAX_CHAT_ATTACHMENTS,
      );
    });

    mockFileToChatAttachment.mockClear();
    await user.upload(
      fileInput,
      new File(["extra"], "extra.png", { type: "image/png" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(`Max ${MAX_CHAT_ATTACHMENTS} attachments per message`),
      ).toBeInTheDocument();
    });

    fireEvent.dragEnter(shell, {
      dataTransfer: { types: ["Files"], files: [] },
    });
    expect(screen.getByText("Drop files to attach")).toBeInTheDocument();

    fireEvent.dragLeave(shell, {
      dataTransfer: { types: ["Files"], files: [] },
    });

    const dropFile = new File(["d"], "drop.png", { type: "image/png" });
    mockFileToChatAttachment.mockResolvedValueOnce(makeImageAttachment("drop"));
    fireEvent.drop(shell, { dataTransfer: { files: [dropFile] } });

    const input = screen.getByLabelText("Message TradeAgent");
    const pasteFile = new File(["p"], "paste.csv", { type: "text/csv" });
    mockFileToChatAttachment.mockResolvedValueOnce(makeTextAttachment("paste"));
    fireEvent.paste(input, {
      clipboardData: { files: [pasteFile] },
    });

    fireEvent.dragOver(input, {
      dataTransfer: { types: ["Files"] },
    });
    mockFileToChatAttachment.mockResolvedValueOnce(makeImageAttachment("input-end"));
    fireEvent.drop(input, {
      dataTransfer: {
        types: ["Files"],
        files: [new File(["i"], "input.png", { type: "image/png" })],
      },
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("ignores drag while loading and disables attach at max", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);

    await user.type(screen.getByLabelText("Message TradeAgent"), "Loading");
    await user.click(screen.getByLabelText("Send message"));

    const shell = screen.getByLabelText("TradeAgent chat");
    fireEvent.dragEnter(shell, {
      dataTransfer: { types: ["Files"], files: [] },
    });
    expect(screen.queryByText("Drop files to attach")).not.toBeInTheDocument();

    const fileInput = document.querySelector(
      'input[type="file"][hidden]',
    ) as HTMLInputElement;
    for (let i = 0; i < MAX_CHAT_ATTACHMENTS; i++) {
      mockFileToChatAttachment.mockResolvedValueOnce(
        makeImageAttachment(`full-${i}`),
      );
    }
    await user.upload(
      fileInput,
      Array.from({ length: MAX_CHAT_ATTACHMENTS }, (_, i) =>
        new File(["x"], `max${i}.png`, { type: "image/png" }),
      ),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Attach file")).toBeDisabled();
    });
  });

  it("handles referenced trade submit, removal, and stale pin cleanup", async () => {
    const trade = sampleTrade();
    resetStore({
      trades: [trade],
      chatReferencedTradeId: trade.id,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ndjsonResponse([{ type: "done", reply: "Trade reviewed." }]),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);

    expect(screen.getByText(/EURUSD long/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Ask about this trade…")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Remove trade reference"));
    expect(useTradingStore.getState().chatReferencedTradeId).toBeNull();

    useTradingStore.setState({ chatReferencedTradeId: trade.id });
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(
        useTradingStore.getState().chat.some((m) =>
          m.content.includes("Referenced:"),
        ),
      ).toBe(true);
    });

    useTradingStore.setState({ trades: [], chatReferencedTradeId: trade.id });
    await waitFor(() => {
      expect(useTradingStore.getState().chatReferencedTradeId).toBeNull();
    });
  });

  it("expands for pending proposal and opens proposal review chip", async () => {
    const proposal = buildChatProposal({
      actions: {
        addTrade: {
          date: "2026-07-02",
          symbol: "GBPUSD",
          side: "short",
          setup: "FVG",
          entry: 1.25,
          stop: 1.26,
          target: 1.23,
          rMultiple: 1,
          result: "win",
        },
      },
      trades: seedTrades,
      strategy: seedStrategy,
    });

    resetStore({ pendingProposal: proposal! });
    const user = userEvent.setup();
    render(<ChatWidget />);

    expect(
      screen.getByRole("button", { name: /Pending review/ }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Pending review/ }));
    expect(useTradingStore.getState().proposalReviewOpen).toBe(true);
  });

  it("clears chat via eraser and guards canSend while loading", async () => {
    resetStore({
      chat: [
        {
          id: "m1",
          role: "assistant",
          content: "Old message",
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const user = userEvent.setup();
    render(<ChatWidget />);

    await user.click(screen.getByLabelText("Message TradeAgent"));
    expect(screen.getByText("Old message")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Clear chat"));
    expect(useTradingStore.getState().chat).toHaveLength(0);
    expect(screen.queryByText("Old message")).not.toBeInTheDocument();

    const sendBtn = screen.getByLabelText("Send message");
    expect(sendBtn).toBeDisabled();

    await user.type(screen.getByLabelText("Message TradeAgent"), "  ");
    expect(sendBtn).toBeDisabled();

    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise(() => {
          /* pending */
        }),
    );

    await user.type(screen.getByLabelText("Message TradeAgent"), "Go");
    await user.click(sendBtn);
    expect(sendBtn).toBeDisabled();
  });

  it("sets pending proposal and chartRequests from done actions", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ndjsonResponse([
        {
          type: "done",
          reply: "Logged trade.",
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
            chartRequests: [{ kind: "equity" as const }],
          },
        },
      ]),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Log it");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(useTradingStore.getState().pendingProposal).not.toBeNull();
      expect(screen.getByText("Logged trade.")).toBeInTheDocument();
    });
  });

  it("clears stale pending proposal when resolvePendingProposalUpdate clears", async () => {
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

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ndjsonResponse([
        {
          type: "done",
          reply: "No changes needed.",
          actions: { updateTrade: { id: "t1", notes: "same" } },
        },
      ]),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Same");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(useTradingStore.getState().pendingProposal).toBeNull();
    });
  });

  it("submits attachments-only message and survives fetch network errors", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));

    const user = userEvent.setup();
    render(<ChatWidget />);

    mockFileToChatAttachment.mockResolvedValueOnce(makeTextAttachment());
    const fileInput = document.querySelector(
      'input[type="file"][hidden]',
    ) as HTMLInputElement;
    await user.upload(fileInput, new File(["a"], "data.csv", { type: "text/csv" }));
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(
        screen.getByText(/Couldn't reach the AI endpoint/),
      ).toBeInTheDocument();
    });
  });

  it("expands when attach is clicked with chat history", async () => {
    resetStore({
      chat: [
        {
          id: "m1",
          role: "user",
          content: "Prior",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.click(screen.getByLabelText("Attach file"));
    expect(screen.getByText("Prior")).toBeInTheDocument();
  });

  it("shows tool failure label and detail while streaming", async () => {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream({
      start(c) {
        controller = c;
        c.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: "tool-start",
              toolCallId: "tc3",
              name: "lookup",
              label: "Looking up trade",
            })}\n${JSON.stringify({
              type: "tool-result",
              toolCallId: "tc3",
              name: "lookup",
              label: "Looking up trade",
              ok: false,
              detail: "Not found",
            })}\n`,
          ),
        );
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson" },
      }),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Tools");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByText("Looking up trade failed")).toBeInTheDocument();
      expect(screen.getByText("Not found")).toBeInTheDocument();
    });

    controller.close();
  });

  it("applies trailing-buffer done event when stream ends mid-line", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ type: "text-delta", text: "Tail " })}\n${JSON.stringify({ type: "done", reply: "Buffered done." })}`,
          ),
        );
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson" },
      }),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Buffer");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByText("Buffered done.")).toBeInTheDocument();
    });
  });

  it("handles trailing-buffer error event", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ type: "error", reply: "Buffered stream error." }),
          ),
        );
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson" },
      }),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Buf");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByText("Buffered stream error.")).toBeInTheDocument();
    });
  });

  it("shows streaming text deltas while loading", async () => {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream({
      start(c) {
        controller = c;
        c.enqueue(
          encoder.encode(
            `${JSON.stringify({ type: "text-delta", text: "Hello " })}\n${JSON.stringify({ type: "text-delta", text: "stream" })}\n`,
          ),
        );
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson" },
      }),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Stream");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByText("Hello stream")).toBeInTheDocument();
    });

    controller.enqueue(
      encoder.encode(`${JSON.stringify({ type: "done", reply: "Hello stream" })}\n`),
    );
    controller.close();
  });

  it("falls back to accumulated stream text when done event is missing", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ type: "text-delta", text: "Partial only" })}\n`,
          ),
        );
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson" },
      }),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Partial");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByText("Partial only")).toBeInTheDocument();
    });
  });

  it("survives addChatMessage failure in error handler", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const original = useTradingStore.getState().addChatMessage;
    let calls = 0;
    useTradingStore.setState({
      addChatMessage: (message) => {
        calls += 1;
        if (calls >= 2) throw new Error("storage full");
        return original(message);
      },
    });

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Fail");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(calls).toBeGreaterThanOrEqual(2);
    });

    useTradingStore.setState({ addChatMessage: original });
  });

  it("focuses input when pending proposal is set", () => {
    vi.useFakeTimers();
    const focusSpy = vi.spyOn(HTMLInputElement.prototype, "focus");
    try {
      const proposal = buildChatProposal({
        actions: {
          addTrade: {
            date: "2026-07-02",
            symbol: "GBPUSD",
            side: "short",
            setup: "FVG",
            entry: 1.25,
            stop: 1.26,
            target: 1.23,
            rMultiple: 1,
            result: "win",
          },
        },
        trades: seedTrades,
        strategy: seedStrategy,
      });
      resetStore({ pendingProposal: proposal! });
      render(<ChatWidget />);
      act(() => {
        vi.advanceTimersByTime(80);
      });
      expect(focusSpy).toHaveBeenCalled();
    } finally {
      focusSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("focuses input when a trade is referenced", () => {
    vi.useFakeTimers();
    const focusSpy = vi.spyOn(HTMLInputElement.prototype, "focus");
    try {
      const trade = sampleTrade();
      resetStore({ trades: [trade], chatReferencedTradeId: trade.id });
      render(<ChatWidget />);
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(focusSpy).toHaveBeenCalled();
    } finally {
      focusSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("formats trade reference label without entryTime", () => {
    const trade = sampleTrade({ entryTime: undefined });
    resetStore({ trades: [trade], chatReferencedTradeId: trade.id });
    render(<ChatWidget />);
    expect(screen.getByText(/EURUSD long · Jul 1, 2026/)).toBeInTheDocument();
  });

  it("expands on attach or focus with only attachments or referenced trade", async () => {
    const trade = sampleTrade();
    const user = userEvent.setup();

    resetStore({ trades: [trade], chatReferencedTradeId: trade.id });
    const withRef = render(<ChatWidget />);
    expect(withRef.container.querySelector(".chat-dock")).toHaveClass("is-expanded");
    await user.click(screen.getByLabelText("Attach file"));
    expect(withRef.container.querySelector(".chat-dock")).toHaveClass("is-expanded");
    withRef.unmount();

    resetStore({
      trades: [trade],
      chatReferencedTradeId: trade.id,
      chat: [],
    });
    const withFocus = render(<ChatWidget />);
    await user.click(screen.getByLabelText("Remove trade reference"));
    await user.click(screen.getByLabelText("Close chat"));
    // collapsed, no pin
    expect(withFocus.container.querySelector(".chat-dock")).not.toHaveClass(
      "is-expanded",
    );
    useTradingStore.setState({ chatReferencedTradeId: trade.id });
    await waitFor(() => {
      expect(withFocus.container.querySelector(".chat-dock")).toHaveClass(
        "is-expanded",
      );
    });
    await user.click(screen.getByLabelText("Remove trade reference"));
    await user.click(screen.getByLabelText("Close chat"));
    await user.click(screen.getByLabelText("Message TradeAgent"));
    expect(withFocus.container.querySelector(".chat-dock")).not.toHaveClass(
      "is-expanded",
    );
    withFocus.unmount();

    resetStore({ chatReferencedTradeId: null, chat: [] });
    const withFiles = render(<ChatWidget />);
    mockFileToChatAttachment.mockResolvedValueOnce(
      makeImageAttachment("solo", "solo.png"),
    );
    const fileInput = document.querySelector(
      'input[type="file"][hidden]',
    ) as HTMLInputElement;
    await user.upload(fileInput, new File(["x"], "solo.png", { type: "image/png" }));
    await waitFor(() => {
      expect(withFiles.container.querySelector(".chat-dock")).toHaveClass(
        "is-expanded",
      );
    });
    await user.click(screen.getByLabelText("Close chat"));
    expect(withFiles.container.querySelector(".chat-dock")).not.toHaveClass(
      "is-expanded",
    );
    await user.click(screen.getByLabelText("Attach file"));
    expect(withFiles.container.querySelector(".chat-dock")).toHaveClass(
      "is-expanded",
    );
  });

  it("ignores empty file batches and non-Error attach failures", async () => {
    const user = userEvent.setup();
    render(<ChatWidget />);
    const fileInput = document.querySelector(
      'input[type="file"][hidden]',
    ) as HTMLInputElement;

    mockFileToChatAttachment.mockClear();
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [],
    });
    fireEvent.change(fileInput);
    expect(mockFileToChatAttachment).not.toHaveBeenCalled();

    mockFileToChatAttachment.mockImplementationOnce(async () => {
      throw "bad file";
    });
    await user.upload(fileInput, new File(["x"], "broken.png", { type: "image/png" }));
    await waitFor(() => {
      expect(screen.getByText("Could not attach broken.png")).toBeInTheDocument();
    });
  });

  it("handles drag events without Files type, nested depth, and drop edge cases", async () => {
    render(<ChatWidget />);
    const shell = screen.getByLabelText("TradeAgent chat");
    const input = screen.getByLabelText("Message TradeAgent");

    fireEvent.dragOver(shell, { dataTransfer: { types: ["text/plain"] } });
    expect(screen.queryByText("Drop files to attach")).not.toBeInTheDocument();

    fireEvent.dragLeave(shell, { dataTransfer: { types: ["text/plain"] } });

    fireEvent.dragEnter(shell, {
      dataTransfer: { types: ["Files"], files: [] },
    });
    fireEvent.dragEnter(shell, {
      dataTransfer: { types: ["Files"], files: [] },
    });
    expect(screen.getByText("Drop files to attach")).toBeInTheDocument();

    fireEvent.dragLeave(shell, {
      dataTransfer: { types: ["Files"], files: [] },
    });
    expect(screen.getByText("Drop files to attach")).toBeInTheDocument();

    fireEvent.dragLeave(shell, {
      dataTransfer: { types: ["Files"], files: [] },
    });
    expect(screen.queryByText("Drop files to attach")).not.toBeInTheDocument();

    mockFileToChatAttachment.mockClear();
    fireEvent.drop(shell, { dataTransfer: { files: [] } });
    expect(mockFileToChatAttachment).not.toHaveBeenCalled();

    fireEvent.drop(input, { dataTransfer: { types: ["text/plain"], files: [] } });

    fireEvent.dragOver(input, { dataTransfer: { types: ["Files"] } });

    mockFileToChatAttachment.mockResolvedValueOnce(
      makeImageAttachment("input-drop", "input-drop.png"),
    );
    fireEvent.drop(input, {
      dataTransfer: {
        types: ["Files"],
        files: [new File(["i"], "input-drop.png", { type: "image/png" })],
      },
    });

    await waitFor(() => {
      expect(screen.getByAltText("input-drop.png")).toBeInTheDocument();
    });
  });

  it("ignores drag-drop on shell and input while loading", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise(() => {
          /* pending */
        }),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Loading");
    await user.click(screen.getByLabelText("Send message"));

    const shell = screen.getByLabelText("TradeAgent chat");
    const input = screen.getByLabelText("Message TradeAgent");

    fireEvent.dragOver(shell, {
      dataTransfer: { types: ["Files"], files: [] },
    });

    mockFileToChatAttachment.mockClear();
    fireEvent.drop(shell, {
      dataTransfer: {
        types: ["Files"],
        files: [new File(["x"], "blocked.png", { type: "image/png" })],
      },
    });
    expect(mockFileToChatAttachment).not.toHaveBeenCalled();

    fireEvent.drop(input, {
      dataTransfer: {
        types: ["Files"],
        files: [new File(["y"], "blocked2.png", { type: "image/png" })],
      },
    });
    expect(mockFileToChatAttachment).not.toHaveBeenCalled();
  });

  it("ignores empty paste events", () => {
    render(<ChatWidget />);
    const input = screen.getByLabelText("Message TradeAgent");
    mockFileToChatAttachment.mockClear();
    fireEvent.paste(input, { clipboardData: { files: [] } });
    expect(mockFileToChatAttachment).not.toHaveBeenCalled();
  });

  it("shows singular tool count, empty content, and streaming tool states", async () => {
    resetStore({
      chat: [
        {
          id: "a1",
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          agentMessages: [
            {
              role: "assistant",
              content: [
                { type: "tool-call", toolCallId: "solo", toolName: "t", args: {} },
              ],
            },
          ],
        },
      ],
    });

    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream({
      start(c) {
        controller = c;
        c.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: "tool-start",
              toolCallId: "run1",
              name: "lookup",
              label: "Running lookup",
            })}\n`,
          ),
        );
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson" },
      }),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.click(screen.getByLabelText("Message TradeAgent"));
    expect(screen.getByText("Used 1 tool this turn")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Message TradeAgent"), "Tools");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByText("Running lookup…")).toBeInTheDocument();
    });

    controller.enqueue(
      encoder.encode(
        `${JSON.stringify({
          type: "tool-result",
          toolCallId: "run1",
          name: "lookup",
          label: "Running lookup",
          ok: true,
        })}\n`,
      ),
    );

    await waitFor(() => {
      expect(screen.getByText("Running lookup")).toBeInTheDocument();
    });

    controller.enqueue(
      encoder.encode(`${JSON.stringify({ type: "done", reply: "Finished." })}\n`),
    );
    controller.close();

    await waitFor(() => {
      expect(screen.getByText("Finished.")).toBeInTheDocument();
    });
  });

  it("uses default replies and handles blank NDJSON lines", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          `${JSON.stringify({ type: "status", message: "Working" })}\n\n   \n${JSON.stringify({ type: "error" })}\n`,
          { headers: { "Content-Type": "application/x-ndjson" } },
        ),
      )
      .mockResolvedValueOnce(
        ndjsonResponse([{ type: "done", reply: "   " }]),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ type: "done", reply: "Tail done." }), {
          headers: { "Content-Type": "application/x-ndjson" },
        }),
      );

    const user = userEvent.setup();
    render(<ChatWidget />);

    await user.type(screen.getByLabelText("Message TradeAgent"), "Err");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(
        screen.getByText('Chat stream error: {"type":"error"}'),
      ).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Message TradeAgent"), "Done");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(screen.getByText("Done.")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Message TradeAgent"), "Json");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(
        screen.getByText(
          "Chat request failed (200, application/json). No error details in the response.",
        ),
      ).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Message TradeAgent"), "Tail");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(screen.getByText("Tail done.")).toBeInTheDocument();
    });
  });

  it("handles trailing-buffer error without reply and missing content-type", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ type: "error" }), {
          headers: { "Content-Type": "application/x-ndjson" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ reply: "Plain json." }), {
          status: 200,
        }),
      );

    const user = userEvent.setup();
    render(<ChatWidget />);

    await user.type(screen.getByLabelText("Message TradeAgent"), "Buf");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(
        screen.getByText('Chat stream error: {"type":"error"}'),
      ).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Message TradeAgent"), "No ct");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(screen.getByText("Plain json.")).toBeInTheDocument();
    });
  });

  it("omits apiKey when empty and includes agentMessages on done", async () => {
    resetStore({ openaiApiKey: "" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ndjsonResponse([
        {
          type: "done",
          reply: "Updated.",
          agentMessages: [
            {
              role: "assistant",
              content: [{ type: "text", text: "Applied changes." }],
            },
          ],
          actions: { updateStrategy: { name: "Test", rules: [] } },
        },
      ]),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Update");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const body = JSON.parse(
      (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string,
    );
    expect(body.apiKey).toBeUndefined();

    await waitFor(() => {
      expect(screen.getByText("Updated.")).toBeInTheDocument();
    });

    const assistant = useTradingStore
      .getState()
      .chat.find((m) => m.role === "assistant" && m.content === "Updated.");
    expect(assistant?.agentMessages).toHaveLength(1);
  });

  it("sends the selected reasoningEffort from settings on chat requests", async () => {
    resetStore({ openaiReasoningEffort: "high" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ndjsonResponse([{ type: "done", reply: "Thoughtful answer.", actions: {} }]),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "How am I doing?");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const body = JSON.parse(
      (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body as string,
    );
    expect(body.reasoningEffort).toBe("high");
    expect(body.model).toBe(DEFAULT_OPENAI_MODEL);
  });

  it("submits image-only attachments without file meta", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ndjsonResponse([{ type: "done", reply: "Seen image." }]),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);
    mockFileToChatAttachment.mockImplementationOnce(async () =>
      makeImageAttachment("img-only", "img-only.png"),
    );
    const fileInput = document.querySelector(
      'input[type="file"][hidden]',
    ) as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(["x"], "img-only.png", { type: "image/png" }),
    );
    await waitFor(() => {
      expect(screen.getByAltText("img-only.png")).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const userMsg = useTradingStore
      .getState()
      .chat.find((m) => m.role === "user");
    expect(userMsg?.files).toBeUndefined();
    expect(userMsg?.images).toHaveLength(1);
  });

  it("returns early when submitting with nothing to send while loading", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise(() => {
          /* pending */
        }),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);
    const form = screen.getByLabelText("Message TradeAgent").closest("form")!;

    fireEvent.submit(form);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Message TradeAgent"), "Wait");
    await user.click(screen.getByLabelText("Send message"));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    fireEvent.submit(form);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("covers input drag-over without files and drop with empty file list", () => {
    render(<ChatWidget />);
    const input = screen.getByLabelText("Message TradeAgent");

    fireEvent.dragOver(input, {
      dataTransfer: { types: ["text/plain"] },
    });

    mockFileToChatAttachment.mockClear();
    fireEvent.drop(input, {
      dataTransfer: { types: ["Files"], files: [] },
    });
    expect(mockFileToChatAttachment).not.toHaveBeenCalled();
  });

  it("handles done in the stream loop and trailing-buffer errors", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        ndjsonResponse([
          { type: "ignored" },
          { type: "done", reply: "Loop-only done." },
        ]),
      )
      .mockResolvedValueOnce(
        new Response(
          `${JSON.stringify({ type: "status", message: "Working" })}\n${JSON.stringify({ type: "error", reply: "Buffered tail error." })}`,
          { headers: { "Content-Type": "application/x-ndjson" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          `${JSON.stringify({ type: "text-delta", text: "Partial" })}\n${JSON.stringify({ type: "ignored" })}`,
          { headers: { "Content-Type": "application/x-ndjson" } },
        ),
      );

    const user = userEvent.setup();
    render(<ChatWidget />);

    await user.type(screen.getByLabelText("Message TradeAgent"), "Loop");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(screen.getByText("Loop-only done.")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Message TradeAgent"), "Tail err");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(screen.getByText("Buffered tail error.")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Message TradeAgent"), "Tail noop");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(screen.getByText("Partial")).toBeInTheDocument();
    });
  });

  it("passes attached screenshots through done actions", async () => {
    const proposals = await import("@/lib/chat-proposals");
    const resolveSpy = vi.spyOn(proposals, "resolvePendingProposalUpdate");

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ndjsonResponse([
        {
          type: "done",
          reply: "Reviewed chart.",
          actions: { updateStrategy: { name: "Trend", rules: [] } },
        },
      ]),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);
    mockFileToChatAttachment.mockImplementationOnce(async () =>
      makeImageAttachment("shot", "shot.png"),
    );
    const fileInput = document.querySelector(
      'input[type="file"][hidden]',
    ) as HTMLInputElement;
    await user.upload(
      fileInput,
      new File(["x"], "shot.png", { type: "image/png" }),
    );
    await waitFor(() => {
      expect(screen.getByAltText("shot.png")).toBeInTheDocument();
    });
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(resolveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          screenshots: ["data:image/png;base64,abc"],
        }),
      );
    });
  });

  it("applies trailing-buffer done without reply and text-only action screenshots", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({ type: "text-delta", text: "Tail " })}\n${JSON.stringify({ type: "done", actions: { charts: [sampleChart] } })}`,
          ),
        );
        controller.close();
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson" },
      }),
    );

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "Tail");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByText("Done.")).toBeInTheDocument();
      expect(screen.getByTestId("chart-equity-1")).toBeInTheDocument();
    });
  });

  it("handles JSON responses when content-type header is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ reply: "Missing content type." }),
    } as Response);

    const user = userEvent.setup();
    render(<ChatWidget />);
    await user.type(screen.getByLabelText("Message TradeAgent"), "No header");
    await user.click(screen.getByLabelText("Send message"));

    await waitFor(() => {
      expect(screen.getByText("Missing content type.")).toBeInTheDocument();
    });
  });

  it("surfaces HTTP error and error fields from non-stream responses", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Missing strategy" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("<html>Gateway Timeout</html>", {
          status: 504,
          headers: { "Content-Type": "text/html" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("", {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const user = userEvent.setup();
    render(<ChatWidget />);

    await user.type(screen.getByLabelText("Message TradeAgent"), "Bad strategy");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(
        screen.getByText("Chat request failed (400): Missing strategy"),
      ).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Message TradeAgent"), "Gateway");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(
        screen.getByText("Chat request failed (504): <html>Gateway Timeout</html>"),
      ).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Message TradeAgent"), "Empty body");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(
        screen.getByText(
          "Chat request failed (500, application/json). No error details in the response.",
        ),
      ).toBeInTheDocument();
    });
  });

  it("surfaces failed NDJSON HTTP responses before streaming", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "upstream failed" }), {
          status: 502,
          headers: { "Content-Type": "application/x-ndjson" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("not-json-body", {
          status: 503,
          headers: { "Content-Type": "application/x-ndjson" },
        }),
      )
      .mockResolvedValueOnce(
        {
          ok: false,
          status: 500,
          headers: { get: () => "application/x-ndjson" },
          body: null,
          text: async () => "",
        } as unknown as Response,
      );

    const user = userEvent.setup();
    render(<ChatWidget />);

    await user.type(screen.getByLabelText("Message TradeAgent"), "Ndjson fail");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(
        screen.getByText("Chat request failed (502): upstream failed"),
      ).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Message TradeAgent"), "Ndjson junk");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(
        screen.getByText("Chat request failed (503): not-json-body"),
      ).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Message TradeAgent"), "Ndjson empty");
    await user.click(screen.getByLabelText("Send message"));
    await waitFor(() => {
      expect(
        screen.getByText(
          "Chat request failed (500, application/x-ndjson). No error details in the response.",
        ),
      ).toBeInTheDocument();
    });
  });
});
