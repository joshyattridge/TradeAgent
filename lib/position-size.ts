import {
  calculateLotSize,
  instrumentConfigs,
} from "@jsr/neabyte__forex-calculator";
import { normalizeSymbol } from "@/lib/chat-context";

export const DEFAULT_POSITION_RISK_USD = 100;
export const DEFAULT_POSITION_LEVERAGE = 100;

export function defaultRiskUsd(trades: { riskUsd?: number }[]): number {
  for (let i = trades.length - 1; i >= 0; i--) {
    const r = trades[i]?.riskUsd;
    if (typeof r === "number" && Number.isFinite(r) && r > 0) return r;
  }
  return DEFAULT_POSITION_RISK_USD;
}

type InstrumentConfig = {
  type: "FOREX" | "METAL" | "INDEX" | "CRYPTO";
  contractSize: number;
  pipSize: number;
};

const SPECS = instrumentConfigs as Record<string, InstrumentConfig>;

const SYMBOL_ALIASES: Record<string, string> = {
  GOLD: "XAUUSD",
  XAU: "XAUUSD",
  SILVER: "XAGUSD",
  XAG: "XAGUSD",
  US100: "NAS100",
  USTEC: "NAS100",
  NASDAQ: "NAS100",
  NASDAQ100: "NAS100",
  NDX: "NAS100",
  NQ: "NAS100",
  US500: "SPX500",
  SPX: "SPX500",
  SP500: "SPX500",
  ES: "SPX500",
  DJI: "US30",
  DJ30: "US30",
  YM: "US30",
  GER: "GER40",
  DAX: "GER40",
  DE40: "GER40",
  BTC: "BTCUSD",
  BITCOIN: "BTCUSD",
  ETH: "ETHUSD",
};

export const SUPPORTED_POSITION_SYMBOLS = Object.keys(SPECS).sort();

/** Pairs the calculator page offers — USD-account sizes that do not need a live FX feed. */
export const CALCULATOR_SYMBOLS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "USDCAD",
  "USDCHF",
  "XAUUSD",
  "NAS100",
] as const;

export const CALCULATOR_SYMBOL_LABELS: Record<
  (typeof CALCULATOR_SYMBOLS)[number],
  string
> = {
  EURUSD: "EURUSD",
  GBPUSD: "GBPUSD",
  USDJPY: "USDJPY",
  USDCAD: "USDCAD",
  USDCHF: "USDCHF",
  XAUUSD: "XAUUSD (gold)",
  NAS100: "NAS100 ($1/point CFD)",
};

export type CalculatorSymbol = (typeof CALCULATOR_SYMBOLS)[number];

export type CalculatorDraft = {
  symbol: CalculatorSymbol;
  slSize: string;
  quote: string;
  risk: string;
};

export const DEFAULT_CALCULATOR_DRAFT: CalculatorDraft = {
  symbol: "EURUSD",
  slSize: "",
  quote: "",
  risk: "",
};

export function isCalculatorSymbol(value: string): value is CalculatorSymbol {
  return (CALCULATOR_SYMBOLS as readonly string[]).includes(value);
}

export function normalizeCalculatorDraft(raw: unknown): CalculatorDraft {
  const d = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    symbol:
      typeof d.symbol === "string" && isCalculatorSymbol(d.symbol)
        ? d.symbol
        : DEFAULT_CALCULATOR_DRAFT.symbol,
    slSize: typeof d.slSize === "string" ? d.slSize : "",
    quote: typeof d.quote === "string" ? d.quote : "",
    risk: typeof d.risk === "string" ? d.risk : "",
  };
}

export type CalculatorStopUnit = "pips" | "points" | "price";

export function calculatorStopUnit(symbol: string): CalculatorStopUnit {
  const spec = SPECS[symbol];
  if (spec?.type === "INDEX" || spec?.type === "CRYPTO") return "points";
  if (spec?.type === "METAL") return "price";
  return "pips";
}

