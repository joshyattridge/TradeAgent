import { describe, expect, it } from "vitest";
import {
  formatChatHttpError,
  formatChatNetworkError,
  formatChatStreamError,
} from "@/lib/chat-errors";

describe("formatChatHttpError", () => {
  it("prefers reply, then error/message, then serialized body", () => {
    expect(
      formatChatHttpError({
        status: 401,
        data: { reply: "No key", error: "hidden" },
      }),
    ).toBe("No key");
    expect(
      formatChatHttpError({ status: 400, data: { error: "Missing strategy" } }),
    ).toBe("Chat request failed (400): Missing strategy");
    expect(
      formatChatHttpError({ status: 500, data: { message: "boom" } }),
    ).toBe("Chat request failed (500): boom");
    expect(
      formatChatHttpError({ status: 502, data: { code: "upstream" } }),
    ).toBe('Chat request failed (502): {"code":"upstream"}');
  });

  it("falls back to raw text or a status-only message", () => {
    expect(
      formatChatHttpError({
        status: 504,
        contentType: "text/html",
        rawText: "<html>timeout</html>",
      }),
    ).toBe("Chat request failed (504): <html>timeout</html>");
    expect(
      formatChatHttpError({
        status: 200,
        contentType: "application/json",
        data: {},
      }),
    ).toBe(
      "Chat request failed (200, application/json). No error details in the response.",
    );
  });

  it("covers edge branches for status, arrays, truncation, and stringify failure", () => {
    expect(
      formatChatHttpError({
        status: Number.NaN,
        contentType: "   ",
        data: ["x"],
      }),
    ).toBe('Chat request failed (unknown): ["x"]');

    expect(
      formatChatHttpError({
        status: 413,
        rawText: `${"a".repeat(501)}`,
      }),
    ).toBe(`Chat request failed (413): ${"a".repeat(500)}…`);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(
      formatChatHttpError({
        status: 500,
        contentType: null,
        data: cyclic,
      }),
    ).toBe("Chat request failed (500). No error details in the response.");

    expect(
      formatChatHttpError({
        status: 400,
        data: { reply: "   ", error: "   ", message: "   ", code: 1 },
      }),
    ).toBe('Chat request failed (400): {"reply":"   ","error":"   ","message":"   ","code":1}');
  });
});

describe("formatChatStreamError", () => {
  it("uses reply/message/detail or serializes the event", () => {
    expect(formatChatStreamError({ reply: "OpenAI error: rate limited" })).toBe(
      "OpenAI error: rate limited",
    );
    expect(formatChatStreamError({ message: "tool failed" })).toBe(
      "Chat stream error: tool failed",
    );
    expect(formatChatStreamError({ detail: "timeout" })).toBe(
      "Chat stream error: timeout",
    );
    expect(formatChatStreamError({ type: "error", code: 42 } as never)).toBe(
      'Chat stream error: {"type":"error","code":42}',
    );
    expect(formatChatStreamError({})).toBe(
      "Chat stream error with no details from the server.",
    );
  });

  it("survives JSON.stringify failures on stream events", () => {
    const cyclic: Record<string, unknown> = { type: "error" };
    cyclic.self = cyclic;
    expect(formatChatStreamError(cyclic)).toBe(
      "Chat stream error with no details from the server.",
    );
  });
});

describe("formatChatNetworkError", () => {
  it("includes the underlying error detail", () => {
    expect(formatChatNetworkError(new Error("network down"))).toBe(
      "Couldn't reach the AI endpoint: network down",
    );
    expect(formatChatNetworkError("offline")).toBe(
      "Couldn't reach the AI endpoint: offline",
    );
    expect(formatChatNetworkError(42)).toBe(
      "Couldn't reach the AI endpoint: unknown error",
    );
  });
});
