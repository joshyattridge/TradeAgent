/**
 * @vitest-environment jsdom
 */
import "fake-indexeddb/auto";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import CalculatorPage from "@/app/calculator/page";
import { CALCULATOR_SYMBOLS, DEFAULT_CALCULATOR_DRAFT } from "@/lib/position-size";
import { useTradingStore } from "@/lib/store";
import { seedStrategy } from "@/lib/seed-data";
import type { Trade } from "@/lib/types";

function sampleTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    date: "2026-07-01",
    symbol: "EURUSD",
    side: "long",
    entry: 1.1682,
    stop: 1.1658,
    target: 1.173,
    rMultiple: 2,
    result: "win",
    riskUsd: 250,
    ...overrides,
  };
}

function resetStore(overrides: Partial<ReturnType<typeof useTradingStore.getState>> = {}) {
  useTradingStore.setState({
    trades: [sampleTrade()],
    strategy: seedStrategy,
    hydrated: true,
    calculator: { ...DEFAULT_CALCULATOR_DRAFT },
    ...overrides,
  });
}

function setField(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("CalculatorPage", () => {
  beforeEach(() => {
    resetStore();
  });

  it("shows loading state when not hydrated", () => {
    resetStore({ hydrated: false });
    render(<CalculatorPage />);
    expect(screen.getByText("Loading calculator…")).toBeInTheDocument();
  });

  it("prompts for stop size and lists only allowed symbols", () => {
    render(<CalculatorPage />);
    expect(screen.getByRole("heading", { name: "Position size" })).toBeInTheDocument();
    expect(screen.getByText(/Enter stop size/)).toBeInTheDocument();
    expect(screen.getByLabelText("Risk dollars")).toHaveAttribute("placeholder", "250");
    expect(screen.queryByLabelText("Entry")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Target")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Quote")).not.toBeInTheDocument();

    const symbol = screen.getByLabelText("Symbol");
    expect(symbol.tagName).toBe("SELECT");
    const values = [...symbol.querySelectorAll("option")].map((o) => o.value);
    expect(values).toEqual([...CALCULATOR_SYMBOLS]);
    expect(values).not.toContain("EURJPY");
  });

  it("sizes a EURUSD trade from stop pips and risk", () => {
    render(<CalculatorPage />);
    setField("Stop pips", "24");
    setField("Risk dollars", "100");

    expect(screen.getByRole("region", { name: "Position size result" })).toBeInTheDocument();
    expect(screen.getByText("0.42 lots")).toBeInTheDocument();
    expect(screen.getByText("24 pips")).toBeInTheDocument();
    expect(screen.queryByText("2.00R")).not.toBeInTheDocument();
    expect(screen.getByText(/100,000-unit FX lot/)).toBeInTheDocument();
  });

  it("sizes NAS100, gold, and USDJPY from stop size", () => {
    render(<CalculatorPage />);

    setField("Symbol", "NAS100");
    setField("Stop points", "65");
    setField("Risk dollars", "100");
    expect(screen.getByText("1.54 contracts")).toBeInTheDocument();
    expect(screen.getByText("65 points")).toBeInTheDocument();

    setField("Symbol", "XAUUSD");
    setField("Stop dollars", "8.5");
    expect(screen.getByText("$8.50")).toBeInTheDocument();

    setField("Symbol", "USDJPY");
    expect(screen.getByText(/Enter USDJPY quote and stop size/)).toBeInTheDocument();
    setField("Quote", "157.42");
    setField("Stop pips", "24");
    expect(screen.getByText("0.66 lots")).toBeInTheDocument();

    setField("Stop pips", "0");
    expect(screen.getByText(/Stop size must be a number greater than 0/)).toBeInTheDocument();

    setField("Stop pips", "abc");
    expect(screen.getByText(/Enter USDJPY quote and stop size/)).toBeInTheDocument();
  });

  it("keeps calculator inputs after unmounting the page", () => {
    const first = render(<CalculatorPage />);
    setField("Symbol", "GBPUSD");
    setField("Stop pips", "18");
    setField("Risk dollars", "80");
    first.unmount();

    render(<CalculatorPage />);
    expect(screen.getByLabelText("Symbol")).toHaveValue("GBPUSD");
    expect(screen.getByLabelText("Stop pips")).toHaveValue("18");
    expect(screen.getByLabelText("Risk dollars")).toHaveValue("80");
    expect(screen.getByText("0.44 lots")).toBeInTheDocument();
  });
});
