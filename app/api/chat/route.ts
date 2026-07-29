import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import {
  buildSystemPrompt,
  JournalSession,
  runAgentLoop,
} from "@/lib/chat-agent";
import type { Strategy, Trade } from "@/lib/types";

export const runtime = "nodejs";

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
    ? images
        .filter(
          (img): img is string =>
            typeof img === "string" && img.startsWith("data:image/"),
        )
        .slice(0, 4)
    : [];

  if (!message?.trim() && !imageList.length) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  if (!strategy || typeof strategy !== "object") {
    return NextResponse.json({ error: "Missing strategy" }, { status: 400 });
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

    const userText =
      message?.trim() ||
      "Review this chart / image against my strategy. Tell me what fits, what doesn't, and what's missing.";

    const session = new JournalSession({
      trades: Array.isArray(trades) ? trades : [],
      strategy,
      activeTradeId,
      userMessage: userText,
      turnHasScreenshots: imageList.length > 0,
    });

    const system = buildSystemPrompt(
      session.strategy,
      Object.keys(stats).length ? stats : session.getStats(),
      session.trades,
      session.activeTradeId,
    );

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

    const result = await runAgentLoop({
      openai,
      model,
      messages,
      session,
    });

    return NextResponse.json({
      reply: result.reply,
      actions: result.actions,
      activeTradeId: result.activeTradeId,
      rounds: result.rounds,
      mode: "openai",
      model,
    });
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
