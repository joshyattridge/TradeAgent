import type { ChatAgentMessage } from "@/lib/chat-history";
import {
  formatChatLogHeader,
  formatChatLogTurn,
  safeChatLogId,
  type LlmCallLog,
} from "@/lib/chat-log-format";
import { idbStorage } from "@/lib/idb-storage";

function chatLogStorageKey(chatLogId: string) {
  return `tradeagent-chat-log:${safeChatLogId(chatLogId)}`;
}

/** Append a formatted turn to the browser chat log (IndexedDB). */
export async function appendChatLogTurnIdb(opts: {
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
  const key = chatLogStorageKey(id);
  const existing = (await idbStorage.getItem(key)) ?? "";
  const prefix = existing ? "" : formatChatLogHeader(id);
  const body = formatChatLogTurn({
    userText: opts.userText,
    reply: opts.reply,
    error: opts.error,
    agentMessages: opts.agentMessages,
    llmCalls: opts.llmCalls,
    model: opts.model,
    attachmentNames: opts.attachmentNames,
  });
  await idbStorage.setItem(key, `${existing}${prefix}${body}`);
  return key;
}

export async function readChatLogIdb(chatLogId: string) {
  return idbStorage.getItem(chatLogStorageKey(chatLogId));
}

export async function clearChatLogIdb(chatLogId: string) {
  await idbStorage.removeItem(chatLogStorageKey(chatLogId));
}
