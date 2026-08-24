import { differenceInMinutes, format, isValid, parseISO } from "date-fns";
import type { Trade } from "./types";

function padTimePart(time: string): string {
  const segments = time.split(":");
  const hh = segments[0]!.padStart(2, "0");
  const mm = segments[1]!.padStart(2, "0");
  if (segments.length < 3) return `${hh}:${mm}:00`;
  const [sec, frac] = segments[2]!.split(".");
  const ss = sec.padStart(2, "0");
  return frac != null ? `${hh}:${mm}:${ss}.${frac}` : `${hh}:${mm}:${ss}`;
}

/**
 * Coerce common LLM / broker datetime strings into something parseISO can read.
 * e.g. "2026-07-30 15:52:45 UTC+1" → "2026-07-30T15:52:45+01:00"
 */
export function coerceDateTimeString(raw: string): string {
  let v = raw.trim();
  if (!v) return v;

  // "… UTC+1" / "UTC+01" / "GMT-5" / "UTC+01:00"
  const withNamedOffset = v.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?\s*$/i,
  );
  if (withNamedOffset) {
    const [, date, time, sign, oh, om] = withNamedOffset;
    const offset = `${sign}${oh.padStart(2, "0")}:${(om ?? "00").padStart(2, "0")}`;
    return `${date}T${padTimePart(time)}${offset}`;
  }

  // "… UTC" / "… GMT" → Z
  const withUtcZ = v.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*(?:UTC|GMT)\s*$/i,
  );
  if (withUtcZ) {
    return `${withUtcZ[1]}T${padTimePart(withUtcZ[2])}Z`;
  }

  // "2026-07-30 15:52:45+01:00" (space before time, numeric offset)
  const spaceWithOffset = v.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})$/i,
  );
  if (spaceWithOffset) {
    let off = spaceWithOffset[3].toUpperCase();
    if (/^[+-]\d{4}$/.test(off)) {
      off = `${off.slice(0, 3)}:${off.slice(3)}`;
    }
    return `${spaceWithOffset[1]}T${padTimePart(spaceWithOffset[2])}${off}`;
  }

  // "2026-07-30 15:52:45" → T separator
  const spaceSep = v.match(
    /^(\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)$/,
  );
  if (spaceSep) {
    return `${spaceSep[1]}T${padTimePart(spaceSep[2])}`;
  }

  // Ensure T form has padded time
  const isoish = v.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)(.*)$/i,
  );
  if (isoish) {
    return `${isoish[1]}T${padTimePart(isoish[2])}${isoish[3]}`;
  }

  return v;
}

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

  const value = coerceDateTimeString(raw);
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

/**
 * True when the string carries an explicit zone (Z, ±HH:MM, or UTC/GMT prose).
 * Broker CSV clocks without a zone must NOT be treated as UTC.
 */
export function hasExplicitTimezone(raw: string): boolean {
  const v = coerceDateTimeString(raw.trim());
  if (/(?:UTC|GMT)\s*$/i.test(raw.trim())) return true;
  if (/(?:UTC|GMT)\s*[+-]/i.test(raw.trim())) return true;
  return /([zZ]|[+-]\d{2}:\d{2})$/.test(v) || /([+-]\d{4})$/.test(v);
}

/**
 * Normalize a trade datetime for storage.
 * Timezone-naive values (typical broker CSV / chart clocks) keep the same
 * wall-clock HH:mm:ss — never shift them via UTC `Z`.
 * Explicit offsets/Z are preserved as real instants.
 */
export function normalizeTradeDateTime(
  raw?: string,
  fallbackDate?: string,
): string | undefined {
  if (!raw?.trim()) return undefined;
  const trimmed = raw.trim();

  // Time-only — keep clock; attach calendar date when we have one
  const timeOnly = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeOnly) {
    const hh = timeOnly[1].padStart(2, "0");
    const mm = timeOnly[2];
    const ss = (timeOnly[3] ?? "00").padStart(2, "0");
    if (fallbackDate) return `${fallbackDate}T${hh}:${mm}:${ss}`;
    return `${hh}:${mm}:${ss}`;
  }

  const coerced = coerceDateTimeString(trimmed);
  const d = parseTradeDateTime(trimmed, fallbackDate);
  if (!d) return trimmed;

  // Naive local / CSV clock — preserve displayed wall time, no Z shift
  if (!hasExplicitTimezone(trimmed)) {
    return format(d, "yyyy-MM-dd'T'HH:mm:ss");
  }

  // Explicit numeric offset — keep wall clock + that offset
  const withOffset = coerced.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})([+-]\d{2}:\d{2})$/,
  );
  if (withOffset) {
    return `${withOffset[1]}T${withOffset[2]}${withOffset[3]}`;
  }

  // Explicit Z / UTC — real instant
  return d.toISOString();
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
    // Date-only input should not pretend to have a real clock time
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return format(d, "MMM d, yyyy");
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

/**
 * Milliseconds for "trades taken" order — matches the journal table.
 * Prefer entryTime, then exitTime, then calendar date.
 */
export function tradeChronologyMs(trade: Trade): number {
  if (trade.entryTime?.trim()) {
    const entry = parseTradeDateTime(trade.entryTime, trade.date);
    if (entry && isValid(entry)) return entry.getTime();
  }
  if (trade.exitTime?.trim()) {
    const exit = parseTradeDateTime(trade.exitTime, trade.date);
    if (exit && isValid(exit)) return exit.getTime();
  }
  const day = parseTradeDateTime(trade.date);
  if (day && isValid(day)) return day.getTime();
  return 0;
}

/**
 * Wall-clock label for equity / timeline charts.
 * Uses entry time when present (trade sequence), else exit, else date.
 */
export function tradeChronologyLabel(trade: Trade): string {
  const raw = trade.entryTime?.trim() || trade.exitTime?.trim();
  if (raw) {
    const formatted = formatTradeDateTime(raw, trade.date, "MMM d HH:mm");
    if (formatted && formatted !== "—") return formatted;
  }
  try {
    return format(parseISO(trade.date), "MMM d");
  } catch {
    return trade.date;
  }
}

export function formatPnlUsd(value?: number): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}$${value.toFixed(2)}`;
}

/** Aggregate R:R for stats — not stored on the trade. */
export function formatRewardRisk(value?: number, signed = false): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}R`;
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
