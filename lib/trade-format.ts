import { differenceInMinutes, format, isValid, parseISO } from "date-fns";
import type { Trade } from "./types";

/**
 * Parse trade datetime fields that may be full ISO, date-only, or time-only
 * (e.g. "12:45:41" from a broker screenshot) combined with calendar date.
 */
export function parseTradeDateTime(
  raw?: string,
  fallbackDate?: string,
): Date | null {
  if (!raw?.trim()) {
    if (!fallbackDate) return null;
    const d = parseISO(fallbackDate);
    return isValid(d) ? d : null;
  }

  const value = raw.trim();
  const iso = parseISO(value);
  if (isValid(iso)) return iso;

  const timeOnly = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeOnly) {
    const hh = timeOnly[1].padStart(2, "0");
    const mm = timeOnly[2];
    const ss = (timeOnly[3] ?? "00").padStart(2, "0");
    if (fallbackDate) {
      const combined = parseISO(`${fallbackDate}T${hh}:${mm}:${ss}`);
      if (isValid(combined)) return combined;
    }
    // No date — return a synthetic date so clock formatting still works
    const clockOnly = parseISO(`1970-01-01T${hh}:${mm}:${ss}`);
    if (isValid(clockOnly)) return clockOnly;
  }

  if (fallbackDate) {
    const d = parseISO(fallbackDate);
    if (isValid(d)) return d;
  }

  return null;
}

export function formatTradeDateTime(
  raw?: string,
  fallbackDate?: string,
  pattern = "MMM d, HH:mm",
): string {
  if (!raw?.trim()) return "—";
  const d = parseTradeDateTime(raw, fallbackDate);
  if (!d) return "—";
  const timeOnly = /^\d{1,2}:\d{2}(?::\d{2})?$/.test(raw.trim());
  try {
    // Time-only without a calendar date — show clock only
    if (timeOnly && !fallbackDate) return format(d, "HH:mm");
    return format(d, pattern);
  } catch {
    return "—";
  }
}

export function formatTradeDate(date?: string): string {
  if (!date?.trim()) return "—";
  const d = parseISO(date.trim());
  if (!isValid(d)) return date;
  try {
    return format(d, "MMM d, yyyy");
  } catch {
    return date;
  }
}

export function getTimeInTradeMinutes(trade: Trade): number | undefined {
  if (typeof trade.timeInTradeMinutes === "number") {
    return trade.timeInTradeMinutes;
  }
  if (!trade.entryTime || !trade.exitTime) return undefined;
  const start = parseTradeDateTime(trade.entryTime, trade.date);
  const end = parseTradeDateTime(trade.exitTime, trade.date);
  if (!start || !end) return undefined;
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

export function formatClock(iso?: string, fallbackDate?: string): string {
  if (!iso) return "—";
  // Preserve raw time-only display
  const timeOnly = iso.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeOnly) {
    return `${timeOnly[1].padStart(2, "0")}:${timeOnly[2]}`;
  }
  const d = parseTradeDateTime(iso, fallbackDate);
  if (!d) return "—";
  try {
    return format(d, "HH:mm");
  } catch {
    return "—";
  }
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
