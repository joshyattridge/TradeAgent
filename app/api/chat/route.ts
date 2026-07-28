import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import type { Strategy, Trade } from "@/lib/types";

export const runtime = "nodejs";

type ChartRequest = {
  type: "equity" | "rByDay" | "winLoss" | "bySymbol" | "bySetup";
  title?: string;
};

type Actions = {
  addTrade?: Omit<Trade, "id">;
  updateTrade?: { id: string } & Partial<Omit<Trade, "id">>;
  updateStrategy?: Partial<Strategy>;
  chartRequests?: ChartRequest[];
};

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
        "Modify an existing logged trade by id. Use when the user wants to fix fields, close a trade, change P&L/R, add notes, or correct SL/TP/times. Prefer updating the most recent matching trade if they don't give an id.",
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
      description: "Generate one or more charts from the trade log",
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
                  enum: ["equity", "rByDay", "winLoss", "bySymbol", "bySetup"],
                },
                title: { type: "string" },
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
) {
  return `You are TradeAgent — a day-trading coach with the user's strategy, trade log, and stats in context.

Voice:
- Direct coach energy. Plain chat text only.
- Short paragraphs. Light dash bullets (-) when listing 3+ items.
- No markdown: no **bold**, no ## headings, no tables, no code fences.

Core behavior (important):
- ALWAYS write a real reply to the user. Never answer with only a tool call and silence.
- Never reply with empty fluff like "Trade logged." or "On it." — that is a failure.
- When the user shares a trade or chart (especially screenshots), review it against THEIR strategy rules before anything else.
- Say what fits the model and what does not (bias, PD zone, POI, sweep, displacement, session, risk).
- Ask for missing details instead of inventing them. Priority asks: entry/SL/TP, session, R or $ risk/P&L, entry/exit times, result.
- Give coaching input: grade the setup briefly (A/B/C or pass), one thing done well, one leak, one next question.
- Only call add_trade when they clearly want it saved/logged (or confirm after you offer). Analyzing a screenshot alone is NOT enough to auto-log.
- Use update_trade to change existing trades (fix SL, close trade, patch P&L, notes, etc.). Use the trade id from the log. If unclear which trade, ask or update the newest matching symbol.
- Screenshots on the current message are auto-attached when you add/update a trade — still call the tool when saving.
- Prefer process adherence and R-multiples over vibes.

STRATEGY JSON:
${JSON.stringify(strategy, null, 2)}

STATS:
${JSON.stringify(stats, null, 2)}

RECENT TRADES (newest first, capped — use these ids for update_trade):
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
  }: {
    message: string;
    images?: string[];
    trades: Trade[];
    strategy: Strategy;
    stats: Record<string, number>;
    history: { role: string; content: string }[];
    apiKey?: string;
    model?: string;
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
    const system = buildSystemPrompt(strategy, stats, trades);

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
    const actions = choice ? parseActions(choice, strategy) : {};
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
            content: `Tool actions taken this turn (if any): ${JSON.stringify(actions)}. Now write the full trader-facing reply.`,
          },
          {
            role: "user",
            content:
              "Write your reply now. Review vs my strategy, call out missing fields, and give coaching input. Plain text only. Do not say just 'Trade logged'.",
          },
        ],
        reasoning_effort: "none",
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

      reply =
        followup.choices[0]?.message?.content?.trim() ||
        "I looked at that against your plan — tell me entry, SL, TP, and session so I can grade it properly.";
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
