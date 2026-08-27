import { describe, expect, it } from "vitest";
import {
  CALCULATOR_SYMBOLS,
  DEFAULT_CALCULATOR_DRAFT,
  DEFAULT_POSITION_RISK_USD,
  calculatePositionSize,
  calculatorStopField,
  calculatorStopUnit,
  defaultRiskUsd,
  isKnownPositionSymbol,
  needsConversionQuote,
  normalizeCalculatorDraft,
  resolvePositionSymbol,
  slSizeToStopPips,
} from "@/lib/position-size";

describe("resolvePositionSymbol", () => {
  it("normalizes punctuation and maps aliases", () => {
    expect(resolvePositionSymbol("eur/usd")).toEqual({ symbol: "EURUSD" });
    expect(resolvePositionSymbol("gold")).toEqual({
      symbol: "XAUUSD",
      aliasNote: "GOLD is treated as XAUUSD.",
    });
    expect(resolvePositionSymbol("nq").aliasNote).toMatch(/NAS100 CFD/);
    expect(resolvePositionSymbol("   ")).toEqual({ symbol: "" });
  });
});

describe("defaultRiskUsd", () => {
  it("uses the latest positive risk and falls back to $100", () => {
    expect(defaultRiskUsd([])).toBe(DEFAULT_POSITION_RISK_USD);
    expect(defaultRiskUsd([{ riskUsd: 0 }, { riskUsd: -10 }])).toBe(100);
    expect(defaultRiskUsd([{ riskUsd: 80 }, { riskUsd: 125 }])).toBe(125);
  });
});

describe("isKnownPositionSymbol", () => {
  it("recognizes library specs only", () => {
    expect(isKnownPositionSymbol("EURUSD")).toBe(true);
    expect(isKnownPositionSymbol("FOOBAR")).toBe(false);
  });

  it("keeps the calculator allowlist inside known specs", () => {
    expect(CALCULATOR_SYMBOLS.every(isKnownPositionSymbol)).toBe(true);
    expect(CALCULATOR_SYMBOLS).not.toContain("EURJPY");
  });
});

describe("calculator stop helpers", () => {
  it("labels stop size by instrument and converts gold dollars to pips", () => {
    expect(calculatorStopUnit("EURUSD")).toBe("pips");
    expect(calculatorStopUnit("NAS100")).toBe("points");
    expect(calculatorStopUnit("BTCUSD")).toBe("points");
    expect(calculatorStopUnit("XAUUSD")).toBe("price");
    expect(calculatorStopUnit("FOOBAR")).toBe("pips");
    expect(calculatorStopField("EURUSD").ariaLabel).toBe("Stop pips");
    expect(calculatorStopField("NAS100").ariaLabel).toBe("Stop points");
    expect(calculatorStopField("XAUUSD").ariaLabel).toBe("Stop dollars");
    expect(needsConversionQuote("USDJPY")).toBe(true);
    expect(needsConversionQuote("EURUSD")).toBe(false);
    expect(slSizeToStopPips("EURUSD", 24)).toBe(24);
    expect(slSizeToStopPips("NAS100", 65)).toBe(65);
    expect(slSizeToStopPips("XAUUSD", 8.5)).toBe(85);
  });

  it("normalizes calculator drafts and rejects unknown symbols", () => {
    expect(normalizeCalculatorDraft(undefined)).toEqual(DEFAULT_CALCULATOR_DRAFT);
    expect(normalizeCalculatorDraft(null)).toEqual(DEFAULT_CALCULATOR_DRAFT);
    expect(normalizeCalculatorDraft("nope")).toEqual(DEFAULT_CALCULATOR_DRAFT);
    expect(
      normalizeCalculatorDraft({
        symbol: "NAS100",
        slSize: "65",
        quote: "20485",
        risk: "100",
      }),
    ).toEqual({
      symbol: "NAS100",
      slSize: "65",
      quote: "20485",
      risk: "100",
    });
    expect(normalizeCalculatorDraft({ symbol: "EURJPY" }).symbol).toBe("EURUSD");
    expect(normalizeCalculatorDraft({ symbol: 1, slSize: 24, quote: null, risk: true })).toEqual(
      DEFAULT_CALCULATOR_DRAFT,
    );
  });
});

