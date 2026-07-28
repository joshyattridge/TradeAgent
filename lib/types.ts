export type TradeSide = "long" | "short";
export type TradeResult = "win" | "loss" | "breakeven" | "open";

export interface Trade {
  id: string;
  date: string;
  symbol: string;
  side: TradeSide;
  setup: string;
  entry: number;
  stop: number;
  target: number;
  exit?: number;
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
  charts?: ChartSpec[];
  createdAt: string;
}

export interface TradingState {
  trades: Trade[];
  strategy: Strategy;
  chat: ChatMessage[];
}
