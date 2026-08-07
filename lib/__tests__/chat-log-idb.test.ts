/**
 * @vitest-environment jsdom
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  appendChatLogTurnIdb,
  clearChatLogIdb,
  readChatLogIdb,
} from "@/lib/chat-log-idb";

describe("chat-log-idb", () => {
  beforeEach(async () => {
    await clearChatLogIdb("sess-1");
  });

  it("writes a header once then appends turns", async () => {
    await appendChatLogTurnIdb({
      chatLogId: "sess-1",
      userText: "first",
      reply: "hello",
      model: "gpt-test",
    });
    await appendChatLogTurnIdb({
      chatLogId: "sess-1",
      userText: "second",
      reply: "again",
    });

    const contents = await readChatLogIdb("sess-1");
    expect(contents).toContain("======== chat sess-1 started");
    expect(contents).toContain("USER:\nfirst");
    expect(contents).toContain("USER:\nsecond");
    expect(contents?.match(/======== chat sess-1 started/g)?.length).toBe(1);
  });

  it("stores LLM call traces", async () => {
    await appendChatLogTurnIdb({
      chatLogId: "sess-1",
      userText: "hi",
      reply: "yo",
      llmCalls: [
        {
          kind: "agent",
          model: "gpt-test",
          request: { system: "sys", messages: [] },
          response: { text: "yo" },
        },
      ],
    });
    const contents = await readChatLogIdb("sess-1");
    expect(contents).toContain("======== LLM AGENT ========");
    expect(contents).toContain("system:\nsys");
  });

  it("clears logs", async () => {
    await appendChatLogTurnIdb({ chatLogId: "sess-1", userText: "x", reply: "y" });
    await clearChatLogIdb("sess-1");
    expect(await readChatLogIdb("sess-1")).toBeNull();
  });
});
