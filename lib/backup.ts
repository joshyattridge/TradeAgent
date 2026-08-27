import {
  normalizeStrategyChecklist,
  normalizeTradeChecklist,
} from "./checklist";
import type { Strategy, Trade, TradeResult, TradeSide } from "./types";
import { normalizeStrategy } from "./strategy-md";

export const BACKUP_FORMAT = "tradeagent-journal" as const;
export const BACKUP_VERSION = 1 as const;

export interface JournalBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  trades: Trade[];
  strategy: Strategy;
}

export type ImportMode = "replace" | "merge";

export type BackupParseResult =
  | { ok: true; backup: JournalBackup }
  | { ok: false; error: string };

const TRADE_SIDES: TradeSide[] = ["long", "short"];
const TRADE_RESULTS: TradeResult[] = [
  "win",
  "loss",
  "breakeven",
  "open",
  "missed",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

function isOptionalStringArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

function parseTrade(raw: unknown, index: number): Trade | string {
  if (!isRecord(raw)) return `Trade ${index + 1} must be an object`;

  const {
    id,
    date,
    symbol,
    side,
    entry,
    stop,
    target,
    result,
  } = raw;

  if (typeof id !== "string" || !id.trim()) {
    return `Trade ${index + 1} is missing a valid id`;
  }
  if (typeof date !== "string" || !date.trim()) {
    return `Trade ${id} is missing a date`;
  }
  if (typeof symbol !== "string" || !symbol.trim()) {
    return `Trade ${id} is missing a symbol`;
  }
  if (typeof side !== "string" || !TRADE_SIDES.includes(side as TradeSide)) {
    return `Trade ${id} has an invalid side`;
  }
  if (!isFiniteNumber(entry)) return `Trade ${id} has an invalid entry`;
  if (!isFiniteNumber(stop)) return `Trade ${id} has an invalid stop`;
  if (!isFiniteNumber(target)) return `Trade ${id} has an invalid target`;
  if (raw.rMultiple !== undefined && !isOptionalNumber(raw.rMultiple)) {
    return `Trade ${id} has an invalid rMultiple`;
  }
  if (
    typeof result !== "string" ||
    !TRADE_RESULTS.includes(result as TradeResult)
  ) {
    return `Trade ${id} has an invalid result`;
  }

  if (!isOptionalNumber(raw.exit)) return `Trade ${id} has an invalid exit`;
  if (!isOptionalNumber(raw.slPips)) return `Trade ${id} has an invalid slPips`;
  if (!isOptionalNumber(raw.tpPips)) return `Trade ${id} has an invalid tpPips`;
  if (!isOptionalString(raw.entryTime)) {
    return `Trade ${id} has an invalid entryTime`;
  }
  if (!isOptionalString(raw.exitTime)) {
    return `Trade ${id} has an invalid exitTime`;
  }
  if (!isOptionalNumber(raw.timeInTradeMinutes)) {
    return `Trade ${id} has an invalid timeInTradeMinutes`;
  }
  if (!isOptionalNumber(raw.pnlUsd)) return `Trade ${id} has an invalid pnlUsd`;
  if (!isOptionalNumber(raw.riskUsd)) {
    return `Trade ${id} has an invalid riskUsd`;
  }
  if (!isOptionalString(raw.size)) return `Trade ${id} has an invalid size`;
  if (!isOptionalNumber(raw.feesUsd)) {
    return `Trade ${id} has an invalid feesUsd`;
  }
  if (!isOptionalString(raw.notes)) return `Trade ${id} has an invalid notes`;
  if (!isOptionalString(raw.session)) {
    return `Trade ${id} has an invalid session`;
  }
  if (!isOptionalStringArray(raw.tags)) {
    return `Trade ${id} has invalid tags`;
  }
  if (!isOptionalStringArray(raw.screenshots)) {
    return `Trade ${id} has invalid screenshots`;
  }
  if (raw.checklist !== undefined && !Array.isArray(raw.checklist)) {
    return `Trade ${id} has invalid checklist`;
  }
  const checklist = normalizeTradeChecklist(raw.checklist);

  // Drop legacy chartExtract / setup from older backups.
  const { chartExtract: _legacyExtract, setup: _setup, ...trade } = raw;
  void _legacyExtract;
  void _setup;
  const next = trade as unknown as Trade;
  if (checklist.length) {
    next.checklist = checklist;
  } else {
    delete next.checklist;
  }
  if (raw.hidden === true) next.hidden = true;
  else delete next.hidden;
  return next;
}

function parseStrategy(raw: unknown): Strategy | string {
  if (!isRecord(raw)) return "Strategy must be an object";

  // New markdown shape
  if (typeof raw.markdown === "string") {
    if (typeof raw.updatedAt !== "string" || !raw.updatedAt) {
      return "Strategy is missing a valid updatedAt";
    }
    if (raw.checklist !== undefined && !Array.isArray(raw.checklist)) {
      return "Strategy.checklist must be an array";
    }
    const name =
      typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : "Trading strategy";
    const checklist = normalizeStrategyChecklist(raw.checklist);
    return {
      name,
      markdown: raw.markdown,
      updatedAt: raw.updatedAt,
      checklist,
    };
  }

  // Legacy structured shape → migrate to markdown
  const requiredLegacy = ["name", "summary", "edge", "approach", "updatedAt"] as const;
  for (const key of requiredLegacy) {
    if (typeof raw[key] !== "string") {
      return `Strategy is missing a valid ${key} (or markdown)`;
    }
  }
  for (const key of ["timeframes", "rules", "risk", "targets"] as const) {
    if (!Array.isArray(raw[key])) {
      return `Strategy.${key} must be an array`;
    }
  }

  return normalizeStrategy(raw);
}

/** Build a portable backup of trades + strategy (no API key / chat). */
export function buildJournalBackup(
  trades: Trade[],
  strategy: Strategy,
): JournalBackup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    trades,
    strategy,
  };
}

