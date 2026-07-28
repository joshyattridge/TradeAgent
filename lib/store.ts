"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_OPENAI_MODEL } from "./models";
import { seedStrategy, seedTrades } from "./seed-data";
import type { ChatMessage, ChartSpec, Strategy, Trade } from "./types";

function uid() {
  return crypto.randomUUID();
}

interface Store {
  trades: Trade[];
  strategy: Strategy;
  chat: ChatMessage[];
  openaiApiKey: string;
  openaiModel: string;
  hydrated: boolean;
  setHydrated: (v: boolean) => void;
  setOpenAIApiKey: (key: string) => void;
  setOpenAIModel: (model: string) => void;
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
      hydrated: false,
      setHydrated: (v) => set({ hydrated: v }),
      setOpenAIApiKey: (key) => set({ openaiApiKey: key.trim() }),
      setOpenAIModel: (model) => set({ openaiModel: model }),
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
              charts: message.charts,
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      clearChat: () =>
        set({
          chat: [
            {
              id: uid(),
              role: "assistant",
              content: "Chat cleared. Still locked onto your strategy + trades.",
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      resetDemoData: () =>
        set({
          trades: seedTrades,
          strategy: seedStrategy,
        }),
    }),
    {
      name: "tradeagent-store-v1",
      partialize: (state) => ({
        trades: state.trades,
        strategy: state.strategy,
        chat: state.chat,
        openaiApiKey: state.openaiApiKey,
        openaiModel: state.openaiModel,
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
    notes.push(`Logged ${trade.side.toUpperCase()} ${trade.symbol} (${trade.result}, ${trade.rMultiple}R).`);
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
