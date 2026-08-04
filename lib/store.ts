"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mergeTrades, type ImportMode } from "./backup";
import type { ChatActionPayload, ChatProposal } from "./chat-proposals";
import {
  clearLegacyLocalStorage,
  idbStorage,
  migrateLegacyLocalStorageToIdb,
} from "./idb-storage";
import { DEFAULT_OPENAI_MODEL } from "./models";
import { seedStrategy, seedTrades } from "./seed-data";
import { normalizeStrategy, strategyNameFromMarkdown } from "./strategy-md";
import {
  DEFAULT_VISIBLE_TRADE_COLUMNS,
  TRADE_COLUMNS,
  type TradeColumnId,
} from "./trade-columns";
import { normalizeTradeDateTime } from "./trade-format";
import type { ChatMessage, ChartSpec, Strategy, Trade } from "./types";

function uid() {
  return crypto.randomUUID();
}

function orderedColumns(ids: TradeColumnId[]): TradeColumnId[] {
  const set = new Set(ids);
  return TRADE_COLUMNS.map((c) => c.id).filter((id) => set.has(id));
}

/** Ensure entry/exit times are ISO before they hit the journal. */
function normalizeTradeTimes<T extends Partial<Trade>>(
  patch: T,
  fallbackDate?: string,
): T {
  const date = patch.date ?? fallbackDate;
  const next = { ...patch };
  if (typeof patch.entryTime === "string" && patch.entryTime.trim()) {
    next.entryTime = normalizeTradeDateTime(patch.entryTime, date)!;
  }
  if (typeof patch.exitTime === "string" && patch.exitTime.trim()) {
    next.exitTime = normalizeTradeDateTime(patch.exitTime, date)!;
  }
  return next;
}

const STORE_KEY = "tradeagent-store-v4";
const MAX_SCREENSHOTS_PER_TRADE = 2;

/** Persist chat as-is — keep images and full file attachments for conversation replay. */
function persistableChat(chat: ChatMessage[]): ChatMessage[] {
  return chat;
}

/** Cap screenshot arrays so one trade can't dominate storage. Drop legacy chartExtract. */
function persistableTrades(trades: Trade[]): Trade[] {
  return trades.map((t) => {
    const { chartExtract: _legacy, ...rest } = t as Trade & {
      chartExtract?: unknown;
    };
    void _legacy;
    if (!rest.screenshots?.length) return rest;
    const shots = rest.screenshots
      .filter((s) => typeof s === "string" && s !== "pending")
      .slice(0, MAX_SCREENSHOTS_PER_TRADE);
    return shots.length
      ? { ...rest, screenshots: shots }
      : { ...rest, screenshots: undefined };
  });
}

