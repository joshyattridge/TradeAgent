export const TRADE_COLUMNS = [
  { id: "date", label: "Date", defaultVisible: true },
  { id: "symbol", label: "Symbol", defaultVisible: true },
  { id: "side", label: "Side", defaultVisible: true },
  { id: "setup", label: "Setup", defaultVisible: true },
  { id: "session", label: "Session", defaultVisible: false },
  { id: "size", label: "Size", defaultVisible: false },
  { id: "entry", label: "Entry", defaultVisible: false },
  { id: "stop", label: "SL", defaultVisible: false },
  { id: "target", label: "TP", defaultVisible: false },
  { id: "slPips", label: "SL pips", defaultVisible: false },
  { id: "tpPips", label: "TP pips", defaultVisible: false },
  { id: "exit", label: "Exit", defaultVisible: false },
  { id: "entryTime", label: "Entry time", defaultVisible: false },
  { id: "exitTime", label: "Exit time", defaultVisible: false },
  { id: "timeInTrade", label: "Time in trade", defaultVisible: false },
  { id: "riskUsd", label: "Risk $", defaultVisible: false },
  { id: "pnlUsd", label: "$ P&L", defaultVisible: true },
  { id: "rMultiple", label: "R", defaultVisible: true },
  { id: "result", label: "Result", defaultVisible: true },
  { id: "notes", label: "Notes", defaultVisible: false },
] as const;

export type TradeColumnId = (typeof TRADE_COLUMNS)[number]["id"];

export const DEFAULT_VISIBLE_TRADE_COLUMNS: TradeColumnId[] = TRADE_COLUMNS.filter(
  (c) => c.defaultVisible,
).map((c) => c.id);
