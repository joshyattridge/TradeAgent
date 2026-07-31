import { describe, expect, it } from "vitest";
import {
  countToolsInAgentMessages,
  ensureFinalAssistantText,
  expandHistoryToModelMessages,
  sanitizeAgentMessages,
  sanitizeJsonValue,
} from "@/lib/chat-history";

describe("sanitizeAgentMessages", () => {
  it("keeps tool-call / tool-result pairs and strips screenshot data URLs", () => {
    const messages = sanitizeAgentMessages([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "query_trades",
            input: { limit: 10 },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "query_trades",
            output: {
              type: "json",
              value: {
                count: 1,
                trades: [
                  {
                    id: "t1",
                    screenshots: ["data:image/png;base64,abc"],
                  },
                ],
              },
            },
          },
        ],
      },
      { role: "assistant", content: "Found 1 trade." },
    ]);

    expect(messages).toHaveLength(3);
    expect(countToolsInAgentMessages(messages)).toBe(1);
    const tool = messages[1];
    expect(tool.role).toBe("tool");
    if (tool.role === "tool") {
      const output = tool.content[0]?.output as {
        type: string;
        value: { trades: Array<{ screenshots: unknown }> };
      };
      expect(output.value.trades[0].screenshots).toBe("[1 screenshot(s)]");
    }
  });
});

describe("ensureFinalAssistantText", () => {
  it("appends reply when transcript has no final assistant text", () => {
    const next = ensureFinalAssistantText(
      [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "c1",
              toolName: "get_stats",
              input: {},
            },
          ],
        },
      ],
      "Win rate is 55%.",
    );
    expect(next.at(-1)).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "c1",
          toolName: "get_stats",
          input: {},
        },
        { type: "text", text: "Win rate is 55%." },
      ],
    });
  });
});

describe("expandHistoryToModelMessages", () => {
  it("replays prior tool transcripts before the next user turn", () => {
    const modelMessages = expandHistoryToModelMessages([
      { role: "user", content: "how many trades?" },
      {
        role: "assistant",
        content: "7 closed.",
        agentMessages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "c1",
                toolName: "query_trades",
                input: { limit: 25 },
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "c1",
                toolName: "query_trades",
                output: { type: "json", value: { count: 7 } },
              },
            ],
          },
          { role: "assistant", content: "7 closed." },
        ],
      },
      { role: "user", content: "and the EURUSD one?" },
    ]);

    expect(modelMessages).toHaveLength(5);
    expect(modelMessages[0]).toMatchObject({ role: "user", content: "how many trades?" });
    expect(modelMessages[1]).toMatchObject({ role: "assistant" });
    expect(modelMessages[2]).toMatchObject({ role: "tool" });
    expect(modelMessages[3]).toMatchObject({
      role: "assistant",
      content: "7 closed.",
    });
    expect(modelMessages[4]).toMatchObject({
      role: "user",
      content: "and the EURUSD one?",
    });
  });

  it("falls back to plain assistant text when no agentMessages", () => {
    const modelMessages = expandHistoryToModelMessages([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    expect(modelMessages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });
});

describe("sanitizeJsonValue", () => {
  it("omits embedded images", () => {
    expect(sanitizeJsonValue("data:image/png;base64,xxx")).toBe("[image omitted]");
  });

  it("truncates at depth and long strings", () => {
    const nest = (depth: number, leaf: unknown): unknown => {
      if (depth <= 0) return leaf;
      return { nested: nest(depth - 1, leaf) };
    };
    expect(JSON.stringify(sanitizeJsonValue(nest(14, "x")))).toContain("[truncated]");
    const long = "z".repeat(50_001);
    expect(sanitizeJsonValue(long)).toBe(`${"z".repeat(50_000)}\n[…truncated]`);
  });

  it("redacts screenshot arrays and recurses objects", () => {
    expect(
      sanitizeJsonValue({ shots: [{ id: 1 }], nested: { screenshots: ["a", "b"] } }),
    ).toEqual({
      shots: [{ id: 1 }],
      nested: { screenshots: "[2 screenshot(s)]" },
    });
    expect(sanitizeJsonValue([1, { x: 2 }])).toEqual([1, { x: 2 }]);
    expect(sanitizeJsonValue(42)).toBe(42);
  });
});

describe("sanitizeAgentMessages edge cases", () => {
  it("returns empty for non-arrays and skips invalid entries", () => {
    expect(sanitizeAgentMessages(null)).toEqual([]);
    expect(sanitizeAgentMessages("x")).toEqual([]);
    expect(sanitizeAgentMessages([null, "bad", { role: "system", content: "x" }])).toEqual([]);
  });

  it("keeps string assistant content and skips malformed assistant parts", () => {
    const messages = sanitizeAgentMessages([
      { role: "assistant", content: "Plain reply" },
      { role: "assistant", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: "not-array" },
      {
        role: "assistant",
        content: [
          null,
          { type: "text", text: "Hi" },
          { type: "tool-call", toolCallId: "c1", toolName: "get_stats", input: { x: 1 } },
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "get_stats",
            output: { count: 1, nested: { screenshots: ["a"] } },
          },
        ],
      },
      { role: "assistant", content: 42 },
      {
        role: "tool",
        content: [
          null,
          {
            type: "tool-result",
            toolCallId: "c2",
            toolName: "query_trades",
            output: "plain output",
          },
        ],
      },
    ]);

    expect(messages).toEqual([
      { role: "assistant", content: "Plain reply" },
      { role: "assistant", content: [{ type: "text", text: "Hello" }] },
      { role: "assistant", content: "not-array" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Hi" },
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "get_stats",
            input: { x: 1 },
          },
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "get_stats",
            output: { count: 1, nested: { screenshots: "[1 screenshot(s)]" } },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c2",
            toolName: "query_trades",
            output: "plain output",
          },
        ],
      },
    ]);
  });

  it("skips assistant/tool messages that produce no valid parts", () => {
    expect(
      sanitizeAgentMessages([
        { role: "assistant", content: [null, { type: "text", text: 1 }] },
        { role: "tool", content: [null, { type: "tool-result", toolCallId: 1 }] },
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "x" }], // missing toolName
        },
      ]),
    ).toEqual([]);
  });
});

