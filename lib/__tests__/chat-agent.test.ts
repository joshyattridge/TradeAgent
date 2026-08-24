import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Strategy, Trade } from "@/lib/types";
import type { ChatContextPack } from "@/lib/chat-context";

const {
  mockStreamText,
  mockGenerateText,
  mockCreateOpenAI,
  mockModelFn,
  mockStepCountIs,
} = vi.hoisted(() => {
  const mockModelFn = vi.fn(() => "mock-model");
  const mockCreateOpenAI = vi.fn(() => mockModelFn);
  const mockStreamText = vi.fn();
  const mockGenerateText = vi.fn();
  const mockStepCountIs = vi.fn((n: number) => ({ type: "step-count", n }));
  return {
    mockStreamText,
    mockGenerateText,
    mockCreateOpenAI,
    mockModelFn,
    mockStepCountIs,
  };
});

vi.mock("ai", () => ({
  streamText: mockStreamText,
  generateText: mockGenerateText,
  stepCountIs: mockStepCountIs,
  tool: (def: unknown) => def,
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: mockCreateOpenAI,
}));

import {
  buildSystemPrompt,
  JournalSession,
  MAX_AGENT_STEPS,
  resolveReasoningEffort,
  streamAgentLoop,
  type AgentStreamEvent,
} from "@/lib/chat-agent";
import { DEFAULT_REASONING_EFFORT } from "@/lib/models";

const strategy: Strategy = {
  name: "NQ Breakout",
  markdown: "# NQ Breakout\nRules here.",
  updatedAt: "2026-07-30T12:00:00.000Z",
};

const sampleTrade: Trade = {
  id: "trade-1",
  date: "2026-07-30",
  symbol: "NQ",
  side: "long",
  entry: 100,
  stop: 95,
  target: 110,
  rMultiple: 2,
  result: "win",
  screenshots: ["data:image/png;base64,screenshot"],
};

function baseCtx(overrides: Partial<ChatContextPack> = {}): ChatContextPack {
  return {
    tradeCount: 3,
    strategyName: "NQ Breakout",
    reattachedScreenshotCount: 0,
    referencedTradeIds: [],
    ...overrides,
  };
}

function makeStreamResult(
  events: unknown[],
  overrides: {
    text?: string;
    steps?: unknown[];
    responseMessages?: unknown[];
  } = {},
) {
  return {
    fullStream: (async function* () {
      for (const event of events) {
        yield event;
      }
    })(),
    text: Promise.resolve(overrides.text ?? "Here is a helpful coaching reply."),
    steps: Promise.resolve(overrides.steps ?? [{ type: "step" }]),
    responseMessages: Promise.resolve(
      overrides.responseMessages ?? [
        { role: "assistant", content: "Here is a helpful coaching reply." },
      ],
    ),
  };
}

async function collectEvents(
  opts: Parameters<typeof streamAgentLoop>[0],
): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const event of streamAgentLoop(opts)) {
    events.push(event);
  }
  return events;
}

function baseLoopOpts(
  overrides: Partial<Parameters<typeof streamAgentLoop>[0]> = {},
) {
  return {
    apiKey: "test-key",
    model: "gpt-4o",
    strategy,
    trades: [sampleTrade],
    stats: {},
    history: [],
    userText: "How am I doing?",
    images: [],
    ...overrides,
  };
}

describe("resolveReasoningEffort", () => {
  it("accepts known efforts and falls back for junk", () => {
    expect(resolveReasoningEffort("max")).toBe("max");
    expect(resolveReasoningEffort("HIGH")).toBe("high");
    expect(resolveReasoningEffort("not-real")).toBe(DEFAULT_REASONING_EFFORT);
    expect(resolveReasoningEffort(null)).toBe(DEFAULT_REASONING_EFFORT);
  });
});

