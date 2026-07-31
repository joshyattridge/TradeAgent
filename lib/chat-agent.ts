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
  selectReattachedScreenshots,
  type ChatContextPack,
  type HistoryMessage,
} from "@/lib/chat-context";
import {
  formatAttachedFilesPrompt,
  parseDataUrl,
  type ChatAttachmentPayload,
} from "@/lib/chat-attachments";
import {
  annotateTradeSchema,
  compareToStrategySchema,
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
      steps: number;
      reattachedScreenshotCount: number;
    }
  | { type: "error"; reply: string };

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
  compare_to_strategy: "Comparing to strategy",
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
      detail: t.symbol ? `${t.symbol} (${t.id})` : `${t.id ?? ""}`,
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
  if (obj.action === "compare_to_strategy") {
    return { ok, detail: "checklist ready" };
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
        "Create a NEW trade only — never updates an existing row. Returns the new id; use patch_trade for field follow-ups and annotate_trade for notes/tags. When reading a screenshot, extract levels into the normal trade fields (entry/stop/target/exit/session/setup).",
      inputSchema: logTradeSchema,
      execute: async (input) => session.logTrade(input),
    }),
    patch_trade: tool({
      description:
        "Partial update of trade fields by exact id (levels, result, session, setup, PnL, etc). Does NOT touch notes or tags — use annotate_trade for those. Never guess ids; call find_trade / query_trades first. No silent retargeting.",
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
    compare_to_strategy: tool({
      description:
        "Compare trade(s) to strategy rules/risk as a short fits/gaps/unclear checklist. Loads strategy internally.",
      inputSchema: compareToStrategySchema,
      execute: async (input) => session.compareToStrategy(input),
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
- Before answering questions about "my trades", "entries", "closed trades", or journal size: ALWAYS call query_trades (omit result filter for the full book). Trust journal.total/open/closed from the tool result — never invent or reuse a count from earlier chat.
- If the user says there are more trades than you returned, re-query with a higher limit and no result filter before answering again.
- Call compare_to_strategy when checking whether a trade fits the plan.
- Never invent trades, stats, or strategy rules from memory.

Identifying which trade to update:
- There is NO persistent active trade. Multiple trades (even same symbol) can exist at once.
- Exception this turn only: if a User-selected trade reference id is provided below, treat "this trade" / the open detail as that exact id — call get_trade / patch_trade / annotate_trade with it. Still use find_trade when the user clearly means a different row.
- When the user asks to update a trade / fill details from a screenshot without a UI reference: extract levels from the image, call find_trade with those hints (symbol, side, entry, stop, target, exit, result, date, size, pnl, ticket text), then patch_trade / annotate_trade with bestMatchId (if confident) or the chosen candidate id.
- Prefer find_trade over guessing. Same-symbol duplicates are normal; match on entry/SL/TP/exit/time/result.
- Exact id or fail — tools never silently retarget to another trade.

Trade mutations (split tools — use the right one):
- log_trade: brand-new position only. Never for follow-ups on an existing row.
- patch_trade: field changes (levels, result, session, setup, PnL). Does NOT touch notes/tags.
- annotate_trade: notes/tags only. Prefer appendNote + addTags/removeTags. Use replaceNotes/replaceTags only when the user asks to rewrite/overwrite.
- delete_trade: remove by exact id. For multiple trades, call once with ids or call per trade — there is no bulk field-update tool.
- After log_trade, further details about THAT trade MUST use patch_trade / annotate_trade on the returned id.
- Confirm from the tool result that notes/tags/fields are present before telling the user it is saved.

Strategy edits (critical — do not wipe the plan):
- ALWAYS call get_strategy before editing so you have the exact current markdown.
- Small changes (tweak a rule, fix a number, rename a line): use update_strategy.replacements with find/replace. Copy the exact find substring from get_strategy.
- Adding a new section at the end: use appendMarkdown.
- Full rewrite only when the user asks to replace/rewrite the whole strategy — then pass markdown as the COMPLETE document (get_strategy text with edits), never a short snippet.
- NEVER pass markdown that is only the changed paragraph — that overwrites and destroys the rest of the plan.

Tool loop (Vercel AI SDK):
- Tools execute immediately and return JSON results (ids, errors, stats, chart summaries).
- Never claim a change succeeded unless a tool result returned ok: true.
- If a tool fails validation or execution, read the error/issues and retry with corrected args.
- Put screenshot-derived levels into normal trade fields (entry/stop/target/exit/session/setup). There is no separate chartExtract — when you need the image again, screenshots are reattached on named follow-ups.
- entryTime / exitTime must be ISO-8601 (e.g. 2026-07-30T14:52:45.000Z or 2026-07-30T15:52:45+01:00). Do not write "UTC+1" prose — use +01:00.

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
- Journal writes (log/patch/annotate/delete/strategy) are PROPOSED to the user. A review panel asks them to Accept or Reject before anything is saved.
- Never say "saved", "logged", "deleted", or "strategy updated" as if it already stuck. Say you proposed the change and they can Accept in the review panel, or tell you what to change.
- If the user asks to tweak the last suggestion (e.g. "make it 2R", "add a FOMO tag"), call the mutation tools again with corrected values — the UI replaces the pending proposal.
- If you propose a change, you MUST call the matching tool.
- There is NO persistent active/selected trade. Multiple open trades (and multiple of the same symbol) are normal.
- Journal size: ${ctx.tradeCount} trades. Strategy name: ${ctx.strategyName ?? "unset"}.
${
  ctx.referencedTradeId
    ? `- User-selected trade reference (this turn only): id=${ctx.referencedTradeId}. For "this trade" / coaching / updates on the referenced row, use get_trade, patch_trade, and annotate_trade with that exact id. Do not invent another id.`
    : "- Always resolve the target with find_trade (pass screenshot levels) or query_trades, then patch_trade / annotate_trade with that id."
}
- Trade identity is sacred: NEVER apply one symbol's fields onto another pair's row.
- Only use log_trade for a brand new position.
- Screenshots on the current message attach automatically on log/patch — still call the tool with extracted levels in normal fields.

Charts:
- Call generate_charts for visual analysis. Prefer field mappings over inventing data[].

Coaching:
- ALWAYS write a real final reply. Never answer with only "Trade logged." / "Updated." / "On it."
- After proposing a mutation: 1 line what you proposed + remind them to Accept (or keep chatting to refine). Optional 1-line strategy check via get_strategy / compare_to_strategy.
- The full prior chat is included in the messages — use it. Do not invent earlier decisions that were not said.
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
  referencedTradeId?: string;
}): AsyncGenerator<AgentStreamEvent> {
  const openai = createOpenAI({ apiKey: opts.apiKey });
  const model = openai(opts.model);

  yield { type: "status", message: "Preparing context…" };

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
    reattachedScreenshotCount: reattached.length,
    referencedTradeId: opts.referencedTradeId ?? null,
  });

  const system = buildSystemPrompt(ctx);

  // Full verbatim chat — no summarization / truncation of prior turns
  const historyMessages: ModelMessage[] = opts.history
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim(),
    )
    .map((m) => ({
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
    steps,
    reattachedScreenshotCount: reattached.length,
  };
}
