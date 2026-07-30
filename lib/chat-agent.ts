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
  foldConversationSummary,
  selectReattachedScreenshots,
  splitHistoryForContext,
  type ChatContextPack,
  type HistoryMessage,
} from "@/lib/chat-context";
import {
  formatAttachedFilesPrompt,
  parseDataUrl,
  type ChatAttachmentPayload,
} from "@/lib/chat-attachments";
import {
  addTradeNoteSchema,
  addTradeSchema,
  bulkUpdateTradesSchema,
  compareToStrategySchema,
  deleteTradeSchema,
  findTradeSchema,
  generateChartsSchema,
  getStatsSchema,
  getStrategySchema,
  getTradeSchema,
  queryTradesSchema,
  updateStrategySchema,
  updateTradeSchema,
} from "@/lib/chat-schemas";
import { JournalSession, type ChatActions } from "@/lib/journal-session";
import type { Strategy, Trade } from "@/lib/types";

export type { ChatActions };
export { JournalSession };

export const MAX_AGENT_STEPS = 8;

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
      chatSummary: string;
      steps: number;
      reattachedScreenshotCount: number;
    }
  | { type: "error"; reply: string };

const TOOL_LABELS: Record<string, string> = {
  add_trade: "Logging trade",
  update_trade: "Updating trade",
  delete_trade: "Deleting trade",
  update_strategy: "Updating strategy",
  get_strategy: "Reading strategy",
  get_trade: "Reading trade",
  find_trade: "Finding matching trade",
  generate_charts: "Building charts",
  query_trades: "Searching trades",
  get_stats: "Computing stats",
  bulk_update_trades: "Bulk updating trades",
  compare_to_strategy: "Comparing to strategy",
  add_trade_note: "Adding note",
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
  if (obj.action === "add_trade" && obj.trade && typeof obj.trade === "object") {
    const t = obj.trade as { symbol?: string; side?: string; result?: string };
    return {
      ok,
      detail: [t.side, t.symbol, t.result].filter(Boolean).join(" "),
    };
  }
  if (
    obj.action === "update_trade" &&
    obj.trade &&
    typeof obj.trade === "object"
  ) {
    const t = obj.trade as { id?: string; symbol?: string };
    const redirected =
      typeof obj.redirectedFrom === "string"
        ? ` (redirected from ${obj.redirectedFrom})`
        : "";
    return {
      ok,
      detail: t.symbol
        ? `${t.symbol} (${t.id})${redirected}`
        : `${t.id ?? ""}${redirected}`,
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
      const wr =
        typeof s.winRate.toFixed === "function"
          ? s.winRate.toFixed(0)
          : String(s.winRate);
      return {
        ok,
        detail: `${s.closedCount ?? "?"} closed, ${wr}% WR`,
      };
    }
  }
  if (obj.action === "bulk_update_trades") {
    const updated = Array.isArray(obj.updatedIds)
      ? obj.updatedIds.length
      : undefined;
    return { ok, detail: updated != null ? `${updated} updated` : undefined };
  }
  if (obj.action === "compare_to_strategy") {
    return { ok, detail: "checklist ready" };
  }
  if (obj.action === "add_trade_note") {
    return { ok, detail: typeof obj.id === "string" ? obj.id : undefined };
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
    return {
      ok,
      detail: t?.symbol ? `${t.symbol} (${t.id})` : typeof obj.id === "string" ? obj.id : undefined,
    };
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
        "Read the user's trading strategy (summary, rules, risk, targets, or all). Call this when coaching or checking plan fit — strategy is NOT in the default prompt.",
      inputSchema: getStrategySchema,
      execute: async (input) => session.getStrategy(input.section ?? "all"),
    }),
    get_trade: tool({
      description:
        "Fetch one trade by id (full snapshot including chartExtract). Get the id from find_trade or query_trades first.",
      inputSchema: getTradeSchema,
      execute: async (input) => session.getTrade(input.id),
    }),
    find_trade: tool({
      description:
        "Rank recent journal trades against screenshot/message hints (symbol, entry/SL/TP/exit, side, result, date, size, pnl, ticket text). Use this BEFORE update_trade when the user says update a trade — especially if multiple trades share a symbol. Then update_trade with bestMatchId (if confident) or the chosen candidate id.",
      inputSchema: findTradeSchema,
      execute: async (input) => session.findTrade(input),
    }),
    add_trade: tool({
      description:
        "Create a NEW trade. Returns the new id — use update_trade for follow-ups. When reading a screenshot, also fill chartExtract with levels/setupTags/bias/sessionGuess.",
      inputSchema: addTradeSchema,
      execute: async (input) => session.addTrade(input),
    }),
    update_trade: tool({
      description:
        "Modify an existing trade by id. There is no active trade. Always find_trade (or query_trades) first using screenshot levels / symbol / date, then pass that exact id. Never guess.",
      inputSchema: updateTradeSchema,
      execute: async (input) => session.updateTrade(input),
    }),
    delete_trade: tool({
      description: "Delete one or more trades by id.",
      inputSchema: deleteTradeSchema,
      execute: async (input) => session.deleteTrade(input),
    }),
    update_strategy: tool({
      description: "Patch strategy fields or append a rule/risk item.",
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
        "Search/filter the journal. ALWAYS call this before answering about trade quality/history. Omit result to get all trades. Returns journal.total/open/closed for the full book plus matching rows. Example: last 5 NQ losses → symbol=NQ, result=loss, limit=5.",
      inputSchema: queryTradesSchema,
      execute: async (input) => session.queryTrades(input),
    }),
    get_stats: tool({
      description:
        "Compute win rate, R, PnL, counts from the working journal (optionally filtered). Call when you need performance numbers.",
      inputSchema: getStatsSchema,
      execute: async (input) => session.getStatsTool(input),
    }),
    bulk_update_trades: tool({
      description:
        "Apply the same patch to many trade ids (session, setup, notes, tags, result).",
      inputSchema: bulkUpdateTradesSchema,
      execute: async (input) => session.bulkUpdateTrades(input),
    }),
    compare_to_strategy: tool({
      description:
        "Compare trade(s) to strategy rules/risk as a short fits/gaps/unclear checklist. Loads strategy internally.",
      inputSchema: compareToStrategySchema,
      execute: async (input) => session.compareToStrategy(input),
    }),
    add_trade_note: tool({
      description: "Append a note (and optional tags) to a trade by id.",
      inputSchema: addTradeNoteSchema,
      execute: async (input) => session.addTradeNote(input),
    }),
  };
}

