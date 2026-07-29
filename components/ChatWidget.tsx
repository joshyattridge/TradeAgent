"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Eraser, ImagePlus, Send, X } from "lucide-react";
import { ChartRenderer } from "@/components/ChartRenderer";
import { fileToChatImage } from "@/lib/images";
import { applyChatActions, useTradingStore } from "@/lib/store";
import { buildChartFromRequest, computeStats } from "@/lib/stats";
import type { ChartRequest, ChartSpec } from "@/lib/types";

const MAX_IMAGES = 4;

type ToolStatus = {
  toolCallId: string;
  name: string;
  label: string;
  state: "running" | "done" | "error";
  detail?: string;
};

type StreamDonePayload = {
  reply: string;
  actions?: {
    addTrade?: unknown;
    addTrades?: unknown[];
    updateTrade?: unknown;
    updateTrades?: unknown[];
    deleteTradeIds?: string[];
    updateStrategy?: unknown;
    charts?: ChartSpec[];
    chartRequests?: ChartRequest[];
  };
  chatSummary?: string;
};

export function ChatWidget() {
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Thinking…");
  const [streamingText, setStreamingText] = useState("");
  const [toolStatuses, setToolStatuses] = useState<ToolStatus[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const trades = useTradingStore((s) => s.trades);
  const strategy = useTradingStore((s) => s.strategy);
  const chat = useTradingStore((s) => s.chat);
  const openaiApiKey = useTradingStore((s) => s.openaiApiKey);
  const openaiModel = useTradingStore((s) => s.openaiModel);
  const chatSummary = useTradingStore((s) => s.chatSummary);
  const addChatMessage = useTradingStore((s) => s.addChatMessage);
  const setChatSummary = useTradingStore((s) => s.setChatSummary);
  const clearChat = useTradingStore((s) => s.clearChat);
  const hydrated = useTradingStore((s) => s.hydrated);

  useEffect(() => {
    if (!expanded) return;
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: "smooth",
    });
  }, [
    chat,
    expanded,
    loading,
    pendingImages,
    streamingText,
    toolStatuses,
    statusMessage,
  ]);

  async function addFiles(files: FileList | File[]) {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;

    const room = MAX_IMAGES - pendingImages.length;
    if (room <= 0) return;

    const next: string[] = [];
    for (const file of list.slice(0, room)) {
      try {
        next.push(await fileToChatImage(file));
      } catch {
        // skip bad files
      }
    }
    if (next.length) {
      setPendingImages((prev) => [...prev, ...next].slice(0, MAX_IMAGES));
      setExpanded(true);
    }
  }

  function resetStreamUi() {
    setStatusMessage("Thinking…");
    setStreamingText("");
    setToolStatuses([]);
  }

  function upsertToolStatus(next: ToolStatus) {
    setToolStatuses((prev) => {
      const idx = prev.findIndex((t) => t.toolCallId === next.toolCallId);
      if (idx === -1) return [...prev, next];
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...next };
      return copy;
    });
  }

  function applyDone(data: StreamDonePayload, images: string[]) {
    if (typeof data.chatSummary === "string") {
      setChatSummary(data.chatSummary);
    }

    let charts: ChartSpec[] = [];
    if (data.actions) {
      const applied = applyChatActions({
        addTrade: data.actions.addTrade as never,
        addTrades: data.actions.addTrades as never,
        updateTrade: data.actions.updateTrade as never,
        updateTrades: data.actions.updateTrades as never,
        deleteTradeIds: data.actions.deleteTradeIds,
        updateStrategy: data.actions.updateStrategy as never,
        charts: data.actions.charts ?? [],
        screenshots: images.length ? images : undefined,
      });

      charts = applied.charts;

      if (!charts.length && data.actions.chartRequests?.length) {
        const tradesNow = useTradingStore.getState().trades;
        charts = data.actions.chartRequests.map((req: ChartRequest) =>
          buildChartFromRequest(req, tradesNow),
        );
      }

      if (applied.notes.length && !data.reply?.trim()) {
        data.reply = applied.notes.join(" ");
      }
    }

    addChatMessage({
      role: "assistant",
      content: data.reply ?? "Done.",
      charts: charts.length ? charts : undefined,
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    const images = pendingImages;
    if ((!text && !images.length) || loading) return;

    setInput("");
    setPendingImages([]);
    setExpanded(true);
    addChatMessage({
      role: "user",
      content: text || (images.length ? "Analyze this chart / image." : ""),
      images: images.length ? images : undefined,
    });
    setLoading(true);
    resetStreamUi();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify({
          message:
            text ||
            "Analyze this chart / image in the context of my strategy and trade log.",
          images,
          trades: trades.map((t) => {
            // Keep screenshots only for symbols named in this message (reattach)
            const named =
              text &&
              new RegExp(
                `\\b${t.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
                "i",
              ).test(text);
            if (named) return t;
            const next = { ...t };
            delete next.screenshots;
            return next;
          }),
          strategy,
          stats: computeStats(trades),
          apiKey: openaiApiKey || undefined,
          model: openaiModel,
          chatSummary,
          history: chat.slice(-20).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      const contentType = res.headers.get("content-type") ?? "";

      // Non-stream JSON fallback (auth errors, etc.)
      if (!contentType.includes("ndjson")) {
        const data = await res.json();
        if (typeof data.chatSummary === "string") {
          setChatSummary(data.chatSummary);
        }
        addChatMessage({
          role: "assistant",
          content:
            data.reply ??
            "No OpenAI API key found. Add your key in Settings to use TradeAgent chat.",
        });
        return;
      }

      if (!res.body) {
        throw new Error("No response body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let event: {
            type: string;
            message?: string;
            text?: string;
            toolCallId?: string;
            name?: string;
            label?: string;
            ok?: boolean;
            detail?: string;
            reply?: string;
            actions?: StreamDonePayload["actions"];
            chatSummary?: string;
          };
          try {
            event = JSON.parse(trimmed);
          } catch {
            continue;
          }

          if (event.type === "status" && event.message) {
            setStatusMessage(event.message);
          } else if (event.type === "text-delta" && event.text) {
            setStreamingText((prev) => prev + event.text!);
          } else if (
            event.type === "tool-start" &&
            event.toolCallId &&
            event.name &&
            event.label
          ) {
            upsertToolStatus({
              toolCallId: event.toolCallId,
              name: event.name,
              label: event.label,
              state: "running",
            });
          } else if (
            event.type === "tool-result" &&
            event.toolCallId &&
            event.name &&
            event.label
          ) {
            upsertToolStatus({
              toolCallId: event.toolCallId,
              name: event.name,
              label: event.label,
              state: event.ok === false ? "error" : "done",
              detail: event.detail,
            });
          } else if (event.type === "error") {
            addChatMessage({
              role: "assistant",
              content:
                event.reply ??
                "OpenAI error. Check your API key and model in Settings.",
            });
            finished = true;
            break;
          } else if (event.type === "done") {
            applyDone(
              {
                reply: event.reply?.trim() || "Done.",
                actions: event.actions,
                chatSummary: event.chatSummary,
              },
              images,
            );
            finished = true;
            break;
          }
        }
      }

      // Flush trailing buffer if stream ended without explicit done
      if (!finished && buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim());
          if (event.type === "done") {
            applyDone(event, images);
            finished = true;
          } else if (event.type === "error") {
            addChatMessage({
              role: "assistant",
              content: event.reply ?? "OpenAI error.",
            });
            finished = true;
          }
        } catch {
          // ignore
        }
      }

      if (!finished && streamingText.trim()) {
        addChatMessage({
          role: "assistant",
          content: streamingText.trim(),
        });
      }
    } catch {
      addChatMessage({
        role: "assistant",
        content:
          "Couldn't reach the AI endpoint. Check your connection or OPENAI_API_KEY.",
      });
    } finally {
      setLoading(false);
      resetStreamUi();
      inputRef.current?.focus();
    }
  }

  if (!hydrated) return null;

  const canSend = !loading && (Boolean(input.trim()) || pendingImages.length > 0);

  return (
    <div className={`chat-dock${expanded ? " is-expanded" : ""}`}>
      <section className="chat-shell" aria-label="TradeAgent chat">
        {expanded ? (
          <div className="chat-panel__messages" ref={scroller}>
            <div className="chat-float-actions">
              <button
                type="button"
                className="chat-float-btn"
                onClick={() => {
                  clearChat();
                  setPendingImages([]);
                  setExpanded(false);
                }}
                aria-label="Clear chat"
                title="Clear chat"
              >
                <Eraser size={15} />
              </button>
              <button
                type="button"
                className="chat-float-btn"
                onClick={() => setExpanded(false)}
                aria-label="Close chat"
                title="Close chat"
              >
                <X size={16} />
              </button>
            </div>

            {chat.map((message) => (
              <div
                key={message.id}
                className={`chat-bubble chat-bubble--${message.role}`}
              >
                {message.images?.length ? (
                  <div className="chat-bubble__images">
                    {message.images.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={`${message.id}-img-${i}`}
                        src={src}
                        alt="Uploaded chart"
                      />
                    ))}
                  </div>
                ) : null}
                {message.content ? <p>{message.content}</p> : null}
                {message.charts?.map((chart) => (
                  <div key={chart.id} className="chat-chart">
                    <ChartRenderer chart={chart} />
                  </div>
                ))}
              </div>
            ))}
            {loading ? (
              <div className="chat-bubble chat-bubble--assistant chat-bubble--streaming">
                {toolStatuses.length ? (
                  <ul className="chat-tool-status" aria-label="Agent tools">
                    {toolStatuses.map((tool) => (
                      <li
                        key={tool.toolCallId}
                        className={`chat-tool-status__item chat-tool-status__item--${tool.state}`}
                      >
                        <span className="chat-tool-status__label">
                          {tool.state === "running"
                            ? `${tool.label}…`
                            : tool.state === "error"
                              ? `${tool.label} failed`
                              : tool.label}
                        </span>
                        {tool.detail ? (
                          <span className="chat-tool-status__detail">
                            {tool.detail}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {streamingText ? (
                  <p>{streamingText}</p>
                ) : (
                  <p className="typing">{statusMessage}</p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {pendingImages.length ? (
          <div className="chat-attach-preview">
            {pendingImages.map((src, i) => (
              <div className="chat-attach-preview__item" key={`pending-${i}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Attachment ${i + 1}`} />
                <button
                  type="button"
                  className="chat-attach-preview__remove"
                  onClick={() =>
                    setPendingImages((prev) =>
                      prev.filter((_, idx) => idx !== i),
                    )
                  }
                  aria-label="Remove image"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <form
          className="chat-bar"
          onSubmit={onSubmit}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((f) =>
              f.type.startsWith("image/"),
            );
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="attach-btn"
            onClick={() => {
              if (chat.length > 0 || pendingImages.length) setExpanded(true);
              fileRef.current?.click();
            }}
            aria-label="Upload image"
            title="Upload chart image"
            disabled={loading || pendingImages.length >= MAX_IMAGES}
          >
            <ImagePlus size={16} />
          </button>
          <input
            ref={inputRef}
            className="chat-bar__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => {
              if (chat.length > 0 || pendingImages.length) setExpanded(true);
            }}
            placeholder="Ask TradeAgent — or drop a chart screenshot…"
            aria-label="Message TradeAgent"
          />
          <button
            type="submit"
            className="send-btn"
            disabled={!canSend}
            aria-label="Send message"
          >
            <Send size={16} />
          </button>
        </form>
      </section>
    </div>
  );
}
