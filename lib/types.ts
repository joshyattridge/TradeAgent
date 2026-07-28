export type TradeSide = "long" | "short";
export type TradeResult = "win" | "loss" | "breakeven" | "open";

export interface Trade {
  id: string;
  /** Calendar date YYYY-MM-DD */
  date: string;
  symbol: string;
  side: TradeSide;
  setup: string;
  entry: number;
  stop: number;
  target: number;
  exit?: number;
  /** ISO datetime when the entry filled */
  entryTime?: string;
  /** ISO datetime when the trade was closed */
  exitTime?: string;
  /** Duration in minutes (optional; derived from entry/exit times when missing) */
  timeInTradeMinutes?: number;
  /** Realized P&L in account currency ($) */
  pnlUsd?: number;
  /** Dollars risked for 1R on this trade */
  riskUsd?: number;
  /** Position size label, e.g. "0.40 lots" or "2 contracts" */
  size?: string;
  /** Fees / commission / swap in $ */
  feesUsd?: number;
  rMultiple: number;
  result: TradeResult;
  notes?: string;
  session?: string;
}

export interface Strategy {
  name: string;
  version: string;
  summary: string;
  edge: string;
  timeframes: { role: string; tf: string; job: string }[];
  rules: { title: string; body: string }[];
  risk: { title: string; body: string }[];
  targets: { metric: string; value: string }[];
  approach: string;
  updatedAt: string;
}

export interface ChartSpec {
  id: string;
  title: string;
  type: "equity" | "rByDay" | "winLoss" | "bySymbol" | "bySetup" | "custom";
  description?: string;
  data?: { label: string; value: number; secondary?: number }[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
  charts?: ChartSpec[];
  createdAt: string;
}

export interface TradingState {
  trades: Trade[];
  strategy: Strategy;
  chat: ChatMessage[];
}
