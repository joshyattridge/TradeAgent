import type { ChatAgentMessage } from "@/lib/chat-history";

export type TradeSide = "long" | "short";
export type TradeResult = "win" | "loss" | "breakeven" | "open";

/** Checklist item defined on the strategy plan. */
export interface StrategyChecklistItem {
  id: string;
  label: string;
}

/**
 * Yes/No answer recorded on a trade.
 * Unanswered items are omitted (neither radio selected).
 * `label` is snapshotted so history survives strategy checklist edits.
 */
export interface TradeChecklistAnswer {
  id: string;
  label: string;
  checked: boolean;
}

export interface Trade {
  id: string;
  /** Calendar date YYYY-MM-DD */
  date: string;
  symbol: string;
  side: TradeSide;
  setup: string;
  entry: number;
  /** Stop loss price level */
  stop: number;
  /** Take profit price level */
  target: number;
  exit?: number;
  /** Distance from entry to SL in pips (or points for indices) */
  slPips?: number;
  /** Distance from entry to TP in pips (or points for indices) */
  tpPips?: number;
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
  /** Lightweight labels for filtering / coaching */
  tags?: string[];
  /** Chart screenshots / images attached when the trade was logged */
  screenshots?: string[];
  /** Strategy checklist Yes/No answers for this trade */
  checklist?: TradeChecklistAnswer[];
}

export interface Strategy {
  /** Display name (usually the first markdown H1) */
  name: string;
  /** Full strategy document as markdown (images may be data URLs) */
  markdown: string;
  updatedAt: string;
  /** Structured pre-trade checklist (Yes/No recorded on each trade) */
  checklist?: StrategyChecklistItem[];
}

export type ChartKind =
  | "equity"
  | "rByDay"
  | "winLoss"
  | "bySymbol"
  | "bySetup"
  | "bar"
  | "scatter"
  | "line";

export type TradeMetricField =
  | "entry"
  | "stop"
  | "target"
  | "exit"
  | "slPips"
  | "tpPips"
  | "stopDistance"
  | "targetDistance"
  | "timeInTradeMinutes"
  | "pnlUsd"
  | "riskUsd"
  | "feesUsd"
  | "rMultiple";

export type TradeLabelField = "symbol" | "date" | "setup" | "session" | "side" | "result";

export interface ChartPoint {
  /** Unique point id (trade id, symbol, etc.) — used as chart keys / X-axis categories */
  id?: string;
  label: string;
  value: number;
  secondary?: number;
  x?: number;
  y?: number;
  /** True when $ value was derived from R × risk because pnlUsd was missing */
  estimated?: boolean;
  /** How many trades contributed to this aggregated point */
  count?: number;
}

export type PerformanceUnit = "r" | "usd";

export interface ChartSpec {
  id: string;
  title: string;
  type: ChartKind;
  description?: string;
  xLabel?: string;
  yLabel?: string;
  /** How to format series values in axes / tooltips */
  valueUnit?: PerformanceUnit;
  data?: ChartPoint[];
}

export interface ChartRequest {
  type: ChartKind;
  title?: string;
  description?: string;
  xLabel?: string;
  yLabel?: string;
  /** For scatter: x-axis metric */
  xField?: TradeMetricField;
  /** For scatter: y-axis metric */
  yField?: TradeMetricField;
  /** For bar/line: y values */
  valueField?: TradeMetricField;
  /** Point labels / group-by for bar/line */
  labelField?: TradeLabelField;
  /** How to reduce trades in a group (default sum; winRate for hit-rate charts) */
  aggregate?: "sum" | "avg" | "count" | "winRate";
  /** Numeric field to bucket for distribution charts (e.g. slPips) */
  bucketField?: TradeMetricField;
  /** Bucket width when bucketField is set (e.g. 10 pips) */
  bucketSize?: number;
  /** Default true — only closed trades */
  closedOnly?: boolean;
  /** Optional explicit points (overrides field mapping) */
  data?: ChartPoint[];
}

export interface ChatAttachmentMeta {
  name: string;
  kind: "image" | "text" | "file";
  mime: string;
}

/** Full attachment payload kept on the message for conversation replay. */
export type ChatMessageAttachment =
  | { kind: "image"; name: string; dataUrl: string; mime?: string }
  | { kind: "text"; name: string; text: string; mime?: string }
  | { kind: "file"; name: string; dataUrl: string; mime: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  images?: string[];
  /** Non-image chips in the UI. */
  files?: ChatAttachmentMeta[];
  /** Full payloads so follow-up turns still see prior CSVs/PDFs/images. */
  attachments?: ChatMessageAttachment[];
  /** Full agent turn transcript (tool calls + results) for session continuity. */
  agentMessages?: ChatAgentMessage[];
  charts?: ChartSpec[];
  createdAt: string;
}

export interface TradingState {
  trades: Trade[];
  strategy: Strategy;
  chat: ChatMessage[];
}
