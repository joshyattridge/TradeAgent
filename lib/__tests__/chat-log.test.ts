import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import {
  appendChatLogTurn,
  chatLogFilePath,
  formatChatLogHeader,
  formatChatLogTurn,
  getChatLogDir,
  safeChatLogId,
} from "@/lib/chat-log";

describe("chat-log", () => {
  let prevDir: string | undefined;

  beforeEach(() => {
    prevDir = process.env.TRADEAGENT_CHAT_LOG_DIR;
  });

  afterEach(async () => {
    if (prevDir === undefined) delete process.env.TRADEAGENT_CHAT_LOG_DIR;
    else process.env.TRADEAGENT_CHAT_LOG_DIR = prevDir;
    vi.restoreAllMocks();
  });

  it("sanitizes chat log ids", () => {
    expect(safeChatLogId("../evil/../x")).toBe("evilx");
    expect(safeChatLogId("abc-123_OK")).toBe("abc-123_OK");
    expect(safeChatLogId("!!!")).toBe("unknown");
  });

  it("resolves log dir from env or project default", () => {
    delete process.env.TRADEAGENT_CHAT_LOG_DIR;
    expect(getChatLogDir()).toBe(path.join(process.cwd(), "logs", "chats"));
    process.env.TRADEAGENT_CHAT_LOG_DIR = "  /tmp/chat-logs  ";
    expect(getChatLogDir()).toBe(path.resolve("/tmp/chat-logs"));
  });

  it("formats a turn with tool calls and results", () => {
    const text = formatChatLogTurn({
      at: "2026-08-01T10:00:00.000Z",
      model: "gpt-test",
      userText: "how am I doing?",
      attachmentNames: ["shot.png"],
      agentMessages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "c1",
              toolName: "get_stats",
              input: { closedOnly: true },
            },
            {
              type: "tool-result",
              toolCallId: "c1",
              toolName: "get_stats",
              output: { ok: true, stats: { wins: 1, losses: 3 } },
            },
            {
              type: "text",
              text: "You are down overall.",
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "c9",
              toolName: "query_trades",
              output: { ok: true, count: 7 },
            },
          ],
        },
        {
          role: "assistant",
          content: "Final spoken line.",
        },
      ],
      reply: "different final",
    });

    expect(text).toContain("-------- turn 2026-08-01T10:00:00.000Z --------");
    expect(text).toContain("model: gpt-test");
    expect(text).toContain("attachments: shot.png");
    expect(text).toContain("USER:\nhow am I doing?");
    expect(text).toContain("TOOL CALL get_stats (c1)");
    expect(text).toContain('"closedOnly": true');
    expect(text).toContain("TOOL RESULT get_stats (c1)");
    expect(text).toContain("TOOL RESULT query_trades (c9)");
    expect(text).toContain('"wins": 1');
    expect(text).toContain("ASSISTANT:\nYou are down overall.");
    expect(text).toContain("ASSISTANT:\nFinal spoken line.");
    expect(text).toContain("ASSISTANT:\ndifferent final");
  });

  it("formats error turns and falls back when JSON stringify fails", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const stringify = vi.spyOn(JSON, "stringify").mockImplementation(() => {
      throw new Error("boom");
    });

    const text = formatChatLogTurn({
      userText: "   ",
      error: "  something broke  ",
      agentMessages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "c2",
              toolName: "query_trades",
              input: circular,
            },
          ],
        },
      ],
    });

    expect(text).toContain("USER:\n(empty)");
    expect(text).toContain("ERROR:\nsomething broke");
    expect(text).toContain("TOOL CALL query_trades (c2)");
    expect(text).toContain("[object Object]");
    stringify.mockRestore();
  });

  it("appends an explicit reply when agentMessages omit it", () => {
    const text = formatChatLogTurn({
      userText: "hi",
      reply: "hello there",
      agentMessages: [
        {
          role: "assistant",
          content: "   ",
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "   " }],
        },
      ],
    });
    expect(text).toContain("ASSISTANT:\nhello there");
  });

  it("does not duplicate a reply already present as assistant text", () => {
    const asString = formatChatLogTurn({
      userText: "hi",
      reply: "same",
      agentMessages: [{ role: "assistant", content: "same" }],
    });
    expect(asString.match(/ASSISTANT:/g)?.length).toBe(1);

    const asParts = formatChatLogTurn({
      userText: "hi",
      reply: "same",
      agentMessages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "same" }],
        },
      ],
    });
    expect(asParts.match(/ASSISTANT:/g)?.length).toBe(1);
  });

  it("ignores unknown agent message roles and blank replies", () => {
    const text = formatChatLogTurn({
      userText: "ping",
      reply: "   ",
      agentMessages: [
        // @ts-expect-error intentional unknown role for coverage
        { role: "system", content: "ignore me" },
      ],
    });
    expect(text).toContain("USER:\nping");
    expect(text).not.toContain("ASSISTANT:");
    expect(text).not.toContain("ignore me");
  });

  it("writes a header once then appends turns to disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tradeagent-chatlog-"));
    process.env.TRADEAGENT_CHAT_LOG_DIR = dir;

    const id = "session-1";
    await appendChatLogTurn({
      chatLogId: id,
      userText: "first",
      reply: "hello",
    });
    await appendChatLogTurn({
      chatLogId: id,
      userText: "second",
      reply: "again",
    });

    const file = chatLogFilePath(id);
    const contents = await readFile(file, "utf8");
    expect(contents.startsWith(formatChatLogHeader(id).slice(0, 20))).toBe(true);
    expect(contents).toContain("USER:\nfirst");
    expect(contents).toContain("USER:\nsecond");
    expect(contents.match(/======== chat session-1 started/g)?.length).toBe(1);

    await rm(dir, { recursive: true, force: true });
  });
});
