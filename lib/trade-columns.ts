export const TRADE_COLUMNS = [
  { id: "entryTime", label: "Entry time", defaultVisible: true },
  { id: "symbol", label: "Symbol", defaultVisible: true },
  { id: "side", label: "Side", defaultVisible: true },
  { id: "session", label: "Session", defaultVisible: false },
  { id: "size", label: "Size", defaultVisible: false },
  { id: "entry", label: "Entry", defaultVisible: false },
  { id: "stop", label: "SL", defaultVisible: false },
  { id: "target", label: "TP", defaultVisible: false },
  { id: "slPips", label: "SL pips", defaultVisible: false },
  { id: "tpPips", label: "TP pips", defaultVisible: false },
  { id: "exit", label: "Exit", defaultVisible: false },
  { id: "date", label: "Date", defaultVisible: false },
  { id: "exitTime", label: "Exit time", defaultVisible: false },
  { id: "timeInTrade", label: "Time in trade", defaultVisible: false },
  { id: "riskUsd", label: "Risk $", defaultVisible: false },
  { id: "pnlUsd", label: "$ P&L", defaultVisible: true },
  { id: "result", label: "Result", defaultVisible: true },
  { id: "screenshots", label: "Chart", defaultVisible: true },
  { id: "tags", label: "Tags", defaultVisible: true },
  { id: "notes", label: "Notes", defaultVisible: true },
] as const;

export type TradeColumnId = (typeof TRADE_COLUMNS)[number]["id"];

export const DEFAULT_VISIBLE_TRADE_COLUMNS: TradeColumnId[] = TRADE_COLUMNS.filter(
  (c) => c.defaultVisible,
).map((c) => c.id);

const VALID_TRADE_COLUMNS = new Set<string>(TRADE_COLUMNS.map((c) => c.id));
const DROPPED_TRADE_COLUMNS = new Set<string>(["date", "setup", "rMultiple"]);

export function orderedColumns(ids: Iterable<string>): TradeColumnId[] {
  const set = new Set(ids);
  return TRADE_COLUMNS.map((c) => c.id).filter((id) => set.has(id));
}

/** Restore saved column prefs. Only rewrite dropped/legacy ids — never un-hide user choices. */
export function migrateVisibleTradeColumns(saved: unknown): TradeColumnId[] {
  if (!Array.isArray(saved) || saved.length === 0) {
    return [...DEFAULT_VISIBLE_TRADE_COLUMNS];
  }
  const hadDate = saved.includes("date");
  const cols = saved.filter(
    (id): id is TradeColumnId =>
      typeof id === "string" &&
      VALID_TRADE_COLUMNS.has(id) &&
      !DROPPED_TRADE_COLUMNS.has(id),
  );
  if (hadDate && !cols.includes("entryTime")) {
    cols.unshift("entryTime");
  }
  const ordered = orderedColumns(cols);
  return ordered.length ? ordered : [...DEFAULT_VISIBLE_TRADE_COLUMNS];
}
