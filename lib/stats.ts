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

/** Taken, resolved trades that feed P&L / win rate / equity / calendar. */
export function isStatsClosedTrade(trade: Trade): boolean {
  return trade.result !== "open" && trade.result !== "missed";
}

export function closedTrades(trades: Trade[]) {
  return visibleJournalTrades(trades).filter(isStatsClosedTrade);
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

function tradeUnitValue(trade: Trade): number {
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
 * Open and missed trades have no realized R.
 */
export function realizedRewardRisk(trade: Trade): number | null {
  if (trade.result === "open" || trade.result === "missed") return null;
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
  const missedCount = visible.filter((t) => t.result === "missed").length;

  return {
    totalTrades: visible.length - missedCount,
    closedCount: closed.length,
    openCount,
    missedCount,
    wins: wins.length,
    losses: losses.length,
    winRate,
    totalR,
    avgR,
    expectancy,
    best,
    worst,
    totalPnlUsd,
    avgPnlUsd,
    avgTimeInTradeMinutes,
    sampleConfidence: sampleConfidence(trades),
  };
}

export type SampleConfidenceLevel = "empty" | "noise" | "thin" | "readable";
export type SampleEdge = "unclear" | "likely-positive" | "likely-negative";

export type SampleConfidence = {
  level: SampleConfidenceLevel;
  closedCount: number;
  winRate: number;
  winRateLo: number;
  winRateHi: number;
  avgPnlUsd: number;
  avgPnlLo: number | null;
  avgPnlHi: number | null;
  avgIncludesZero: boolean;
  edge: SampleEdge;
  moreClosedNeeded: number;
  title: string;
  summary: string;
  winRateRangeLabel: string;
  avgRangeLabel: string | null;
  /** 0–100 chance the true average $ is positive. Null until 2 closed trades. */
  positiveEdgePct: number | null;
  edgeTone: "pos" | "neg" | "flat";
  edgeScoreLabel: string;
};

const Z_95 = 1.959964;
const MIN_N_READABLE = 40;
const TARGET_WR_WIDTH_PP = 20;
const T_CRIT_95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201,
  2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069,
  2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

function tCritical95(df: number): number {
  if (df <= T_CRIT_95.length) return T_CRIT_95[df - 1]!;
  return Z_95 + 2.4 / df + 3.2 / (df * df);
}

/** Wilson score interval for a binomial proportion, in percent. */
export function wilsonIntervalPct(
  successes: number,
  n: number,
): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 0 };
  const p = successes / n;
  const z2 = Z_95 * Z_95;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin =
    (Z_95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return {
    lo: clampPct((center - margin) * 100),
    hi: clampPct((center + margin) * 100),
  };
}

function clampPct(value: number): number {
  if (value <= 1e-10) return 0;
  if (value >= 100 - 1e-10) return 100;
  return value;
}

/** Student's t 95% CI for the mean. Null when variance is unidentified (n < 2). */
export function meanTInterval(
  values: number[],
): { lo: number; hi: number } | null {
  const n = values.length;
  if (n < 2) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  if (!(se > 0)) return { lo: mean, hi: mean };
  const t = tCritical95(n - 1);
  return { lo: mean - t * se, hi: mean + t * se };
}

const LANCZOS = [
  676.5203681218851, -1259.1392167224128, 771.3234287778304,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012,
  9.984369726010533e-6, 1.5056327351493116e-7,
];

function logGamma(z: number): number {
  let x = 0.99999999999980993;
  const z1 = z - 1;
  for (let i = 0; i < LANCZOS.length; i++) x += LANCZOS[i]! / (z1 + i + 1);
  const t = z1 + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z1 + 0.5) * Math.log(t) - t + Math.log(x);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 / (1 + aa * d);
    c = 1 + aa / c;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 / (1 + aa * d);
    c = 1 + aa / c;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-10) break;
  }
  return h;
}