export function calculatorStopField(symbol: string): {
  label: string;
  ariaLabel: string;
} {
  const unit = calculatorStopUnit(symbol);
  if (unit === "points") return { label: "Stop (points)", ariaLabel: "Stop points" };
  if (unit === "price") return { label: "Stop ($)", ariaLabel: "Stop dollars" };
  return { label: "Stop (pips)", ariaLabel: "Stop pips" };
}

/** USDXXX FX pairs need the current quote to convert pip value into dollars. */
export function needsConversionQuote(symbol: string): boolean {
  return SPECS[symbol]?.type === "FOREX" && symbol.startsWith("USD");
}

/** Page SL size → library stopPoints (gold uses price dollars, not 0.1 pips). */
export function slSizeToStopPips(symbol: string, slSize: number): number {
  const spec = SPECS[symbol];
  if (spec?.type === "METAL") return slSize / spec.pipSize;
  return slSize;
}

export type PositionSizeInput = {
  symbol: string;
  riskUsd: number;
  entry?: number;
  stop?: number;
  /** Stop distance in library pips/points. Alternative to entry+stop prices. */
  stopPips?: number;
  target?: number;
  /** $ per 1.0 price unit per lot/contract. Overrides the library spec. */
  pointValueUsd?: number;
  leverage?: number;
};

export type PositionSizeOk = {
  ok: true;
  action: "calculate_position_size";
  symbol: string;
  resolvedSymbol: string;
  instrumentType: InstrumentConfig["type"] | "CUSTOM";
  lots: number;
  lotsRounded: number;
  sizeLabel: string;
  sizeUnit: "lots" | "contracts";
  units: number;
  pipValue: number;
  stopDistance: number;
  stopPips: number;
  riskUsd: number;
  potentialLossRounded: number;
  margin: number;
  leverage: string;
  plannedRr: number | null;
  notes: string[];
};

export type PositionSizeErr = {
  ok: false;
  action: "calculate_position_size";
  error: string;
};

export type PositionSizeResult = PositionSizeOk | PositionSizeErr;

export function resolvePositionSymbol(raw: string): {
  symbol: string;
  aliasNote?: string;
} {
  const cleaned = normalizeSymbol(raw);
  const mapped = SYMBOL_ALIASES[cleaned] ?? cleaned;
  if (!cleaned) return { symbol: "" };
  if (cleaned === "NQ") {
    return {
      symbol: mapped,
      aliasNote:
        "NQ is sized as NAS100 CFD at $1/point, not CME NQ ($20/point). Pass pointValueUsd if your broker differs.",
    };
  }
  if (cleaned !== mapped) {
    return { symbol: mapped, aliasNote: `${cleaned} is treated as ${mapped}.` };
  }
  return { symbol: mapped };
}

export function isKnownPositionSymbol(symbol: string): boolean {
  return Object.prototype.hasOwnProperty.call(SPECS, symbol);
}

function roundLots(lots: number): number {
  return Math.round(lots * 100) / 100;
}

function sizeUnitFor(
  type: PositionSizeOk["instrumentType"],
): PositionSizeOk["sizeUnit"] {
  return type === "INDEX" || type === "CRYPTO" ? "contracts" : "lots";
}

function formatSizeLabel(lotsRounded: number, unit: PositionSizeOk["sizeUnit"]): string {
  const digits = lotsRounded >= 0.01 ? 2 : 4;
  return `${lotsRounded.toFixed(digits)} ${unit}`;
}

function plannedRr(entry: number, stop: number, target?: number): number | null {
  if (target == null || !Number.isFinite(target)) return null;
  return Math.abs(target - entry) / Math.abs(entry - stop);
}

