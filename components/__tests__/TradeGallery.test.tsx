/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TradeGallery } from "@/components/TradeGallery";
import type { Trade } from "@/lib/types";

vi.mock("@/components/TradeDetail", () => ({
  TradeDetail: ({
    trade,
    onClose,
    onPrev,
    onNext,
    hasPrev,
    hasNext,
    navLabel,
  }: {
    trade: Trade;
    onClose: () => void;
    onPrev?: () => void;
    onNext?: () => void;
    hasPrev?: boolean;
    hasNext?: boolean;
    navLabel?: string;
  }) => (
    <div data-testid="trade-detail">
      <span>{trade.symbol}</span>
      {navLabel ? <span>{navLabel}</span> : null}
      <button type="button" onClick={onClose}>
        Close detail
      </button>
      {onPrev ? (
        <button type="button" onClick={onPrev} disabled={!hasPrev}>
          Previous trade
        </button>
      ) : null}
      {onNext ? (
        <button type="button" onClick={onNext} disabled={!hasNext}>
          Next trade
        </button>
      ) : null}
    </div>
  ),
}));

function trade(overrides: Partial<Trade> & Pick<Trade, "id">): Trade {
  return {
    date: "2026-07-01",
    symbol: "EURUSD",
    side: "long",
    entry: 1.1,
    stop: 1.09,
    target: 1.12,
    rMultiple: 1,
    result: "win",
    ...overrides,
  };
}

const win = trade({
  id: "win-1",
  date: "2026-07-02",
  entryTime: "2026-07-02T09:15:00Z",
  symbol: "EURUSD",
  side: "long",
  result: "win",
  pnlUsd: 120,
  screenshots: ["https://example.com/win-a.png", "https://example.com/win-b.png"],
});

const loss = trade({
  id: "loss-1",
  date: "2026-07-01",
  symbol: "GBPUSD",
  side: "short",
  result: "loss",
  pnlUsd: -80,
  screenshots: ["https://example.com/loss.png"],
});

const noPnl = trade({
  id: "win-2",
  date: "2026-06-30",
  symbol: "USDJPY",
  result: "win",
  screenshots: ["https://example.com/flat.png"],
});

