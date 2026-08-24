import { createOpenAI } from "@ai-sdk/openai";
import {
  generateText,
  stepCountIs,
  streamText,
  tool,
  type ModelMessage,
} from "ai";
import {
  buildChatContextPack,
  expandHistoryToModelMessages,
  ensureFinalAssistantText,
  sanitizeAgentMessages,
  selectReattachedScreenshots,
  type ChatContextPack,
  type HistoryMessage,
} from "@/lib/chat-context";
import {
  buildUserContentParts,
  collectConversationAttachments,
  mergeAttachmentPayloads,
  type ChatAttachmentPayload,
} from "@/lib/chat-attachments";
import type { ChatAgentMessage } from "@/lib/chat-history";
import { sanitizeJsonValue } from "@/lib/chat-history";
import type { LlmCallLog } from "@/lib/chat-log-format";
import { sanitizeLlmMessagesForLog } from "@/lib/chat-log-format";
import {
  annotateTradeSchema,
  deleteTradeSchema,
  findTradeSchema,
  generateChartsSchema,
  getStatsSchema,
  getStrategySchema,
  getTradeSchema,
  logTradeSchema,
  patchTradeSchema,
  queryTradesSchema,
  updateStrategySchema,
} from "@/lib/chat-schemas";
import { JournalSession, type ChatActions } from "@/lib/journal-session";
import {
  DEFAULT_REASONING_EFFORT,
  isReasoningEffort,
  type ReasoningEffortId,
} from "@/lib/models";
import type { Strategy, Trade } from "@/lib/types";

export type { ChatActions, ReasoningEffortId };
export type OpenAIReasoningEffort = ReasoningEffortId;
export { JournalSession };

export const MAX_AGENT_STEPS = 8;

/** Default medium — override with CHAT_REASONING_EFFORT or streamAgentLoop opts. */
export function resolveReasoningEffort(
  override?: ReasoningEffortId | string | null,
): ReasoningEffortId {
  const raw = (override ?? process.env.CHAT_REASONING_EFFORT ?? DEFAULT_REASONING_EFFORT)
    .toString()
    .trim()
    .toLowerCase();
  if (isReasoningEffort(raw)) return raw;
  return DEFAULT_REASONING_EFFORT;
}

export type AgentStreamEvent =
  | { type: "status"; message: string }
  | {
      type: "tool-start";
      toolCallId: string;
      name: string;
      label: string;
    }
  | {
      type: "tool-result";
      toolCallId: string;
      name: string;
      label: string;
      ok: boolean;
      detail?: string;
    }
  | { type: "text-delta"; text: string }
  | {
      type: "done";
      reply: string;
      actions: ChatActions;
      steps: number;
      reattachedScreenshotCount: number;
      /** Full tool transcript for this turn (replayed on later turns). */
      agentMessages?: ChatAgentMessage[];
      /** Full LLM request/response traces for local chat logs. */
      llmCalls?: LlmCallLog[];
    }
  | { type: "error"; reply: string; llmCalls?: LlmCallLog[] };

const TOOL_LABELS: Record<string, string> = {
  log_trade: "Logging trade",
  patch_trade: "Updating trade fields",
  annotate_trade: "Updating notes/tags",
  delete_trade: "Deleting trade",
  update_strategy: "Updating strategy",
  get_strategy: "Reading strategy",
  get_trade: "Reading trade",
  find_trade: "Finding matching trade",
  generate_charts: "Building charts",
  query_trades: "Searching trades",
  get_stats: "Computing stats",
};

function toolLabel(name: string) {
  return TOOL_LABELS[name] ?? name.replaceAll("_", " ");
}