export function buildSystemPrompt(ctx: ChatContextPack) {
  return `You are TradeAgent — a fully chat-controlled trading journal + coach.

This product is conversational. The user runs their whole journal through chat: log, update, delete, review, query, and coach. Be decisive and mutate with tools when they ask.

On-demand context (IMPORTANT):
- Do NOT assume you already know the strategy or trade log. They are NOT included in this prompt.
- Call get_strategy when you need the plan/rules/risk (or before coaching against the strategy).
- Call query_trades / find_trade / get_trade / get_stats when you need history or to identify a row.
- Before answering questions about "my trades", "entries", "closed trades", or journal size: ALWAYS call query_trades (omit result filter for the full book). Trust journal.total/open/closed from the tool result — never invent or reuse a count from earlier chat.
- If the user says there are more trades than you returned, re-query with a higher limit and no result filter before answering again.
- Call compare_to_strategy when checking whether a trade fits the plan.
- Never invent trades, stats, or strategy rules from memory.

Identifying which trade to update:
- There is NO persistent active trade. Multiple trades (even same symbol) can exist at once.
- Exception this turn only: if a User-selected trade reference id is provided below, treat "this trade" / the open detail as that exact id — call get_trade / update_trade with it. Still use find_trade when the user clearly means a different row.
- When the user asks to update a trade / fill details from a screenshot without a UI reference: extract levels from the image, call find_trade with those hints (symbol, side, entry, stop, target, exit, result, date, size, pnl, ticket text), then update_trade with bestMatchId (if confident) or the chosen candidate id.
- Prefer find_trade over guessing. Same-symbol duplicates are normal; match on entry/SL/TP/exit/time/result.

Tool loop (Vercel AI SDK):
- Tools execute immediately and return JSON results (ids, errors, stats, chart summaries).
- Never claim a change succeeded unless a tool result returned ok: true.
- If a tool fails validation or execution, read the error/issues and retry with corrected args.
- After screenshot reads, save chartExtract (levels, setupTags, bias, sessionGuess) on add_trade/update_trade so follow-ups keep structured levels even without re-uploads.

Voice:
- SHORT and concise. Default to 2–5 short sentences max, or a tiny checklist.
- Plain chat text only. No markdown: no **bold**, no ## headings, no tables, no code fences.
- Light dash bullets (-) only for 2–4 items. Never write long essays.
- One clear next question max, unless confirming a short suggested fill.

Missing info / screenshots:
- Screenshots are primary source of truth. Extract symbol, side, entry, SL, TP, exit, session, structure notes before asking.
- Prefer screenshot values over asking the user to retype.
- If ambiguous, suggest your best read and ask yes/no.
- Reattached screenshots (if any this turn): ${ctx.reattachedScreenshotCount}. These belong to a trade uniquely named in the message.
- Attached files (CSV/PDF/text exports) are part of the user message — use them as source data for logging, reviews, or imports.
- Required when logging/closing: symbol, side, entry, SL, TP (or why missing), result, R and/or $ P&L.

Hard rules for mutations:
- If you say you logged/updated/deleted something, you MUST call the matching tool.
- There is NO persistent active/selected trade. Multiple open trades (and multiple of the same symbol) are normal.
- Journal size: ${ctx.tradeCount} trades. Strategy name: ${ctx.strategyName ?? "unset"}.
${
  ctx.referencedTradeId
    ? `- User-selected trade reference (this turn only): id=${ctx.referencedTradeId}. For "this trade" / coaching / updates on the referenced row, use get_trade and update_trade with that exact id. Do not invent another id.`
    : "- Always resolve the target with find_trade (pass screenshot levels) or query_trades, then update_trade with that id."
}
- Trade identity is sacred: NEVER apply one symbol's fields onto another pair's row.
- After add_trade, further details about THAT trade MUST use update_trade on the returned id.
- Only use add_trade for a brand new position.
- Screenshots on the current message attach automatically on add/update — still call the tool and fill chartExtract.

Charts:
- Call generate_charts for visual analysis. Prefer field mappings over inventing data[].

Coaching:
- ALWAYS write a real final reply. Never answer with only "Trade logged." / "Updated." / "On it."
- After a save/update: 1 line what you saved + optional 1-line strategy check (use get_strategy / compare_to_strategy if needed).

${
  ctx.conversationSummary
    ? `CONVERSATION SUMMARY (older turns):\n${ctx.conversationSummary}\n`
    : ""
}`;
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
 */
export async function* streamAgentLoop(opts: {
  apiKey: string;
  model: string;
  strategy: Strategy;
  trades: Trade[];
  stats: Record<string, number | undefined>;
  history: HistoryMessage[];
  chatSummary?: string;
  userText: string;
  images: string[];
  attachments?: ChatAttachmentPayload[];
  referencedTradeId?: string;
}): AsyncGenerator<AgentStreamEvent> {
  const openai = createOpenAI({ apiKey: opts.apiKey });
  const model = openai(opts.model);

  yield { type: "status", message: "Preparing context…" };

  const { older, recent } = splitHistoryForContext(opts.history);
  if (older.length >= 2) {
    yield { type: "status", message: "Summarizing earlier chat…" };
  }

  const chatSummary = await foldConversationSummary({
    model,
    existingSummary: opts.chatSummary,
    olderMessages: older,
  });

  const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
  const imageFromAttachments = attachments
    .filter(
      (a): a is Extract<ChatAttachmentPayload, { kind: "image" }> =>
        a.kind === "image" && typeof a.dataUrl === "string",
    )
    .map((a) => a.dataUrl);
  const textAttachments = attachments.filter(
    (a): a is Extract<ChatAttachmentPayload, { kind: "text" }> =>
      a.kind === "text" && typeof a.text === "string" && a.text.length > 0,
  );
  const fileAttachments = attachments.filter(
    (a): a is Extract<ChatAttachmentPayload, { kind: "file" }> =>
      a.kind === "file" && typeof a.dataUrl === "string",
  );

  // Prefer unified attachments; keep legacy images[] for compatibility
  const turnImages = [...opts.images, ...imageFromAttachments].slice(0, 6);

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

  if (textAttachments.length || fileAttachments.length) {
    yield {
      type: "status",
      message: `Reading ${textAttachments.length + fileAttachments.length} attached file${textAttachments.length + fileAttachments.length > 1 ? "s" : ""}…`,
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
    conversationSummary: chatSummary,
    reattachedScreenshotCount: reattached.length,
    referencedTradeId: opts.referencedTradeId ?? null,
  });

  const system = buildSystemPrompt(ctx);

  const historyMessages: ModelMessage[] = recent.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const textBlock = [
    opts.userText,
    formatAttachedFilesPrompt(
      textAttachments.map((a) => ({ name: a.name, text: a.text })),
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

  const contentParts: Array<
    | { type: "text"; text: string }
    | {
        type: "image";
        image: string;
        providerOptions?: { openai: { imageDetail: "low" | "high" } };
      }
    | { type: "file"; data: string; mediaType: string; filename?: string }
  > = [{ type: "text", text: textBlock || opts.userText }];

  turnImages.forEach((url, i) => {
    contentParts.push({
      type: "image",
      image: url,
      providerOptions: {
        openai: { imageDetail: "high" },
      },
    });
    void i;
  });

  reattached.forEach((url) => {
    contentParts.push({
      type: "image",
      image: url,
      providerOptions: {
        openai: { imageDetail: "low" },
      },
    });
  });

  for (const file of fileAttachments) {
    const parsed = parseDataUrl(file.dataUrl);
    if (!parsed) continue;
    contentParts.push({
      type: "file",
      data: parsed.base64,
      mediaType: file.mime || parsed.mime || "application/pdf",
      filename: file.name,
    });
  }

  const hasRichParts = contentParts.length > 1;
  const userMessage: ModelMessage = hasRichParts
    ? { role: "user", content: contentParts }
    : { role: "user", content: textBlock || opts.userText };

  yield { type: "status", message: "Thinking…" };

  const result = streamText({
    model,
    system,
    messages: [...historyMessages, userMessage],
    tools: createJournalTools(session),
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    providerOptions: {
      openai: {
        reasoningEffort: "none",
      },
    },
  });

  let streamedText = "";
  let stepCount = 0;

  try {
    for await (const part of result.fullStream) {
      if (part.type === "start-step") {
        stepCount += 1;
        if (stepCount > 1) {
          yield { type: "status", message: `Continuing (step ${stepCount})…` };
        }
      } else if (part.type === "tool-call") {
        yield {
          type: "tool-start",
          toolCallId: part.toolCallId,
          name: part.toolName,
          label: toolLabel(part.toolName),
        };
      } else if (part.type === "tool-result") {
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
        yield {
          type: "tool-result",
          toolCallId: part.toolCallId,
          name: part.toolName,
          label: toolLabel(part.toolName),
          ok: false,
          detail: err,
        };
      } else if (part.type === "text-delta") {
        const delta =
          "text" in part && typeof part.text === "string"
            ? part.text
            : "delta" in part && typeof (part as { delta?: string }).delta === "string"
              ? (part as { delta: string }).delta
              : "";
        if (delta) {
          streamedText += delta;
          yield { type: "text-delta", text: delta };
        }
      } else if (part.type === "error") {
        const message =
          part.error instanceof Error
            ? part.error.message
            : "Stream error from model";
        yield {
          type: "error",
          reply: `OpenAI error: ${message}\n\nCheck your API key and model in Settings.`,
        };
        return;
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OpenAI request failed";
    yield {
      type: "error",
      reply: `OpenAI error: ${message}\n\nCheck your API key and model in Settings.`,
    };
    return;
  }

  let reply = (await result.text)?.trim() || streamedText.trim();
  const steps = (await result.steps).length || stepCount;

  if (isWeakReply(reply)) {
    yield { type: "status", message: "Polishing reply…" };
    const nudge = await generateText({
      model,
      system,
      messages: [
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
      ],
      providerOptions: {
        openai: { reasoningEffort: "none" },
      },
    });
    reply =
      nudge.text?.trim() ||
      "Which trade should I update? Name the symbol (and date/result if there are several).";
  }

  yield {
    type: "done",
    reply: reply || "Done.",
    actions: session.toActions(),
    chatSummary,
    steps,
    reattachedScreenshotCount: reattached.length,
  };
}
