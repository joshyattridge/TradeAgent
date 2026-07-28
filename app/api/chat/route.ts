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
          stop: { type: "number" },
          target: { type: "number" },
          exit: { type: "number" },
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
    trades = [],
    strategy,
    stats = {},
    history = [],
    apiKey: clientApiKey,
    model: clientModel,
  }: {
    message: string;
    trades: Trade[];
    strategy: Strategy;
    stats: Record<string, number>;
    history: { role: string; content: string }[];
    apiKey?: string;
    model?: string;
  } = body;

  if (!message?.trim()) {
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
    const system = `You are TradeAgent — a sharp, concise Gen-Z day trading copilot.
You have full context of the user's strategy, trade log, and dashboard stats.
Help them analyze performance, generate charts, log trades, and refine their strategy.
Be direct. No fluff. When mutating data, call tools.
Prefer R-multiples and process adherence over vibes.

STRATEGY JSON:
${JSON.stringify(strategy, null, 2)}

STATS:
${JSON.stringify(stats, null, 2)}

RECENT TRADES (newest first, capped):
${JSON.stringify(trades.slice(0, 40), null, 2)}`;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: system },
      ...history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      { role: "user", content: message },
    ];

    const completion = await openai.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.4,
    });

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
