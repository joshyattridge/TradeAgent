"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_OPENAI_MODEL } from "./models";
import { seedStrategy, seedTrades } from "./seed-data";
import {
  DEFAULT_VISIBLE_TRADE_COLUMNS,
  TRADE_COLUMNS,
  type TradeColumnId,
} from "./trade-columns";
import type { ChatMessage, ChartSpec, Strategy, Trade } from "./types";

function uid() {
  return crypto.randomUUID();
}

function orderedColumns(ids: TradeColumnId[]): TradeColumnId[] {
  const set = new Set(ids);
  return TRADE_COLUMNS.map((c) => c.id).filter((id) => set.has(id));
}

interface Store {
  trades: Trade[];
  strategy: Strategy;
  chat: ChatMessage[];
  /** Rolling summary of older chat turns (server-maintained) */
  chatSummary: string;
  openaiApiKey: string;
  openaiModel: string;
  visibleTradeColumns: TradeColumnId[];
  /** Composer-only trade pin for the next chat message (not a persistent active trade). */
  chatReferencedTradeId: string | null;
  hydrated: boolean;
  setHydrated: (v: boolean) => void;
  setOpenAIApiKey: (key: string) => void;
  setOpenAIModel: (model: string) => void;
  setChatSummary: (summary: string) => void;
  setChatReferencedTradeId: (id: string | null) => void;
  toggleTradeColumn: (id: TradeColumnId) => void;
  resetTradeColumns: () => void;
  addTrade: (trade: Omit<Trade, "id"> | Trade) => Trade;
  updateTrade: (id: string, patch: Partial<Trade>) => void;
  deleteTrade: (id: string) => void;
  deleteTrades: (ids: string[]) => void;
  updateStrategy: (patch: Partial<Strategy>) => void;
  replaceStrategy: (strategy: Strategy) => void;
  addChatMessage: (message: Omit<ChatMessage, "id" | "createdAt"> & { id?: string }) => void;
  clearChat: () => void;
  resetDemoData: () => void;
}

