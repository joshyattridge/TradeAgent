import type { ModelMessage } from "ai";
import {
  buildUserContentParts,
  type ChatAttachmentPayload,
} from "@/lib/chat-attachments";

/**
 * Serializable assistant/tool messages from one agent turn
 * (same shape the AI SDK uses in responseMessages).
 */
export type ChatAgentMessage =
  | {
      role: "assistant";
      content:
        | string
        | Array<
            | { type: "text"; text: string }
            | {
                type: "tool-call";
                toolCallId: string;
                toolName: string;
                input: unknown;
              }
            | {
                type: "tool-result";
                toolCallId: string;
                toolName: string;
                output: unknown;
              }
          >;
    }
  | {
      role: "tool";
      content: Array<{
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        output: unknown;
      }>;
    };

export type HistoryMessage = {
  role: "user" | "assistant" | string;
  content: string;
  images?: string[];
  attachments?: ChatAttachmentPayload[];
  /** Cursor/Claude Code–style tool transcript for this assistant turn. */
  agentMessages?: ChatAgentMessage[];
};

/** Drop huge screenshot payloads from nested tool JSON while keeping structure. */
export function sanitizeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[truncated]";
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) return "[image omitted]";
    if (value.length > 50_000) return `${value.slice(0, 50_000)}\n[…truncated]`;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeJsonValue(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (key === "screenshots" && Array.isArray(v)) {
        out[key] = `[${v.length} screenshot(s)]`;
        continue;
      }
      out[key] = sanitizeJsonValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

function sanitizeToolOutput(output: unknown): unknown {
  if (!output || typeof output !== "object") {
    return sanitizeJsonValue(output);
  }
  const o = output as Record<string, unknown>;
  // AI SDK ToolResultOutput: { type: 'json'|'text'|..., value }
  if (typeof o.type === "string" && "value" in o) {
    return { ...o, value: sanitizeJsonValue(o.value) };
  }
  return sanitizeJsonValue(output);
}

/** Make responseMessages JSON-safe for chat persistence / next-turn replay. */
export function sanitizeAgentMessages(raw: unknown): ChatAgentMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatAgentMessage[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;

    if (m.role === "assistant") {
      if (typeof m.content === "string") {
        out.push({ role: "assistant", content: m.content });
        continue;
      }
      if (!Array.isArray(m.content)) continue;

      const parts: Array<
        | { type: "text"; text: string }
        | {
            type: "tool-call";
            toolCallId: string;
            toolName: string;
            input: unknown;
          }
        | {
            type: "tool-result";
            toolCallId: string;
            toolName: string;
            output: unknown;
          }
      > = [];

      for (const part of m.content) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, unknown>;
        if (p.type === "text" && typeof p.text === "string") {
          parts.push({ type: "text", text: p.text });
        } else if (
          p.type === "tool-call" &&
          typeof p.toolCallId === "string" &&
          typeof p.toolName === "string"
        ) {
          parts.push({
            type: "tool-call",
            toolCallId: p.toolCallId,
            toolName: p.toolName,
            input: sanitizeJsonValue(p.input),
          });
        } else if (
          p.type === "tool-result" &&
          typeof p.toolCallId === "string" &&
          typeof p.toolName === "string"
        ) {
          parts.push({
            type: "tool-result",
            toolCallId: p.toolCallId,
            toolName: p.toolName,
            output: sanitizeToolOutput(p.output),
          });
        }
      }

      if (parts.length) out.push({ role: "assistant", content: parts });
      continue;
    }

    if (m.role === "tool" && Array.isArray(m.content)) {
      const content: Array<{
        type: "tool-result";
        toolCallId: string;
        toolName: string;
        output: unknown;
      }> = [];
      for (const part of m.content) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, unknown>;
        if (
          p.type === "tool-result" &&
          typeof p.toolCallId === "string" &&
          typeof p.toolName === "string"
        ) {
          content.push({
            type: "tool-result",
            toolCallId: p.toolCallId,
            toolName: p.toolName,
            output: sanitizeToolOutput(p.output),
          });
        }
      }
      if (content.length) out.push({ role: "tool", content });
    }
  }

  return out;
}

/** Ensure the turn ends with the user-facing final reply text. */
export function ensureFinalAssistantText(
  messages: ChatAgentMessage[],
  reply: string,
): ChatAgentMessage[] {
  const text = reply.trim();
  if (!text) return messages;

  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") {
    return [...messages, { role: "assistant", content: text }];
  }

  if (typeof last.content === "string") {
    if (last.content.trim() === text) return messages;
    return [...messages.slice(0, -1), { role: "assistant", content: text }];
  }

  const parts = [...last.content];
  const nonText = parts.filter((p) => p.type !== "text");
  const existingText = parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");

  if (existingText.trim() === text && nonText.length === parts.length - 1) {
    return messages;
  }

  return [
    ...messages.slice(0, -1),
    {
      role: "assistant",
      content: [...nonText, { type: "text", text }],
    },
  ];
}

/**
 * Expand stored chat history into AI SDK ModelMessages, including tool transcripts.
 */
export function expandHistoryToModelMessages(
  history: HistoryMessage[],
): ModelMessage[] {
  const out: ModelMessage[] = [];

  for (const m of history) {
    if (m.role === "user") {
      const hasText = typeof m.content === "string" && m.content.trim().length > 0;
      const hasImages = Boolean(m.images?.length);
      const hasAttachments = Boolean(m.attachments?.length);
      if (!hasText && !hasImages && !hasAttachments) continue;

      const parts = buildUserContentParts({
        text: m.content || "",
        images: m.images,
        attachments: m.attachments,
        imageDetail: "high",
      });
      out.push(
        parts.length > 1
          ? { role: "user", content: parts }
          : {
              role: "user",
              content: (parts[0] as { type: "text"; text: string }).text,
            },
      );
      continue;
    }

    if (m.role !== "assistant") continue;

    if (m.agentMessages?.length) {
      for (const am of m.agentMessages) {
        out.push(am as ModelMessage);
      }
      continue;
    }

    if (m.content?.trim()) {
      out.push({ role: "assistant", content: m.content });
    }
  }

  return out;
}

export function countToolsInAgentMessages(messages?: ChatAgentMessage[]): number {
  if (!messages?.length) return 0;
  let n = 0;
  for (const m of messages) {
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    n += m.content.filter((p) => p.type === "tool-call").length;
  }
  return n;
}
