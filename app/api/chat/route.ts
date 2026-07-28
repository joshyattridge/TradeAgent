import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import type { ChartRequest, Strategy, Trade } from "@/lib/types";

export const runtime = "nodejs";

type Actions = {
  addTrade?: Omit<Trade, "id">;
  updateTrade?: { id: string } & Partial<Omit<Trade, "id">>;
  deleteTradeIds?: string[];
  updateStrategy?: Partial<Strategy>;
  chartRequests?: ChartRequest[];
};

const METRIC_FIELDS = [
  "entry",
  "stop",
  "target",
  "exit",
  "slPips",
  "tpPips",
  "stopDistance",
  "targetDistance",
  "timeInTradeMinutes",
  "pnlUsd",
  "riskUsd",
  "feesUsd",
  "rMultiple",
] as const;

const LABEL_FIELDS = [
  "symbol",
  "date",
  "setup",
  "session",
  "side",
  "result",
] as const;

const tradeFields = {
  date: { type: "string", description: "YYYY-MM-DD" },
  symbol: { type: "string" },
  side: { type: "string", enum: ["long", "short"] },
  setup: { type: "string" },
  entry: { type: "number" },
  stop: {
    type: "number",
    description: "Stop loss price level (SL)",
  },
  target: {
    type: "number",
    description: "Take profit price level (TP)",
  },
  exit: { type: "number" },
  slPips: {
    type: "number",
    description: "Distance from entry to SL in pips (or points for indices)",
  },
  tpPips: {
    type: "number",
    description: "Distance from entry to TP in pips (or points for indices)",
  },
  entryTime: {
    type: "string",
    description: "ISO datetime when entry filled, e.g. 2026-07-28T08:42:00Z",
  },
  exitTime: {
    type: "string",
    description: "ISO datetime when trade closed",
  },
  timeInTradeMinutes: {
    type: "number",
    description: "Minutes held; derive from entry/exit times when possible",
  },
  pnlUsd: {
    type: "number",
    description: "Realized dollar P&L (negative for losses)",
  },
  riskUsd: {
    type: "number",
    description: "Dollars risked for 1R on this trade",
  },
  size: {
    type: "string",
    description: 'Position size, e.g. "0.40 lots" or "2 contracts"',
  },
  feesUsd: { type: "number", description: "Fees/commission/swap in $" },
  rMultiple: { type: "number" },
  result: {
    type: "string",
    enum: ["win", "loss", "breakeven", "open"],
  },
  notes: { type: "string" },
  session: { type: "string" },
} as const;

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "add_trade",
      description:
        "Create a NEW trade in the log. Only call when the user clearly wants to log/save a trade (or confirms after you proposed logging). Screenshots on the message are attached automatically. Do not call this just to analyze a chart.",
      parameters: {
        type: "object",
        properties: tradeFields,
        required: [
          "date",
          "symbol",
          "side",
          "setup",
          "entry",
          "stop",
          "target",
          "rMultiple",
          "result",
        ],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_trade",
      description:
        "Modify an existing logged trade by id. Use for follow-ups about the SAME trade (result, P&L, exit, times, notes, close the trade, etc.). Prefer this over add_trade whenever an active/recent trade exists.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Trade id from the trade log (required)",
          },
          ...tradeFields,
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_trade",
      description:
        "Permanently delete one or more trades by id. Use to remove duplicates after reconciling, or when the user asks to delete a trade.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Single trade id to delete",
          },
          ids: {
            type: "array",
            items: { type: "string" },
            description: "Multiple trade ids to delete in one call",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_strategy",
      description: "Update fields on the user's trading strategy",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          version: { type: "string" },
          summary: { type: "string" },
          edge: { type: "string" },
          approach: { type: "string" },
          addRule: {
            type: "object",
            properties: {
              title: { type: "string" },
              body: { type: "string" },
            },
          },
          addRisk: {
            type: "object",
            properties: {
              title: { type: "string" },
              body: { type: "string" },
            },
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_charts",
      description:
        "Generate one or more charts from the live trade log. Use presets for common views, or bar/scatter/line with field mappings for true on-the-fly analysis (e.g. SL size vs R, win rate by SL buckets). Prefer field mappings over inventing data points — the client builds the series from trades.",
      parameters: {
        type: "object",
        properties: {
          charts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "equity",
                    "rByDay",
                    "winLoss",
                    "bySymbol",
                    "bySetup",
                    "bar",
                    "scatter",
                    "line",
                  ],
                  description:
                    "Presets: equity, rByDay, winLoss, bySymbol, bySetup. Custom: scatter (trade points), bar (grouped/bucketed), line (series).",
                },
                title: { type: "string" },
                description: { type: "string" },
                xLabel: { type: "string" },
                yLabel: { type: "string" },
                xField: {
                  type: "string",
                  enum: [...METRIC_FIELDS],
                  description: "Scatter X metric",
                },
                yField: {
                  type: "string",
                  enum: [...METRIC_FIELDS],
                  description: "Scatter Y metric",
                },
                valueField: {
                  type: "string",
                  enum: [...METRIC_FIELDS],
                  description: "Bar/line value metric (default rMultiple)",
                },
                labelField: {
                  type: "string",
                  enum: [...LABEL_FIELDS],
                  description: "Bar/line group-by or scatter point label",
                },
                aggregate: {
                  type: "string",
                  enum: ["sum", "avg", "count", "winRate"],
                  description:
                    "How to reduce trades in a bar/line group. Use winRate for hit-rate charts.",
                },
                bucketField: {
                  type: "string",
                  enum: [...METRIC_FIELDS],
                  description:
                    "Numeric field to bin for distribution charts (e.g. slPips for SL size vs win rate)",
                },
                bucketSize: {
                  type: "number",
                  description: "Bin width when bucketField is set (e.g. 10)",
                },
                closedOnly: {
                  type: "boolean",
                  description: "Default true — only closed trades",
                },
                data: {
                  type: "array",
                  description:
                    "Optional explicit points only when field mapping cannot express the chart. Prefer xField/yField/valueField/bucketField instead.",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      value: { type: "number" },
                      secondary: { type: "number" },
                      x: { type: "number" },
                      y: { type: "number" },
                    },
                    required: ["label", "value"],
                  },
                },
              },
              required: ["type"],
            },
          },
        },
        required: ["charts"],
      },
    },
  },
];

