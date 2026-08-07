import { promises as fs } from "fs";
import path from "path";
import type { ChatAgentMessage } from "@/lib/chat-history";
import {
  formatChatLogHeader,
  formatChatLogTurn,
  safeChatLogId,
  type LlmCallLog,
} from "@/lib/chat-log-format";

export {
  formatChatLogHeader,
  formatChatLogTurn,
  formatLlmCall,
  safeChatLogId,
  sanitizeLlmMessagesForLog,
  type LlmCallLog,
} from "@/lib/chat-log-format";

export function getChatLogDir() {
  const override = process.env.TRADEAGENT_CHAT_LOG_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(process.cwd(), "logs", "chats");
}

export function chatLogFilePath(chatLogId: string) {
  return path.join(getChatLogDir(), `${safeChatLogId(chatLogId)}.log`);
}

/** Node/evals only — browser chat uses IndexedDB (`chat-log-idb`). */
export async function appendChatLogTurn(opts: {
  chatLogId: string;
  userText: string;
  reply?: string;
  error?: string;
  agentMessages?: ChatAgentMessage[];
  llmCalls?: LlmCallLog[];
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
    llmCalls: opts.llmCalls,
    model: opts.model,
    attachmentNames: opts.attachmentNames,
  });

  await fs.appendFile(filePath, `${prefix}${body}`, "utf8");
  return filePath;
}
