import type { ChatAgentMessage } from "@/lib/chat-history";
import { sanitizeJsonValue } from "@/lib/chat-history";

/** Keep ids filesystem-safe and block path traversal. */
export function safeChatLogId(chatLogId: string) {
  const cleaned = chatLogId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return cleaned || "unknown";
}

/** One model round-trip (main agent loop or polish generateText). */
export type LlmCallLog = {
  kind: "agent" | "polish";
  model: string;
  reasoningEffort?: string;
  request: {
    system: string;
    messages: unknown;
    tools?: string[];
  };
  response: {
    text?: string;
    steps?: number;
    messages?: ChatAgentMessage[];
    error?: string;
  };
};

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(sanitizeJsonValue(value), null, 2);
  } catch {
    return String(value);
  }
}

/** Snapshot of messages sent to the model, with image bytes stripped. */
export function sanitizeLlmMessagesForLog(messages: unknown): unknown {
  return sanitizeJsonValue(messages);
}

function formatAgentMessages(agentMessages: ChatAgentMessage[]): string[] {
  const lines: string[] = [];

  for (const message of agentMessages) {
    if (message.role === "assistant") {
      if (typeof message.content === "string") {
        if (message.content.trim()) {
          lines.push("ASSISTANT:");
          lines.push(message.content.trim());
          lines.push("");
        }
        continue;
      }
      for (const part of message.content) {
        if (part.type === "text" && part.text.trim()) {
          lines.push("ASSISTANT:");
          lines.push(part.text.trim());
          lines.push("");
        } else if (part.type === "tool-call") {
          lines.push(`TOOL CALL ${part.toolName} (${part.toolCallId})`);
          lines.push(prettyJson(part.input));
          lines.push("");
        } else if (part.type === "tool-result") {
          lines.push(`TOOL RESULT ${part.toolName} (${part.toolCallId})`);
          lines.push(prettyJson(part.output));
          lines.push("");
        }
      }
      continue;
    }

    if (message.role === "tool") {
      for (const part of message.content) {
        lines.push(`TOOL RESULT ${part.toolName} (${part.toolCallId})`);
        lines.push(prettyJson(part.output));
        lines.push("");
      }
    }
  }

  return lines;
}

export function formatLlmCall(call: LlmCallLog): string[] {
  const lines: string[] = [
    `======== LLM ${call.kind.toUpperCase()} ========`,
    "REQUEST:",
    `model: ${call.model}`,
  ];
  if (call.reasoningEffort) {
    lines.push(`reasoningEffort: ${call.reasoningEffort}`);
  }
  if (call.request.tools?.length) {
    lines.push(`tools: ${call.request.tools.join(", ")}`);
  }
  lines.push("system:");
  lines.push(call.request.system);
  lines.push("");
  lines.push("messages:");
  lines.push(prettyJson(call.request.messages));
  lines.push("");
  lines.push("RESPONSE:");
  if (call.response.error) {
    lines.push(`error: ${call.response.error}`);
    lines.push("");
    return lines;
  }
  if (typeof call.response.steps === "number") {
    lines.push(`steps: ${call.response.steps}`);
  }
  if (call.response.messages?.length) {
    lines.push("responseMessages:");
    lines.push(...formatAgentMessages(call.response.messages));
  }
  if (call.response.text?.trim()) {
    lines.push("text:");
    lines.push(call.response.text.trim());
    lines.push("");
  }
  return lines;
}

export function formatChatLogTurn(opts: {
  userText: string;
  reply?: string;
  error?: string;
  agentMessages?: ChatAgentMessage[];
  llmCalls?: LlmCallLog[];
  model?: string;
  attachmentNames?: string[];
  at?: string;
}) {
  const at = opts.at ?? new Date().toISOString();
  const lines: string[] = [`-------- turn ${at} --------`];
  if (opts.model) lines.push(`model: ${opts.model}`);
  if (opts.attachmentNames?.length) {
    lines.push(`attachments: ${opts.attachmentNames.join(", ")}`);
  }
  lines.push("USER:");
  lines.push(opts.userText.trim() || "(empty)");
  lines.push("");

  if (opts.llmCalls?.length) {
    for (const call of opts.llmCalls) {
      lines.push(...formatLlmCall(call));
    }
    if (opts.reply?.trim()) {
      const last = opts.llmCalls[opts.llmCalls.length - 1];
      if (last.response.text?.trim() !== opts.reply.trim()) {
        lines.push("FINAL REPLY:");
        lines.push(opts.reply.trim());
        lines.push("");
      }
    }
  } else if (opts.agentMessages?.length) {
    lines.push(...formatAgentMessages(opts.agentMessages));
  }

  if (opts.error) {
    lines.push("ERROR:");
    lines.push(opts.error.trim());
    lines.push("");
  } else if (opts.reply?.trim() && !opts.llmCalls?.length) {
    const alreadyHasReply = opts.agentMessages?.some((m) => {
      if (m.role !== "assistant") return false;
      if (typeof m.content === "string") {
        return m.content.trim() === opts.reply!.trim();
      }
      return m.content.some(
        (p) => p.type === "text" && p.text.trim() === opts.reply!.trim(),
      );
    });
    if (!alreadyHasReply) {
      lines.push("ASSISTANT:");
      lines.push(opts.reply.trim());
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n\n`;
}

export function formatChatLogHeader(chatLogId: string, at = new Date().toISOString()) {
  return `======== chat ${safeChatLogId(chatLogId)} started ${at} ========\n\n`;
}
