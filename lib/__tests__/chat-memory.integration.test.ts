import { describe, expect, it } from "vitest";
import { buildUserContentParts } from "@/lib/chat-attachments";
import {
  ensureFinalAssistantText,
  expandHistoryToModelMessages,
  type HistoryMessage,
} from "@/lib/chat-history";
import { sanitizeHistory } from "@/lib/chat-request";

/**
 * Simulates what ChatWidget stores after turn 1, then what turn 2 sends
 * through /api/chat sanitize → model message expansion.
 */
describe("multi-turn chat memory (Cursor-style)", () => {
  const csvBody = [
    "symbol,side,entry,stop,target,exit,pnl,r",
    "EURUSD,long,1.13899,1.13746,1.14036,1.14076,-654.90,-1.29",
    "USDCAD,short,1.37,1.372,1.365,1.3655,200,1.95",
  ].join("\n");

  const turn1History: HistoryMessage[] = [
    {
      role: "user",
      content: "Are all the trades correct to this csv file?",
      attachments: [
        {
          kind: "text",
          name: "trading-journal-2.csv",
          text: csvBody,
          mime: "text/csv",
        },
      ],
    },
    {
      role: "assistant",
      content: "Journal has 7 trades. Comparing to the CSV…",
      agentMessages: ensureFinalAssistantText(
        [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call_query",
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
                toolCallId: "call_query",
                toolName: "query_trades",
                output: {
                  type: "json",
                  value: {
                    ok: true,
                    count: 7,
                    journal: { total: 7, open: 0, closed: 7 },
                    trades: [
                      {
                        id: "eur-1",
                        symbol: "EURUSD",
                        side: "long",
                        rMultiple: -1.29,
                      },
                    ],
                  },
                },
              },
            ],
          },
        ],
        "Journal has 7 trades. Comparing to the CSV…",
      ),
    },
  ];

  it("round-trips attachments + tool transcripts through API sanitize", () => {
    const sanitized = sanitizeHistory(turn1History);
    expect(sanitized).toHaveLength(2);
    expect(sanitized[0]?.attachments?.[0]).toMatchObject({
      kind: "text",
      name: "trading-journal-2.csv",
    });
    expect(sanitized[0]?.attachments?.[0]?.kind === "text"
      ? sanitized[0]?.attachments?.[0].text
      : "").toContain("EURUSD,long");
    expect(sanitized[1]?.agentMessages?.length).toBeGreaterThan(0);
  });

  it("follow-up turn model context still contains CSV text and prior tool results", () => {
    const sanitized = sanitizeHistory(turn1History);
    const modelMessages = expandHistoryToModelMessages(sanitized);

    // user (with CSV inlined) + assistant tool-call + tool result + final assistant text
    expect(modelMessages.length).toBeGreaterThanOrEqual(4);

    const firstUser = modelMessages[0];
    expect(firstUser?.role).toBe("user");
    const userText =
      typeof firstUser?.content === "string"
        ? firstUser.content
        : firstUser?.content
            ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join("\n") ?? "";

    expect(userText).toContain("trading-journal-2.csv");
    expect(userText).toContain("EURUSD,long");
    expect(userText).toContain("USDCAD,short");

    const toolMsg = modelMessages.find((m) => m.role === "tool");
    expect(toolMsg).toBeTruthy();
    const toolJson = JSON.stringify(toolMsg);
    expect(toolJson).toContain("query_trades");
    expect(toolJson).toContain("eur-1");
    expect(toolJson).toContain('"total":7');

    // Simulate turn 2: only new user text, history = turn1
    const turn2Parts = buildUserContentParts({
      text: "can you check the stats of each trade is correct to the csv",
    });
    const turn2Messages = [
      ...modelMessages,
      { role: "user" as const, content: turn2Parts[0]?.type === "text" ? turn2Parts[0].text : "" },
    ];

    // CSV must still be present without re-attach
    const allText = JSON.stringify(turn2Messages);
    expect(allText).toContain("trading-journal-2.csv");
    expect(allText).toContain("EURUSD,long,1.13899");
    expect(allText).toContain("call_query");
  });

  it("clear chat empties memory (new session)", () => {
    expect(expandHistoryToModelMessages([])).toEqual([]);
    expect(sanitizeHistory([])).toEqual([]);
  });

  it("survives JSON persist round-trip like IndexedDB", () => {
    const reloaded = JSON.parse(JSON.stringify(turn1History));
    const modelMessages = expandHistoryToModelMessages(sanitizeHistory(reloaded));
    const blob = JSON.stringify(modelMessages);
    expect(blob).toContain("trading-journal-2.csv");
    expect(blob).toContain("EURUSD,long,1.13899");
    expect(blob).toContain("query_trades");
    expect(blob).toContain("eur-1");
  });
});