export function serializeJournalBackup(backup: JournalBackup): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export function backupFilename(
  exportedAt = new Date(),
  gzip = true,
): string {
  const stamp = exportedAt.toISOString().slice(0, 10);
  const base = `tradeagent-backup-${stamp}.json`;
  return gzip ? `${base}.gz` : base;
}

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

export function isGzipBuffer(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1;
}

/** Copy into a real ArrayBuffer so Blob / CompressionStream type-check. */
export function u8ToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function collectStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function runByteTransform(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  const collected = collectStream(transform.readable);
  try {
    await writer.write(new Uint8Array(u8ToArrayBuffer(bytes)));
    await writer.close();
    return await collected;
  } catch (err) {
    await collected.catch(() => undefined);
    throw err;
  }
}

export async function gzipUtf8(text: string): Promise<Uint8Array> {
  if (typeof CompressionStream !== "function") {
    throw new Error("Gzip is not supported in this browser");
  }
  return runByteTransform(
    new TextEncoder().encode(text),
    new CompressionStream("gzip"),
  );
}

export async function gunzipUtf8(bytes: Uint8Array): Promise<string> {
  if (typeof DecompressionStream !== "function") {
    throw new Error("Gzip is not supported in this browser");
  }
  const out = await runByteTransform(bytes, new DecompressionStream("gzip"));
  return new TextDecoder().decode(out);
}

/** Decode a backup file: gzip if magic bytes or `.gz` name, otherwise UTF-8 JSON. */
export async function readBackupText(
  bytes: Uint8Array,
  fileName = "",
): Promise<string> {
  const gzip = isGzipBuffer(bytes) || /\.gz$/i.test(fileName);
  if (!gzip) return new TextDecoder().decode(bytes);
  try {
    return await gunzipUtf8(bytes);
  } catch (err) {
    if (err instanceof Error && err.message === "Gzip is not supported in this browser") {
      throw err;
    }
    throw new Error("Could not decompress gzip backup");
  }
}

/** Parse + lightly validate a backup JSON string or object. */
export function parseJournalBackup(input: unknown): BackupParseResult {
  let raw: unknown = input;

  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      return { ok: false, error: "File is not valid JSON" };
    }
  }

  if (!isRecord(raw)) {
    return { ok: false, error: "Backup root must be a JSON object" };
  }

  if (raw.format !== BACKUP_FORMAT) {
    return {
      ok: false,
      error: `Unrecognized backup format (expected "${BACKUP_FORMAT}")`,
    };
  }

  if (raw.version !== BACKUP_VERSION) {
    return {
      ok: false,
      error: `Unsupported backup version (got ${String(raw.version)}, expected ${BACKUP_VERSION})`,
    };
  }

  if (typeof raw.exportedAt !== "string") {
    return { ok: false, error: "Backup is missing exportedAt" };
  }

  if (!Array.isArray(raw.trades)) {
    return { ok: false, error: "Backup trades must be an array" };
  }

  const trades: Trade[] = [];
  for (let i = 0; i < raw.trades.length; i++) {
    const parsed = parseTrade(raw.trades[i], i);
    if (typeof parsed === "string") {
      return { ok: false, error: parsed };
    }
    trades.push(parsed);
  }

  const strategy = parseStrategy(raw.strategy);
  if (typeof strategy === "string") {
    return { ok: false, error: strategy };
  }

  return {
    ok: true,
    backup: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: raw.exportedAt,
      trades,
      strategy,
    },
  };
}

/**
 * Merge imported trades into the current book.
 * Same id → imported trade wins. New ids are appended (newest-first order preserved for imports).
 */
export function mergeTrades(current: Trade[], incoming: Trade[]): Trade[] {
  const byId = new Map(current.map((t) => [t.id, t]));
  for (const trade of incoming) {
    byId.set(trade.id, trade);
  }

  const incomingIds = new Set(incoming.map((t) => t.id));
  const mergedIncoming = incoming.map((t) => byId.get(t.id)!);
  const leftovers = current.filter((t) => !incomingIds.has(t.id));
  return [...mergedIncoming, ...leftovers];
}
