/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TradeDetail } from "@/components/TradeDetail";
import type { Trade } from "@/lib/types";

const deleteTrade = vi.fn();
const setChatReferencedTradeId = vi.fn();

vi.mock("@/lib/store", () => ({
  useTradingStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      deleteTrade,
      setChatReferencedTradeId,
    }),
}));

function sampleTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    date: "2026-07-01",
    symbol: "EURUSD",
    side: "long",
    setup: "1H FVG Continuation",
    entry: 1.1682,
    stop: 1.1658,
    target: 1.173,
    exit: 1.173,
    slPips: 24,
    tpPips: 48,
    entryTime: "2026-07-01T08:42:00Z",
    exitTime: "2026-07-01T12:18:00Z",
    riskUsd: 100,
    pnlUsd: 200,
    feesUsd: 2.4,
    size: "0.40 lots",
    rMultiple: 2.0,
    result: "win",
    notes: "Clean fill",
    session: "London",
    tags: ["A+", "Momentum"],
    screenshots: ["https://example.com/chart.png"],
    ...overrides,
  };
}

describe("TradeDetail", () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = "";
  });

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.style.overflow = "";
  });

  it("returns null until mounted, then portals dialog to body", async () => {
    const onClose = vi.fn();
    render(<TradeDetail trade={sampleTrade()} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(document.body.querySelector(".trade-detail-backdrop")).toBeTruthy();
  });

  it("renders win badge, positive R/P&L, and populated optional fields", async () => {
    render(<TradeDetail trade={sampleTrade()} onClose={vi.fn()} />);

    const dialog = await screen.findByRole("dialog");
    const view = within(dialog);

    expect(view.getByText("win")).toHaveClass("badge--win");
    expect(view.getByText("+2.0R")).toHaveClass("pos");
    expect(view.getByText("London")).toBeInTheDocument();
    expect(view.getByText("0.40 lots")).toBeInTheDocument();
    expect(view.getByText("$100")).toBeInTheDocument();
    expect(view.getByText("Clean fill")).toBeInTheDocument();
    expect(view.getByAltText("Trade chart 1")).toBeInTheDocument();
    expect(view.getByText("A+")).toBeInTheDocument();
  });

  it("renders loss, open, breakeven badges and missing optional fields", async () => {
    const { rerender } = render(
      <TradeDetail
        trade={sampleTrade({
          result: "loss",
          rMultiple: -1,
          pnlUsd: -100,
          side: "short",
          session: undefined,
          size: undefined,
          riskUsd: undefined,
          exit: undefined,
          feesUsd: undefined,
          notes: "  ",
          tags: undefined,
          screenshots: undefined,
        })}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("loss")).toHaveClass("badge--loss");
    });
    expect(screen.getByText("short")).toHaveClass("side-short");
    expect(screen.getByText("-1.0R")).toHaveClass("neg");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("No notes yet.")).toBeInTheDocument();

    rerender(
      <TradeDetail trade={sampleTrade({ result: "open", rMultiple: 0, pnlUsd: undefined })} onClose={vi.fn()} />,
    );
    expect(screen.getByText("open")).toHaveClass("badge--open");

    rerender(
      <TradeDetail trade={sampleTrade({ result: "breakeven", rMultiple: 0 })} onClose={vi.fn()} />,
    );
    expect(screen.getByText("breakeven")).toHaveClass("badge");
  });

  it("locks body overflow and restores on unmount", async () => {
    const prev = "scroll";
    document.body.style.overflow = prev;
    const { unmount } = render(<TradeDetail trade={sampleTrade()} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(document.body.style.overflow).toBe("hidden");
    });

    unmount();
    expect(document.body.style.overflow).toBe(prev);
  });

  it("closes via backdrop, X button, and Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TradeDetail trade={sampleTrade()} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    await user.click(document.body.querySelector(".trade-detail-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    await user.click(screen.getByRole("button", { name: "Close trade detail" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking inside the panel", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TradeDetail trade={sampleTrade()} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("runs delete confirmation flow and resets on trade change", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <TradeDetail trade={sampleTrade({ id: "t1" })} onClose={onClose} />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Delete trade/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Delete trade/i }));
    expect(screen.getByText("Delete this trade permanently?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(screen.queryByText("Delete this trade permanently?")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Delete trade/i }));
    await user.click(screen.getByRole("button", { name: /Confirm delete/i }));
    expect(deleteTrade).toHaveBeenCalledWith("t1");
    expect(onClose).toHaveBeenCalled();

    deleteTrade.mockClear();
    onClose.mockClear();
    rerender(<TradeDetail trade={sampleTrade({ id: "t2" })} onClose={onClose} />);
    expect(screen.queryByText("Delete this trade permanently?")).not.toBeInTheDocument();
  });

  it("references trade in chat and closes", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TradeDetail trade={sampleTrade({ id: "ref-1" })} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Reference in chat/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Reference in chat/i }));
    expect(setChatReferencedTradeId).toHaveBeenCalledWith("ref-1");
    expect(onClose).toHaveBeenCalled();
  });

  it("ignores non-Escape keys", async () => {
    const onClose = vi.fn();
    render(<TradeDetail trade={sampleTrade()} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
