import {
  eachDayOfInterval,
  endOfWeek,
  format,
  parseISO,
  startOfDay,
  startOfWeek,
  subDays,
} from "date-fns";
import type {
  ChartKind,
  ChartPoint,
  ChartRequest,
  ChartSpec,
  PerformanceUnit,
  Trade,
  TradeLabelField,
  TradeMetricField,
} from "./types";
import {
  getSlPips,
  getTimeInTradeMinutes,
  getTpPips,
  tradeChronologyLabel,
  tradeChronologyMs,
} from "./trade-format";

export type { PerformanceUnit };

export type CalendarDayPnl = {
  date: string;
  dayOfMonth: number;
  label: string;
  /** Day is inside the requested lookback window. */
  inRange: boolean;
  /** Closed trades exist on this calendar day. */
  hasTrades: boolean;
  /** Net P&L for the day when in range; null for week-padding cells. */
  value: number | null;
};

/** Hidden trades stay in the journal but never count toward stats/charts. */
export function visibleJournalTrades(trades: Trade[]) {
  return trades.filter((t) => !t.hidden);
}

export function closedTrades(trades: Trade[]) {
  return visibleJournalTrades(trades).filter((t) => t.result !== "open");
}

/**
 * Resolve net $ P&L for charting/stats: pnlUsd − feesUsd.
 * feesUsd is the combined commission / swap / other costs field.
 * Missing pnlUsd contributes 0 (no R × risk estimate).
 */
export function resolvePnlUsd(trade: Trade): number {
  if (trade.pnlUsd != null && Number.isFinite(trade.pnlUsd)) {
    const fees =
      trade.feesUsd != null && Number.isFinite(trade.feesUsd)
        ? trade.feesUsd
        : 0;
    return trade.pnlUsd - fees;
  }
  return 0;
}

function tradeUnitValue(trade: Trade, _unit: PerformanceUnit): number {
  void _unit;
  return resolvePnlUsd(trade);
}

/** Planned reward:risk from TP/SL — derived, never stored on the trade. */
export function plannedRewardRisk(trade: Trade): number | null {
  const sl = getSlPips(trade);
  const tp = getTpPips(trade);
  if (
    typeof sl === "number" &&
    sl > 0 &&
    typeof tp === "number" &&
    Number.isFinite(tp)
  ) {
    return tp / sl;
  }
  const risk = Math.abs(trade.entry - trade.stop);
  const reward = Math.abs(trade.target - trade.entry);
  if (!(risk > 0) || !Number.isFinite(reward)) return null;
  return reward / risk;
}

/**
 * Realized R from net $ / risk, else exit vs stop, else a legacy stored rMultiple.
 * Open trades have no realized R.
 */
export function realizedRewardRisk(trade: Trade): number | null {
  if (trade.result === "open") return null;
  if (
    trade.riskUsd != null &&
    trade.riskUsd > 0 &&
    trade.pnlUsd != null &&
    Number.isFinite(trade.pnlUsd)
  ) {
    return resolvePnlUsd(trade) / trade.riskUsd;
  }
  if (trade.exit != null && Number.isFinite(trade.exit)) {
    const risk = trade.entry - trade.stop;
    if (risk === 0 || !Number.isFinite(risk)) return null;
    return (trade.exit - trade.entry) / risk;
  }
  if (trade.rMultiple != null && Number.isFinite(trade.rMultiple)) {
    return trade.rMultiple;
  }
  return null;
}

function roundUnit(value: number): number {
  return Number(value.toFixed(2));
}

/** @deprecated use tradeChronologyMs — kept as alias for callers/tests */
export function tradeCloseMs(trade: Trade): number {
  return tradeChronologyMs(trade);
}

export function compareTradesChronologically(a: Trade, b: Trade): number {
  const diff = tradeChronologyMs(a) - tradeChronologyMs(b);
  if (diff !== 0) return diff;
  return a.id.localeCompare(b.id);
}

