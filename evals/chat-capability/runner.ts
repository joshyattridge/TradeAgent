import {
  streamAgentLoop,
  type AgentStreamEvent,
} from "@/lib/chat-agent";
import type { HistoryMessage } from "@/lib/chat-history";
import type { ChatActions } from "@/lib/journal-session";
import { computeStats } from "@/lib/stats";
import type { Strategy, Trade } from "@/lib/types";
import type { ChatAgentMessage } from "@/lib/chat-history";

export type ToolCallRecord = {
  name: string;
  ok?: boolean;
  detail?: string;
};

export type ChatTurnResult = {
  reply: string;
  tools: ToolCallRecord[];
  actions: ChatActions;
  steps: number;
  agentMessages: ChatAgentMessage[];
  error?: string;
  rawEvents: AgentStreamEvent[];
};

export type RunChatTurnOptions = {
  apiKey: string;
  model: string;
  strategy: Strategy;
  trades: Trade[];
  message: string;
  history?: HistoryMessage[];
  referencedTradeId?: string;
  images?: string[];
  reasoningEffort?: string;
};

/**
 * Drive the same agent loop the /api/chat route uses, collecting tools + final reply.
 */
export async function runChatTurn(
  opts: RunChatTurnOptions,
): Promise<ChatTurnResult> {
  const tools: ToolCallRecord[] = [];
  const rawEvents: AgentStreamEvent[] = [];
  let reply = "";
  let actions: ChatActions = {};
  let steps = 0;
  let agentMessages: ChatAgentMessage[] = [];
  let error: string | undefined;

  const stats = computeStats(opts.trades);

  for await (const event of streamAgentLoop({
    apiKey: opts.apiKey,
    model: opts.model,
    strategy: structuredClone(opts.strategy),
    trades: structuredClone(opts.trades),
    stats,
    history: opts.history ?? [],
    userText: opts.message,
    images: opts.images ?? [],
    referencedTradeId: opts.referencedTradeId,
    reasoningEffort: opts.reasoningEffort,
  })) {
    rawEvents.push(event);
    if (event.type === "tool-result") {
      tools.push({
        name: event.name,
        ok: event.ok,
        detail: event.detail,
      });
    } else if (event.type === "done") {
      reply = event.reply;
      actions = event.actions;
      steps = event.steps;
      agentMessages = event.agentMessages ?? [];
    } else if (event.type === "error") {
      error = event.reply;
      reply = event.reply;
    }
  }

  return { reply, tools, actions, steps, agentMessages, error, rawEvents };
}

/** Append a completed turn into chat history for multi-turn scenarios. */
export function appendHistory(
  history: HistoryMessage[],
  userMessage: string,
  turn: ChatTurnResult,
): HistoryMessage[] {
  return [
    ...history,
    { role: "user", content: userMessage },
    {
      role: "assistant",
      content: turn.reply,
      agentMessages: turn.agentMessages,
    },
  ];
}

export function resolveEvalCredentials() {
  const apiKey =
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.CHAT_EVAL_API_KEY?.trim() ||
    "";
  const model =
    process.env.CHAT_EVAL_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-5.6-luna";
  const reasoningEffort =
    process.env.CHAT_REASONING_EFFORT?.trim() || "medium";
  const runRequested =
    process.env.RUN_CHAT_EVAL === "1" ||
    process.env.RUN_CHAT_EVAL === "true";
  return {
    apiKey,
    model,
    reasoningEffort,
    runRequested,
    enabled: runRequested && Boolean(apiKey),
  };
}
