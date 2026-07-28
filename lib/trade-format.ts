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
