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
});