function specNote(symbol: string, type: PositionSizeOk["instrumentType"]): string {
  if (type === "METAL") {
    return `${symbol} assumes a standard 100oz gold / 5,000oz silver lot. Override $ per point if your broker uses a mini contract.`;
  }
  if (type === "INDEX") {
    return `${symbol} assumes $1 per point per contract (typical retail CFD, not futures). Override $ per point if your broker differs.`;
  }
  if (type === "CRYPTO") {
    return `${symbol} assumes 1 coin per lot. Override $ per point if your broker's contract size differs.`;
  }
  if (type === "CUSTOM") {
    return "Sized with your $ per point override, not a library contract spec.";
  }
  return `${symbol} uses a standard 100,000-unit FX lot via @neabyte/forex-calculator.`;
}

function fail(error: string): PositionSizeErr {
  return { ok: false, action: "calculate_position_size", error };
}

function dummyOpenPrice(stopDistance: number, pipSize: number): number {
  return Math.max(stopDistance * 2, pipSize * 10_000, 1);
}

function pricesFromStopPips(
  symbol: string,
  stopPips: number,
  quote: number | undefined,
  spec: InstrumentConfig | undefined,
): { entry: number; stop: number } | { error: string } {
  const pipSize = spec?.pipSize ?? 1;
  const stopDistance = stopPips * pipSize;
  const needsQuote = spec?.type === "FOREX" && symbol.startsWith("USD");
  let entry: number;
  if (needsQuote) {
    if (quote == null || quote <= 0) {
      return {
        error: `${symbol} pip value in $ depends on the current ${symbol} price.`,
      };
    }
    entry = quote;
  } else {
    entry = quote != null && quote > 0 ? quote : dummyOpenPrice(stopDistance, pipSize);
  }
  let stop = entry - stopDistance;
  if (stop <= 0) stop = entry + stopDistance;
  return { entry, stop };
}

function resolveEntryStop(
  input: PositionSizeInput,
  symbol: string,
): { entry: number; stop: number; synthesized: boolean } | { error: string } {
  const spec = isKnownPositionSymbol(symbol) ? SPECS[symbol] : undefined;
  const entryIn = input.entry;
  const stopIn = input.stop;
  const stopPipsIn = input.stopPips;
  const hasEntry = Number.isFinite(entryIn);
  const hasStop = Number.isFinite(stopIn);
  const hasStopPips = Number.isFinite(stopPipsIn);

  if (hasEntry && hasStop) {
    if (entryIn! <= 0) return { error: "Entry must be a price greater than 0." };
    if (stopIn === entryIn) return { error: "Stop cannot equal entry." };
    return { entry: entryIn!, stop: stopIn!, synthesized: false };
  }

  if (stopPipsIn != null && !hasStopPips) {
    return { error: "Stop size must be a number greater than 0." };
  }

  if (hasStopPips) {
    if (stopPipsIn! <= 0) {
      return { error: "Stop size must be a number greater than 0." };
    }
    const quote = hasEntry ? entryIn : undefined;
    const prices = pricesFromStopPips(symbol, stopPipsIn!, quote, spec);
    if ("error" in prices) return prices;
    return { ...prices, synthesized: true };
  }

  if (entryIn != null && !hasEntry) {
    return { error: "Entry must be a price greater than 0." };
  }
  if (hasEntry && entryIn! <= 0) {
    return { error: "Entry must be a price greater than 0." };
  }
  if (hasEntry && !hasStop) {
    return { error: "Stop must be a valid price." };
  }
  if (stopIn != null && !hasStop) {
    return { error: "Stop must be a valid price." };
  }
  return { error: "Provide entry and stop prices, or a stop size in pips/points." };
}

