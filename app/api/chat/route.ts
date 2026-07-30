import { NextRequest, NextResponse } from "next/server";
import {
  streamAgentLoop,
  type AgentStreamEvent,
} from "@/lib/chat-agent";
import type { ChatAttachmentPayload } from "@/lib/chat-attachments";
import type { Strategy, Trade } from "@/lib/types";

export const runtime = "nodejs";

const MAX_ATTACHMENTS = 6;
const MAX_TEXT_CHARS = 120_000;

function stripTradeScreenshots(trade: Trade): Trade {
  const next = { ...trade };
  delete next.screenshots;
  return next;
}

function encodeEvent(event: AgentStreamEvent) {
  return `${JSON.stringify(event)}\n`;
}

function sanitizeAttachments(raw: unknown): ChatAttachmentPayload[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatAttachmentPayload[] = [];

  for (const item of raw.slice(0, MAX_ATTACHMENTS)) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const name =
      typeof a.name === "string" && a.name.trim()
        ? a.name.trim().slice(0, 200)
        : "attachment";

    if (a.kind === "image" && typeof a.dataUrl === "string") {
      if (!a.dataUrl.startsWith("data:image/")) continue;
      if (a.dataUrl.length > 8_000_000) continue;
      out.push({
        kind: "image",
        name,
        dataUrl: a.dataUrl,
        mime: typeof a.mime === "string" ? a.mime : undefined,
      });
      continue;
    }

    if (a.kind === "text" && typeof a.text === "string") {
      const text =
        a.text.length > MAX_TEXT_CHARS
          ? `${a.text.slice(0, MAX_TEXT_CHARS)}\n\n[…truncated]`
          : a.text;
      if (!text.trim()) continue;
      out.push({
        kind: "text",
        name,
        text,
        mime: typeof a.mime === "string" ? a.mime : undefined,
      });
      continue;
    }

    if (a.kind === "file" && typeof a.dataUrl === "string") {
      if (!a.dataUrl.startsWith("data:")) continue;
      if (a.dataUrl.length > 8_000_000) continue;
      const mime =
        typeof a.mime === "string" && a.mime.trim()
          ? a.mime.trim()
          : "application/pdf";
      out.push({ kind: "file", name, dataUrl: a.dataUrl, mime });
    }
  }

  return out;
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
    history = [],
    chatSummary = "",
    referencedTradeId,
    apiKey: clientApiKey,
    model: clientModel,
  }: {
    message: string;
    images?: string[];
    attachments?: unknown;
    trades: Trade[];
    strategy: Strategy;
    stats: Record<string, number>;
    history: { role: string; content: string }[];
    chatSummary?: string;
    referencedTradeId?: string;
    apiKey?: string;
    model?: string;
  } = body;

  const attachments = sanitizeAttachments(rawAttachments);

  const imageList = Array.isArray(images)
    ? images
        .filter(
          (img): img is string =>
            typeof img === "string" && img.startsWith("data:image/"),
        )
        .slice(0, 4)
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

  const userText =
    message?.trim() ||
    (hasAttachments
      ? "Review the attached file(s) / image(s) in the context of my trading journal and strategy."
      : "Review this chart / image against my strategy. Tell me what fits, what doesn't, and what's missing.");

  // Keep screenshots for symbols named in the message, or the UI-referenced trade
  const tradeList = Array.isArray(trades)
    ? trades.map((t) => {
        const named =
          typeof message === "string" &&
          new RegExp(
            `\\b${t.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
            "i",
          ).test(message);
        const referenced =
          typeof referencedTradeId === "string" && t.id === referencedTradeId;
        return named || referenced ? t : stripTradeScreenshots(t);
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
          attachments,
          referencedTradeId:
            typeof referencedTradeId === "string" ? referencedTradeId : undefined,
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