function toolResultDetail(output: unknown): { ok: boolean; detail?: string } {
  if (!output || typeof output !== "object") {
    return { ok: true };
  }
  const obj = output as Record<string, unknown>;
  const ok = obj.ok !== false;
  if (typeof obj.error === "string") {
    return { ok: false, detail: obj.error };
  }
  if (obj.action === "log_trade" && obj.trade && typeof obj.trade === "object") {
    const t = obj.trade as { symbol?: string; side?: string; result?: string };
    return {
      ok,
      detail: [t.side, t.symbol, t.result].filter(Boolean).join(" "),
    };
  }
  if (
    (obj.action === "patch_trade" || obj.action === "annotate_trade") &&
    obj.trade &&
    typeof obj.trade === "object"
  ) {
    const t = obj.trade as { id?: string; symbol?: string };
    return {
      ok,
      detail: t.symbol ? `${t.symbol} (${t.id})` : String(t.id ?? ""),
    };
  }
  if (obj.action === "delete_trade" && Array.isArray(obj.deletedIds)) {
    return { ok, detail: `${obj.deletedIds.length} removed` };
  }
  if (obj.action === "generate_charts" && Array.isArray(obj.charts)) {
    return { ok, detail: `${obj.charts.length} chart(s)` };
  }
  if (obj.action === "query_trades" && typeof obj.count === "number") {
    return { ok, detail: `${obj.count} match(es)` };
  }
  if (obj.action === "get_stats" && obj.stats && typeof obj.stats === "object") {
    const s = obj.stats as { closedCount?: number; winRate?: number };
    if (typeof s.winRate === "number") {
      return {
        ok,
        detail: `${s.closedCount ?? "?"} closed, ${s.winRate.toFixed(0)}% WR`,
      };
    }
  }
  if (obj.action === "update_strategy") {
    return { ok, detail: "strategy saved" };
  }
  if (obj.action === "get_strategy") {
    return {
      ok,
      detail: typeof obj.section === "string" ? obj.section : "strategy",
    };
  }
  if (obj.action === "get_trade") {
    const t = obj.trade as { symbol?: string; id?: string } | undefined;
    if (t?.symbol) return { ok, detail: `${t.symbol} (${t.id})` };
    if (typeof obj.id === "string") return { ok, detail: obj.id };
    if (typeof t?.id === "string") return { ok, detail: t.id };
    return { ok };
  }
  if (obj.action === "find_trade") {
    if (typeof obj.bestMatchId === "string") {
      return { ok, detail: `best ${obj.bestMatchId}` };
    }
    const n = Array.isArray(obj.candidates) ? obj.candidates.length : 0;
    return { ok, detail: `${n} candidate(s)` };
  }
  return { ok };
}

function createJournalTools(session: JournalSession) {
  return {
    get_strategy: tool({
      description:
        "Read the user's full trading strategy markdown document. Call this when coaching or checking plan fit — strategy is NOT in the default prompt.",
      inputSchema: getStrategySchema,
      execute: async (input) => session.getStrategy(input.section ?? "all"),
    }),
    get_trade: tool({
      description:
        "Fetch one trade by id (full snapshot). Get the id from find_trade or query_trades first.",
      inputSchema: getTradeSchema,
      execute: async (input) => session.getTrade(input.id),
    }),
    find_trade: tool({
      description:
        "Rank recent journal trades against screenshot/message hints (symbol, entry/SL/TP/exit, side, result, date, size, pnl, ticket text). Use BEFORE patch_trade or annotate_trade when identifying which row to change — especially if multiple trades share a symbol. Then call the mutation tool with bestMatchId (if confident) or the chosen candidate id.",
      inputSchema: findTradeSchema,
      execute: async (input) => session.findTrade(input),
    }),
    log_trade: tool({
      description:
        "Create a NEW trade only — never updates an existing row. Returns the new id; use patch_trade for field follow-ups and annotate_trade for notes/tags. When reading a screenshot, extract levels into the normal trade fields (entry/stop/target/exit/session). feesUsd is commission + swap. Record P&L in pnlUsd ($) only — never R-multiple.",
      inputSchema: logTradeSchema,
      execute: async (input) => session.logTrade(input),
    }),
    patch_trade: tool({
      description:
        "Partial update of trade fields by exact id (levels, result, session, PnL, fees, etc). feesUsd = commission + swap. Does NOT touch notes or tags — use annotate_trade for those. Never guess ids; call find_trade / query_trades first. No silent retargeting. Use pnlUsd ($) only — never R-multiple.",
      inputSchema: patchTradeSchema,
      execute: async (input) => session.patchTrade(input),
    }),
    annotate_trade: tool({
      description:
        "Notes/tags only by exact id. Prefer appendNote and addTags/removeTags. Use replaceNotes or replaceTags only when the user explicitly asks to rewrite/overwrite. Omit unused fields — do not send empty strings or empty arrays. Never use this for levels/result/session — that is patch_trade.",
      inputSchema: annotateTradeSchema,
      execute: async (input) => session.annotateTrade(input),
    }),
    delete_trade: tool({
      description: "Delete one or more trades by exact id.",
      inputSchema: deleteTradeSchema,
      execute: async (input) => session.deleteTrade(input),
    }),
    update_strategy: tool({
      description:
        "Edit the strategy markdown. PREFER replacements[{find,replace}] for small changes (call get_strategy first and copy exact text). Use appendMarkdown to add a section. Use markdown ONLY for a full-document rewrite (complete text, never a short snippet).",
      inputSchema: updateStrategySchema,
      execute: async (input) => session.updateStrategy(input),
    }),
    generate_charts: tool({
      description:
        "Generate charts from the live trade log (includes trades added earlier this turn).",
      inputSchema: generateChartsSchema,
      execute: async (input) => session.generateCharts(input.charts),
    }),
    query_trades: tool({
      description:
        "Search the journal for trade rows. Always includes journalStats (full-book wins/losses/$ PnL). For listing every trade: omit symbol/side/result filters and use limit=25. Only add filters when the user explicitly asks for a subset.",
      inputSchema: queryTradesSchema,
      execute: async (input) => session.queryTrades(input),
    }),
    get_stats: tool({
      description:
        "Full-journal performance scoreboard (wins, losses, win rate, $ PnL). Does NOT accept symbol/side/result filters — always the whole book. Prefer closedOnly=true.",
      inputSchema: getStatsSchema,
      execute: async (input) => session.getStatsTool(input),
    }),
  };
}

