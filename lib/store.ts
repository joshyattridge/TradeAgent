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
  openaiApiKey: string;
  openaiModel: string;
  visibleTradeColumns: TradeColumnId[];
  hydrated: boolean;
  setHydrated: (v: boolean) => void;
  setOpenAIApiKey: (key: string) => void;
  setOpenAIModel: (model: string) => void;
  toggleTradeColumn: (id: TradeColumnId) => void;
  resetTradeColumns: () => void;
  addTrade: (trade: Omit<Trade, "id"> | Trade) => Trade;
  updateTrade: (id: string, patch: Partial<Trade>) => void;
  deleteTrade: (id: string) => void;
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
            "Yo — I'm TradeAgent. I've got your strategy, trade log, and dashboard in context. Ask for charts, log a trade, or tweak the plan.",
          createdAt: new Date().toISOString(),
        },
      ],
      openaiApiKey: "",
      openaiModel: DEFAULT_OPENAI_MODEL,
      visibleTradeColumns: DEFAULT_VISIBLE_TRADE_COLUMNS,
      hydrated: false,
      setHydrated: (v) => set({ hydrated: v }),
      setOpenAIApiKey: (key) => set({ openaiApiKey: key.trim() }),
      setOpenAIModel: (model) => set({ openaiModel: model }),
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
        set({ trades: get().trades.filter((t) => t.id !== id) }),
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
              charts: message.charts,
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      clearChat: () => set({ chat: [] }),
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

  if (actions.addTrade) {
    const trade = store.addTrade(actions.addTrade);
    notes.push(
      `Logged ${trade.side.toUpperCase()} ${trade.symbol} (${trade.result}, ${trade.rMultiple}R${
        trade.pnlUsd != null ? `, $${trade.pnlUsd}` : ""
      }).`,
    );
  }

  if (actions.updateStrategy) {
    store.updateStrategy(actions.updateStrategy);
    notes.push("Strategy updated.");
  }

  if (actions.charts?.length) {
    charts.push(...actions.charts);
    notes.push(`Generated ${actions.charts.length} chart${actions.charts.length > 1 ? "s" : ""}.`);
  }

  return { charts, notes };
}

export interface ChatActionPayload {
  addTrade?: Omit<Trade, "id">;
  updateStrategy?: Partial<Strategy>;
  charts?: ChartSpec[];
}
