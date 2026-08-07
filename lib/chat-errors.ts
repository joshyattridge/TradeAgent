/** Build a chat-visible message from a non-streaming `/api/chat` response. */
export function formatChatHttpError(opts: {
  status: number;
  contentType?: string | null;
  data?: unknown;
  rawText?: string;
}): string {
  const { status, contentType, data, rawText } = opts;
  const statusBit = Number.isFinite(status) ? String(status) : "unknown";
  const emptyObject =
    !!data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    Object.keys(data as object).length === 0;

  if (data && typeof data === "object" && !emptyObject) {
    const obj = data as Record<string, unknown>;
    if (typeof obj.reply === "string" && obj.reply.trim()) {
      return obj.reply.trim();
    }
    if (typeof obj.error === "string" && obj.error.trim()) {
      return `Chat request failed (${statusBit}): ${obj.error.trim()}`;
    }
    if (typeof obj.message === "string" && obj.message.trim()) {
      return `Chat request failed (${statusBit}): ${obj.message.trim()}`;
    }
    try {
      const serialized = JSON.stringify(obj);
      if (serialized && serialized !== "{}") {
        return `Chat request failed (${statusBit}): ${serialized}`;
      }
    } catch {
      // ignore
    }
  }

  const trimmed = rawText?.trim();
  if (trimmed && !emptyObject) {
    const preview = trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
    return `Chat request failed (${statusBit}): ${preview}`;
  }

  const typeBit = contentType?.trim() ? `, ${contentType.trim()}` : "";
  return `Chat request failed (${statusBit}${typeBit}). No error details in the response.`;
}

/** Prefer the stream event reply; otherwise include whatever fields we have. */
export function formatChatStreamError(event: {
  reply?: unknown;
  message?: unknown;
  detail?: unknown;
  type?: unknown;
}): string {
  if (typeof event.reply === "string" && event.reply.trim()) {
    return event.reply.trim();
  }
  if (typeof event.message === "string" && event.message.trim()) {
    return `Chat stream error: ${event.message.trim()}`;
  }
  if (typeof event.detail === "string" && event.detail.trim()) {
    return `Chat stream error: ${event.detail.trim()}`;
  }
  try {
    const serialized = JSON.stringify(event);
    if (serialized && serialized !== "{}") {
      return `Chat stream error: ${serialized}`;
    }
  } catch {
    // ignore
  }
  return "Chat stream error with no details from the server.";
}

export function formatChatNetworkError(err: unknown): string {
  const detail =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "unknown error";
  return `Couldn't reach the AI endpoint: ${detail}`;
}