export function calculatePositionSize(input: PositionSizeInput): PositionSizeResult {
  const symbolRaw = (input.symbol ?? "").trim();
  if (!symbolRaw) return fail("Provide a symbol (e.g. EURUSD, XAUUSD, NAS100).");

  const { symbol, aliasNote } = resolvePositionSymbol(symbolRaw);
  if (!symbol) return fail("Provide a symbol (e.g. EURUSD, XAUUSD, NAS100).");

  const riskUsd = input.riskUsd;
  if (!Number.isFinite(riskUsd) || riskUsd <= 0) {
    return fail("Risk must be a dollar amount greater than 0.");
  }

  const resolved = resolveEntryStop(input, symbol);
  if ("error" in resolved) return fail(resolved.error);
  const { entry, stop, synthesized } = resolved;

  const leverageRaw = input.leverage;
  const leverage =
    leverageRaw == null || !Number.isFinite(leverageRaw) || leverageRaw <= 0
      ? DEFAULT_POSITION_LEVERAGE
      : leverageRaw;

  const pointValueUsd = input.pointValueUsd;
  const hasOverride =
    pointValueUsd != null && Number.isFinite(pointValueUsd) && pointValueUsd > 0;
  if (pointValueUsd != null && !hasOverride) {
    return fail("$ per point must be greater than 0 when provided.");
  }

  const known = isKnownPositionSymbol(symbol);
  if (!known && !hasOverride) {
    return fail(
      `Unknown symbol ${symbol}. Use a supported pair (${SUPPORTED_POSITION_SYMBOLS.slice(0, 8).join(", ")}, …) or pass pointValueUsd for your broker's contract.`,
    );
  }

  const notes: string[] = [];
  if (aliasNote) notes.push(aliasNote);

  if (hasOverride) {
    const stopDistance = Math.abs(entry - stop);
    const lots = riskUsd / (stopDistance * pointValueUsd);
    const spec = known ? SPECS[symbol] : undefined;
    const type = spec?.type ?? "CUSTOM";
    const pipSize = spec?.pipSize ?? 1;
    const unit = sizeUnitFor(type);
    const lotsRounded = roundLots(lots);
    const potentialLossRounded = lotsRounded * stopDistance * pointValueUsd;
    notes.push(specNote(symbol, type));
    return {
      ok: true,
      action: "calculate_position_size",
      symbol: symbolRaw,
      resolvedSymbol: symbol,
      instrumentType: type,
      lots,
      lotsRounded,
      sizeLabel: formatSizeLabel(lotsRounded, unit),
      sizeUnit: unit,
      units: lots * (spec?.contractSize ?? 1),
      pipValue: lots * pointValueUsd * pipSize,
      stopDistance,
      stopPips: Number((stopDistance / pipSize).toFixed(1)),
      riskUsd,
      potentialLossRounded: Number(potentialLossRounded.toFixed(2)),
      margin: Number(((entry * lots * (spec?.contractSize ?? 1)) / leverage).toFixed(2)),
      leverage: `1:${leverage}`,
      plannedRr: synthesized ? null : plannedRr(entry, stop, input.target),
      notes,
    };
  }

  let raw;
  try {
    raw = calculateLotSize({
      pairName: symbol,
      openPrice: entry,
      stopPrice: stop,
      leverage,
      riskUSD: riskUsd,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Position size calculation failed.";
    return fail(message);
  }

  const spec = SPECS[symbol]!;
  const unit = sizeUnitFor(spec.type);
  const lotsRounded = roundLots(raw.position.lot);
  const pipPerLot = spec.contractSize * spec.pipSize;
  const pipValuePerLot =
    symbol.startsWith("USD") && spec.type === "FOREX" ? pipPerLot / entry : pipPerLot;
  const potentialLossRounded = lotsRounded * raw.risk.stopPoints * pipValuePerLot;
  notes.push(specNote(symbol, spec.type));

  return {
    ok: true,
    action: "calculate_position_size",
    symbol: symbolRaw,
    resolvedSymbol: symbol,
    instrumentType: spec.type,
    lots: raw.position.lot,
    lotsRounded,
    sizeLabel: formatSizeLabel(lotsRounded, unit),
    sizeUnit: unit,
    units: raw.position.units,
    pipValue: raw.position.pipValue,
    stopDistance: raw.risk.stopDistance,
    stopPips: raw.risk.stopPoints,
    riskUsd,
    potentialLossRounded: Number(potentialLossRounded.toFixed(2)),
    margin: raw.margin.required,
    leverage: raw.margin.leverage,
    plannedRr: synthesized ? null : plannedRr(entry, stop, input.target),
    notes,
  };
}