function uniqueEquityLabels(trades: Trade[]): string[] {
  const raw = trades.map((t) => tradeChronologyLabel(t));
  const totals = new Map<string, number>();
  for (const label of raw) {
    totals.set(label, (totals.get(label) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return raw.map((label) => {
    const total = totals.get(label)!;
    if (total <= 1) return label;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return `${label} · ${n}`;
  });
}

export function computeStats(trades: Trade[]) {
  const visible = visibleJournalTrades(trades);
  const closed = closedTrades(trades);
  const wins = closed.filter((t) => t.result === "win");
  const losses = closed.filter((t) => t.result === "loss");
  const totalR = closed.reduce(
    (sum, t) => sum + (realizedRewardRisk(t) ?? 0),
    0,
  );
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const avgR = closed.length ? totalR / closed.length : 0;
  const expectancy = avgR;
  const planned = visible
    .map(plannedRewardRisk)
    .filter((v): v is number => v != null);
  const avgPlannedRr = planned.length
    ? planned.reduce((sum, v) => sum + v, 0) / planned.length
    : 0;
  const pnls = closed.map((t) => resolvePnlUsd(t));
  const best = pnls.length ? Math.max(...pnls) : 0;
  const worst = pnls.length ? Math.min(...pnls) : 0;
  const totalPnlUsd = pnls.reduce((sum, v) => sum + v, 0);
  const avgPnlUsd = closed.length ? totalPnlUsd / closed.length : 0;
  const durations = closed
    .map((t) => getTimeInTradeMinutes(t))
    .filter((m): m is number => typeof m === "number");
  const avgTimeInTradeMinutes = durations.length
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : undefined;
  const openCount = visible.filter((t) => t.result === "open").length;

  return {
    totalTrades: visible.length,
    closedCount: closed.length,
    openCount,
    wins: wins.length,
    losses: losses.length,
    winRate,
    totalR,
    avgR,
    avgPlannedRr,
    expectancy,
    best,
    worst,
    totalPnlUsd,
    avgPnlUsd,
    avgTimeInTradeMinutes,
  };
}

export function equityCurve(trades: Trade[], unit: PerformanceUnit = "usd") {
  const closed = [...closedTrades(trades)].sort(compareTradesChronologically);
  const labels = uniqueEquityLabels(closed);

  // Start at flat 0 so the first trade is a visible step (win goes up, loss down).
  const points: ChartPoint[] = [
    {
      id: "__equity-start",
      label: "Start",
      value: 0,
      secondary: 0,
      x: 0,
    },
  ];

  let running = 0;
  closed.forEach((t, index) => {
    const delta = resolvePnlUsd(t);
    running += delta;
    points.push({
      id: t.id,
      label: labels[index]!,
      value: roundUnit(running),
      secondary: roundUnit(delta),
      x: index + 1,
    });
  });
  return points;
}

export function rByDay(trades: Trade[], unit: PerformanceUnit = "usd") {
  const map = new Map<string, number>();
  for (const t of closedTrades(trades)) {
    map.set(t.date, (map.get(t.date) ?? 0) + tradeUnitValue(t, unit));
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({
      id: date,
      label: format(parseISO(date), "MMM d"),
      value: roundUnit(value),
    }));
}

/**
 * Build a Sunday–Saturday calendar grid covering the last `days` calendar
 * days (inclusive of `now`). Leading/trailing week padding cells have
 * `inRange: false` so the UI can render empty squares.
 */
export function pnlCalendar(
  trades: Trade[],
  unit: PerformanceUnit = "usd",
  days = 30,
  now: Date = new Date(),
): CalendarDayPnl[] {
  const end = startOfDay(now);
  const start = subDays(end, Math.max(days, 1) - 1);
  const byDay = new Map(rByDay(trades, unit).map((d) => [d.id, d.value]));
  const gridStart = startOfWeek(start, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(end, { weekStartsOn: 0 });

  return eachDayOfInterval({ start: gridStart, end: gridEnd }).map((day) => {
    const date = format(day, "yyyy-MM-dd");
    const inRange = day >= start && day <= end;
    const value = byDay.get(date);
    const hasTrades = value !== undefined;
    return {
      date,
      dayOfMonth: day.getDate(),
      label: format(day, "MMM d"),
      inRange,
      hasTrades,
      value: inRange ? (hasTrades ? value! : 0) : null,
    };
  });
}

export function winLossBreakdown(trades: Trade[]) {
  const stats = computeStats(trades);
  return [
    { id: "wins", label: "Wins", value: stats.wins },
    { id: "losses", label: "Losses", value: stats.losses },
    { id: "open", label: "Open", value: stats.openCount },
  ];
}

export function bySymbol(trades: Trade[], unit: PerformanceUnit = "usd") {
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const t of closedTrades(trades)) {
    counts.set(t.symbol, (counts.get(t.symbol) ?? 0) + 1);
    totals.set(
      t.symbol,
      (totals.get(t.symbol) ?? 0) + tradeUnitValue(t, unit),
    );
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({
      id: label,
      label,
      value: roundUnit(value),
      count: counts.get(label)!,
    }));
}

/** @deprecated Setup was removed; kept so old chart requests still resolve. */
export function bySetup(trades: Trade[], unit: PerformanceUnit = "usd") {
  void trades;
  void unit;
  return [];
}

const METRIC_LABELS: Record<TradeMetricField, string> = {
  entry: "Entry",
  stop: "Stop",
  target: "Target",
  exit: "Exit",
  slPips: "SL (pips)",
  tpPips: "TP (pips)",
  stopDistance: "SL distance",
  targetDistance: "TP distance",
  timeInTradeMinutes: "Time in trade (min)",
  pnlUsd: "P&L ($)",
  riskUsd: "Risk ($)",
  feesUsd: "Fees (comm+swap $)",
};

export function metricLabel(field: TradeMetricField) {
  return METRIC_LABELS[field] ?? field;
}

export function metricValue(trade: Trade, field: TradeMetricField): number | null {
  switch (field) {
    case "entry":
      return trade.entry;
    case "stop":
      return trade.stop;
    case "target":
      return trade.target;
    case "exit":
      return trade.exit ?? null;
    case "slPips":
      return trade.slPips ?? null;
    case "tpPips":
      return trade.tpPips ?? null;
    case "stopDistance":
      return Number.isFinite(trade.entry) && Number.isFinite(trade.stop)
        ? Math.abs(trade.entry - trade.stop)
        : null;
    case "targetDistance":
      return Number.isFinite(trade.entry) && Number.isFinite(trade.target)
        ? Math.abs(trade.target - trade.entry)
        : null;
    case "timeInTradeMinutes":
      return getTimeInTradeMinutes(trade) ?? null;
    case "pnlUsd":
      return trade.pnlUsd ?? null;
    case "riskUsd":
      return trade.riskUsd ?? null;
    case "feesUsd":
      return trade.feesUsd ?? null;
    default:
      return null;
  }
}

export function labelValue(trade: Trade, field: TradeLabelField = "symbol"): string {
  switch (field) {
    case "symbol":
      return trade.symbol;
    case "date":
      try {
        return format(parseISO(trade.date), "MMM d");
      } catch {
        return trade.date;
      }
    case "session":
      return trade.session || "—";
    case "side":
      return trade.side;
    case "result":
      return trade.result;
    default:
      return trade.symbol;
  }
}

function round(n: number, digits = 2) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function isPreset(type: ChartKind): type is Exclude<ChartKind, "bar" | "scatter" | "line"> {
  return (
    type === "equity" ||
    type === "rByDay" ||
    type === "winLoss" ||
    type === "bySymbol" ||
    type === "bySetup"
  );
}

export function buildChart(
  type: ChartKind,
  trades: Trade[],
  title?: string,
  customData?: ChartPoint[],
  unit: PerformanceUnit = "usd",
): ChartSpec {
  const id = `chart-${type}-${Date.now()}`;
  switch (type) {
    case "equity":
      return {
        id,
        type,
        title: title ?? "Equity curve ($)",
        description: "Cumulative $ P&L across closed trades",
        yLabel: "$",
        valueUnit: "usd",
        data: equityCurve(trades, "usd"),
      };
    case "rByDay":
      return {
        id,
        type,
        title: title ?? "Daily $",
        description: "Net $ P&L by day",
        yLabel: "$",
        valueUnit: "usd",
        data: rByDay(trades, "usd"),
      };
    case "winLoss":
      return {
        id,
        type,
        title: title ?? "Win / loss mix",
        data: winLossBreakdown(trades),
      };
    case "bySymbol":
      return {
        id,
        type,
        title: title ?? "$ by symbol",
        description: "Net $ P&L across closed trades per symbol",
        yLabel: "$",
        valueUnit: "usd",
        data: bySymbol(trades, "usd"),
      };
    case "bySetup":
      return {
        id,
        type,
        title: title ?? "$ by symbol",
        description: "Setup grouping was removed; showing $ by symbol instead",
        yLabel: "$",
        valueUnit: "usd",
        data: bySymbol(trades, "usd"),
      };
    case "bar":
    case "line":
    case "scatter":
      return {
        id,
        type,
        title: title ?? "Custom chart",
        data: customData ?? [],
      };
  }
}

type Aggregate = NonNullable<ChartRequest["aggregate"]>;

function aggregateGroup(
  group: Trade[],
  aggregate: Aggregate,
  valueField: TradeMetricField,
): number | null {
  if (aggregate === "count") return group.length;
  if (aggregate === "winRate") {
    const decided = group.filter((t) => t.result === "win" || t.result === "loss");
    if (!decided.length) return null;
    return round((decided.filter((t) => t.result === "win").length / decided.length) * 100, 1);
  }
  const values = group
    .map((t) => metricValue(t, valueField))
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (!values.length) return null;
  if (aggregate === "avg") {
    return round(values.reduce((a, b) => a + b, 0) / values.length);
  }
  return round(values.reduce((a, b) => a + b, 0));
}

function buildScatter(req: ChartRequest, pool: Trade[]): ChartPoint[] {
  const xField = req.xField ?? "slPips";
  const yField = req.yField ?? "pnlUsd";
  const labelField = req.labelField ?? "symbol";
  const points: ChartPoint[] = [];
  for (const t of pool) {
    const x = metricValue(t, xField);
    const y = metricValue(t, yField);
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push({
      label: labelValue(t, labelField),
      value: round(x),
      secondary: round(y),
      x: round(x),
      y: round(y),
    });
  }
  return points;
}

function buildBucketedBar(req: ChartRequest, pool: Trade[]): ChartPoint[] {
  const bucketField = req.bucketField!;
  const bucketSize = req.bucketSize && req.bucketSize > 0 ? req.bucketSize : 10;
  const aggregate = req.aggregate ?? "winRate";
  const valueField = req.valueField ?? "pnlUsd";
  const buckets = new Map<number, Trade[]>();

  for (const t of pool) {
    const raw = metricValue(t, bucketField);
    if (raw == null || !Number.isFinite(raw)) continue;
    const key = Math.floor(raw / bucketSize) * bucketSize;
    const list = buckets.get(key) ?? [];
    list.push(t);
    buckets.set(key, list);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, group]) => {
      const value = aggregateGroup(group, aggregate, valueField);
      return {
        label: `${start}–${start + bucketSize}`,
        value: value ?? 0,
      };
    });
}

function buildGroupedSeries(req: ChartRequest, pool: Trade[]): ChartPoint[] {
  const labelField = req.labelField ?? "symbol";
  const valueField = req.valueField ?? "pnlUsd";
  const aggregate = req.aggregate ?? "sum";
  const groups = new Map<string, Trade[]>();

  for (const t of pool) {
    const key = labelValue(t, labelField);
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const points = [...groups.entries()].map(([label, group]) => {
    const value = aggregateGroup(group, aggregate, valueField);
    return { label, value: value ?? 0 };
  });

  if (labelField === "date") {
    return points;
  }
  return points.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

/** Resolve a chat/dashboard chart request into a renderable ChartSpec. */
export function buildChartFromRequest(req: ChartRequest, trades: Trade[]): ChartSpec {
  if (isPreset(req.type)) {
    const chart = buildChart(req.type, trades, req.title);
    if (req.description) chart.description = req.description;
    return chart;
  }

  const id = `chart-${req.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const closedOnly = req.closedOnly !== false;
  const pool = closedOnly ? closedTrades(trades) : [...trades];

  if (req.data?.length) {
    return {
      id,
      type: req.type,
      title: req.title ?? "Custom chart",
      description: req.description,
      xLabel: req.xLabel,
      yLabel: req.yLabel,
      data: req.data,
    };
  }

  if (req.type === "scatter") {
    const xField = req.xField ?? "slPips";
    const yField = req.yField ?? "pnlUsd";
    return {
      id,
      type: "scatter",
      title: req.title ?? `${metricLabel(xField)} vs ${metricLabel(yField)}`,
      description: req.description ?? "Each point is one closed trade",
      xLabel: req.xLabel ?? metricLabel(xField),
      yLabel: req.yLabel ?? metricLabel(yField),
      data: buildScatter(req, pool),
    };
  }

  // bar / line
  let data: ChartPoint[];
  let defaultTitle: string;
  let defaultDescription: string | undefined;
  let yLabel = req.yLabel;

  if (req.bucketField) {
    data = buildBucketedBar(req, pool);
    const agg = req.aggregate ?? "winRate";
    const bucket = req.bucketField;
    defaultTitle =
      req.title ??
      (agg === "winRate"
        ? `Win rate by ${metricLabel(bucket)}`
        : `${agg} ${metricLabel(req.valueField ?? "pnlUsd")} by ${metricLabel(bucket)}`);
    defaultDescription =
      req.description ??
      `Buckets of ${req.bucketSize ?? 10} on ${metricLabel(bucket)}`;
    if (!yLabel) {
      yLabel =
        agg === "winRate"
          ? "Win rate %"
          : agg === "count"
            ? "Trades"
            : metricLabel(req.valueField ?? "pnlUsd");
    }
  } else {
    data = buildGroupedSeries(req, pool);
    const agg = req.aggregate ?? "sum";
    const vf = req.valueField ?? "pnlUsd";
    const lf = req.labelField ?? "symbol";
    defaultTitle =
      req.title ??
      `${agg === "winRate" ? "Win rate" : metricLabel(vf)} by ${lf}`;
    defaultDescription = req.description;
    if (!yLabel) {
      yLabel =
        agg === "winRate"
          ? "Win rate %"
          : agg === "count"
            ? "Trades"
            : metricLabel(vf);
    }
  }

  return {
    id,
    type: req.type,
    title: req.title ?? defaultTitle,
    description: req.description ?? defaultDescription,
    xLabel: req.xLabel,
    yLabel,
    data,
  };
}
