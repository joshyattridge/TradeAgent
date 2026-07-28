"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Eraser, Send, X } from "lucide-react";
import { ChartRenderer } from "@/components/ChartRenderer";
import { applyChatActions, useTradingStore } from "@/lib/store";
import { buildChart, computeStats } from "@/lib/stats";
import type { ChartSpec } from "@/lib/types";

export function ChatWidget() {
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
  }, [chat, expanded, loading]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setExpanded(true);
    addChatMessage({ role: "user", content: text });
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
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
          updateStrategy: data.actions.updateStrategy,
          charts: [],
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

        if (applied.notes.length && !data.reply) {
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

  return (
    <div className={`chat-dock${expanded ? " is-expanded" : ""}`}>
      <section className="chat-shell" aria-label="TradeAgent chat">
        {expanded ? (
          <div className="chat-panel__messages" ref={scroller}>
            <div className="chat-float-actions">
              <button
                type="button"
                className="chat-float-btn"
                onClick={() => clearChat()}
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
                <p>{message.content}</p>
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

        <form className="chat-bar" onSubmit={onSubmit}>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => {
              if (chat.length > 0) setExpanded(true);
            }}
            placeholder="Ask TradeAgent — log a trade, update strategy, pull a chart…"
            aria-label="Message TradeAgent"
          />
          <button
            type="submit"
            className="send-btn"
            disabled={loading || !input.trim()}
            aria-label="Send message"
          >
            <Send size={16} />
          </button>
        </form>
      </section>
    </div>
  );
}