export const useTradingStore = create<Store>()(
  persist(
    (set, get) => ({
      trades: seedTrades,
      strategy: seedStrategy,
      chat: [
        {
          id: "welcome",
          role: "assistant",
          content:
            "Yo — I'm TradeAgent. Fully chat-controlled journal. Log trades, update them, delete duplicates, pull charts, and I’ll coach against your strategy.",
          createdAt: new Date().toISOString(),
        },
      ],
      openaiApiKey: "",
      openaiModel: DEFAULT_OPENAI_MODEL,
      chatSummary: "",
      visibleTradeColumns: DEFAULT_VISIBLE_TRADE_COLUMNS,
      chatReferencedTradeId: null,
      hydrated: false,
      setHydrated: (v) => set({ hydrated: v }),
      setOpenAIApiKey: (key) => set({ openaiApiKey: key.trim() }),
      setOpenAIModel: (model) => set({ openaiModel: model }),
      setChatSummary: (summary) => set({ chatSummary: summary }),
      setChatReferencedTradeId: (id) => set({ chatReferencedTradeId: id }),
      toggleTradeColumn: (id) => {
        const current = get().visibleTradeColumns;
        if (current.includes(id)) {
          if (current.length <= 1) return;
          set({ visibleTradeColumns: current.filter((c) => c !== id) });
        } else {
          set({ visibleTradeColumns: orderedColumns([...current, id]) });
        }
      },
      resetTradeColumns: () =>
        set({ visibleTradeColumns: DEFAULT_VISIBLE_TRADE_COLUMNS }),
      addTrade: (trade) => {
        const next: Trade = {
          ...trade,
          id: "id" in trade && trade.id ? trade.id : uid(),
        };
        set({ trades: [next, ...get().trades] });
        return next;
      },
      updateTrade: (id, patch) =>
        set({
          trades: get().trades.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        }),
      deleteTrade: (id) =>
        set({
          trades: get().trades.filter((t) => t.id !== id),
          chatReferencedTradeId:
            get().chatReferencedTradeId === id
              ? null
              : get().chatReferencedTradeId,
        }),
      deleteTrades: (ids) => {
        const remove = new Set(ids);
        const ref = get().chatReferencedTradeId;
        set({
          trades: get().trades.filter((t) => !remove.has(t.id)),
          chatReferencedTradeId: ref && remove.has(ref) ? null : ref,
        });
      },
      updateStrategy: (patch) =>
        set({
          strategy: {
            ...get().strategy,
            ...patch,
            updatedAt: new Date().toISOString(),
          },
        }),
      replaceStrategy: (strategy) =>
        set({
          strategy: { ...strategy, updatedAt: new Date().toISOString() },
        }),
      addChatMessage: (message) =>
        set({
          chat: [
            ...get().chat,
            {
              id: message.id ?? uid(),
              role: message.role,
              content: message.content,
              images: message.images,
              files: message.files,
              charts: message.charts,
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      clearChat: () =>
        set({ chat: [], chatSummary: "", chatReferencedTradeId: null }),
      resetDemoData: () =>
        set({
          trades: seedTrades,
          strategy: seedStrategy,
        }),
    }),
    {
      name: "tradeagent-store-v3",
      partialize: (state) => ({
        trades: state.trades,
        strategy: state.strategy,
        // Keep chat text, drop image payloads so localStorage doesn't blow up
        chat: state.chat.map(({ images: _images, ...rest }) => rest),
        chatSummary: state.chatSummary,
        openaiApiKey: state.openaiApiKey,
        openaiModel: state.openaiModel,
        visibleTradeColumns: state.visibleTradeColumns,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
    },
  ),
);

export function applyChatActions(actions: ChatActionPayload) {
  const store = useTradingStore.getState();
  const charts: ChartSpec[] = [];
  const notes: string[] = [];
  let touchedTradeId: string | null = null;
  const screenshots = actions.screenshots?.length
    ? actions.screenshots.slice(0, 4)
    : undefined;

  const addTrades: Array<Omit<Trade, "id"> | Trade> = [
    ...(actions.addTrades ?? []),
    ...(actions.addTrade && !actions.addTrades?.length ? [actions.addTrade] : []),
  ];

  for (const incoming of addTrades) {
    const trade = store.addTrade({
      ...incoming,
      screenshots: screenshots?.length
        ? [...(incoming.screenshots ?? []), ...screenshots]
            .filter((s) => s !== "pending")
            .slice(0, 4)
        : (incoming.screenshots ?? []).filter((s) => s !== "pending"),
    });
    touchedTradeId = trade.id;
    notes.push(
      `Logged ${trade.side.toUpperCase()} ${trade.symbol} (${trade.result}, ${trade.rMultiple}R${
        trade.pnlUsd != null ? `, $${trade.pnlUsd}` : ""
      }${trade.screenshots?.length ? `, ${trade.screenshots.length} screenshot${trade.screenshots.length > 1 ? "s" : ""}` : ""}).`,
    );
  }

  const updateTrades: Array<{ id: string } & Partial<Omit<Trade, "id">>> = [
    ...(actions.updateTrades ?? []),
    ...(actions.updateTrade?.id && !actions.updateTrades?.length
      ? [actions.updateTrade]
      : []),
  ];

  for (const update of updateTrades) {
    const { id, ...patch } = update;
    if (!id) continue;
    const existing = store.trades.find((t) => t.id === id);
    store.updateTrade(id, {
      ...patch,
      ...(screenshots?.length
        ? {
            screenshots: [
              ...(existing?.screenshots ?? []),
              ...screenshots,
            ].slice(0, 4),
          }
        : {}),
    });
    touchedTradeId = id;
    notes.push(`Updated trade ${id}.`);
  }

  if (actions.deleteTradeIds?.length) {
    store.deleteTrades(actions.deleteTradeIds);
    notes.push(
      `Removed ${actions.deleteTradeIds.length} trade${
        actions.deleteTradeIds.length > 1 ? "s" : ""
      }.`,
    );
    if (
      touchedTradeId &&
      actions.deleteTradeIds.includes(touchedTradeId)
    ) {
      touchedTradeId = null;
    }
  }

  if (actions.updateStrategy) {
    store.updateStrategy(actions.updateStrategy);
    notes.push("Strategy updated.");
  }

  if (actions.charts?.length) {
    charts.push(...actions.charts);
    notes.push(
      `Generated ${actions.charts.length} chart${actions.charts.length > 1 ? "s" : ""}.`,
    );
  }

  return { charts, notes, touchedTradeId };
}

export interface ChatActionPayload {
  addTrade?: Omit<Trade, "id"> | Trade;
  addTrades?: Array<Omit<Trade, "id"> | Trade>;
  updateTrade?: { id: string } & Partial<Omit<Trade, "id">>;
  updateTrades?: Array<{ id: string } & Partial<Omit<Trade, "id">>>;
  deleteTradeIds?: string[];
  updateStrategy?: Partial<Strategy>;
  charts?: ChartSpec[];
  /** Screenshots from the current chat turn to attach to a newly logged/updated trade */
  screenshots?: string[];
}
