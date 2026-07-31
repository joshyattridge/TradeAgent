"use client";

import { FormEvent, useEffect, useRef, useState, type DragEvent } from "react";
import { Eraser, FileText, Paperclip, Send, X } from "lucide-react";
import { ChartRenderer } from "@/components/ChartRenderer";
import {
  attachmentMeta,
  fileToChatAttachment,
  MAX_CHAT_ATTACHMENTS,
  toAttachmentPayload,
  type ChatAttachment,
} from "@/lib/chat-attachments";
import { planChatDone } from "@/lib/chat-proposals";
import { applyChatActions, useTradingStore } from "@/lib/store";
import { buildChartFromRequest, computeStats } from "@/lib/stats";
import { formatTradeDate } from "@/lib/trade-format";
import type { ChartRequest, ChartSpec, Trade } from "@/lib/types";

function tradeRefLabel(trade: Trade) {
  return `${trade.symbol} ${trade.side} · ${formatTradeDate(trade.date)}`;
}

function buildReferencedTradePrefix(trade: Trade) {
  return `[Referenced trade: ${trade.symbol} ${trade.side} · ${trade.date} · id=${trade.id}]`;
}

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
};

export function ChatWidget() {
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>(
    [],
  );
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Thinking…");
  const [streamingText, setStreamingText] = useState("");
  const [toolStatuses, setToolStatuses] = useState<ToolStatus[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const dragDepth = useRef(0);

  const trades = useTradingStore((s) => s.trades);
  const strategy = useTradingStore((s) => s.strategy);
  const chat = useTradingStore((s) => s.chat);
  const openaiApiKey = useTradingStore((s) => s.openaiApiKey);
  const openaiModel = useTradingStore((s) => s.openaiModel);
  const chatReferencedTradeId = useTradingStore((s) => s.chatReferencedTradeId);
  const setChatReferencedTradeId = useTradingStore(
    (s) => s.setChatReferencedTradeId,
  );
  const addChatMessage = useTradingStore((s) => s.addChatMessage);
  const clearChat = useTradingStore((s) => s.clearChat);
  const hydrated = useTradingStore((s) => s.hydrated);
  const pendingProposal = useTradingStore((s) => s.pendingProposal);
  const setPendingProposal = useTradingStore((s) => s.setPendingProposal);
  const openProposalReview = useTradingStore((s) => s.openProposalReview);

  const referencedTrade = chatReferencedTradeId
    ? trades.find((t) => t.id === chatReferencedTradeId)
    : undefined;

  useEffect(() => {
    if (!chatReferencedTradeId) return;
    setExpanded(true);
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [chatReferencedTradeId]);

  useEffect(() => {
    // Drop stale pins if the trade was removed elsewhere
    if (chatReferencedTradeId && !referencedTrade) {
      setChatReferencedTradeId(null);
    }
  }, [chatReferencedTradeId, referencedTrade, setChatReferencedTradeId]);

  useEffect(() => {
    if (!expanded) return;

    function onPointerDown(e: PointerEvent) {
      const shell = shellRef.current;
      const target = e.target;
      if (!(target instanceof Node) || !shell) return;
      if (shell.contains(target)) return;
      // Keep open when interacting with native file picker / other OS UI
      setExpanded(false);
    }

    // Capture phase so we close even if page stops propagation
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [expanded]);

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
    pendingAttachments,
    streamingText,
    toolStatuses,
    statusMessage,
  ]);

  async function addFiles(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;

    const room = MAX_CHAT_ATTACHMENTS - pendingAttachments.length;
    if (room <= 0) {
      setAttachError(`Max ${MAX_CHAT_ATTACHMENTS} attachments per message`);
      return;
    }

    const next: ChatAttachment[] = [];
    const errors: string[] = [];
    for (const file of list.slice(0, room)) {
      try {
        next.push(await fileToChatAttachment(file));
      } catch (err) {
        errors.push(
          err instanceof Error ? err.message : `Could not attach ${file.name}`,
        );
      }
    }
    if (next.length) {
      setPendingAttachments((prev) =>
        [...prev, ...next].slice(0, MAX_CHAT_ATTACHMENTS),
      );
      setExpanded(true);
    }
    setAttachError(errors[0] ?? null);
  }

  function removeAttachment(id: string) {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
    setAttachError(null);
  }

  function hasFileDrag(e: DragEvent) {
    return [...e.dataTransfer.types].includes("Files");
  }

  function onDragEnter(e: DragEvent) {
    if (!hasFileDrag(e) || loading) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    setDragOver(true);
    setExpanded(true);
  }

  function onDragOver(e: DragEvent) {
    if (!hasFileDrag(e) || loading) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(e: DragEvent) {
    if (!hasFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragOver(false);
    if (loading) return;
    const files = e.dataTransfer.files;
    if (files?.length) void addFiles(files);
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
    let charts: ChartSpec[] = [];
    const rawActions = data.actions
      ? {
          addTrade: data.actions.addTrade as never,
          addTrades: data.actions.addTrades as never,
          updateTrade: data.actions.updateTrade as never,
          updateTrades: data.actions.updateTrades as never,
          deleteTradeIds: data.actions.deleteTradeIds,
          updateStrategy: data.actions.updateStrategy as never,
          charts: data.actions.charts ?? [],
          screenshots: images.length ? images : undefined,
        }
      : null;

    if (rawActions) {
      const state = useTradingStore.getState();
      const planned = planChatDone({
        actions: rawActions,
        trades: state.trades,
        strategy: state.strategy,
        screenshots: images.length ? images : undefined,
      });

      // Charts apply immediately; journal writes need Accept/Reject.
      if (planned.chartActions.charts?.length) {
        const applied = applyChatActions(planned.chartActions);
        charts = applied.charts;
      }

      if (!charts.length && data.actions?.chartRequests?.length) {
        charts = data.actions.chartRequests.map((req: ChartRequest) =>
          buildChartFromRequest(req, state.trades),
        );
      }

      if (planned.proposal) {
        setPendingProposal(planned.proposal);
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
    const attachments = pendingAttachments;
    const images = attachments
      .filter((a): a is Extract<ChatAttachment, { kind: "image" }> => a.kind === "image")
      .map((a) => a.dataUrl);
    const fileMeta = attachments
      .filter((a) => a.kind !== "image")
      .map(attachmentMeta);
    const refTrade = referencedTrade;
    if ((!text && !attachments.length && !refTrade) || loading) return;

    const refPrefix = refTrade ? buildReferencedTradePrefix(refTrade) : "";
    const bodyText =
      text ||
      (refTrade
        ? "Regarding this trade."
        : attachments.length
          ? "Review the attached file(s)."
          : "");
    const displayText = refTrade
      ? `Referenced: ${tradeRefLabel(refTrade)}\n${bodyText}`
      : bodyText;
    const apiMessage = refPrefix
      ? `${refPrefix}\n${bodyText}`
      : bodyText ||
        "Review the attached file(s) / image(s) in the context of my trading journal and strategy.";

    setInput("");
    setPendingAttachments([]);
    setAttachError(null);
    setChatReferencedTradeId(null);
    setExpanded(true);
    addChatMessage({
      role: "user",
      content: displayText,
      images: images.length ? images : undefined,
      files: fileMeta.length ? fileMeta : undefined,
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
          message: apiMessage,
          images,
          attachments: attachments.map(toAttachmentPayload),
          referencedTradeId: refTrade?.id,
          trades: trades.map((t) => {
            const keepShots =
              t.id === refTrade?.id ||
              (text &&
                new RegExp(
                  `\\b${t.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
                  "i",
                ).test(text));
            if (keepShots) return t;
            const next = { ...t };
            delete next.screenshots;
            return next;
          }),
          strategy,
          stats: computeStats(trades),
          apiKey: openaiApiKey || undefined,
          model: openaiModel,
          history: chat
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map((m) => ({
              role: m.role,
              content: m.content,
            })),
        }),
      });

      const contentType = res.headers.get("content-type") ?? "";

      // Non-stream JSON fallback (auth errors, etc.)
      if (!contentType.includes("ndjson")) {
        const data = await res.json();
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
      try {
        addChatMessage({
          role: "assistant",
          content:
            "Couldn't reach the AI endpoint. Check your connection or OPENAI_API_KEY.",
        });
      } catch {
        // Persist storage full or unavailable — avoid crashing the UI
      }
    } finally {
      setLoading(false);
      resetStreamUi();
      inputRef.current?.focus();
    }
  }

  if (!hydrated) return null;

  const canSend =
    !loading &&
    (Boolean(input.trim()) ||
      pendingAttachments.length > 0 ||
      Boolean(referencedTrade));

  return (
    <div
      className={`chat-dock${expanded ? " is-expanded" : ""}${dragOver ? " is-dragover" : ""}`}
    >
      <section
        ref={shellRef}
        className="chat-shell"
        aria-label="TradeAgent chat"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dragOver ? (
          <div className="chat-drop-overlay" aria-hidden="true">
            Drop files to attach
          </div>
        ) : null}

        {expanded ? (
          <div className="chat-panel__messages" ref={scroller}>
            <div className="chat-float-actions">
              <button
                type="button"
                className="chat-float-btn"
                onClick={() => {
                  clearChat();
                  setPendingAttachments([]);
                  setAttachError(null);
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
                {message.files?.length ? (
                  <div className="chat-bubble__files">
                    {message.files.map((file, i) => (
                      <span
                        className="chat-file-chip"
                        key={`${message.id}-file-${i}`}
                        title={file.mime}
                      >
                        <FileText size={12} />
                        {file.name}
                      </span>
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

        {pendingProposal ? (
          <button
            type="button"
            className="chat-proposal-chip"
            onClick={() => openProposalReview()}
          >
            Review pending: {pendingProposal.summary}
          </button>
        ) : null}

        {attachError ? (
          <p className="chat-attach-error" role="status">
            {attachError}
          </p>
        ) : null}

        {pendingAttachments.length || referencedTrade ? (
          <div className="chat-attach-preview">
            {referencedTrade ? (
              <div
                className="chat-trade-ref"
                title={`Trade id ${referencedTrade.id}`}
              >
                <span className="chat-trade-ref__label">
                  {tradeRefLabel(referencedTrade)}
                </span>
                <button
                  type="button"
                  className="chat-attach-preview__remove"
                  onClick={() => setChatReferencedTradeId(null)}
                  aria-label="Remove trade reference"
                >
                  <X size={12} />
                </button>
              </div>
            ) : null}
            {pendingAttachments.map((att) =>
              att.kind === "image" ? (
                <div className="chat-attach-preview__item" key={att.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={att.dataUrl} alt={att.name} title={att.name} />
                  <button
                    type="button"
                    className="chat-attach-preview__remove"
                    onClick={() => removeAttachment(att.id)}
                    aria-label={`Remove ${att.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <div
                  className="chat-file-chip chat-file-chip--pending"
                  key={att.id}
                  title={att.mime}
                >
                  <FileText size={12} />
                  <span>{att.name}</span>
                  <button
                    type="button"
                    className="chat-attach-preview__remove"
                    onClick={() => removeAttachment(att.id)}
                    aria-label={`Remove ${att.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ),
            )}
          </div>
        ) : null}

        <form
          className="chat-bar"
          onSubmit={onSubmit}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
        >
          <input
            ref={fileRef}
            type="file"
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
              if (
                chat.length > 0 ||
                pendingAttachments.length ||
                referencedTrade
              ) {
                setExpanded(true);
              }
              fileRef.current?.click();
            }}
            aria-label="Attach file"
            title="Attach CSV, PDF, image, or text file"
            disabled={
              loading || pendingAttachments.length >= MAX_CHAT_ATTACHMENTS
            }
          >
            <Paperclip size={16} />
          </button>
          <input
            ref={inputRef}
            className="chat-bar__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => {
              if (
                chat.length > 0 ||
                pendingAttachments.length ||
                referencedTrade
              ) {
                setExpanded(true);
              }
            }}
            onDragOver={(e) => {
              if (hasFileDrag(e)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={(e) => {
              if (!hasFileDrag(e)) return;
              e.preventDefault();
              e.stopPropagation();
              dragDepth.current = 0;
              setDragOver(false);
              if (loading) return;
              const files = e.dataTransfer.files;
              if (files?.length) void addFiles(files);
            }}
            placeholder={
              referencedTrade
                ? "Ask about this trade…"
                : "Ask TradeAgent — attach charts, CSV, PDF…"
            }
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