function buildSystemPrompt(
  strategy: Strategy,
  stats: Record<string, number>,
  trades: Trade[],
  activeTradeId?: string | null,
) {
  const active = activeTradeId
    ? trades.find((t) => t.id === activeTradeId)
    : null;

  return `You are TradeAgent — a fully chat-controlled trading journal + coach.

This product is conversational. The user runs their whole journal through chat: log, update, delete, review, and coach. Be decisive and actually mutate the log with tools when they ask.

Voice:
- SHORT and concise. Default to 2–5 short sentences, or a tiny checklist.
- Plain chat text only. No markdown: no **bold**, no ## headings, no tables, no code fences.
- Light dash bullets (-) only for 2–4 items. Never write long essays.
- One clear next question max, unless confirming a short suggested fill.

Missing info rules:
- Screenshots are primary source of truth. If the user attaches a chart/screenshot, READ IT carefully and pull everything you can from it before asking questions: symbol, side/bias, entry, SL, TP, exit if marked, session/time if visible, structure notes, pip/point distances, and whether it looks open or closed.
- Prefer extracting and using screenshot values over asking the user to retype what is already on the image.
- Only ASK for fields that are truly not visible/inferable from the screenshot + message.
- If a value is slightly ambiguous on the chart, SUGGEST your best read and ask for a quick yes/no confirmation.
  Example: "From the screenshot I’m reading BTCUSD long, entry 64050, SL 62995, TP 63888.5, looks stopped out — log that?"
- Required when logging/closing (from screenshot and/or user text): symbol, side, entry, SL, TP (or why missing), result, R and/or $ P&L.
- Nice-to-have if visible: session, size, entry/exit times, risk $, setup notes, HTF confirmations.
- Only invent nothing. Extract, estimate from the image, confirm if unsure, then save.

Hard rules for mutations:
- If you say you logged/updated/deleted something, you MUST call the matching tool in that same turn. Never claim a change without a tool call.
- One live conversation = one trade thread whenever possible.
- ACTIVE TRADE ID: ${activeTradeId ?? "none"}
${
  active
    ? `- Active trade snapshot: ${JSON.stringify({
        id: active.id,
        symbol: active.symbol,
        side: active.side,
        result: active.result,
        rMultiple: active.rMultiple,
        pnlUsd: active.pnlUsd,
        entry: active.entry,
        stop: active.stop,
        target: active.target,
        exit: active.exit,
        hasScreenshots: Boolean(active.screenshots?.length),
      })}`
    : "- No active trade yet."
}
- After add_trade, further details about THAT trade (I lost $500, closed at X, fix SL, add session, etc.) MUST use update_trade on the active/same id — NEVER add_trade again.
- Only use add_trade for a brand new position the user wants recorded.
- Use delete_trade to remove duplicates or unwanted rows. If user says remove the duplicate and keep one, delete the extra id and update the keeper if needed — do both in the same turn when possible.
- Prefer keeping the trade that has screenshots when reconciling duplicates, unless the user says otherwise.
- Screenshots on the current message attach automatically on add/update — still call the tool.
- When a screenshot is present and the user wants it recorded, extract the trade fields from the image and call add_trade/update_trade with those values in the same turn (confirm only if something critical is unclear).

Charts:
- When the user asks for a chart, comparison, or visual analysis, call generate_charts — do not only describe a plot in text.
- Presets: equity, rByDay, winLoss, bySymbol, bySetup.
- On-the-fly: use type scatter/bar/line with field mappings so the app builds real data from the trade log.
  Examples:
  - SL size vs profit/R → scatter with xField=slPips (or stopDistance), yField=rMultiple or pnlUsd
  - Win rate by SL size → bar with bucketField=slPips, bucketSize=10, aggregate=winRate
  - Avg R by session → bar with labelField=session, valueField=rMultiple, aggregate=avg
- Prefer field mappings over inventing data[]. Keep the reply short; the chart is the answer.

Coaching (keep it tiny):
- ALWAYS write a real reply. Never answer with only "Trade logged." / "Updated." / "On it."
- After a save/update: 1 line what you pulled/saved from the screenshot + optional 1-line strategy check + ask only if something important was unreadable.
- Do not ask the user for numbers that are clearly visible on the chart.

STRATEGY JSON:
${JSON.stringify(strategy, null, 2)}

STATS:
${JSON.stringify(stats, null, 2)}

RECENT TRADES (newest first — use these ids):
${JSON.stringify(
  trades.slice(0, 40).map((t) => ({
    id: t.id,
    date: t.date,
    symbol: t.symbol,
    side: t.side,
    setup: t.setup,
    entry: t.entry,
    stop: t.stop,
    target: t.target,
    exit: t.exit,
    slPips: t.slPips,
    tpPips: t.tpPips,
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    timeInTradeMinutes: t.timeInTradeMinutes,
    pnlUsd: t.pnlUsd,
    riskUsd: t.riskUsd,
    size: t.size,
    rMultiple: t.rMultiple,
    result: t.result,
    session: t.session,
    notes: t.notes,
    hasScreenshots: Boolean(t.screenshots?.length),
  })),
  null,
  2,
)}`;
}