describe("buildSystemPrompt", () => {
  it("includes journal pointers, strategy name, and screenshot count", () => {
    const prompt = buildSystemPrompt(
      baseCtx({ tradeCount: 12, reattachedScreenshotCount: 2 }),
    );

    expect(prompt).toContain("Journal size: 12 trades");
    expect(prompt).toContain("Strategy name: NQ Breakout");
    expect(prompt).toContain("Reattached trade-journal screenshots (if any this turn): 2");
    expect(prompt).toContain("TradeAgent");
    expect(prompt).toContain("get_strategy");
    expect(prompt).toContain("query_trades");
  });

  it("uses unset when strategy name is missing", () => {
    const prompt = buildSystemPrompt(baseCtx({ strategyName: null }));
    expect(prompt).toContain("Strategy name: unset");
  });

  it("includes referenced trade guidance when a UI pin is present", () => {
    const prompt = buildSystemPrompt(
      baseCtx({ referencedTradeIds: ["trade-abc"] }),
    );
    expect(prompt).toContain("User-selected trade reference (this turn only): id=trade-abc");
    expect(prompt).toContain("use get_trade, patch_trade, and annotate_trade with that exact id");
    expect(prompt).not.toContain("Always resolve the target with find_trade");
  });

  it("includes find_trade guidance when no referenced trade is pinned", () => {
    const prompt = buildSystemPrompt(baseCtx({ referencedTradeIds: [] }));
    expect(prompt).toContain(
      "Always resolve the target with find_trade (pass screenshot levels)",
    );
    expect(prompt).not.toContain("id=trade-abc");
  });

  it("lists multiple referenced trade ids in the system prompt", () => {
    const prompt = buildSystemPrompt(
      baseCtx({ referencedTradeIds: ["trade-a", "trade-b"] }),
    );
    expect(prompt).toContain(
      "User-selected trade references (this turn only): ids=trade-a, trade-b",
    );
    expect(prompt).toContain("those exact ids");
  });
});