export function buildSystemPrompt(ctx: ChatContextPack) {
  return `You are TradeAgent — a fully chat-controlled trading journal + coach.

This product is conversational. The user runs their whole journal through chat: log, update, delete, review, query, and coach. Be decisive and mutate with tools when they ask — the UI will ask them to Accept before saving.

On-demand context (IMPORTANT):
- Do NOT assume you already know the strategy or trade log. They are NOT included in this prompt.
- Call get_strategy when you need the full strategy markdown (or before coaching against the strategy).
- Call query_trades / find_trade / get_trade / get_stats when you need history or to identify a row.
- Before answering questions about "my trades", "entries", "closed trades", "how am I doing", or journal size: ALWAYS call get_stats (closedOnly=true) and query_trades with limit=25 and NO symbol/side/result filters.
- Performance numbers come ONLY from get_stats.stats or query_trades.journalStats — never tally a filtered trades[] slice. If query_trades was filtered, still use journalStats for the scoreboard and re-query unfiltered if you need every row.
- Never invent "visible" / "need review" / "can't assess yet" filler when journalStats/get_stats is present.
- Only add side/result/symbol filters on query_trades when the user explicitly asks for that subset (e.g. "my losing NQ longs"). get_stats never takes those filters.
- When coaching whether trades fit the plan: call get_strategy, then query_trades + get_stats. Compare yourself from those tool results — there is no separate compare tool.
- Never invent trades, stats, or strategy rules from memory.

Identifying which trade to update:
- There is NO persistent active trade. Multiple trades (even same symbol) can exist at once.
- Exception this turn only: if User-selected trade reference id(s) are provided below, treat "this trade" / "these trades" / the referenced rows as those exact ids — call get_trade / patch_trade / annotate_trade with them. Still use find_trade when the user clearly means a different row.
- When the user asks to update a trade / fill details from a screenshot without a UI reference: extract levels from the image, call find_trade with those hints (symbol, side, entry, stop, target, exit, result, date, size, pnl, ticket text), then patch_trade / annotate_trade with bestMatchId (if confident) or the chosen candidate id.
- Prefer find_trade over guessing. Same-symbol duplicates are normal; match on entry/SL/TP/exit/time/result.
- Exact id or fail — tools never silently retarget to another trade.

Trade mutations (split tools — use the right one):
- log_trade: brand-new position only. Never for follow-ups on an existing row.
- patch_trade: field changes (levels, result, session, $ PnL, checklist answers). Does NOT touch notes/tags.
- annotate_trade: notes/tags only. Prefer appendNote + addTags/removeTags. Use replaceNotes/replaceTags only when the user asks to rewrite/overwrite.
- delete_trade: remove by exact id. For multiple trades, call once with ids or call per trade — there is no bulk field-update tool.
- After log_trade, further details about THAT trade MUST use patch_trade / annotate_trade on the returned id.
- Confirm from the tool result that notes/tags/fields are present before telling the user it is saved.

Strategy checklist (done / not done):
- get_strategy returns strategy.checklist: [{id, label}, ...].
- When logging a trade, call get_strategy first if you need checklist ids, then pass checklist: [{id, checked: true}] on log_trade for completed steps. Omit items that were not done.
- Follow-up checklist answers: patch_trade with checklist answers (merges by id).
- update_strategy.checklist replaces the full strategy checklist definition (not trade answers). Pass [] to clear.
- When the user describes which checklist steps they followed, mark those done. If unclear, ask once which items were completed.

Strategy edits (critical — do not wipe the plan):
- ALWAYS call get_strategy before editing so you have the exact current markdown.
- Small changes (tweak a rule, fix a number, rename a line): use update_strategy.replacements with find/replace. Copy the exact find substring from get_strategy.
- Adding a new section at the end: use appendMarkdown.
- Full rewrite only when the user asks to replace/rewrite the whole strategy — then pass markdown as the COMPLETE document (get_strategy text with edits), never a short snippet.
- NEVER pass markdown that is only the changed paragraph — that overwrites and destroys the rest of the plan.
- Checklist item add/edit/remove: use update_strategy.checklist with the full list (reuse existing ids when renaming).

Tool loop (Vercel AI SDK):
- Tools execute immediately and return JSON results (ids, errors, stats, chart summaries).
- Never claim a change succeeded unless a tool result returned ok: true.
- If a tool fails validation or execution, read the error/issues and retry with corrected args.
- Prior turns include their tool calls and tool results in this conversation (like Cursor). Use them for continuity (ids, what you already compared), but re-query the live journal when answering about current state — Accept/Reject may have changed it.
- Put screenshot-derived levels into normal trade fields (entry/stop/target/exit/session). There is no separate chartExtract — when you need the image again, prior chat attachments and images stay in the conversation history for the entire chat (same as ChatGPT).
- entryTime / exitTime: for broker CSV / chart clocks with NO timezone, copy the wall clock exactly as YYYY-MM-DDTHH:mm:ss with NO trailing Z (e.g. 2026-07-30T15:46:09). Never invent UTC/Z — that shifts the displayed hour for users in UTC+1. Only use Z or +01:00 when the source explicitly states a zone.

Voice:
- SHORT and concise. Default to 2–5 short sentences max, or a tiny checklist.
- Plain chat text only. No markdown: no **bold**, no ## headings, no tables, no code fences.
- Light dash bullets (-) only for 2–4 items. Never write long essays.
- One clear next question max, unless confirming a short suggested fill.

Missing info / screenshots:
- Screenshots are primary source of truth. Extract symbol, side, entry, SL, TP, exit, session, structure notes before asking.
- Prefer screenshot values over asking the user to retype.
- If ambiguous, suggest your best read and ask yes/no.
- The full prior chat is included every turn — including every previously attached CSV, PDF, text file, and image, plus prior tool calls/results. Do not ask the user to reattach a file that already appeared earlier in this conversation.
- Reattached trade-journal screenshots (if any this turn): ${ctx.reattachedScreenshotCount}. These belong to a trade uniquely named in the message.
- Attached files on the current message are also in the user message — use them as source data for logging, reviews, or imports.
- Required when logging/closing: symbol, side, entry, SL, TP (or why missing), result, and $ P&L. Never use R-multiple.
- feesUsd = commission + swap (add them if the broker shows both separately). pnlUsd is gross price P&L; net $ P&L used in stats is pnlUsd − feesUsd.

Hard rules for mutations:
- Journal writes (log/patch/annotate/delete/strategy) are PROPOSED to the user. A review panel asks them to Accept or Reject before anything is saved.
- Never say "saved", "logged", "deleted", or "strategy updated" as if it already stuck. Say you proposed the change and they can Accept in the review panel, or tell you what to change.
- If the user asks to tweak the last suggestion (e.g. "make it 2R", "ignore the times", "add a FOMO tag"), IMMEDIATELY call the mutation tools again with the revised fields. The UI replaces the pending proposal automatically. NEVER ask them to Reject first.
- When omitting fields the user wants unchanged, simply do not send those fields on patch_trade — do not ask them to reject the old proposal.
- Only say a proposal is ready if you actually called mutation tools and they returned ok. If nothing differs from the live journal after the requested omissions, say clearly that there is nothing left to change — do not invent a proposal.
- If you propose a change, you MUST call the matching tool.
- There is NO persistent active/selected trade. Multiple open trades (and multiple of the same symbol) are normal.
- Journal size: ${ctx.tradeCount} trades. Strategy name: ${ctx.strategyName ?? "unset"}.
${
  ctx.referencedTradeIds.length === 1
    ? `- User-selected trade reference (this turn only): id=${ctx.referencedTradeIds[0]}. For "this trade" / coaching / updates on the referenced row, use get_trade, patch_trade, and annotate_trade with that exact id. Do not invent another id.`
    : ctx.referencedTradeIds.length > 1
      ? `- User-selected trade references (this turn only): ids=${ctx.referencedTradeIds.join(", ")}. For "these trades" / comparing / coaching on the referenced rows, use get_trade, patch_trade, and annotate_trade with those exact ids. Do not invent other ids. If the user says "this trade", ask which of the referenced ids they mean unless the rest of the message makes it obvious.`
      : "- Always resolve the target with find_trade (pass screenshot levels) or query_trades, then patch_trade / annotate_trade with that id."
}
- Trade identity is sacred: NEVER apply one symbol's fields onto another pair's row.
- Only use log_trade for a brand new position.
- Screenshots from this conversation attach automatically on log/patch, including images from earlier turns — still call the tool with extracted levels in normal fields.

Charts:
- Call generate_charts for visual analysis. Prefer field mappings over inventing data[].

Coaching:
- ALWAYS write a real final reply. Never answer with only "Trade logged." / "Updated." / "On it."
- After proposing a mutation: 1 line what you proposed + remind them to Accept (or keep chatting to refine). Optional 1-line strategy check via get_strategy.
- The full prior chat is included in the messages — including prior attachments and tool transcripts. Use it. Do not invent earlier decisions that were not said.
`;
}