function looksLikeFollowUpUpdate(message: string) {
  return /(update|lost|loss|won|win|closed|close it|fix|change|correct|actually|reflect|make it|set (it|the)|pnl|p&l|-\s*\$?\d|result|duplicate|remove|delete|keep the)/i.test(
    message,
  );
}

function coerceActions(
  actions: Actions,
  message: string,
  activeTradeId?: string | null,
): Actions {
  const next = { ...actions };

  // Follow-up details about the active trade should update, not create a duplicate
  if (
    next.addTrade &&
    !next.updateTrade &&
    activeTradeId &&
    looksLikeFollowUpUpdate(message)
  ) {
    next.updateTrade = { id: activeTradeId, ...next.addTrade };
    delete next.addTrade;
  }

  // If both add + update somehow, prefer update on active trade
  if (next.addTrade && next.updateTrade) {
    delete next.addTrade;
  }

  return next;
}

function parseActions(
  choice: OpenAI.Chat.Completions.ChatCompletionMessage,
  strategy: Strategy,
): Actions {
  const actions: Actions = {};
  for (const call of choice.tool_calls ?? []) {
    if (call.type !== "function") continue;
    const args = JSON.parse(call.function.arguments || "{}");
    if (call.function.name === "add_trade") {
      actions.addTrade = args;
    }
    if (call.function.name === "update_trade" && args.id) {
      actions.updateTrade = args;
    }
    if (call.function.name === "delete_trade") {
      const ids = [
        ...(typeof args.id === "string" && args.id ? [args.id] : []),
        ...(Array.isArray(args.ids) ? args.ids.filter((x: unknown) => typeof x === "string") : []),
      ];
      if (ids.length) {
        actions.deleteTradeIds = [...new Set(ids)];
      }
    }
    if (call.function.name === "update_strategy") {
      const patch: Partial<Strategy> = { ...args };
      delete (patch as { addRule?: unknown }).addRule;
      delete (patch as { addRisk?: unknown }).addRisk;
      if (args.addRule) {
        patch.rules = [...(strategy.rules ?? []), args.addRule];
      }
      if (args.addRisk) {
        patch.risk = [...(strategy.risk ?? []), args.addRisk];
      }
      actions.updateStrategy = patch;
    }
    if (call.function.name === "generate_charts") {
      actions.chartRequests = args.charts;
    }
  }
  return actions;
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

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    message,
    images = [],
    trades = [],
    strategy,
    stats = {},
    history = [],
    apiKey: clientApiKey,
    model: clientModel,
    activeTradeId = null,
  }: {
    message: string;
    images?: string[];
    trades: Trade[];
    strategy: Strategy;
    stats: Record<string, number>;
    history: { role: string; content: string }[];
    apiKey?: string;
    model?: string;
    activeTradeId?: string | null;
  } = body;

  const imageList = Array.isArray(images)
    ? images.filter(
        (img): img is string =>
          typeof img === "string" && img.startsWith("data:image/"),
      ).slice(0, 4)
    : [];

  if (!message?.trim() && !imageList.length) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  const apiKey =
    (typeof clientApiKey === "string" && clientApiKey.trim()) ||
    process.env.OPENAI_API_KEY ||
    "";
  const model =
    (typeof clientModel === "string" && clientModel.trim()) ||
    process.env.OPENAI_MODEL ||
    "gpt-5.6-luna";

  if (!apiKey) {
    return NextResponse.json(
      {
        reply:
          "No OpenAI API key found. Add your key in Settings to use TradeAgent chat.",
        actions: {},
        mode: "error",
      },
      { status: 401 },
    );
  }

  try {
    const openai = new OpenAI({ apiKey });
    const system = buildSystemPrompt(strategy, stats, trades, activeTradeId);

    const userText =
      message?.trim() ||
      "Review this chart / image against my strategy. Tell me what fits, what doesn't, and what's missing.";

    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: "text", text: userText },
      ...imageList.map(
        (url): OpenAI.Chat.Completions.ChatCompletionContentPart => ({
          type: "image_url",
          image_url: { url, detail: "high" },
        }),
      ),
    ];

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      ...history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      {
        role: "user",
        content: imageList.length ? userContent : userText,
      },
    ];

    const completion = await openai.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: "auto",
      reasoning_effort: "none",
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

    const choice = completion.choices[0]?.message;
    let actions = choice ? parseActions(choice, strategy) : {};
    actions = coerceActions(actions, userText, activeTradeId);
    let reply = choice?.content?.trim() ?? "";

    if (isWeakReply(reply)) {
      const followup = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: system },
          ...history
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
          {
            role: "user",
            content: imageList.length ? userContent : userText,
          },
          {
            role: "assistant",
            content: `Tool actions for this turn: ${JSON.stringify(actions)}. Keep the user-facing reply short.`,
          },
          {
            role: "user",
            content:
              "Reply in 2–5 short sentences max. If a screenshot was provided, use the values you read from it. Confirm what you saved. Ask only for fields that were NOT visible on the image. Plain text only. No long lists. No 'Trade logged.' stubs.",
          },
        ],
        reasoning_effort: "none",
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

      reply =
        followup.choices[0]?.message?.content?.trim() ||
        "What do you want changed on the active trade?";
    }

    return NextResponse.json({ reply, actions, mode: "openai", model });
  } catch (error) {
    console.error(error);
    const messageText =
      error instanceof Error ? error.message : "OpenAI request failed";
    return NextResponse.json(
      {
        reply: `OpenAI error: ${messageText}\n\nCheck your API key and model in Settings.`,
        actions: {},
        mode: "error",
        model,
      },
      { status: 200 },
    );
  }
}