interface Store {
  trades: Trade[];
  strategy: Strategy;
  chat: ChatMessage[];
  /** Rolling summary of older chat turns (server-maintained) */
  chatSummary: string;
  /** Server log file id — one .log per chat session under logs/chats/ */
  chatLogId: string;
  openaiApiKey: string;
  openaiModel: string;
  visibleTradeColumns: TradeColumnId[];
  /** Composer-only trade pin for the next chat message (not a persistent active trade). */
  chatReferencedTradeId: string | null;
  /** Chat journal writes waiting for Accept/Reject (not persisted). */
  pendingProposal: ChatProposal | null;
  /** Whether the proposal review panel is visible. */
  proposalReviewOpen: boolean;
  hydrated: boolean;
  setHydrated: (v: boolean) => void;
  setOpenAIApiKey: (key: string) => void;
  setOpenAIModel: (model: string) => void;
  setChatSummary: (summary: string) => void;
  setChatReferencedTradeId: (id: string | null) => void;
  setPendingProposal: (proposal: ChatProposal | null) => void;
  openProposalReview: () => void;
  closeProposalReview: () => void;
  acceptPendingProposal: () => void;
  rejectPendingProposal: () => void;
  toggleTradeColumn: (id: TradeColumnId) => void;
  resetTradeColumns: () => void;
  addTrade: (trade: Omit<Trade, "id"> | Trade) => Trade;
  updateTrade: (id: string, patch: Partial<Trade>) => void;
  deleteTrade: (id: string) => void;
  deleteTrades: (ids: string[]) => void;
  updateStrategy: (patch: Partial<Strategy>) => void;
  replaceStrategy: (strategy: Strategy) => void;
  /** Restore trades + strategy from a backup file. */
  importJournal: (
    trades: Trade[],
    strategy: Strategy,
    mode: ImportMode,
  ) => void;
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
        if (parsed?.state?.trades?.length) {
          parsed.state.trades = parsed.state.trades.map((t) => {
            const next = { ...t };
            delete next.screenshots;
            return next;
          });
        }
        if (parsed?.state?.chat?.length) {
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
    (set, get): Store => ({
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
      // Widen preset literal so persist middleware matches Store.openaiModel: string
      openaiModel: DEFAULT_OPENAI_MODEL as string,
      chatSummary: "",
      chatLogId: uid(),
      visibleTradeColumns: DEFAULT_VISIBLE_TRADE_COLUMNS,
      chatReferencedTradeId: null as string | null,
      pendingProposal: null as ChatProposal | null,
      proposalReviewOpen: false,
      hydrated: false,
      setHydrated: (v) => set({ hydrated: v }),
      setOpenAIApiKey: (key) => set({ openaiApiKey: key.trim() }),
      setOpenAIModel: (model) => set({ openaiModel: model }),
      setChatSummary: (summary) => set({ chatSummary: summary }),
      setChatReferencedTradeId: (id) => set({ chatReferencedTradeId: id }),
      setPendingProposal: (proposal) =>
        set({
          pendingProposal: proposal,
          // Always reopen when a proposal is set/replaced so refinements show
          // even if the user had hidden the previous panel.
          proposalReviewOpen: proposal != null,
        }),
      openProposalReview: () => {
        if (get().pendingProposal) set({ proposalReviewOpen: true });
      },
      closeProposalReview: () => set({ proposalReviewOpen: false }),
      acceptPendingProposal: () => {
        const proposal = get().pendingProposal;
        if (!proposal) return;
        applyChatActions(proposal.actions);
        set({ pendingProposal: null, proposalReviewOpen: false });
      },
      rejectPendingProposal: () =>
        set({ pendingProposal: null, proposalReviewOpen: false }),
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
            // Empty checklist means none done — don't leave stale answers.
            if (
              Object.prototype.hasOwnProperty.call(patch, "checklist") &&
              Array.isArray(patch.checklist) &&
              patch.checklist.length === 0
            ) {
              delete merged.checklist;
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
      updateStrategy: (patch) => {
        const current = get().strategy;
        const merged = normalizeStrategy({
          ...current,
          ...patch,
          updatedAt: new Date().toISOString(),
        });
        if (patch.markdown != null && patch.name == null) {
          merged.name = strategyNameFromMarkdown(patch.markdown, current.name);
        }
        set({ strategy: merged });
      },
      replaceStrategy: (strategy) =>
        set({
          strategy: normalizeStrategy({
            ...strategy,
            updatedAt: new Date().toISOString(),
          }),
        }),
      importJournal: (trades, strategy, mode) => {
        const nextTrades =
          mode === "replace"
            ? persistableTrades(trades)
            : persistableTrades(mergeTrades(get().trades, trades));
        const ref = get().chatReferencedTradeId;
        const nextStrategy = normalizeStrategy({
          ...strategy,
          updatedAt: strategy.updatedAt || new Date().toISOString(),
        });
        set({
          trades: nextTrades,
          strategy: nextStrategy,
          chatReferencedTradeId:
            ref && nextTrades.some((t) => t.id === ref) ? ref : null,
        });
      },
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
              attachments: message.attachments,
              agentMessages: message.agentMessages,
              charts: message.charts,
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      clearChat: () =>
        set({
          chat: [],
          chatSummary: "",
          chatLogId: uid(),
          chatReferencedTradeId: null,
          pendingProposal: null,
          proposalReviewOpen: false,
        }),
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
        chatLogId: state.chatLogId,
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
          // Migrate legacy structured strategy → markdown document
          state.strategy = normalizeStrategy(state.strategy);
          // Drop legacy chartExtract; screenshots are reattached when needed
          state.trades = persistableTrades(state.trades);
          // Prefer entry time over calendar date in the logs table
          let cols: TradeColumnId[] = state.visibleTradeColumns.filter(
            (id) => id !== "date",
          );
          if (!cols.includes("entryTime")) {
            cols = ["entryTime", ...cols];
          }
          // Ensure newer default columns (tags/notes) appear for existing users
          const current = new Set(cols);
          const missing = DEFAULT_VISIBLE_TRADE_COLUMNS.filter((id) => !current.has(id));
          if (missing.length) {
            cols = [...cols, ...missing];
          }
          state.visibleTradeColumns = orderedColumns(cols);
          if (!state.chatLogId) {
            state.chatLogId = crypto.randomUUID();
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

  let loggedNewTrade = false;
  for (const incoming of addTrades) {
    const trade = store.addTrade(
      normalizeTradeTimes({
        ...incoming,
        screenshots: screenshots?.length
          ? [...(incoming.screenshots ?? []), ...screenshots]
              .filter((s) => s !== "pending")
              .slice(0, MAX_SCREENSHOTS_PER_TRADE)
          : (incoming.screenshots ?? []).filter((s) => s !== "pending"),
      }),
    );
    loggedNewTrade = true;
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
    store.updateTrade(id, normalizeTradeTimes(patch, existing?.date));
    touchedTradeId = id;
    notes.push(`Updated trade ${id}.`);
  }

  // If we only updated (no new log), attach turn screenshots to a single trade id.
  // Never spray the same images onto every updated row in a multi-trade turn.
  if (screenshots?.length && !loggedNewTrade) {
    const uniqueUpdateIds = [
      ...new Set(updateTrades.map((u) => u.id).filter(Boolean)),
    ];
    if (uniqueUpdateIds.length === 1) {
      const attachId = uniqueUpdateIds[0];
      const existing = store.trades.find((t) => t.id === attachId);
      store.updateTrade(attachId, {
        screenshots: [...(existing?.screenshots ?? []), ...screenshots]
          .filter((s) => s && s !== "pending")
          .slice(0, MAX_SCREENSHOTS_PER_TRADE),
      });
    }
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

export type { ChatActionPayload };