describe("streamAgentLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateText.mockResolvedValue({
      text: "Polished final reply with ids and next steps.",
    });
  });

  it("wires OpenAI and streamText with journal tools", async () => {
    mockStreamText.mockReturnValue(makeStreamResult([]));

    await collectEvents(baseLoopOpts());

    expect(mockCreateOpenAI).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(mockModelFn).toHaveBeenCalledWith("gpt-4o");
    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("TradeAgent"),
        tools: expect.objectContaining({
          log_trade: expect.objectContaining({ execute: expect.any(Function) }),
          get_strategy: expect.objectContaining({ execute: expect.any(Function) }),
        }),
        stopWhen: { type: "step-count", n: MAX_AGENT_STEPS },
      }),
    );
    expect(mockStepCountIs).toHaveBeenCalledWith(MAX_AGENT_STEPS);
  });

  it("passes an explicit OpenAI baseURL through to the provider", async () => {
    mockStreamText.mockReturnValue(makeStreamResult([]));
    await collectEvents(baseLoopOpts({ baseURL: "/api/openai/v1" }));
    expect(mockCreateOpenAI).toHaveBeenCalledWith({
      apiKey: "test-key",
      baseURL: "/api/openai/v1",
    });
  });

  it("defaults baseURL to the app proxy when window is defined", async () => {
    vi.stubGlobal("window", {} as Window & typeof globalThis);
    mockStreamText.mockReturnValue(makeStreamResult([]));
    try {
      await collectEvents(baseLoopOpts());
      expect(mockCreateOpenAI).toHaveBeenCalledWith({
        apiKey: "test-key",
        baseURL: "/api/openai/v1",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("announces attached files and reattached screenshots", async () => {
    mockStreamText.mockReturnValue(makeStreamResult([]));

    const events = await collectEvents(
      baseLoopOpts({
        userText: "Please review my NQ entry levels from the journal screenshot",
        attachments: [
          {
            kind: "text",
            name: "journal.csv",
            text: "symbol,side\nNQ,long",
          },
        ],
      }),
    );

    expect(events.some((e) => e.type === "status" && e.message === "Preparing context…")).toBe(
      true,
    );
    expect(
      events.some(
        (e) => e.type === "status" && e.message.includes("Re-attaching 1 screenshot"),
      ),
    ).toBe(true);
    expect(
      events.some((e) => e.type === "status" && e.message === "Reading attached file(s)…"),
    ).toBe(true);
  });

  it("uses plural screenshot status when multiple screenshots reattach", async () => {
    mockStreamText.mockReturnValue(makeStreamResult([]));

    const twoScreenshots: Trade = {
      ...sampleTrade,
      screenshots: [
        "data:image/png;base64,one",
        "data:image/png;base64,two",
      ],
    };

    const events = await collectEvents(
      baseLoopOpts({
        trades: [twoScreenshots],
        userText: "Review my NQ screenshot levels again",
      }),
    );

    expect(
      events.some(
        (e) =>
          e.type === "status" &&
          e.message === "Re-attaching 2 screenshots for the named trade…",
      ),
    ).toBe(true);
  });

  it("handles plain-text-only user messages and ignores invalid attachment arrays", async () => {
    mockStreamText.mockReturnValue(makeStreamResult([]));

    await collectEvents(
      baseLoopOpts({
        userText: "Hello",
        attachments: "not-an-array" as unknown as undefined,
      }),
    );

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: "Hello",
          }),
        ]),
      }),
    );
  });

  it("builds rich multimodal user content for images, files, and attachment images", async () => {
    mockStreamText.mockReturnValue(makeStreamResult([]));

    await collectEvents(
      baseLoopOpts({
        userText: "Review this",
        images: ["data:image/png;base64,inline"],
        attachments: [
          {
            kind: "image",
            name: "chart.png",
            dataUrl: "data:image/png;base64,attached",
          },
          {
            kind: "file",
            name: "note.pdf",
            mime: "application/pdf",
            dataUrl: "data:application/pdf;base64,abc",
          },
        ],
      }),
    );

    const call = mockStreamText.mock.calls[0]?.[0];
    const userMessage = call.messages.at(-1);
    expect(userMessage.role).toBe("user");
    expect(Array.isArray(userMessage.content)).toBe(true);
    expect(userMessage.content.some((p: { type: string }) => p.type === "image")).toBe(
      true,
    );
    expect(userMessage.content.some((p: { type: string }) => p.type === "file")).toBe(
      true,
    );
  });

  it("reuses images from earlier conversation turns when the current turn has none", async () => {
    mockStreamText.mockReturnValue(makeStreamResult([]));

    await collectEvents(
      baseLoopOpts({
        userText: "Log that screenshot now",
        images: undefined,
        history: [
          {
            role: "user",
            content: "here is the chart",
            images: ["data:image/png;base64,hist"],
          },
        ],
      }),
    );

    const call = mockStreamText.mock.calls[0]?.[0];
    const userMessage = call.messages.at(-1);
    expect(userMessage.content.some((p: { type: string }) => p.type === "image")).toBe(
      true,
    );
  });

  it("streams step, tool, text, and done events on the happy path", async () => {
    mockStreamText.mockReturnValue(
      makeStreamResult([
        { type: "start-step" },
        { type: "text-delta", text: "Checking " },
        { type: "text-delta", delta: "journal." },
        { type: "tool-call", toolCallId: "c1", toolName: "query_trades", input: { limit: 5 } },
        {
          type: "tool-result",
          toolCallId: "c1",
          toolName: "query_trades",
          output: { action: "query_trades", count: 2, ok: true },
        },
        { type: "start-step" },
      ]),
    );

    const events = await collectEvents(baseLoopOpts());

    expect(events).toEqual(
      expect.arrayContaining([
        { type: "status", message: "Thinking…" },
        { type: "text-delta", text: "Checking " },
        { type: "text-delta", text: "journal." },
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
          ok: true,
          detail: "2 match(es)",
        },
        { type: "status", message: "Continuing (step 2)…" },
        expect.objectContaining({
          type: "done",
          reply: "Here is a helpful coaching reply.",
          steps: 1,
        }),
      ]),
    );
  });

  it("formats tool labels and result details across tool output shapes", async () => {
    mockStreamText.mockReturnValue(
      makeStreamResult([
        {
          type: "tool-result",
          toolCallId: "patch-no-symbol",
          toolName: "patch_trade",
          output: { action: "patch_trade", trade: { id: "t1" } },
        },
        {
          type: "tool-result",
          toolCallId: "plain",
          toolName: "custom_tool_name",
          output: null,
        },
        {
          type: "tool-result",
          toolCallId: "err",
          toolName: "log_trade",
          output: { ok: false, error: "validation failed" },
        },
        {
          type: "tool-result",
          toolCallId: "log",
          toolName: "log_trade",
          output: {
            action: "log_trade",
            trade: { side: "long", symbol: "NQ", result: "open" },
          },
        },
        {
          type: "tool-result",
          toolCallId: "patch",
          toolName: "patch_trade",
          output: { action: "patch_trade", trade: { id: "t1", symbol: "ES" } },
        },
        {
          type: "tool-result",
          toolCallId: "annotate",
          toolName: "annotate_trade",
          output: { action: "annotate_trade", trade: { id: "t2" } },
        },
        {
          type: "tool-result",
          toolCallId: "delete",
          toolName: "delete_trade",
          output: { action: "delete_trade", deletedIds: ["a", "b"] },
        },
        {
          type: "tool-result",
          toolCallId: "charts",
          toolName: "generate_charts",
          output: { action: "generate_charts", charts: [{}] },
        },
        {
          type: "tool-result",
          toolCallId: "stats",
          toolName: "get_stats",
          output: {
            action: "get_stats",
            stats: { closedCount: 4, winRate: 62.5 },
          },
        },
        {
          type: "tool-result",
          toolCallId: "stats-no-closed",
          toolName: "get_stats",
          output: {
            action: "get_stats",
            stats: { winRate: 50 },
          },
        },
        {
          type: "tool-result",
          toolCallId: "patch-empty-trade",
          toolName: "patch_trade",
          output: { action: "patch_trade", trade: {} },
        },
        {
          type: "tool-result",
          toolCallId: "trade-get-trade-id",
          toolName: "get_trade",
          output: { action: "get_trade", trade: { id: "from-trade" } },
        },
        {
          type: "tool-result",
          toolCallId: "trade-get-empty",
          toolName: "get_trade",
          output: { action: "get_trade" },
        },
        {
          type: "tool-result",
          toolCallId: "find-no-candidates",
          toolName: "find_trade",
          output: { action: "find_trade", candidates: "nope" },
        },
        {
          type: "tool-result",
          toolCallId: "strategy-update",
          toolName: "update_strategy",
          output: { action: "update_strategy" },
        },
        {
          type: "tool-result",
          toolCallId: "strategy-get",
          toolName: "get_strategy",
          output: { action: "get_strategy", section: "risk" },
        },
        {
          type: "tool-result",
          toolCallId: "trade-get",
          toolName: "get_trade",
          output: { action: "get_trade", trade: { id: "t9", symbol: "NQ" } },
        },
        {
          type: "tool-result",
          toolCallId: "trade-get-id",
          toolName: "get_trade",
          output: { action: "get_trade", id: "t10" },
        },
        {
          type: "tool-result",
          toolCallId: "find-best",
          toolName: "find_trade",
          output: { action: "find_trade", bestMatchId: "t11" },
        },
        {
          type: "tool-result",
          toolCallId: "find-candidates",
          toolName: "find_trade",
          output: { action: "find_trade", candidates: [{ id: "a" }, { id: "b" }] },
        },
        {
          type: "tool-result",
          toolCallId: "strategy-get-default",
          toolName: "get_strategy",
          output: { action: "get_strategy" },
        },
        {
          type: "tool-result",
          toolCallId: "stats-no-wr",
          toolName: "get_stats",
          output: { action: "get_stats", stats: { closedCount: 2 } },
        },
        {
          type: "tool-result",
          toolCallId: "fallback",
          toolName: "unknown_branch",
          output: { action: "noop", ok: true },
        },
      ]),
    );

    const events = await collectEvents(baseLoopOpts());
    const toolResults = events.filter((e) => e.type === "tool-result");

    const expectedDetails = [
      { toolCallId: "patch-no-symbol", name: "patch_trade", detail: "t1", ok: true },
      { toolCallId: "plain", name: "custom_tool_name", label: "custom tool name", ok: true },
      { toolCallId: "err", detail: "validation failed", ok: false },
      { toolCallId: "log", detail: "long NQ open", ok: true },
      { toolCallId: "patch", detail: "ES (t1)", ok: true },
      { toolCallId: "annotate", detail: "t2", ok: true },
      { toolCallId: "delete", detail: "2 removed", ok: true },
      { toolCallId: "charts", detail: "1 chart(s)", ok: true },
      { toolCallId: "stats", detail: "4 closed, 63% WR", ok: true },
      { toolCallId: "stats-no-closed", detail: "? closed, 50% WR", ok: true },
      { toolCallId: "patch-empty-trade", detail: "", ok: true },
      { toolCallId: "trade-get-trade-id", detail: "from-trade", ok: true },
      { toolCallId: "find-no-candidates", detail: "0 candidate(s)", ok: true },
      { toolCallId: "strategy-update", detail: "strategy saved", ok: true },
      { toolCallId: "strategy-get", detail: "risk", ok: true },
      { toolCallId: "trade-get", detail: "NQ (t9)", ok: true },
      { toolCallId: "trade-get-id", detail: "t10", ok: true },
      { toolCallId: "find-best", detail: "best t11", ok: true },
      { toolCallId: "find-candidates", detail: "2 candidate(s)", ok: true },
      { toolCallId: "strategy-get-default", detail: "strategy", ok: true },
    ];

    for (const expected of expectedDetails) {
      expect(toolResults).toContainEqual(expect.objectContaining(expected));
    }

    expect(toolResults.find((e) => e.type === "tool-result" && e.toolCallId === "stats-no-wr")).toMatchObject({
      name: "get_stats",
      ok: true,
      detail: undefined,
    });
    expect(toolResults.find((e) => e.type === "tool-result" && e.toolCallId === "fallback")).toMatchObject({
      name: "unknown_branch",
      ok: true,
      detail: undefined,
    });
  });

  it("records tool errors from Error, string, and unknown values", async () => {
    mockStreamText.mockReturnValue(
      makeStreamResult([
        {
          type: "tool-call",
          toolCallId: "e1",
          toolName: "patch_trade",
          input: { id: "t1" },
        },
        {
          type: "tool-error",
          toolCallId: "e1",
          toolName: "patch_trade",
          error: new Error("patch failed"),
        },
        {
          type: "tool-error",
          toolCallId: "e2",
          toolName: "delete_trade",
          error: "delete failed",
        },
        {
          type: "tool-error",
          toolCallId: "e3",
          toolName: "log_trade",
          error: { reason: "bad" },
        },
      ]),
    );

    const events = await collectEvents(baseLoopOpts());
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-result",
          toolCallId: "e1",
          ok: false,
          detail: "patch failed",
        }),
        expect.objectContaining({
          type: "tool-result",
          toolCallId: "e2",
          ok: false,
          detail: "delete failed",
        }),
        expect.objectContaining({
          type: "tool-result",
          toolCallId: "e3",
          ok: false,
          detail: "Tool failed",
        }),
      ]),
    );
  });

  it("ignores empty text deltas", async () => {
    mockStreamText.mockReturnValue(
      makeStreamResult([
        { type: "text-delta", text: "" },
        { type: "text-delta", delta: "" },
        { type: "text-delta" },
        { type: "text-delta", text: 1, delta: 2 },
        { type: "finish", finishReason: "stop" },
        { type: "text-delta", text: "Visible" },
      ], { text: "Visible" }),
    );

    const events = await collectEvents(baseLoopOpts());
    expect(events.filter((e) => e.type === "text-delta")).toEqual([
      { type: "text-delta", text: "Visible" },
    ]);
  });

  it("returns early on stream error parts and caught iteration failures", async () => {
    mockStreamText.mockReturnValueOnce({
      fullStream: (async function* () {
        yield { type: "error", error: new Error("rate limited") };
      })(),
      text: Promise.resolve(""),
      steps: Promise.resolve([]),
      responseMessages: Promise.resolve([]),
    });

    const streamErrorEvents = await collectEvents(baseLoopOpts());
    expect(streamErrorEvents.at(-1)).toMatchObject({
      type: "error",
      reply:
        "OpenAI error: rate limited\n\nCheck your API key and model in Settings.",
      llmCalls: [expect.objectContaining({ kind: "agent", response: { error: "rate limited" } })],
    });

    mockStreamText.mockReturnValueOnce({
      fullStream: (async function* () {
        throw new Error("network down");
      })(),
      text: Promise.resolve(""),
      steps: Promise.resolve([]),
      responseMessages: Promise.resolve([]),
    });

    const caughtEvents = await collectEvents(baseLoopOpts());
    expect(caughtEvents.at(-1)).toMatchObject({
      type: "error",
      reply:
        "OpenAI error: network down\n\nCheck your API key and model in Settings.",
      llmCalls: [expect.objectContaining({ kind: "agent", response: { error: "network down" } })],
    });

    mockStreamText.mockReturnValueOnce({
      fullStream: (async function* () {
        throw "socket hang up";
      })(),
      text: Promise.resolve(""),
      steps: Promise.resolve([]),
      responseMessages: Promise.resolve([]),
    });

    const nonErrorCatch = await collectEvents(baseLoopOpts());
    expect(nonErrorCatch.at(-1)).toMatchObject({
      type: "error",
      reply:
        "OpenAI error: OpenAI request failed\n\nCheck your API key and model in Settings.",
      llmCalls: [
        expect.objectContaining({
          kind: "agent",
          response: { error: "OpenAI request failed" },
        }),
      ],
    });
  });

  it("handles non-Error stream error values", async () => {
    mockStreamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: "error", error: "plain failure" };
      })(),
      text: Promise.resolve(""),
      steps: Promise.resolve([]),
      responseMessages: Promise.resolve([]),
    });

    const events = await collectEvents(baseLoopOpts());
    expect(events.at(-1)).toMatchObject({
      type: "error",
      reply:
        "OpenAI error: Stream error from model\n\nCheck your API key and model in Settings.",
      llmCalls: [
        expect.objectContaining({
          kind: "agent",
          response: { error: "Stream error from model" },
        }),
      ],
    });
  });

  it("polishes weak replies via generateText and falls back when nudge is empty", async () => {
    mockStreamText.mockReturnValue(
      makeStreamResult([], { text: "Trade logged.", responseMessages: [] }),
    );
    mockGenerateText.mockResolvedValueOnce({
      text: "Proposed logging NQ long with id trade-1.",
    });

    const polished = await collectEvents(baseLoopOpts());
    expect(polished.some((e) => e.type === "status" && e.message === "Polishing reply…")).toBe(
      true,
    );
    expect(polished.at(-1)).toMatchObject({
      type: "done",
      reply: "Proposed logging NQ long with id trade-1.",
      llmCalls: [
        expect.objectContaining({
          kind: "agent",
          request: expect.objectContaining({
            system: expect.stringContaining("TradeAgent"),
            tools: expect.arrayContaining(["get_stats", "query_trades"]),
          }),
          response: expect.objectContaining({ text: "Trade logged." }),
        }),
        expect.objectContaining({
          kind: "polish",
          response: { text: "Proposed logging NQ long with id trade-1." },
        }),
      ],
    });
    expect(mockGenerateText).toHaveBeenCalled();

    mockStreamText.mockReturnValue(
      makeStreamResult([], { text: "done", responseMessages: [] }),
    );
    mockGenerateText.mockResolvedValueOnce({ text: "" });

    const fallback = await collectEvents(baseLoopOpts());
    expect(fallback.at(-1)).toMatchObject({
      type: "done",
      reply:
        "Which trade should I update? Name the symbol (and date/result if there are several).",
      llmCalls: [
        expect.objectContaining({ kind: "agent" }),
        expect.objectContaining({
          kind: "polish",
          response: {
            text: "Which trade should I update? Name the symbol (and date/result if there are several).",
          },
        }),
      ],
    });
  });

  it("logs polish failures as error events with both LLM calls", async () => {
    mockStreamText.mockReturnValue(
      makeStreamResult([], { text: "Done.", responseMessages: [] }),
    );
    mockGenerateText.mockRejectedValueOnce(new Error("polish boom"));

    const events = await collectEvents(baseLoopOpts());
    expect(events.at(-1)).toMatchObject({
      type: "error",
      reply:
        "OpenAI error: polish boom\n\nCheck your API key and model in Settings.",
      llmCalls: [
        expect.objectContaining({ kind: "agent" }),
        expect.objectContaining({
          kind: "polish",
          response: { error: "polish boom" },
        }),
      ],
    });

    mockStreamText.mockReturnValueOnce(
      makeStreamResult([], { text: "Logged.", responseMessages: [] }),
    );
    mockGenerateText.mockRejectedValueOnce("non-error polish fail");
    const nonErrorPolish = await collectEvents(baseLoopOpts());
    expect(nonErrorPolish.at(-1)).toMatchObject({
      type: "error",
      llmCalls: [
        expect.objectContaining({ kind: "agent" }),
        expect.objectContaining({
          kind: "polish",
          response: { error: "OpenAI polish failed" },
        }),
      ],
    });
  });

  it("records tool calls that omit an input payload", async () => {
    mockStreamText.mockReturnValue(
      makeStreamResult([
        {
          type: "tool-call",
          toolCallId: "no-input",
          toolName: "get_stats",
        },
        {
          type: "tool-result",
          toolCallId: "no-input",
          toolName: "get_stats",
          output: { action: "get_stats", stats: { closedCount: 0, winRate: 0 } },
        },
      ]),
    );

    const events = await collectEvents(baseLoopOpts());
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-start",
          toolCallId: "no-input",
          name: "get_stats",
        }),
      ]),
    );
  });

  it("does not emit continuing status on the first step", async () => {
    mockStreamText.mockReturnValue(makeStreamResult([{ type: "start-step" }]));

    const events = await collectEvents(baseLoopOpts());
    expect(events.some((e) => e.type === "status" && e.message.includes("Continuing"))).toBe(
      false,
    );
  });

  it("treats common stub replies as weak", async () => {
    const weakReplies = [
      "Trade updated.",
      "Strategy updated.",
      "Charts ready.",
      "On it.",
      "Logged.",
      "",
      "   ",
    ];

    for (const reply of weakReplies) {
      mockStreamText.mockReturnValueOnce(
        makeStreamResult([], { text: reply, responseMessages: [] }),
      );
      mockGenerateText.mockResolvedValueOnce({ text: `Expanded: ${reply || "empty"}` });
      const events = await collectEvents(baseLoopOpts());
      expect(events.some((e) => e.type === "status" && e.message === "Polishing reply…")).toBe(
        true,
      );
    }
  });

  it("uses streamed text when result.text is empty and falls back to collected agent messages", async () => {
    mockStreamText.mockReturnValue(
      makeStreamResult(
        [
          { type: "text-delta", text: "Streamed only reply." },
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "get_strategy",
            input: { section: "all" },
          },
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "get_strategy",
            output: { action: "get_strategy" },
          },
        ],
        {
          text: "",
          responseMessages: [],
          steps: [],
        },
      ),
    );

    const events = await collectEvents(baseLoopOpts());
    const done = events.at(-1);
    expect(done).toMatchObject({
      type: "done",
      reply: "Streamed only reply.",
      steps: 0,
      agentMessages: expect.arrayContaining([
        expect.objectContaining({ role: "assistant" }),
        expect.objectContaining({ role: "tool" }),
      ]),
    });
  });

  it("includes referencedTradeIds in the system prompt context", async () => {
    mockStreamText.mockReturnValue(makeStreamResult([]));

    await collectEvents(baseLoopOpts({ referencedTradeIds: ["pinned-trade"] }));

    const system = mockStreamText.mock.calls[0]?.[0]?.system as string;
    expect(system).toContain("id=pinned-trade");
  });
});

