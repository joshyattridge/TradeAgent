/**
 * @vitest-environment jsdom
 */
import "fake-indexeddb/auto";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/page";
import { seedTrades } from "@/lib/seed-data";
import { useTradingStore } from "@/lib/store";

vi.mock("@/components/ChartRenderer", () => ({
  ChartRenderer: ({ chart }: { chart: { id: string; title?: string } }) => (
    <div data-testid={`chart-${chart.id}`}>{chart.title ?? chart.id}</div>
  ),
}));

function resetStore(overrides: Partial<ReturnType<typeof useTradingStore.getState>> = {}) {
  useTradingStore.setState({
    trades: seedTrades,
    hydrated: true,
    ...overrides,
  });
}

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetStore();
  });

  it("shows loading state when not hydrated", () => {
    resetStore({ hydrated: false });
    render(<DashboardPage />);
    expect(screen.getByText("Loading book…")).toBeInTheDocument();
  });

  it("renders $-only dashboard stats and charts when hydrated", () => {
    render(<DashboardPage />);
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("$ P&L")).toBeInTheDocument();
    expect(screen.getByText("Win rate")).toBeInTheDocument();
    expect(screen.getByText("Avg RR")).toBeInTheDocument();
    expect(screen.getByText("Avg $")).toBeInTheDocument();
    expect(screen.queryByText("Total R")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "R" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "$" })).not.toBeInTheDocument();
    expect(screen.getByTestId("pnl-calendar")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Last 30 days" })).toBeInTheDocument();
    expect(screen.getByText(/cumulative \$/, { exact: false })).toBeInTheDocument();
    expect(screen.getAllByTestId(/^chart-/).length).toBeGreaterThan(0);
  });

  it("colors calendar days by daily $ profit and shows amounts", () => {
    const today = new Date();
    const winDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 5);
    const lossDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 4);
    const toIso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const formatLabel = (d: Date) =>
      d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    resetStore({
      trades: [
        {
          id: "win-day",
          date: toIso(winDate),
          symbol: "EURUSD",
          side: "long",
          setup: "Test",
          entry: 1.1,
          stop: 1.09,
          target: 1.12,
          rMultiple: 2,
          result: "win",
          pnlUsd: 200,
          feesUsd: 0,
        },
        {
          id: "loss-day",
          date: toIso(lossDate),
          symbol: "EURUSD",
          side: "long",
          setup: "Test",
          entry: 1.1,
          stop: 1.09,
          target: 1.12,
          rMultiple: -1,
          result: "loss",
          pnlUsd: -100,
          feesUsd: 0,
        },
      ],
    });

    render(<DashboardPage />);

    expect(screen.getByLabelText(`${formatLabel(winDate)}: +$200`)).toBeInTheDocument();
    expect(screen.getByLabelText(`${formatLabel(lossDate)}: $-100`)).toBeInTheDocument();
  });

  it("shows negative dashboard $ stats", () => {
    resetStore({
      trades: [
        {
          id: "loss-1",
          date: "2026-07-01",
          symbol: "EURUSD",
          side: "long",
          setup: "Test",
          entry: 1.1,
          stop: 1.09,
          target: 1.12,
          rMultiple: -1,
          result: "loss",
          pnlUsd: -100,
          feesUsd: 0,
        },
      ],
    });
    render(<DashboardPage />);
    expect(screen.getAllByText("$-100").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("-1.00R")).toBeInTheDocument();
  });
});