describe("ensureFinalAssistantText branches", () => {
  it("returns unchanged when reply is empty", () => {
    const messages = [{ role: "assistant" as const, content: "Keep" }];
    expect(ensureFinalAssistantText(messages, "   ")).toBe(messages);
  });

  it("appends when last message is not assistant", () => {
    expect(
      ensureFinalAssistantText([{ role: "tool", content: [] }], "Final"),
    ).toEqual([
      { role: "tool", content: [] },
      { role: "assistant", content: "Final" },
    ]);
  });

  it("replaces mismatched string content and keeps matching parts", () => {
    const messages = [{ role: "assistant" as const, content: "Old" }];
    expect(ensureFinalAssistantText(messages, "New")).toEqual([
      { role: "assistant", content: "New" },
    ]);
    expect(ensureFinalAssistantText(messages, "Old")).toBe(messages);

    const parts = [
      {
        role: "assistant" as const,
        content: [
          { type: "tool-call" as const, toolCallId: "c1", toolName: "x", input: {} },
          { type: "text" as const, text: "Same" },
        ],
      },
    ];
    expect(ensureFinalAssistantText(parts, "Same")).toBe(parts);
    expect(ensureFinalAssistantText(parts, "Different")).toEqual([
      {
        role: "assistant",
        content: [
          { type: "tool-call", toolCallId: "c1", toolName: "x", input: {} },
          { type: "text", text: "Different" },
        ],
      },
    ]);
  });
});

describe("expandHistoryToModelMessages branches", () => {
  it("skips empty user rows and non-assistant roles", () => {
    expect(
      expandHistoryToModelMessages([
        { role: "user", content: "   " },
        { role: "system", content: "ignored" },
        { role: "assistant", content: "   " },
      ]),
    ).toEqual([]);
  });

  it("uses multimodal user parts when images or attachments present", () => {
    const modelMessages = expandHistoryToModelMessages([
      {
        role: "user",
        content: "",
        images: ["data:image/png;base64,abc"],
      },
      {
        role: "user",
        content: "see file",
        attachments: [{ kind: "text", name: "a.csv", text: "row" }],
      },
    ]);
    expect(modelMessages[0]).toMatchObject({ role: "user" });
    expect(Array.isArray(modelMessages[0].content)).toBe(true);
    expect(modelMessages[1]).toMatchObject({ role: "user", content: expect.stringContaining("see file") });
  });
});

describe("countToolsInAgentMessages", () => {
  it("returns zero for empty input and counts tool-call parts only", () => {
    expect(countToolsInAgentMessages()).toBe(0);
    expect(countToolsInAgentMessages([])).toBe(0);
    expect(
      countToolsInAgentMessages([
        { role: "assistant", content: "text only" },
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "a", toolName: "x", input: {} },
            { type: "tool-call", toolCallId: "b", toolName: "y", input: {} },
            { type: "text", text: "done" },
          ],
        },
      ]),
    ).toBe(2);
  });
});
