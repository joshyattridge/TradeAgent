import { format, parseISO } from "date-fns";
import type { ChartSpec, Trade } from "./types";

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

export function buildChart(
  type: ChartSpec["type"],
  trades: Trade[],
  title?: string,
  customData?: ChartSpec["data"],
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
    case "custom":
      return {
        id,
        type,
        title: title ?? "Custom chart",
        data: customData ?? [],
      };
  }
}
