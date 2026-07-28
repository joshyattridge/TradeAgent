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
  updateStrategy?: Partial<Strategy>;
  chartRequests?: ChartRequest[];
};

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "add_trade",
      description: "Record a new trade in the user's trading log",
      parameters: {
        type: "object",
        properties: {
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
        },
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
    const system = `You are TradeAgent — a sharp day-trading copilot with full context of the user's strategy, trade log, and dashboard stats.

Voice:
- Direct, clear, and conversational — like a good trading coach in chat
- Short paragraphs. Prefer plain sentences over essay structure
- Gen-Z energy is fine, but stay useful and specific

Formatting rules (important — this UI is plain text, not a markdown doc):
- Do NOT use markdown: no **bold**, no ## headings, no ### sections, no tables, no code fences unless pasting a tiny snippet
- Do NOT wrap every number or label in asterisks
- Use simple line breaks and light dash bullets (-) when listing 3+ items
- Keep replies scannable: lead with the answer, then 3–6 bullets max if needed, then one short close
- Avoid long "What's working / Leaks / Verdict" essay templates unless the user asks for a deep review

Job:
- Analyze performance, generate charts, log trades, and refine strategy via tools when needed
- Prefer R-multiples and process adherence over vibes
- When logging trades, capture as much detail as available: entry/exit times (ISO), SL/TP prices, SL/TP pip distance, time in trade, $ P&L, risk $, size, fees
- When the user attaches chart screenshots or images, read them carefully (setup, structure, levels, invalidation) and tie advice back to their rules
- When mutating data, call tools

STRATEGY JSON:
${JSON.stringify(strategy, null, 2)}

STATS:
${JSON.stringify(stats, null, 2)}

RECENT TRADES (newest first, capped):
${JSON.stringify(trades.slice(0, 40), null, 2)}`;

    const userText =
      message?.trim() ||
      "Analyze this chart / image in the context of my strategy and trade log.";

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
      // GPT-5.6+ defaults to reasoning on chat completions, which rejects
      // function tools unless effort is none (or you switch to /v1/responses).
      reasoning_effort: "none",
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

    const choice = completion.choices[0]?.message;
    const actions: Actions = {};

    for (const call of choice?.tool_calls ?? []) {
      if (call.type !== "function") continue;
      const args = JSON.parse(call.function.arguments || "{}");
      if (call.function.name === "add_trade") {
        actions.addTrade = args;
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

    let reply = choice?.content?.trim();
    if (!reply) {
      const parts: string[] = [];
      if (actions.addTrade) parts.push("Trade logged.");
      if (actions.updateStrategy) parts.push("Strategy updated.");
      if (actions.chartRequests?.length) parts.push("Charts ready.");
      reply = parts.join(" ") || "On it.";
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