function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x >= 1) return 1;
  const bt = Math.exp(
    a * Math.log(x) + b * Math.log(1 - x) + logGamma(a + b) - logGamma(a) - logGamma(b),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (bt * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (bt * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Student's t CDF. Used for P(true mean $ > 0) from the sample. */
export function studentTCdf(t: number, df: number): number {
  if (!(df > 0) || !Number.isFinite(t)) return 0.5;
  const x = df / (df + t * t);
  const ib = regularizedIncompleteBeta(df / 2, 0.5, x);
  return t >= 0 ? 1 - ib / 2 : ib / 2;
}

function positiveEdgeProbability(values: number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  if (!(se > 0)) {
    if (mean > 0) return 1;
    if (mean < 0) return 0;
    return 0.5;
  }
  return studentTCdf(mean / se, n - 1);
}

function edgeToneFromPct(pct: number | null): "pos" | "neg" | "flat" {
  if (pct == null) return "flat";
  if (pct >= 56) return "pos";
  if (pct <= 44) return "neg";
  return "flat";
}

function edgeScoreLabel(pct: number | null): string {
  if (pct == null) return "Need 2 closed trades for an edge score";
  return "Chance the true average $ is positive";
}

function nForWinRateWidth(p: number): number {
  const clipped = Math.min(0.95, Math.max(0.05, p));
  const half = TARGET_WR_WIDTH_PP / 200;
  return Math.ceil((Z_95 * Math.sqrt(clipped * (1 - clipped)) / half) ** 2);
}

function formatSignedUsdCompact(value: number): string {
  const digits = Math.abs(value) >= 10 ? 0 : 2;
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return "$0";
  const sign = rounded > 0 ? "+" : "";
  return `${sign}$${rounded.toFixed(digits)}`;
}

function closedPhrase(n: number): string {
  return `${n} closed ${n === 1 ? "trade" : "trades"}`;
}

function classifySample(opts: {
  n: number;
  wrWidth: number;
}): SampleConfidenceLevel {
  if (opts.n <= 0) return "empty";
  if (opts.n < 20) return "noise";
  if (opts.n >= MIN_N_READABLE && opts.wrWidth <= TARGET_WR_WIDTH_PP) {
    return "readable";
  }
  return "thin";
}

function edgeFromMeanInterval(
  interval: { lo: number; hi: number } | null,
): SampleEdge {
  if (!interval) return "unclear";
  if (interval.lo > 0) return "likely-positive";
  if (interval.hi < 0) return "likely-negative";
  return "unclear";
}

function avgSentence(
  avg: number,
  interval: { lo: number; hi: number } | null,
  edge: SampleEdge,
): string {
  if (!interval) {
    return "Average $ needs at least two closed trades for a range.";
  }
  const range = `${formatSignedUsdCompact(interval.lo)} to ${formatSignedUsdCompact(interval.hi)}`;
  if (edge === "likely-positive") {
    return `Average ${formatSignedUsdCompact(avg)} is likely positive (95% range ${range}).`;
  }
  if (edge === "likely-negative") {
    return `Average ${formatSignedUsdCompact(avg)} is likely negative (95% range ${range}).`;
  }
  return `Average ${formatSignedUsdCompact(avg)} still includes $0 in its 95% range (${range}) — no evidence of an edge yet.`;
}

function sampleCopy(opts: {
  level: SampleConfidenceLevel;
  n: number;
  winRate: number;
  wrRange: string;
  avgText: string;
  moreClosedNeeded: number;
}): { title: string; summary: string } {
  if (opts.level === "empty") {
    return {
      title: "No closed trades yet",
      summary:
        "Closed trades will build a sample. Win rate, average $, and the Monte Carlo fan are noise until then.",
    };
  }
  if (opts.level === "noise") {
    return {
      title: "Too early — this is still noise",
      summary: `${closedPhrase(opts.n)}. Win rate ${opts.winRate.toFixed(0)}% has a 95% range of ${opts.wrRange}. ${opts.avgText} Need about ${opts.moreClosedNeeded} more closed trades before the win-rate range is tight enough to trust.`,
    };
  }
  if (opts.level === "thin") {
    return {
      title: "Early sample — still a lot of noise",
      summary: `${closedPhrase(opts.n)}. Win rate ${opts.winRate.toFixed(0)}% (95% range ${opts.wrRange}). ${opts.avgText} About ${opts.moreClosedNeeded} more closed trades would tighten the win-rate range to ~20 points.`,
    };
  }
  return {
    title: "Sample is large enough to read",
    summary: `${closedPhrase(opts.n)}. Win rate ${opts.winRate.toFixed(0)}% (95% range ${opts.wrRange}). ${opts.avgText}`,
  };
}

/**
 * Whether the closed book is large enough to treat headline stats as
 * strategy evidence, vs a small-sample sketch.
 */
export function sampleConfidence(trades: Trade[]): SampleConfidence {
  const closed = closedTrades(trades);
  const n = closed.length;
  const wins = closed.filter((t) => t.result === "win").length;
  const pnls = closed.map((t) => resolvePnlUsd(t));
  const avgPnlUsd = n ? pnls.reduce((sum, v) => sum + v, 0) / n : 0;
  const winRate = n ? (wins / n) * 100 : 0;
  const wr = wilsonIntervalPct(wins, n);
  const meanInterval = meanTInterval(pnls);
  const wrWidth = wr.hi - wr.lo;
  const level = classifySample({ n, wrWidth });
  const edge = edgeFromMeanInterval(meanInterval);
  const avgIncludesZero = meanInterval
    ? meanInterval.lo <= 0 && meanInterval.hi >= 0
    : true;
  const targetN = Math.max(MIN_N_READABLE, nForWinRateWidth(n ? wins / n : 0.5));
  const moreClosedNeeded = level === "readable" ? 0 : Math.max(0, targetN - n);
  const wrRange = `${Math.round(wr.lo)}–${Math.round(wr.hi)}%`;
  const avgRangeLabel = meanInterval
    ? `${formatSignedUsdCompact(meanInterval.lo)} to ${formatSignedUsdCompact(meanInterval.hi)}`
    : null;
  const pPositive = positiveEdgeProbability(pnls);
  const positiveEdgePct =
    pPositive == null ? null : Math.round(pPositive * 100);
  const copy = sampleCopy({
    level,
    n,
    winRate,
    wrRange,
    avgText: avgSentence(avgPnlUsd, meanInterval, edge),
    moreClosedNeeded,
  });

  return {
    level,
    closedCount: n,
    winRate,
    winRateLo: wr.lo,
    winRateHi: wr.hi,
    avgPnlUsd,
    avgPnlLo: meanInterval?.lo ?? null,
    avgPnlHi: meanInterval?.hi ?? null,
    avgIncludesZero,
    edge,
    moreClosedNeeded,
    title: copy.title,
    summary: copy.summary,
    winRateRangeLabel: wrRange,
    avgRangeLabel,
    positiveEdgePct,
    edgeTone: edgeToneFromPct(positiveEdgePct),
    edgeScoreLabel: edgeScoreLabel(positiveEdgePct),
  };
}

function appendSampleSketch(text: string, trades: Trade[]): string {
  const { level } = sampleConfidence(trades);
  if (level === "noise") {
    return `${text} Small sample — treat this as a sketch, not a verdict.`;
  }
  if (level === "thin") {
    return `${text} Sample is still thin — ranges can still move a lot.`;
  }
  return text;
}

export function equityCurve(trades: Trade[]) {
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

export function pnlByDay(trades: Trade[]) {
  const map = new Map<string, number>();
  for (const t of closedTrades(trades)) {
    map.set(t.date, (map.get(t.date) ?? 0) + tradeUnitValue(t));
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
  days = 30,
  now: Date = new Date(),
): CalendarDayPnl[] {
  const end = startOfDay(now);
  const start = subDays(end, Math.max(days, 1) - 1);
  const byDay = new Map(pnlByDay(trades).map((d) => [d.id, d.value]));
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

/** Consecutive losses at the end of the closed journal, newest first. */
export function currentLosingStreak(trades: Trade[]): number {
  const closed = [...closedTrades(trades)].sort(compareTradesChronologically);
  let n = 0;
  for (let i = closed.length - 1; i >= 0; i--) {
    if (closed[i]!.result === "loss") n += 1;
    else break;
  }
  return n;
}

function losingStreakCaption(streak: number): string {
  if (streak <= 0) return "You are not currently in a losing streak.";
  if (streak === 1) return "You are currently on a 1-loss streak.";
  return `You are currently on a ${streak}-loss streak.`;
}

/**
 * Geometric P(next n trades are all losses) = (1 − win rate)^n.
 * Uses the same win rate as the dashboard (wins / closed trades).
 * Marks the bar for the trader's current consecutive-loss streak when > 0.
 */
export function lossStreakProbabilities(
  trades: Trade[],
  maxStreak = 10,
): ChartPoint[] {
  const { winRate, closedCount } = computeStats(trades);
  if (!closedCount) return [];
  const streak = currentLosingStreak(trades);
  const pLoss = 1 - winRate / 100;
  const limit = Math.max(1, Math.trunc(maxStreak), streak);
  const points: ChartPoint[] = [];
  for (let n = 1; n <= limit; n++) {
    const pct = pLoss ** n * 100;
    const current = streak === n;
    points.push({
      id: `streak-${n}`,
      label: current ? `${n} · now` : String(n),
      value: roundStreakPct(pct),
      ...(current ? { current: true } : {}),
    });
  }
  return points;
}

function roundStreakPct(pct: number): number {
  if (pct >= 1) return round(pct, 1);
  if (pct >= 0.01) return round(pct, 2);
  return round(pct, 3);
}

function winWithinCaption(winRate: number, streak: number): string {
  const next = `Chance the next trade is a win: ${winRate.toFixed(0)}%.`;
  if (streak <= 0) {
    return `You are not currently in a losing streak. ${next}`;
  }
  if (streak === 1) {
    return `You are currently on a 1-loss streak. ${next}`;
  }
  return `You are currently on a ${streak}-loss streak. ${next}`;
}

/**
 * Geometric CDF: P(at least one win in the next k trades) = 1 − (1 − win rate)^k.
 * Marks k = 1 ("this one") as the live next-trade probability.
 */
export function winWithinProbabilities(
  trades: Trade[],
  maxK = 10,
): ChartPoint[] {
  const { winRate, closedCount } = computeStats(trades);
  if (!closedCount) return [];
  const pLoss = 1 - winRate / 100;
  const limit = Math.max(1, Math.trunc(maxK));
  const points: ChartPoint[] = [];
  for (let k = 1; k <= limit; k++) {
    const pct = (1 - pLoss ** k) * 100;
    const current = k === 1;
    points.push({
      id: `wait-${k}`,
      label: current ? "this one" : String(k),
      value: roundStreakPct(pct),
      ...(current ? { current: true } : {}),
    });
  }
  return points;
}

export type MonteCarloFanOptions = {
  paths?: number;
  horizon?: number;
  seed?: number;
};

function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

function fanSeed(trades: Trade[]): number {
  const closed = closedTrades(trades);
  let h = 0x811c9dc5;
  h = Math.imul(h ^ closed.length, 0x01000193);
  for (const t of closed) {
    h = Math.imul(h ^ t.id.length, 0x01000193);
    h ^= Math.round(resolvePnlUsd(t) * 100);
  }
  return h >>> 0;
}

/**
 * Bootstrap future equity from closed-trade $ P&L, attached to the live curve.
 * Each path resamples the empirical distribution with replacement.
 */
export function monteCarloEquityFan(
  trades: Trade[],
  opts: MonteCarloFanOptions = {},
): ChartPoint[] {
  const closed = closedTrades(trades);
  if (!closed.length) return [];
  const paths = Math.max(1, Math.trunc(opts.paths ?? 500));
  const horizon = Math.max(1, Math.trunc(opts.horizon ?? 10));
  const rng = mulberry32(opts.seed ?? fanSeed(closed));
  const pnls = closed.map((t) => resolvePnlUsd(t));
  const curve = equityCurve(trades);
  const start = curve.at(-1)!.value;

  const history: ChartPoint[] = curve.map((p, index) => {
    const value = roundUnit(p.value);
    const last = index === curve.length - 1;
    return {
      ...p,
      value,
      lo: value,
      hi: value,
      ...(last ? { current: true } : {}),
    };
  });

  const running = Array.from({ length: paths }, () => start);
  const forecast: ChartPoint[] = [];
  const originX = history.at(-1)!.x!;

  for (let step = 1; step <= horizon; step++) {
    for (let i = 0; i < paths; i++) {
      const draw = pnls[Math.floor(rng() * pnls.length)]!;
      running[i] = running[i]! + draw;
    }
    const sorted = [...running].sort((a, b) => a - b);
    const lo = percentile(sorted, 0.1);
    const mid = percentile(sorted, 0.5);
    const hi = percentile(sorted, 0.9);
    forecast.push({
      id: `fan-${step}`,
      label: String(step),
      value: roundUnit(mid),
      lo: roundUnit(lo),
      hi: roundUnit(hi),
      x: originX + step,
      estimated: true,
    });
  }
  return [...history, ...forecast];
}

export function bySymbol(trades: Trade[]) {
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const t of closedTrades(trades)) {
    counts.set(t.symbol, (counts.get(t.symbol) ?? 0) + 1);
    totals.set(
      t.symbol,
      (totals.get(t.symbol) ?? 0) + tradeUnitValue(t),
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
export function bySetup(trades: Trade[]) {
  void trades;
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
    type === "pnlByDay" ||
    type === "winLoss" ||
    type === "bySymbol" ||
    type === "bySetup" ||
    type === "lossStreak" ||
    type === "winWithin" ||
    type === "equityFan"
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
        title: title ?? "Equity curve ($)",
        description: "Cumulative $ P&L across closed trades",
        yLabel: "$",
        valueUnit: "usd",
        data: equityCurve(trades),
      };
    case "pnlByDay":
      return {
        id,
        type,
        title: title ?? "Daily $",
        description: "Net $ P&L by day",
        yLabel: "$",
        valueUnit: "usd",
        data: pnlByDay(trades),
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
        data: bySymbol(trades),
      };
    case "bySetup":
      return {
        id,
        type,
        title: title ?? "$ by symbol",
        description: "Setup grouping was removed; showing $ by symbol instead",
        yLabel: "$",
        valueUnit: "usd",
        data: bySymbol(trades),
      };
    case "lossStreak": {
      const { winRate, closedCount } = computeStats(trades);
      return {
        id,
        type,
        title: title ?? "Losing streak odds",
        description: closedCount
          ? appendSampleSketch(
              `Chance the next N trades are all losses, at your ${winRate.toFixed(0)}% win rate. ${losingStreakCaption(currentLosingStreak(trades))}`,
              trades,
            )
          : "Needs closed trades so we can use your win rate",
        xLabel: "Losses in a row",
        yLabel: "Probability %",
        valueUnit: "percent",
        data: lossStreakProbabilities(trades),
      };
    }
    case "winWithin": {
      const { winRate, closedCount } = computeStats(trades);
      return {
        id,
        type,
        title: title ?? "Odds of a win soon",
        description: closedCount
          ? appendSampleSketch(
              `Chance of at least one win in the next k trades, at your ${winRate.toFixed(0)}% win rate. ${winWithinCaption(winRate, currentLosingStreak(trades))}`,
              trades,
            )
          : "Needs closed trades so we can use your win rate",
        xLabel: "Trades from now",
        yLabel: "Probability %",
        valueUnit: "percent",
        data: winWithinProbabilities(trades),
      };
    }
    case "equityFan": {
      const closedCount = closedTrades(trades).length;
      return {
        id,
        type,
        title: title ?? "Monte Carlo equity fan",
        description: closedCount
          ? appendSampleSketch(
              "Your live equity curve, then 500 resampled paths of the next 10 trades. Line is the median; band is the 10th–90th percentile.",
              trades,
            )
          : "Needs closed trades to simulate future equity",
        xLabel: "Trades",
        yLabel: "$",
        valueUnit: "usd",
        data: monteCarloEquityFan(trades),
      };
    }
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