function isWeakReply(reply?: string | null) {
  if (!reply?.trim()) return true;
  const weak = [
    /^trade logged\.?$/i,
    /^trade updated\.?$/i,
    /^strategy updated\.?$/i,
    /^charts ready\.?$/i,
    /^on it\.?$/i,
    /^done\.?$/i,
    /^logged\.?$/i,
  ];
  return weak.some((re) => re.test(reply.trim()));
}

/**
 * Streaming multi-step tool loop via Vercel AI SDK streamText.
 * Yields NDJSON-friendly events for UI progress + final actions.
 *
 * In the browser, set `baseURL` to `/api/openai/v1` so model HTTP is same-origin
 * (OpenAI CORS blocks direct browser calls). Tool execute stays in-process.
 */
export async function* streamAgentLoop(opts: {
  apiKey: string;
  model: string;
  strategy: Strategy;
  trades: Trade[];
  stats: Record<string, number | undefined>;
  history: HistoryMessage[];
  userText: string;
  images: string[];
  attachments?: ChatAttachmentPayload[];
  referencedTradeIds?: string[];
  reasoningEffort?: ReasoningEffortId | string;
  /** OpenAI SDK base URL. Browser default: `/api/openai/v1`. */
  baseURL?: string;
}): AsyncGenerator<AgentStreamEvent> {
  const baseURL =
    opts.baseURL ??
    (typeof window !== "undefined" ? "/api/openai/v1" : undefined);
  const openai = createOpenAI({
    apiKey: opts.apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
  const model = openai(opts.model);
  const reasoningEffort = resolveReasoningEffort(opts.reasoningEffort);

  yield { type: "status", message: "Preparing context…" };

  const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
  const historyAttachments = collectConversationAttachments(opts.history);
  const mergedAttachments = mergeAttachmentPayloads(
    historyAttachments,
    (opts.images ?? []).map((dataUrl) => ({
      kind: "image" as const,
      name: "image",
      dataUrl,
    })),
    attachments,
  );
  const turnHasFiles = mergedAttachments.some(
    (a) => a.kind === "text" || a.kind === "file",
  );
    const turnImages = [
    ...(opts.images ?? []),
    ...mergedAttachments
      .filter(
        (a): a is Extract<ChatAttachmentPayload, { kind: "image" }> =>
          a.kind === "image" && typeof a.dataUrl === "string",
      )
      .map((a) => a.dataUrl),
  ];

  const reattached = selectReattachedScreenshots({
    userMessage: opts.userText,
    hasNewImages: turnImages.length > 0,
    trades: opts.trades,
  });

  if (reattached.length) {
    yield {
      type: "status",
      message: `Re-attaching ${reattached.length} screenshot${reattached.length > 1 ? "s" : ""} for the named trade…`,
    };
  }

  if (turnHasFiles) {
    yield {
      type: "status",
      message: "Reading attached file(s)…",
    };
  }

  const session = new JournalSession({
    trades: opts.trades,
    strategy: opts.strategy,
    userMessage: opts.userText,
    turnHasScreenshots: turnImages.length > 0 || reattached.length > 0,
  });

  const ctx = buildChatContextPack({
    strategy: session.strategy,
    trades: session.trades,
    reattachedScreenshotCount: reattached.length,
    referencedTradeIds: opts.referencedTradeIds ?? [],
  });

  const system = buildSystemPrompt(ctx);

  // Full verbatim chat — prior images/files/tool transcripts stay in the session
  const historyMessages = expandHistoryToModelMessages(opts.history);

  const contentParts = buildUserContentParts({
    text: opts.userText,
    images: [],
    attachments: mergedAttachments,
    imageDetail: "high",
  });

  // Also include any trade-journal screenshots reattached for a named symbol
  for (const url of reattached) {
    contentParts.push({
      type: "image",
      image: url,
      providerOptions: { openai: { imageDetail: "high" } },
    });
  }

  const hasRichParts = contentParts.length > 1;
  const userMessage: ModelMessage = hasRichParts
    ? { role: "user", content: contentParts }
    : {
        role: "user",
        content: (contentParts[0] as { type: "text"; text: string }).text,
      };

  yield { type: "status", message: "Thinking…" };

  const tools = createJournalTools(session);
  const toolNames = Object.keys(tools);
  const modelMessages: ModelMessage[] = [...historyMessages, userMessage];
  const requestMessages = sanitizeLlmMessagesForLog(modelMessages);

  const result = streamText({
    model,
    system,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    providerOptions: {
      openai: {
        reasoningEffort,
      },
    },
  });

  let streamedText = "";
  let stepCount = 0;
  /** Fallback transcript if responseMessages is empty after the stream. */
  const collectedAgentMessages: ChatAgentMessage[] = [];
  const pendingCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
  }> = [];

  const agentCallBase = {
    kind: "agent" as const,
    model: opts.model,
    reasoningEffort,
    request: {
      system,
      messages: requestMessages,
      tools: toolNames,
    },
  };

  try {
    for await (const part of result.fullStream) {
      if (part.type === "start-step") {
        stepCount += 1;
        if (stepCount > 1) {
          yield { type: "status", message: `Continuing (step ${stepCount})…` };
        }
      } else if (part.type === "tool-call") {
        pendingCalls.push({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: "input" in part ? part.input : undefined,
        });
        yield {
          type: "tool-start",
          toolCallId: part.toolCallId,
          name: part.toolName,
          label: toolLabel(part.toolName),
        };
      } else if (part.type === "tool-result") {
        const call = pendingCalls.find((c) => c.toolCallId === part.toolCallId);
        collectedAgentMessages.push({
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: call?.input ?? {},
            },
          ],
        });
        collectedAgentMessages.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              output: {
                type: "json",
                value: sanitizeJsonValue(part.output),
              },
            },
          ],
        });
        const { ok, detail } = toolResultDetail(part.output);
        yield {
          type: "tool-result",
          toolCallId: part.toolCallId,
          name: part.toolName,
          label: toolLabel(part.toolName),
          ok,
          detail,
        };
      } else if (part.type === "tool-error") {
        const err =
          part.error instanceof Error
            ? part.error.message
            : typeof part.error === "string"
              ? part.error
              : "Tool failed";
        const call = pendingCalls.find((c) => c.toolCallId === part.toolCallId);
        collectedAgentMessages.push({
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: call?.input ?? {},
            },
          ],
        });
        collectedAgentMessages.push({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              output: { type: "json", value: { ok: false, error: err } },
            },
          ],
        });
        yield {
          type: "tool-result",
          toolCallId: part.toolCallId,
          name: part.toolName,
          label: toolLabel(part.toolName),
          ok: false,
          detail: err,
        };
      } else if (part.type === "text-delta") {
        const raw = part as { text?: unknown; delta?: unknown };
        const delta =
          typeof raw.text === "string"
            ? raw.text
            : typeof raw.delta === "string"
              ? raw.delta
              : "";
        streamedText += delta;
        if (!delta) continue;
        yield { type: "text-delta", text: delta };
      } else if (part.type === "error") {
        const message =
          part.error instanceof Error
            ? part.error.message
            : "Stream error from model";
        const llmCalls: LlmCallLog[] = [
          {
            ...agentCallBase,
            response: { error: message },
          },
        ];
        yield {
          type: "error",
          reply: `OpenAI error: ${message}\n\nCheck your API key and model in Settings.`,
          llmCalls,
        };
        return;
      }
      // Ignore other stream part types (finish, step-*, etc.)
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OpenAI request failed";
    const llmCalls: LlmCallLog[] = [
      {
        ...agentCallBase,
        response: { error: message },
      },
    ];
    yield {
      type: "error",
      reply: `OpenAI error: ${message}\n\nCheck your API key and model in Settings.`,
      llmCalls,
    };
    return;
  }

  let reply = (await result.text)?.trim() || streamedText.trim();
  const steps = (await result.steps).length || stepCount;
  let agentMessages = sanitizeAgentMessages(await result.responseMessages);
  if (!agentMessages.length && collectedAgentMessages.length) {
    agentMessages = sanitizeAgentMessages(collectedAgentMessages);
  }

  const llmCalls: LlmCallLog[] = [
    {
      ...agentCallBase,
      response: {
        text: reply,
        steps,
        messages: agentMessages,
      },
    },
  ];

  if (isWeakReply(reply)) {
    yield { type: "status", message: "Polishing reply…" };
    const polishMessages: ModelMessage[] = [
      ...historyMessages,
      userMessage,
      {
        role: "assistant",
        content: `Tool outcomes this turn: ${JSON.stringify(session.toActions())}. Steps: ${steps}.`,
      },
      {
        role: "user",
        content:
          "Write the final user-facing reply now in 2–5 short sentences max. Confirm what actually succeeded (use real ids/values). Ask only for fields that were NOT visible. Plain text only. No 'Trade logged.' stubs.",
      },
    ];
    try {
      const nudge = await generateText({
        model,
        system,
        messages: polishMessages,
        providerOptions: {
          openai: { reasoningEffort },
        },
      });
      reply =
        nudge.text?.trim() ||
        "Which trade should I update? Name the symbol (and date/result if there are several).";
      llmCalls.push({
        kind: "polish",
        model: opts.model,
        reasoningEffort,
        request: {
          system,
          messages: sanitizeLlmMessagesForLog(polishMessages),
        },
        response: { text: reply },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "OpenAI polish failed";
      llmCalls.push({
        kind: "polish",
        model: opts.model,
        reasoningEffort,
        request: {
          system,
          messages: sanitizeLlmMessagesForLog(polishMessages),
        },
        response: { error: message },
      });
      yield {
        type: "error",
        reply: `OpenAI error: ${message}\n\nCheck your API key and model in Settings.`,
        llmCalls,
      };
      return;
    }
  }

  agentMessages = ensureFinalAssistantText(agentMessages, reply);

  yield {
    type: "done",
    reply,
    actions: session.toActions(),
    steps,
    reattachedScreenshotCount: reattached.length,
    agentMessages,
    llmCalls,
  };
}