describe("journal tool execute wrappers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGenerateText.mockResolvedValue({ text: "Done." });
  });

  async function captureTools() {
    mockStreamText.mockImplementation(({ tools }) =>
      makeStreamResult([], { text: "noop" }),
    );
    await collectEvents(baseLoopOpts());
    return mockStreamText.mock.calls[0]?.[0]?.tools as Record<
      string,
      { execute: (input: unknown) => Promise<unknown> }
    >;
  }

  it("delegates every journal tool to JournalSession methods", async () => {
    const spies = {
      getStrategy: vi.spyOn(JournalSession.prototype, "getStrategy").mockResolvedValue({
        action: "get_strategy",
      }),
      getTrade: vi.spyOn(JournalSession.prototype, "getTrade").mockResolvedValue({
        action: "get_trade",
      }),
      findTrade: vi.spyOn(JournalSession.prototype, "findTrade").mockResolvedValue({
        action: "find_trade",
      }),
      logTrade: vi.spyOn(JournalSession.prototype, "logTrade").mockResolvedValue({
        action: "log_trade",
      }),
      patchTrade: vi.spyOn(JournalSession.prototype, "patchTrade").mockResolvedValue({
        action: "patch_trade",
      }),
      annotateTrade: vi
        .spyOn(JournalSession.prototype, "annotateTrade")
        .mockResolvedValue({ action: "annotate_trade" }),
      deleteTrade: vi.spyOn(JournalSession.prototype, "deleteTrade").mockResolvedValue({
        action: "delete_trade",
      }),
      updateStrategy: vi
        .spyOn(JournalSession.prototype, "updateStrategy")
        .mockResolvedValue({ action: "update_strategy" }),
      generateCharts: vi
        .spyOn(JournalSession.prototype, "generateCharts")
        .mockResolvedValue({ action: "generate_charts" }),
      queryTrades: vi.spyOn(JournalSession.prototype, "queryTrades").mockResolvedValue({
        action: "query_trades",
      }),
      getStatsTool: vi.spyOn(JournalSession.prototype, "getStatsTool").mockResolvedValue({
        action: "get_stats",
      }),
    };

    const tools = await captureTools();

    await tools.get_strategy.execute({ section: "risk" });
    await tools.get_strategy.execute({});
    await tools.get_trade.execute({ id: "t1" });
    await tools.find_trade.execute({ symbol: "NQ" });
    await tools.log_trade.execute({ symbol: "NQ", side: "long" });
    await tools.patch_trade.execute({ id: "t1", entry: 1 });
    await tools.annotate_trade.execute({ id: "t1", appendNote: "note" });
    await tools.delete_trade.execute({ ids: ["t1"] });
    await tools.update_strategy.execute({ appendMarkdown: "# New" });
    await tools.generate_charts.execute({ charts: [{ kind: "equity" }] });
    await tools.query_trades.execute({ symbol: "NQ" });
    await tools.get_stats.execute({ closedOnly: true });

    expect(spies.getStrategy).toHaveBeenCalledWith("risk");
    expect(spies.getStrategy).toHaveBeenCalledWith("all");
    expect(spies.getTrade).toHaveBeenCalledWith("t1");
    expect(spies.findTrade).toHaveBeenCalledWith({ symbol: "NQ" });
    expect(spies.logTrade).toHaveBeenCalledWith({ symbol: "NQ", side: "long" });
    expect(spies.patchTrade).toHaveBeenCalledWith({ id: "t1", entry: 1 });
    expect(spies.annotateTrade).toHaveBeenCalledWith({ id: "t1", appendNote: "note" });
    expect(spies.deleteTrade).toHaveBeenCalledWith({ ids: ["t1"] });
    expect(spies.updateStrategy).toHaveBeenCalledWith({ appendMarkdown: "# New" });
    expect(spies.generateCharts).toHaveBeenCalledWith([{ kind: "equity" }]);
    expect(spies.queryTrades).toHaveBeenCalledWith({ symbol: "NQ" });
    expect(spies.getStatsTool).toHaveBeenCalledWith({ closedOnly: true });
  });
});
