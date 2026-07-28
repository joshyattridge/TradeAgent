import { format, parseISO } from "date-fns";
import type {
  ChartKind,
  ChartPoint,
  ChartRequest,
  ChartSpec,
  Trade,
  TradeLabelField,
  TradeMetricField,
} from "./types";
import { getTimeInTradeMinutes } from "./trade-format";

export function closedTrades(trades: Trade[]) {
  return trades.filter((t) => t.result !== "open");
}

export function computeStats(trades: Trade[]) {
  const closed = closedTrades(trades);
  const wins = closed.filter((t) => t.result === "win");
  const losses = closed.filter((t) => t.result === "loss");
  const totalR = closed.reduce((sum, t) => sum + t.rMultiple, 0);
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const avgR = closed.length ? totalR / closed.length : 0;
  const expectancy = avgR;
  const best = closed.reduce((m, t) => Math.max(m, t.rMultiple), 0);
  const worst = closed.reduce((m, t) => Math.min(m, t.rMultiple), 0);
  const totalPnlUsd = closed.reduce((sum, t) => sum + (t.pnlUsd ?? 0), 0);
  const durations = closed
    .map((t) => getTimeInTradeMinutes(t))
    .filter((m): m is number => typeof m === "number");
  const avgTimeInTradeMinutes = durations.length
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : undefined;
  const openCount = trades.filter((t) => t.result === "open").length;

  return {
    totalTrades: trades.length,
    closedCount: closed.length,
    openCount,
    wins: wins.length,
    losses: losses.length,
    winRate,
    totalR,
    avgR,
    expectancy,
    best,
    worst,
    totalPnlUsd,
    avgTimeInTradeMinutes,
  };
}

export function equityCurve(trades: Trade[]) {
  const closed = [...closedTrades(trades)].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  let running = 0;
  return closed.map((t) => {
    running += t.rMultiple;
    return {
      label: format(parseISO(t.date), "MMM d"),
      value: Number(running.toFixed(2)),
      secondary: t.rMultiple,
    };
  });
}

export function rByDay(trades: Trade[]) {
  const map = new Map<string, number>();
  for (const t of closedTrades(trades)) {
    map.set(t.date, (map.get(t.date) ?? 0) + t.rMultiple);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({
      label: format(parseISO(date), "MMM d"),
      value: Number(value.toFixed(2)),
    }));
}

export function winLossBreakdown(trades: Trade[]) {
  const stats = computeStats(trades);
  return [
    { label: "Wins", value: stats.wins },
    { label: "Losses", value: stats.losses },
    { label: "Open", value: stats.openCount },
  ];
}

export function bySymbol(trades: Trade[]) {
  const map = new Map<string, number>();
  for (const t of closedTrades(trades)) {
    map.set(t.symbol, (map.get(t.symbol) ?? 0) + t.rMultiple);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({
      label,
      value: Number(value.toFixed(2)),
    }));
}

export function bySetup(trades: Trade[]) {
  const map = new Map<string, number>();
  for (const t of closedTrades(trades)) {
    map.set(t.setup, (map.get(t.setup) ?? 0) + t.rMultiple);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({
      label,
      value: Number(value.toFixed(2)),
    }));
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
  feesUsd: "Fees ($)",
  rMultiple: "R",
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
    case "rMultiple":
      return trade.rMultiple;
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
    case "setup":
      return trade.setup || "—";
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
): ChartSpec {
  const id = `chart-${type}-${Date.now()}`;
  switch (type) {
    case "equity":
      return {
        id,
        type,
        title: title ?? "Equity curve (R)",
        description: "Cumulative R across closed trades",
        data: equityCurve(trades),
      };
    case "rByDay":
      return {
        id,
        type,
        title: title ?? "Daily R",
        description: "Net R by day",
        data: rByDay(trades),
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
        title: title ?? "R by symbol",
        data: bySymbol(trades),
      };
    case "bySetup":
      return {
        id,
        type,
        title: title ?? "R by setup",
        data: bySetup(trades),
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
  const yField = req.yField ?? "rMultiple";
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
  const valueField = req.valueField ?? "rMultiple";
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
  const valueField = req.valueField ?? "rMultiple";
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
    const yField = req.yField ?? "rMultiple";
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
        : `${agg} ${metricLabel(req.valueField ?? "rMultiple")} by ${metricLabel(bucket)}`);
    defaultDescription =
      req.description ??
      `Buckets of ${req.bucketSize ?? 10} on ${metricLabel(bucket)}`;
    if (!yLabel) {
      yLabel =
        agg === "winRate"
          ? "Win rate %"
          : agg === "count"
            ? "Trades"
            : metricLabel(req.valueField ?? "rMultiple");
    }
  } else {
    data = buildGroupedSeries(req, pool);
    const agg = req.aggregate ?? "sum";
    const vf = req.valueField ?? "rMultiple";
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
