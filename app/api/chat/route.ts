import { NextRequest, NextResponse } from "next/server";
import {
  streamAgentLoop,
  type AgentStreamEvent,
} from "@/lib/chat-agent";
import type { Strategy, Trade } from "@/lib/types";

export const runtime = "nodejs";

function stripTradeScreenshots(trade: Trade): Trade {
  const next = { ...trade };
  delete next.screenshots;
  return next;
}

function encodeEvent(event: AgentStreamEvent) {
  return `${JSON.stringify(event)}\n`;
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
    chatSummary = "",
    apiKey: clientApiKey,
    model: clientModel,
  }: {
    message: string;
    images?: string[];
    trades: Trade[];
    strategy: Strategy;
    stats: Record<string, number>;
    history: { role: string; content: string }[];
    chatSummary?: string;
    apiKey?: string;
    model?: string;
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

  const userText =
    message?.trim() ||
    "Review this chart / image against my strategy. Tell me what fits, what doesn't, and what's missing.";

  // Keep screenshots only for symbols named in the message (for optional reattach)
  const tradeList = Array.isArray(trades)
    ? trades.map((t) => {
        const named =
          typeof message === "string" &&
          new RegExp(
            `\\b${t.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
            "i",
          ).test(message);
        return named ? t : stripTradeScreenshots(t);
      })
    : [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const push = (event: AgentStreamEvent) => {
        controller.enqueue(encoder.encode(encodeEvent(event)));
      };

      try {
        for await (const event of streamAgentLoop({
          apiKey,
          model,
          strategy,
          trades: tradeList,
          stats,
          history,
          chatSummary: typeof chatSummary === "string" ? chatSummary : "",
          userText,
          images: imageList,
        })) {
          push(event);
        }
      } catch (error) {
        console.error(error);
        const messageText =
          error instanceof Error ? error.message : "OpenAI request failed";
        push({
          type: "error",
          reply: `OpenAI error: ${messageText}\n\nCheck your API key and model in Settings.`,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
