import { promises as fs } from "fs";
import path from "path";
import type { ChatAgentMessage } from "@/lib/chat-history";
import { sanitizeJsonValue } from "@/lib/chat-history";

export function getChatLogDir() {
  const override = process.env.TRADEAGENT_CHAT_LOG_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(process.cwd(), "logs", "chats");
}

/** Keep ids filesystem-safe and block path traversal. */
export function safeChatLogId(chatLogId: string) {
  const cleaned = chatLogId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return cleaned || "unknown";
}

export function chatLogFilePath(chatLogId: string) {
  return path.join(getChatLogDir(), `${safeChatLogId(chatLogId)}.log`);
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(sanitizeJsonValue(value), null, 2);
  } catch {
    return String(value);
  }
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

export function formatChatLogTurn(opts: {
  userText: string;
  reply?: string;
  error?: string;
  agentMessages?: ChatAgentMessage[];
  model?: string;
  attachmentNames?: string[];
  at?: string;
}) {
  const at = opts.at ?? new Date().toISOString();
  const lines: string[] = [
    `-------- turn ${at} --------`,
  ];
  if (opts.model) lines.push(`model: ${opts.model}`);
  if (opts.attachmentNames?.length) {
    lines.push(`attachments: ${opts.attachmentNames.join(", ")}`);
  }
  lines.push("USER:");
  lines.push(opts.userText.trim() || "(empty)");
  lines.push("");

  if (opts.agentMessages?.length) {
    lines.push(...formatAgentMessages(opts.agentMessages));
  }

  if (opts.error) {
    lines.push("ERROR:");
    lines.push(opts.error.trim());
    lines.push("");
  } else if (opts.reply?.trim()) {
    // Prefer explicit final reply when agentMessages didn't already include it
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

export async function appendChatLogTurn(opts: {
  chatLogId: string;
  userText: string;
  reply?: string;
  error?: string;
  agentMessages?: ChatAgentMessage[];
  model?: string;
  attachmentNames?: string[];
}) {
  const id = safeChatLogId(opts.chatLogId);
  const dir = getChatLogDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.log`);

  let prefix = "";
  try {
    await fs.access(filePath);
  } catch {
    prefix = formatChatLogHeader(id);
  }

  const body = formatChatLogTurn({
    userText: opts.userText,
    reply: opts.reply,
    error: opts.error,
    agentMessages: opts.agentMessages,
    model: opts.model,
    attachmentNames: opts.attachmentNames,
  });

  await fs.appendFile(filePath, `${prefix}${body}`, "utf8");
  return filePath;
}
