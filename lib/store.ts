"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  clearLegacyLocalStorage,
  idbStorage,
  migrateLegacyLocalStorageToIdb,
} from "./idb-storage";
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

const STORE_KEY = "tradeagent-store-v4";
const MAX_SCREENSHOTS_PER_TRADE = 2;

/** Slim chat for disk: keep full text history, drop heavy image payloads only. */
function persistableChat(chat: ChatMessage[]): ChatMessage[] {
  return chat.map(({ images: _images, ...rest }) => rest);
}

/** Cap screenshot arrays so one trade can't dominate storage. */
function persistableTrades(trades: Trade[]): Trade[] {
  return trades.map((t) => {
    if (!t.screenshots?.length) return t;
    const shots = t.screenshots
      .filter((s) => typeof s === "string" && s !== "pending")
      .slice(0, MAX_SCREENSHOTS_PER_TRADE);
    return shots.length ? { ...t, screenshots: shots } : { ...t, screenshots: undefined };
  });
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

const migratingStorage = {
  getItem: async (name: string) => {
    await migrateLegacyLocalStorageToIdb(name);
    return idbStorage.getItem(name);
  },
  setItem: async (name: string, value: string) => {
    try {
      await idbStorage.setItem(name, value);
      // Free leftover localStorage space from the old persist key
      clearLegacyLocalStorage();
    } catch (err) {
      console.warn("[TradeAgent] persist write failed", err);
      clearLegacyLocalStorage();
      // Last resort: try again without the heaviest fields by rewriting a slimmer payload
      try {
        const parsed = JSON.parse(value) as {
          state?: {
            trades?: Trade[];
            chat?: ChatMessage[];
            [k: string]: unknown;
          };
          version?: number;
        };
        if (parsed?.state?.trades) {
          parsed.state.trades = parsed.state.trades.map((t) => {
            const next = { ...t };
            delete next.screenshots;
            return next;
          });
        }
        if (parsed?.state?.chat) {
          parsed.state.chat = persistableChat(parsed.state.chat).map(
            ({ charts: _c, ...rest }) => rest,
          );
        }
        await idbStorage.setItem(name, JSON.stringify(parsed));
      } catch (err2) {
        console.warn("[TradeAgent] slim persist write also failed", err2);
      }
    }
  },
  removeItem: (name: string) => idbStorage.removeItem(name),
};

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
        const shots = trade.screenshots
          ?.filter((s) => s && s !== "pending")
          .slice(0, MAX_SCREENSHOTS_PER_TRADE);
        const next: Trade = {
          ...trade,
          id: "id" in trade && trade.id ? trade.id : uid(),
          ...(shots?.length ? { screenshots: shots } : {}),
        };
        set({ trades: [next, ...get().trades] });
        return next;
      },
      updateTrade: (id, patch) =>
        set({
          trades: get().trades.map((t) => {
            if (t.id !== id) return t;
            const clean: Partial<Trade> = {};
            for (const [key, value] of Object.entries(patch)) {
              if (value !== undefined) {
                (clean as Record<string, unknown>)[key] = value;
              }
            }
            const merged = { ...t, ...clean };
            if (clean.screenshots) {
              merged.screenshots = clean.screenshots
                .filter((s) => s && s !== "pending")
                .slice(0, MAX_SCREENSHOTS_PER_TRADE);
            }
            return merged;
          }),
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
              // Keep images in memory for the current session UI only —
              // partialize strips them before writing to disk.
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
      name: STORE_KEY,
      storage: createJSONStorage(() => migratingStorage),
      partialize: (state) => ({
        trades: persistableTrades(state.trades),
        strategy: state.strategy,
        chat: persistableChat(state.chat),
        chatSummary: state.chatSummary,
        openaiApiKey: state.openaiApiKey,
        openaiModel: state.openaiModel,
        visibleTradeColumns: state.visibleTradeColumns,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn("[TradeAgent] rehydrate failed", error);
          clearLegacyLocalStorage();
        }
        if (state) {
          // Ensure newer default columns (tags/notes) appear for existing users
          const current = new Set(state.visibleTradeColumns);
          const missing = DEFAULT_VISIBLE_TRADE_COLUMNS.filter((id) => !current.has(id));
          if (missing.length) {
            state.visibleTradeColumns = orderedColumns([
              ...state.visibleTradeColumns,
              ...missing,
            ]);
          }
          state.setHydrated(true);
        }
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
    ? actions.screenshots.slice(0, MAX_SCREENSHOTS_PER_TRADE)
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
            .slice(0, MAX_SCREENSHOTS_PER_TRADE)
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
    const { id, ...rawPatch } = update;
    if (!id) continue;
    const existing = store.trades.find((t) => t.id === id);
    const patch: Partial<Trade> = {};
    for (const [key, value] of Object.entries(rawPatch)) {
      if (value !== undefined) {
        (patch as Record<string, unknown>)[key] = value;
      }
    }
    store.updateTrade(id, {
      ...patch,
      ...(screenshots?.length
        ? {
            screenshots: [
              ...(existing?.screenshots ?? []),
              ...screenshots,
            ]
              .filter((s) => s && s !== "pending")
              .slice(0, MAX_SCREENSHOTS_PER_TRADE),
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
