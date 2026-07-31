/**
 * Shared request sanitizers used by /api/chat — exported for tests.
 */
import type { ChatAttachmentPayload } from "@/lib/chat-attachments";
import type { HistoryMessage } from "@/lib/chat-history";
import { sanitizeAgentMessages } from "@/lib/chat-history";

const MAX_TEXT_CHARS = 120_000;

export function sanitizeAttachment(item: unknown): ChatAttachmentPayload | null {
  if (!item || typeof item !== "object") return null;
  const a = item as Record<string, unknown>;
  const name =
    typeof a.name === "string" && a.name.trim()
      ? a.name.trim().slice(0, 200)
      : "attachment";

  if (a.kind === "image" && typeof a.dataUrl === "string") {
    if (!a.dataUrl.startsWith("data:image/")) return null;
    return {
      kind: "image",
      name,
      dataUrl: a.dataUrl,
      mime: typeof a.mime === "string" ? a.mime : undefined,
    };
  }

  if (a.kind === "text" && typeof a.text === "string") {
    const text =
      a.text.length > MAX_TEXT_CHARS
        ? `${a.text.slice(0, MAX_TEXT_CHARS)}\n\n[…truncated]`
        : a.text;
    if (!text.trim()) return null;
    return {
      kind: "text",
      name,
      text,
      mime: typeof a.mime === "string" ? a.mime : undefined,
    };
  }

  if (a.kind === "file" && typeof a.dataUrl === "string") {
    if (!a.dataUrl.startsWith("data:")) return null;
    const mime =
      typeof a.mime === "string" && a.mime.trim()
        ? a.mime.trim()
        : "application/pdf";
    return { kind: "file", name, dataUrl: a.dataUrl, mime };
  }

  return null;
}

export function sanitizeAttachments(raw: unknown): ChatAttachmentPayload[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatAttachmentPayload[] = [];
  for (const item of raw) {
    const next = sanitizeAttachment(item);
    if (next) out.push(next);
  }
  return out;
}

/** Sanitize the history array the client sends on every chat request. */
export function sanitizeHistory(raw: unknown): HistoryMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    const role =
      m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : null;
    if (!role) continue;
    const content = typeof m.content === "string" ? m.content : "";
    const images = Array.isArray(m.images)
      ? m.images.filter(
          (img): img is string =>
            typeof img === "string" && img.startsWith("data:image/"),
        )
      : undefined;
    const attachments = sanitizeAttachments(m.attachments);
    const agentMessages = sanitizeAgentMessages(m.agentMessages);
    if (
      !content.trim() &&
      !images?.length &&
      !attachments.length &&
      !agentMessages.length
    ) {
      continue;
    }
    out.push({
      role,
      content,
      ...(images?.length ? { images } : {}),
      ...(attachments.length ? { attachments } : {}),
      ...(agentMessages.length ? { agentMessages } : {}),
    });
  }
  return out;
}
