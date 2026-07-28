"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Eraser, ImagePlus, Send, X } from "lucide-react";
import { ChartRenderer } from "@/components/ChartRenderer";
import { fileToChatImage } from "@/lib/images";
import { applyChatActions, useTradingStore } from "@/lib/store";
import { buildChart, computeStats } from "@/lib/stats";
import type { ChartSpec } from "@/lib/types";

const MAX_IMAGES = 4;

export function ChatWidget() {
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const trades = useTradingStore((s) => s.trades);
  const strategy = useTradingStore((s) => s.strategy);
  const chat = useTradingStore((s) => s.chat);
  const openaiApiKey = useTradingStore((s) => s.openaiApiKey);
  const openaiModel = useTradingStore((s) => s.openaiModel);
  const addChatMessage = useTradingStore((s) => s.addChatMessage);
  const clearChat = useTradingStore((s) => s.clearChat);
  const hydrated = useTradingStore((s) => s.hydrated);

  useEffect(() => {
    if (!expanded) return;
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chat, expanded, loading, pendingImages]);

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

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text || "Analyze this chart / image in the context of my strategy and trade log.",
          images,
          trades,
          strategy,
          stats: computeStats(trades),
          apiKey: openaiApiKey || undefined,
          model: openaiModel,
          history: chat.slice(-12).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      const data = await res.json();

      if (!res.ok || data.mode === "error") {
        addChatMessage({
          role: "assistant",
          content:
            data.reply ??
            "No OpenAI API key found. Add your key in Settings to use TradeAgent chat.",
        });
        return;
      }

      let charts: ChartSpec[] = [];
      if (data.actions) {
        const applied = applyChatActions({
          addTrade: data.actions.addTrade,
          updateTrade: data.actions.updateTrade,
          updateStrategy: data.actions.updateStrategy,
          charts: [],
          screenshots: images.length ? images : undefined,
        });

        if (data.actions.chartRequests?.length) {
          charts = data.actions.chartRequests.map(
            (req: { type: ChartSpec["type"]; title?: string }) =>
              buildChart(req.type, useTradingStore.getState().trades, req.title),
          );
        }

        if (data.actions.charts?.length) {
          charts = [...charts, ...data.actions.charts];
        }

        // Only use tool notes if the model still gave no usable reply
        if (applied.notes.length && !data.reply?.trim()) {
          data.reply = applied.notes.join(" ");
        }
      }

      addChatMessage({
        role: "assistant",
        content: data.reply ?? "Done.",
        charts: charts.length ? charts : undefined,
      });
    } catch {
      addChatMessage({
        role: "assistant",
        content:
          "Couldn't reach the AI endpoint. Check your connection or OPENAI_API_KEY.",
      });
    } finally {
      setLoading(false);
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
                      <img key={`${message.id}-img-${i}`} src={src} alt="Uploaded chart" />
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
              <div className="chat-bubble chat-bubble--assistant">
                <p className="typing">Thinking through your book…</p>
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
                    setPendingImages((prev) => prev.filter((_, idx) => idx !== i))
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
