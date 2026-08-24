/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PnlCalendar } from "@/components/PnlCalendar";
import type { Trade } from "@/lib/types";

function makeTrade(overrides: Partial<Trade> & Pick<Trade, "id" | "date">): Trade {
  return {
    symbol: "EURUSD",
    side: "long",
    entry: 1.1,
    stop: 1.09,
    target: 1.12,
    rMultiple: 1,
    result: "win",
    pnlUsd: 100,
    feesUsd: 0,
    ...overrides,
  };
}

describe("PnlCalendar", () => {
  const now = new Date(2026, 7, 2); // Aug 2, 2026

  it("renders last 30 days heading and weekday grid", () => {
    render(
      <PnlCalendar
        trades={[makeTrade({ id: "1", date: "2026-07-20", rMultiple: 1.5, pnlUsd: 150 })]}
        now={now}
      />,
    );

    expect(screen.getByTestId("pnl-calendar")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Last 30 days" })).toBeInTheDocument();
    expect(screen.getByText("Daily $ — green when profitable, red when not")).toBeInTheDocument();
    expect(screen.getByLabelText("Jul 20: +$150")).toBeInTheDocument();
  });

  it("shows USD amounts for wins and losses", () => {
    render(
      <PnlCalendar
        trades={[
          makeTrade({ id: "w", date: "2026-07-20", rMultiple: 2, pnlUsd: 200 }),
          makeTrade({ id: "l", date: "2026-07-21", rMultiple: -0.5, result: "loss", pnlUsd: -50.5 }),
        ]}
        now={now}
      />,
    );

    expect(screen.getByLabelText("Jul 20: +$200")).toBeInTheDocument();
    expect(screen.getByLabelText("Jul 21: $-50.50")).toBeInTheDocument();
  });
});
