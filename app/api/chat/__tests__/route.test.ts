import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Strategy } from "@/lib/types";

const mockStreamAgentLoop = vi.fn();

vi.mock("@/lib/chat-agent", () => ({
  streamAgentLoop: (...args: unknown[]) => mockStreamAgentLoop(...args),
}));

vi.mock("@/lib/chat-request", () => ({
  sanitizeAttachments: vi.fn((raw: unknown) =>
    Array.isArray(raw) ? raw : [],
  ),
  sanitizeHistory: vi.fn((raw: unknown) => (Array.isArray(raw) ? raw : [])),
}));

const mockAppendChatLogTurn = vi.fn().mockResolvedValue("/tmp/fake.log");

vi.mock("@/lib/chat-log", () => ({
  appendChatLogTurn: (...args: unknown[]) => mockAppendChatLogTurn(...args),
}));

import { POST } from "../route";

const strategy: Strategy = {
  name: "Test Strategy",
  markdown: "# Test",
  updatedAt: "2026-07-30T12:00:00.000Z",
};

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

async function readNdjson(response: Response) {
  const text = await response.text();
  if (!text.trim()) return [];
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    mockStreamAgentLoop.mockReset();
    mockAppendChatLogTurn.mockReset();
    mockAppendChatLogTurn.mockResolvedValue("/tmp/fake.log");
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
  });

  it("returns 400 for empty message with no attachments", async () => {
    const res = await POST(makeRequest({ message: "   ", strategy }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Empty message" });
  });

  it("returns 400 when strategy is missing", async () => {
    const res = await POST(makeRequest({ message: "hello", strategy: null }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing strategy" });
  });

  it("returns 401 when no API key is available", async () => {
    const res = await POST(makeRequest({ message: "hello", strategy }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      mode: "error",
      reply: expect.stringContaining("No OpenAI API key"),
    });
  });

  it("streams NDJSON events on success", async () => {
    process.env.OPENAI_API_KEY = "env-key";
    mockStreamAgentLoop.mockImplementation(async function* () {
      yield { type: "status", message: "Preparing…" };
      yield { type: "done", reply: "All good", actions: {} };
    });

    const res = await POST(
      makeRequest({
        message: "Analyze my week",
        strategy,
        chatLogId: "sess-abc",
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/x-ndjson; charset=utf-8",
    );

    const events = await readNdjson(res);
    expect(events).toEqual([
      { type: "status", message: "Preparing…" },
      { type: "done", reply: "All good", actions: {} },
    ]);
    expect(mockAppendChatLogTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatLogId: "sess-abc",
        userText: "Analyze my week",
        reply: "All good",
      }),
    );
  });

  it("uses default userText for attachments-only requests", async () => {
    process.env.OPENAI_API_KEY = "env-key";
    mockStreamAgentLoop.mockImplementation(async function* (opts) {
      expect(opts.userText).toBe(
        "Review the attached file(s) / image(s) in the context of my trading journal and strategy.",
      );
      yield { type: "status", message: "ok" };
    });

    const res = await POST(
      makeRequest({
        message: "  ",
        strategy,
        attachments: [
          {
            kind: "text",
            name: "notes.txt",
            text: "journal notes",
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    await readNdjson(res);
  });

  it("filters images to data:image/ strings only", async () => {
    process.env.OPENAI_API_KEY = "env-key";
    const valid = "data:image/png;base64,abc";
    mockStreamAgentLoop.mockImplementation(async function* (opts) {
      expect(opts.images).toEqual([valid]);
      yield { type: "status", message: "ok" };
    });

    const res = await POST(
      makeRequest({
        message: "check chart",
        strategy,
        images: [valid, "http://bad", "data:text/plain,x", 42],
      }),
    );
    expect(res.status).toBe(200);
    await readNdjson(res);
  });

  it("uses env API key and model when client values are absent", async () => {
    process.env.OPENAI_API_KEY = "env-key";
    process.env.OPENAI_MODEL = "env-model";
    mockStreamAgentLoop.mockImplementation(async function* (opts) {
      expect(opts.apiKey).toBe("env-key");
      expect(opts.model).toBe("env-model");
      yield { type: "status", message: "ok" };
    });

    const res = await POST(makeRequest({ message: "hi", strategy }));
    expect(res.status).toBe(200);
    await readNdjson(res);
  });

  it("prefers client apiKey and model over env", async () => {
    process.env.OPENAI_API_KEY = "env-key";
    process.env.OPENAI_MODEL = "env-model";
    mockStreamAgentLoop.mockImplementation(async function* (opts) {
      expect(opts.apiKey).toBe("client-key");
      expect(opts.model).toBe("client-model");
      yield { type: "status", message: "ok" };
    });

    const res = await POST(
      makeRequest({
        message: "hi",
        strategy,
        apiKey: "client-key",
        model: "client-model",
      }),
    );
    expect(res.status).toBe(200);
    await readNdjson(res);
  });

  it("falls back to default model when none provided", async () => {
    process.env.OPENAI_API_KEY = "env-key";
    mockStreamAgentLoop.mockImplementation(async function* (opts) {
      expect(opts.model).toBe("gpt-5.6-luna");
      yield { type: "status", message: "ok" };
    });

    const res = await POST(makeRequest({ message: "hi", strategy }));
    expect(res.status).toBe(200);
    await readNdjson(res);
  });

  it("emits error event when the generator throws", async () => {
    process.env.OPENAI_API_KEY = "env-key";
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockStreamAgentLoop.mockImplementation(async function* () {
      throw new Error("rate limited");
    });

    const res = await POST(makeRequest({ message: "hi", strategy }));
    const events = await readNdjson(res);
    expect(events).toEqual([
      {
        type: "error",
        reply: expect.stringContaining("OpenAI error: rate limited"),
      },
    ]);
    expect(mockAppendChatLogTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining("rate limited"),
      }),
    );
    consoleSpy.mockRestore();
  });

  it("logs stream error events and swallows log write failures", async () => {
    process.env.OPENAI_API_KEY = "env-key";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockAppendChatLogTurn
      .mockRejectedValueOnce(new Error("disk full"))
      .mockRejectedValueOnce(new Error("disk full again"));

    mockStreamAgentLoop.mockImplementation(async function* () {
      yield { type: "done", reply: "ok", actions: {} };
      yield { type: "error", reply: "stream failed" };
    });

    const res = await POST(
      makeRequest({ message: "hi", strategy, chatLogId: "log-fail" }),
    );
    const events = await readNdjson(res);
    expect(events).toEqual([
      { type: "done", reply: "ok", actions: {} },
      { type: "error", reply: "stream failed" },
    ]);
    expect(warn).toHaveBeenCalledWith(
      "[TradeAgent] chat log write failed",
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it("swallows log failures when the generator throws", async () => {
    process.env.OPENAI_API_KEY = "env-key";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockAppendChatLogTurn.mockRejectedValueOnce(new Error("cannot write"));
    mockStreamAgentLoop.mockImplementation(async function* () {
      throw new Error("boom");
    });

    const res = await POST(makeRequest({ message: "hi", strategy }));
    await readNdjson(res);
    expect(warn).toHaveBeenCalledWith(
      "[TradeAgent] chat log write failed",
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it("emits generic error message for non-Error throws", async () => {
    process.env.OPENAI_API_KEY = "env-key";
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockStreamAgentLoop.mockImplementation(async function* () {
      throw "network down";
    });

    const res = await POST(makeRequest({ message: "hi", strategy }));
    const events = await readNdjson(res);
    expect(events[0]).toMatchObject({
      type: "error",
      reply: expect.stringContaining("OpenAI request failed"),
    });
  });

  it("passes empty trades when trades is not an array", async () => {
    process.env.OPENAI_API_KEY = "env-key";
    mockStreamAgentLoop.mockImplementation(async function* (opts) {
      expect(opts.trades).toEqual([]);
      yield { type: "status", message: "ok" };
    });

    const res = await POST(
      makeRequest({ message: "hi", strategy, trades: "not-an-array" }),
    );
    expect(res.status).toBe(200);
    await readNdjson(res);
  });

  it("ignores non-string referencedTradeId", async () => {
    process.env.OPENAI_API_KEY = "env-key";
    mockStreamAgentLoop.mockImplementation(async function* (opts) {
      expect(opts.referencedTradeId).toBeUndefined();
      yield { type: "status", message: "ok" };
    });

    const res = await POST(
      makeRequest({ message: "hi", strategy, referencedTradeId: 123 }),
    );
    expect(res.status).toBe(200);
    await readNdjson(res);
  });

  it("passes string referencedTradeId through", async () => {
    process.env.OPENAI_API_KEY = "env-key";
    mockStreamAgentLoop.mockImplementation(async function* (opts) {
      expect(opts.referencedTradeId).toBe("trade-42");
      yield { type: "status", message: "ok" };
    });

    const res = await POST(
      makeRequest({ message: "hi", strategy, referencedTradeId: "trade-42" }),
    );
    expect(res.status).toBe(200);
    await readNdjson(res);
  });

  it("treats non-array images as empty", async () => {
    process.env.OPENAI_API_KEY = "env-key";
    mockStreamAgentLoop.mockImplementation(async function* (opts) {
      expect(opts.images).toEqual([]);
      yield { type: "status", message: "ok" };
    });

    const res = await POST(
      makeRequest({ message: "hi", strategy, images: "not-array" }),
    );
    expect(res.status).toBe(200);
    await readNdjson(res);
  });
});
