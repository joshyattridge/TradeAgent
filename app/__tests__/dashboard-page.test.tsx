/**
 * @vitest-environment jsdom
 */
import "fake-indexeddb/auto";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/page";
import { seedTrades } from "@/lib/seed-data";
import { useTradingStore } from "@/lib/store";

vi.mock("@/components/ChartRenderer", () => ({
  ChartRenderer: ({
    chart,
    featured,
  }: {
    chart: { id: string; title?: string };
    featured?: boolean;
  }) => (
    <div
      data-testid={`chart-${chart.id}`}
      data-featured={featured ? "true" : undefined}
    >
      {chart.title ?? chart.id}
    </div>
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
    expect(screen.queryByText("Best / worst")).not.toBeInTheDocument();
    expect(screen.queryByText("Total R")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "R" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "$" })).not.toBeInTheDocument();
    expect(screen.getByTestId("pnl-calendar")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Last 30 days" })).toBeInTheDocument();
    expect(screen.getByText(/cumulative \$/, { exact: false })).toBeInTheDocument();
    expect(screen.getAllByTestId(/^chart-/).length).toBeGreaterThan(0);
    expect(screen.getByText("Losing streak odds")).toBeInTheDocument();
    expect(screen.getByText("Odds of a win soon")).toBeInTheDocument();
    expect(screen.getByText("Monte Carlo equity fan")).toBeInTheDocument();
    expect(screen.getByText("Equity curve ($)")).toBeInTheDocument();
    expect(screen.getByText("Equity curve ($)")).toHaveAttribute(
      "data-featured",
      "true",
    );
    expect(
      screen.getByRole("region", { name: "Sample confidence" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Can you trust these numbers?")).toBeInTheDocument();
    expect(screen.getByText("Too early — this is still noise")).toBeInTheDocument();
    expect(screen.getByText("+$ edge")).toBeInTheDocument();
    expect(screen.getByText("Chance the true average $ is positive")).toBeInTheDocument();
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

    expect(screen.getByLabelText(`${formatLabel(winDate)}: +$200, 1 trade`)).toBeInTheDocument();
    expect(screen.getByLabelText(`${formatLabel(lossDate)}: $-100, 1 trade`)).toBeInTheDocument();
  });

  it("shows negative dashboard $ stats", () => {
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
          pnlUsd: -100,
          feesUsd: 0,
        },
      ],
    });
    render(<DashboardPage />);
    expect(screen.getAllByText("$-100").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Avg $ range needs 2 trades")).toBeInTheDocument();
    expect(screen.getByText("Need 2 closed trades for an edge score")).toBeInTheDocument();
  });

  it("shows an empty-sample banner when there are no closed trades", () => {
    resetStore({ trades: [] });
    render(<DashboardPage />);
    expect(screen.getByText("No closed trades yet")).toBeInTheDocument();
    expect(screen.queryByText("Win rate 0–0%")).not.toBeInTheDocument();
    expect(screen.getByText("Need 2 closed trades for an edge score")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Sample confidence" })).getByText("—"),
    ).toBeInTheDocument();
  });

  it("shows a thin-sample banner once the book is past the tiny-n cutoff", () => {
    resetStore({
      trades: Array.from({ length: 25 }, (_, i) => ({
        id: `thin-${i}`,
        date: "2026-08-01",
        symbol: "EURUSD",
        side: "long" as const,
        entry: 1.1,
        stop: 1.09,
        target: 1.12,
        result: i % 2 === 0 ? ("win" as const) : ("loss" as const),
        pnlUsd: i % 2 === 0 ? 100 : -100,
        feesUsd: 0,
      })),
    });
    render(<DashboardPage />);
    expect(screen.getByText("Early sample — still a lot of noise")).toBeInTheDocument();
  });

  it("shows a readable-sample banner on a large all-win book", () => {
    resetStore({
      trades: Array.from({ length: 50 }, (_, i) => ({
        id: `read-${i}`,
        date: "2026-08-01",
        symbol: "EURUSD",
        side: "long" as const,
        entry: 1.1,
        stop: 1.09,
        target: 1.12,
        result: "win" as const,
        pnlUsd: 20,
        feesUsd: 0,
      })),
    });
    render(<DashboardPage />);
    expect(screen.getByText("Sample is large enough to read")).toBeInTheDocument();
    expect(screen.getByText("Avg $ +$20 to +$20")).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Sample confidence" })).getByText("100%"),
    ).toBeInTheDocument();
  });
});