describe("calculatePositionSize", () => {
  it("sizes EURUSD from $ risk and stop distance", () => {
    const res = calculatePositionSize({
      symbol: "EURUSD",
      entry: 1.1682,
      stop: 1.1658,
      riskUsd: 100,
      target: 1.173,
      leverage: 100,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.sizeLabel).toBe("0.42 lots");
    expect(res.stopPips).toBe(24);
    expect(res.plannedRr).toBeCloseTo(2, 5);
    expect(res.instrumentType).toBe("FOREX");
    expect(res.notes.some((n) => n.includes("100,000-unit"))).toBe(true);
  });

  it("sizes USDJPY using the entry quote and gold/index defaults", () => {
    const jpy = calculatePositionSize({
      symbol: "USDJPY",
      entry: 157.42,
      stop: 157.18,
      riskUsd: 100,
    });
    expect(jpy.ok).toBe(true);
    if (jpy.ok) expect(jpy.lots).toBeGreaterThan(0.6);

    const gold = calculatePositionSize({
      symbol: "XAUUSD",
      entry: 2384.5,
      stop: 2376,
      riskUsd: 100,
    });
    expect(gold.ok).toBe(true);
    if (gold.ok) {
      expect(gold.sizeUnit).toBe("lots");
      expect(gold.notes.some((n) => n.includes("100oz"))).toBe(true);
    }

    const nas = calculatePositionSize({
      symbol: "NAS100",
      entry: 20485,
      stop: 20420,
      riskUsd: 100,
    });
    expect(nas.ok).toBe(true);
    if (nas.ok) {
      expect(nas.sizeUnit).toBe("contracts");
      expect(nas.sizeLabel).toMatch(/contracts/);
      expect(nas.notes.some((n) => n.includes("$1 per point"))).toBe(true);
    }

    const btc = calculatePositionSize({
      symbol: "BTC",
      entry: 65000,
      stop: 64000,
      riskUsd: 100,
    });
    expect(btc.ok).toBe(true);
    if (btc.ok) {
      expect(btc.resolvedSymbol).toBe("BTCUSD");
      expect(btc.notes.some((n) => n.includes("1 coin"))).toBe(true);
    }
  });

  it("honors a $ per point override on known and unknown symbols", () => {
    const known = calculatePositionSize({
      symbol: "NAS100",
      entry: 20000,
      stop: 19900,
      riskUsd: 100,
      pointValueUsd: 2,
    });
    expect(known.ok).toBe(true);
    if (known.ok) {
      expect(known.lots).toBeCloseTo(0.5, 5);
      expect(known.sizeLabel).toBe("0.50 contracts");
    }

    const custom = calculatePositionSize({
      symbol: "MYINDEX",
      entry: 100,
      stop: 90,
      riskUsd: 50,
      pointValueUsd: 5,
    });
    expect(custom.ok).toBe(true);
    if (custom.ok) {
      expect(custom.instrumentType).toBe("CUSTOM");
      expect(custom.notes.some((n) => n.includes("override"))).toBe(true);
      expect(custom.lots).toBeCloseTo(1, 5);
    }
  });

  it("formats sub-0.01 sizes with extra decimals", () => {
    const res = calculatePositionSize({
      symbol: "XAUUSD",
      entry: 2000,
      stop: 1000,
      riskUsd: 1,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.sizeLabel).toMatch(/0\.00/);
  });

  it("rejects invalid inputs", () => {
    expect(calculatePositionSize({ symbol: "", entry: 1, stop: 0.9, riskUsd: 100 }).error).toMatch(
      /symbol/i,
    );
    expect(
      calculatePositionSize({
        symbol: undefined as unknown as string,
        entry: 1,
        stop: 0.9,
        riskUsd: 100,
      }).error,
    ).toMatch(/symbol/i);
    expect(calculatePositionSize({ symbol: "!!!", entry: 1, stop: 0.9, riskUsd: 100 }).error).toMatch(
      /symbol/i,
    );
    expect(calculatePositionSize({ symbol: "EURUSD", entry: 0, stop: 1, riskUsd: 100 }).error).toMatch(
      /Entry/,
    );
    expect(
      calculatePositionSize({ symbol: "EURUSD", entry: Number.NaN, stop: 1, riskUsd: 100 }).error,
    ).toMatch(/Entry/);
    expect(
      calculatePositionSize({ symbol: "EURUSD", entry: 1.1, stop: Number.NaN, riskUsd: 100 }).error,
    ).toMatch(/Stop/);
    expect(
      calculatePositionSize({ symbol: "EURUSD", entry: 1.1, stop: 1.1, riskUsd: 100 }).error,
    ).toMatch(/equal/);
    expect(
      calculatePositionSize({ symbol: "EURUSD", entry: 1.1, stop: 1.09, riskUsd: 0 }).error,
    ).toMatch(/Risk/);
    expect(
      calculatePositionSize({
        symbol: "FOOBAR",
        entry: 1,
        stop: 0.9,
        riskUsd: 100,
      }).error,
    ).toMatch(/Unknown symbol/);
    expect(
      calculatePositionSize({
        symbol: "EURUSD",
        entry: 1.1,
        stop: 1.09,
        riskUsd: 100,
        pointValueUsd: 0,
      }).error,
    ).toMatch(/per point/);
    expect(
      calculatePositionSize({
        symbol: "EURUSD",
        entry: 1.1,
        stop: 1.09,
        riskUsd: 100,
        pointValueUsd: Number.NaN,
      }).error,
    ).toMatch(/per point/);
    expect(
      calculatePositionSize({
        symbol: "EURUSD",
        riskUsd: 100,
      }).error,
    ).toMatch(/stop size/i);
    expect(
      calculatePositionSize({
        symbol: "EURUSD",
        entry: 1.1,
        riskUsd: 100,
      }).error,
    ).toMatch(/Stop/);
    expect(
      calculatePositionSize({
        symbol: "EURUSD",
        stop: Number.NaN,
        riskUsd: 100,
      }).error,
    ).toMatch(/Stop/);
    expect(
      calculatePositionSize({
        symbol: "EURUSD",
        entry: 0,
        riskUsd: 100,
      }).error,
    ).toMatch(/Entry/);
    expect(
      calculatePositionSize({
        symbol: "EURUSD",
        stopPips: Number.NaN,
        riskUsd: 100,
      }).error,
    ).toMatch(/Stop size/);
    expect(
      calculatePositionSize({
        symbol: "EURUSD",
        stopPips: 0,
        riskUsd: 100,
      }).error,
    ).toMatch(/Stop size/);
    expect(
      calculatePositionSize({
        symbol: "USDJPY",
        stopPips: 24,
        riskUsd: 100,
      }).error,
    ).toMatch(/USDJPY/);
    expect(
      calculatePositionSize({
        symbol: "USDJPY",
        stopPips: 24,
        entry: 0,
        riskUsd: 100,
      }).error,
    ).toMatch(/USDJPY/);
  });

  it("defaults invalid leverage and omits planned RR without a target", () => {
    const res = calculatePositionSize({
      symbol: "EURUSD",
      entry: 1.2,
      stop: 1.19,
      riskUsd: 100,
      leverage: 0,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.leverage).toBe("1:100");
      expect(res.plannedRr).toBeNull();
    }

    const nanLeverage = calculatePositionSize({
      symbol: "EURUSD",
      entry: 1.2,
      stop: 1.19,
      riskUsd: 100,
      leverage: Number.NaN,
    });
    expect(nanLeverage.ok).toBe(true);
    if (nanLeverage.ok) expect(nanLeverage.leverage).toBe("1:100");

    const infiniteTarget = calculatePositionSize({
      symbol: "EURUSD",
      entry: 1.1,
      stop: 1.09,
      riskUsd: 100,
      target: Number.POSITIVE_INFINITY,
    });
    expect(infiniteTarget.ok).toBe(true);
    if (infiniteTarget.ok) expect(infiniteTarget.plannedRr).toBeNull();
  });

  it("sizes from stopPips without entry/stop prices", () => {
    const eurusd = calculatePositionSize({
      symbol: "EURUSD",
      stopPips: 24,
      riskUsd: 100,
      target: 1.2,
    });
    expect(eurusd.ok).toBe(true);
    if (eurusd.ok) {
      expect(eurusd.sizeLabel).toBe("0.42 lots");
      expect(eurusd.stopPips).toBe(24);
      expect(eurusd.plannedRr).toBeNull();
    }

    const withQuote = calculatePositionSize({
      symbol: "EURUSD",
      stopPips: 24,
      entry: 1.1682,
      riskUsd: 100,
    });
    expect(withQuote.ok).toBe(true);
    if (withQuote.ok) expect(withQuote.sizeLabel).toBe("0.42 lots");

    const dummyWhenQuoteZero = calculatePositionSize({
      symbol: "EURUSD",
      stopPips: 24,
      entry: 0,
      riskUsd: 100,
    });
    expect(dummyWhenQuoteZero.ok).toBe(true);
    if (dummyWhenQuoteZero.ok) expect(dummyWhenQuoteZero.sizeLabel).toBe("0.42 lots");

    const pricesWin = calculatePositionSize({
      symbol: "EURUSD",
      entry: 1.1682,
      stop: 1.1658,
      stopPips: 10,
      riskUsd: 100,
    });
    expect(pricesWin.ok).toBe(true);
    if (pricesWin.ok) expect(pricesWin.stopPips).toBe(24);

    const jpy = calculatePositionSize({
      symbol: "USDJPY",
      stopPips: 24,
      entry: 157.42,
      riskUsd: 100,
    });
    expect(jpy.ok).toBe(true);
    if (jpy.ok) expect(jpy.lots).toBeGreaterThan(0.6);

    const flipped = calculatePositionSize({
      symbol: "USDJPY",
      stopPips: 24,
      entry: 0.05,
      riskUsd: 100,
    });
    expect(flipped.ok).toBe(true);
    if (flipped.ok) expect(flipped.lots).toBeGreaterThan(0);

    const gold = calculatePositionSize({
      symbol: "XAUUSD",
      stopPips: 85,
      riskUsd: 100,
    });
    expect(gold.ok).toBe(true);
    if (gold.ok) expect(gold.stopDistance).toBeCloseTo(8.5, 5);

    const override = calculatePositionSize({
      symbol: "MYINDEX",
      stopPips: 10,
      riskUsd: 50,
      pointValueUsd: 5,
      target: 1,
    });
    expect(override.ok).toBe(true);
    if (override.ok) {
      expect(override.lots).toBeCloseTo(1, 5);
      expect(override.plannedRr).toBeNull();
    }
  });
});
