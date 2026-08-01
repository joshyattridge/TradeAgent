import { NextRequest, NextResponse } from "next/server";
import {
  streamAgentLoop,
  type AgentStreamEvent,
} from "@/lib/chat-agent";
import { appendChatLogTurn } from "@/lib/chat-log";
import {
  sanitizeAttachments,
  sanitizeHistory,
} from "@/lib/chat-request";
import type { Strategy, Trade } from "@/lib/types";
import type { ChatAgentMessage } from "@/lib/chat-history";

export const runtime = "nodejs";

function encodeEvent(event: AgentStreamEvent) {
  return `${JSON.stringify(event)}\n`;
}

function resolveChatLogId(raw: unknown) {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return crypto.randomUUID();
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    message,
    images = [],
    attachments: rawAttachments,
    trades = [],
    strategy,
    stats = {},
    history: rawHistory = [],
    referencedTradeId,
    apiKey: clientApiKey,
    model: clientModel,
    chatLogId: rawChatLogId,
  }: {
    message: string;
    images?: string[];
    attachments?: unknown;
    trades: Trade[];
    strategy: Strategy;
    stats: Record<string, number>;
    history: unknown;
    referencedTradeId?: string;
    apiKey?: string;
    model?: string;
    chatLogId?: string;
  } = body;

  const attachments = sanitizeAttachments(rawAttachments);
  const history = sanitizeHistory(rawHistory);
  const chatLogId = resolveChatLogId(rawChatLogId);

  const imageList = Array.isArray(images)
    ? images.filter(
        (img): img is string =>
          typeof img === "string" && img.startsWith("data:image/"),
      )
    : [];

  const hasAttachments = attachments.length > 0 || imageList.length > 0;

  if (!message?.trim() && !hasAttachments) {
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

  // Empty message is only allowed when attachments/images are present (guard above).
  const userText =
    message?.trim() ||
    "Review the attached file(s) / image(s) in the context of my trading journal and strategy.";

  const attachmentNames = [
    ...attachments.map((a) => a.name).filter(Boolean),
    ...imageList.map((_, i) => `image-${i + 1}`),
  ];

  // Full journal — keep trade screenshots; no stripping for token savings
  const tradeList = Array.isArray(trades) ? trades : [];

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
          userText,
          images: imageList,
          attachments,
          referencedTradeId:
            typeof referencedTradeId === "string" ? referencedTradeId : undefined,
        })) {
          push(event);

          if (event.type === "done") {
            try {
              await appendChatLogTurn({
                chatLogId,
                userText,
                reply: event.reply,
                agentMessages: event.agentMessages as ChatAgentMessage[] | undefined,
                model,
                attachmentNames,
              });
            } catch (logError) {
              console.warn("[TradeAgent] chat log write failed", logError);
            }
          } else if (event.type === "error") {
            try {
              await appendChatLogTurn({
                chatLogId,
                userText,
                error: event.reply,
                model,
                attachmentNames,
              });
            } catch (logError) {
              console.warn("[TradeAgent] chat log write failed", logError);
            }
          }
        }
      } catch (error) {
        console.error(error);
        const messageText =
          error instanceof Error ? error.message : "OpenAI request failed";
        const reply = `OpenAI error: ${messageText}\n\nCheck your API key and model in Settings.`;
        push({
          type: "error",
          reply,
        });
        try {
          await appendChatLogTurn({
            chatLogId,
            userText,
            error: reply,
            model,
            attachmentNames,
          });
        } catch (logError) {
          console.warn("[TradeAgent] chat log write failed", logError);
        }
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
