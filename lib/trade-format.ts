import { differenceInMinutes, format, isValid, parseISO } from "date-fns";
import type { Trade } from "./types";

export function getTimeInTradeMinutes(trade: Trade): number | undefined {
  if (typeof trade.timeInTradeMinutes === "number") {
    return trade.timeInTradeMinutes;
  }
  if (!trade.entryTime || !trade.exitTime) return undefined;
  const start = parseISO(trade.entryTime);
  const end = parseISO(trade.exitTime);
  if (!isValid(start) || !isValid(end)) return undefined;
  return Math.max(0, differenceInMinutes(end, start));
}

export function formatDuration(minutes?: number): string {
  if (minutes == null || Number.isNaN(minutes)) return "—";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

export function formatClock(iso?: string): string {
  if (!iso) return "—";
  const d = parseISO(iso);
  if (!isValid(d)) return "—";
  return format(d, "HH:mm");
}

export function formatPnlUsd(value?: number): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}$${value.toFixed(2)}`;
}

/** Pip/point size for common symbols. */
export function pipSize(symbol: string): number {
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.includes("XAU") || s.includes("GOLD")) return 0.1;
  if (s.includes("XAG") || s.includes("SILVER")) return 0.01;
  if (
    s.includes("NAS") ||
    s.includes("US100") ||
    s.includes("NDX") ||
    s.includes("SPX") ||
    s.includes("US500") ||
    s.includes("DJ") ||
    s.includes("GER") ||
    s.includes("DAX")
  ) {
    return 1;
  }
  if (s.includes("JPY")) return 0.01;
  // Standard FX majors / minors
  if (/^[A-Z]{6}$/.test(s) || s.includes("USD") || s.includes("EUR") || s.includes("GBP")) {
    return 0.0001;
  }
  return 0.0001;
}

export function priceToPips(symbol: string, priceDistance: number): number {
  const size = pipSize(symbol);
  return Number((Math.abs(priceDistance) / size).toFixed(1));
}

export function getSlPips(trade: Trade): number | undefined {
  if (typeof trade.slPips === "number") return trade.slPips;
  if (trade.entry == null || trade.stop == null) return undefined;
  return priceToPips(trade.symbol, trade.entry - trade.stop);
}

export function getTpPips(trade: Trade): number | undefined {
  if (typeof trade.tpPips === "number") return trade.tpPips;
  if (trade.entry == null || trade.target == null) return undefined;
  return priceToPips(trade.symbol, trade.target - trade.entry);
}

export function formatPips(value?: number): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}`;
}
