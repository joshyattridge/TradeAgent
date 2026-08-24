/**
 * @vitest-environment jsdom
 */
import "fake-indexeddb/auto";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LogsPage from "@/app/logs/page";
import { seedTrades } from "@/lib/seed-data";
import { computeStats } from "@/lib/stats";
import { formatDuration } from "@/lib/trade-format";
import { useTradingStore } from "@/lib/store";

vi.mock("@/components/TradeTable", () => ({
  TradeTable: ({ trades }: { trades: unknown[] }) => (
    <div data-testid="trade-table">{trades.length} trades</div>
  ),
}));

function resetStore(overrides: Partial<ReturnType<typeof useTradingStore.getState>> = {}) {
  useTradingStore.setState({
    trades: seedTrades,
    hydrated: true,
    ...overrides,
  });
}

describe("LogsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetStore();
  });

  it("shows loading state when not hydrated", () => {
    resetStore({ hydrated: false });
    render(<LogsPage />);
    expect(screen.getByText("Loading logs…")).toBeInTheDocument();
  });

  it("renders stats and trade table when hydrated", () => {
    const trades = seedTrades;
    const stats = computeStats(trades);

    render(<LogsPage />);

    expect(screen.getByRole("heading", { name: "Trading Logs" })).toBeInTheDocument();
    expect(screen.getByText("$ P&L")).toBeInTheDocument();
    expect(screen.getByText("Wins / losses")).toBeInTheDocument();
    expect(screen.getByText("Avg RR")).toBeInTheDocument();
    expect(screen.getByText("Avg time in trade")).toBeInTheDocument();
    expect(screen.queryByText("Best / worst")).not.toBeInTheDocument();

    const pnlSign = stats.totalPnlUsd > 0 ? "+" : "";
    expect(
      screen.getByText(`${pnlSign}$${stats.totalPnlUsd.toFixed(0)}`),
    ).toBeInTheDocument();

    expect(screen.getByText(String(stats.wins))).toBeInTheDocument();
    expect(screen.getByText(String(stats.losses))).toBeInTheDocument();

    const avgMinutes =
      stats.avgTimeInTradeMinutes != null
        ? Math.round(stats.avgTimeInTradeMinutes)
        : undefined;
    expect(screen.getByText(formatDuration(avgMinutes))).toBeInTheDocument();

    expect(screen.queryByText(`${stats.worst.toFixed(1)}R`)).not.toBeInTheDocument();
    expect(screen.getByTestId("trade-table")).toHaveTextContent(
      `${trades.length} trades`,
    );
  });

  it("renders negative pnl without plus sign", () => {
    resetStore({
      trades: [
        {
          id: "loss-1",
          date: "2026-07-01",
          symbol: "EURUSD",
          side: "long",
          entry: 1.1,
          stop: 1.09,
          target: 1.12,
          rMultiple: -1,
          result: "loss",
          pnlUsd: -50,
        },
      ],
    });
    render(<LogsPage />);
    expect(screen.getAllByText("$-50").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps hidden trades in the table while excluding them from stats", () => {
    const visible = seedTrades[0];
    const hidden = { ...seedTrades[1], hidden: true as const };
    resetStore({ trades: [visible, hidden] });
    const stats = computeStats([visible, hidden]);
    render(<LogsPage />);
    expect(screen.getByTestId("trade-table")).toHaveTextContent("2 trades");
    expect(screen.queryByRole("button", { name: /Show hidden/ })).not.toBeInTheDocument();
    expect(screen.getByText(String(stats.wins))).toBeInTheDocument();
    expect(screen.getByText(String(stats.losses))).toBeInTheDocument();
  });
});