describe("TradeGallery", () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = "";
  });

  beforeEach(() => {
    document.body.style.overflow = "";
  });

  it("shows an empty state when nothing has screenshots", () => {
    render(
      <TradeGallery
        trades={[
          trade({ id: "open", result: "open", screenshots: ["https://x"] }),
          trade({ id: "plain", result: "win" }),
        ]}
      />,
    );
    expect(
      screen.getByText(/No screenshots on winning or losing trades yet/i),
    ).toBeInTheDocument();
  });

  it("filters wins and losses", async () => {
    const user = userEvent.setup();
    render(<TradeGallery trades={[win, loss, noPnl]} />);

    expect(screen.getByRole("radio", { name: /All/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getAllByRole("article")).toHaveLength(4);
    expect(screen.getByText("USDJPY")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Losses/ }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("GBPUSD")).toBeInTheDocument();
    expect(screen.queryByText("EURUSD")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Wins/ }));
    expect(screen.getAllByRole("article")).toHaveLength(3);

    await user.click(screen.getByRole("radio", { name: /All/ }));
    expect(screen.getAllByRole("article")).toHaveLength(4);
  });

  it("shows the winning-only empty copy", async () => {
    const user = userEvent.setup();
    render(<TradeGallery trades={[loss]} />);
    await user.click(screen.getByRole("radio", { name: /Wins/ }));
    expect(screen.getByText("No screenshots on winning trades.")).toBeInTheDocument();
  });

  it("shows the losing-only empty copy", async () => {
    const user = userEvent.setup();
    render(<TradeGallery trades={[win]} />);
    await user.click(screen.getByRole("radio", { name: /Losses/ }));
    expect(screen.getByText("No screenshots on losing trades.")).toBeInTheDocument();
  });

  it("opens a lightbox, walks shots, and restores overflow", async () => {
    const user = userEvent.setup();
    render(<TradeGallery trades={[win, loss]} />);

    await user.click(
      screen.getByRole("button", { name: /View EURUSD long .* chart 1 of 2 full screen/i }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Screenshot" });
    expect(document.body.style.overflow).toBe("hidden");
    expect(within(dialog).getByText(/1 of 2/)).toBeInTheDocument();
    expect(within(dialog).getByText(/1 \/ 3/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next screenshot" }));
    expect(within(dialog).getByText(/2 of 2/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous screenshot" }));
    expect(within(dialog).getByText(/1 of 2/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("img"));
    expect(screen.getByRole("dialog", { name: "Screenshot" })).toBeInTheDocument();

    fireEvent.click(dialog.querySelector(".gallery-lightbox__bar")!);
    expect(screen.getByRole("dialog", { name: "Screenshot" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close screenshot" }));
    expect(screen.queryByRole("dialog", { name: "Screenshot" })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });

  it("closes the lightbox from the backdrop", async () => {
    const user = userEvent.setup();
    render(<TradeGallery trades={[loss]} />);
    await user.click(
      screen.getByRole("button", { name: /View GBPUSD short .* full screen/i }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Screenshot" });
    expect(screen.queryByRole("button", { name: "Next screenshot" })).not.toBeInTheDocument();
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog", { name: "Screenshot" })).not.toBeInTheDocument();
  });

  it("handles lightbox keyboard navigation including no-ops at the ends", async () => {
    const user = userEvent.setup();
    render(<TradeGallery trades={[win, loss]} />);
    await user.click(
      screen.getByRole("button", { name: /View EURUSD long .* chart 1 of 2 full screen/i }),
    );
    await screen.findByRole("dialog", { name: "Screenshot" });

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowLeft", metaKey: true });
    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });
    fireEvent.keyDown(window, { key: "ArrowRight", altKey: true });
    fireEvent.keyDown(window, { key: "a" });
    expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText(/2 \/ 3/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText(/3 \/ 3/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText(/3 \/ 3/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Screenshot" })).not.toBeInTheDocument();
  });

  it("opens trade detail from a card and from the lightbox", async () => {
    const user = userEvent.setup();
    render(<TradeGallery trades={[win, loss]} />);

    await user.click(screen.getAllByRole("button", { name: "Open trade" })[0]);
    expect(screen.getByTestId("trade-detail")).toHaveTextContent("EURUSD");
    expect(screen.getByText("1 of 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next trade" }));
    expect(screen.getByTestId("trade-detail")).toHaveTextContent("GBPUSD");
    await user.click(screen.getByRole("button", { name: "Previous trade" }));
    expect(screen.getByTestId("trade-detail")).toHaveTextContent("EURUSD");
    await user.click(screen.getByRole("button", { name: "Close detail" }));
    expect(screen.queryByTestId("trade-detail")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /View GBPUSD short .* full screen/i }),
    );
    await screen.findByRole("dialog", { name: "Screenshot" });
    await user.click(
      within(screen.getByRole("dialog", { name: "Screenshot" })).getByRole(
        "button",
        { name: "Open trade" },
      ),
    );
    expect(screen.queryByRole("dialog", { name: "Screenshot" })).not.toBeInTheDocument();
    expect(screen.getByTestId("trade-detail")).toHaveTextContent("GBPUSD");
  });

  it("does not add trade-to-trade nav for a single unique trade", async () => {
    const user = userEvent.setup();
    render(<TradeGallery trades={[win]} />);
    await user.click(screen.getAllByRole("button", { name: "Open trade" })[0]);
    expect(screen.getByTestId("trade-detail")).toHaveTextContent("1 of 1");
    expect(screen.queryByRole("button", { name: "Next trade" })).not.toBeInTheDocument();
  });

  it("closes the lightbox when the filter changes", async () => {
    const user = userEvent.setup();
    render(<TradeGallery trades={[win, loss]} />);
    await user.click(
      screen.getByRole("button", { name: /View EURUSD long .* chart 1 of 2 full screen/i }),
    );
    await screen.findByRole("dialog", { name: "Screenshot" });
    await user.click(screen.getByRole("radio", { name: /Losses/ }));
    expect(screen.queryByRole("dialog", { name: "Screenshot" })).not.toBeInTheDocument();
  });

  it("clamps or closes the lightbox when the shot list shrinks", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TradeGallery trades={[win, loss]} />);
    await user.click(
      screen.getByRole("button", { name: /View GBPUSD short .* full screen/i }),
    );
    await screen.findByRole("dialog", { name: "Screenshot" });
    expect(screen.getByText(/3 \/ 3/)).toBeInTheDocument();

    rerender(<TradeGallery trades={[win]} />);
    await waitFor(() => {
      expect(screen.getByText(/2 \/ 2/)).toBeInTheDocument();
    });

    rerender(<TradeGallery trades={[]} />);
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Screenshot" })).not.toBeInTheDocument();
    });
  });
});
