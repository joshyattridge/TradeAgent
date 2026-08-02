/**
 * @vitest-environment jsdom
 */
import "fake-indexeddb/auto";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("renders dashboard stats and charts when hydrated", () => {
    render(<DashboardPage />);
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Total R")).toBeInTheDocument();
    expect(screen.getByText("Win rate")).toBeInTheDocument();
    expect(screen.getByTestId("pnl-calendar")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Last 30 days" })).toBeInTheDocument();
    expect(screen.getAllByTestId(/^chart-/).length).toBeGreaterThan(0);
  });

  it("colors calendar days by daily profit and shows amounts", () => {
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
        },
      ],
    });

    render(<DashboardPage />);

    expect(screen.getByLabelText(`${formatLabel(winDate)}: +2.0R`)).toBeInTheDocument();
    expect(screen.getByLabelText(`${formatLabel(lossDate)}: -1.0R`)).toBeInTheDocument();
  });

  it("toggles between R and $ performance units", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);

    expect(screen.getByText("Total R")).toBeInTheDocument();
    expect(screen.getByText("$ P&L")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "$" }));

    expect(screen.getByText("$ P&L")).toBeInTheDocument();
    expect(screen.getByText("Total R")).toBeInTheDocument();
    expect(screen.getByText("Avg $")).toBeInTheDocument();
    expect(
      screen.getByText(/cumulative \$/, { exact: false }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "R" }));

    expect(screen.getByText("Expectancy")).toBeInTheDocument();
    expect(
      screen.getByText(/cumulative R/, { exact: false }),
    ).toBeInTheDocument();
  });

  it("marks active unit toggle button", async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);

    const rBtn = screen.getByRole("button", { name: "R" });
    const usdBtn = screen.getByRole("button", { name: "$" });

    expect(rBtn).toHaveAttribute("aria-pressed", "true");
    expect(usdBtn).toHaveAttribute("aria-pressed", "false");

    await user.click(usdBtn);

    expect(rBtn).toHaveAttribute("aria-pressed", "false");
    expect(usdBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("shows negative dashboard stats in usd mode", async () => {
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
        },
      ],
    });
    const user = userEvent.setup();
    render(<DashboardPage />);
    await user.click(screen.getByRole("button", { name: "$" }));
    expect(screen.getAllByText("$-100").length).toBeGreaterThanOrEqual(1);
  });
});
