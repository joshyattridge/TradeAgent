/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TradeDetail } from "@/components/TradeDetail";
import type { StrategyChecklistItem, Trade } from "@/lib/types";

const deleteTrade = vi.fn();
const updateTrade = vi.fn();
const setChatReferencedTradeId = vi.fn();

let strategyChecklist: StrategyChecklistItem[] = [];
let storeTrades: Trade[] = [];

vi.mock("@/lib/store", () => ({
  useTradingStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      deleteTrade,
      updateTrade,
      setChatReferencedTradeId,
      strategy: { checklist: strategyChecklist },
      trades: storeTrades,
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
    strategyChecklist = [];
    storeTrades = [];
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
    expect(view.getByAltText("Trade chart 1")).toHaveAttribute(
      "src",
      "https://example.com/chart.png",
    );
  });

  it("renders loss/open/breakeven badges and empty optional fields", async () => {
    const { rerender } = render(
      <TradeDetail
        trade={sampleTrade({
          result: "loss",
          rMultiple: -1,
          pnlUsd: -50,
          session: undefined,
          size: undefined,
          riskUsd: undefined,
          feesUsd: undefined,
          exit: undefined,
          notes: "   ",
          tags: undefined,
          screenshots: undefined,
        })}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("loss")).toHaveClass("badge--loss");
    expect(screen.getByText("-1.0R")).toHaveClass("neg");

    rerender(
      <TradeDetail trade={sampleTrade({ result: "open", rMultiple: 0, pnlUsd: undefined })} onClose={vi.fn()} />,
    );
    expect(await screen.findByText("open")).toHaveClass("badge--open");

    rerender(
      <TradeDetail trade={sampleTrade({ result: "breakeven", rMultiple: 0 })} onClose={vi.fn()} />,
    );
    expect(await screen.findByText("breakeven")).toBeInTheDocument();
  });

  it("closes on backdrop click, close button, and Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { unmount } = render(<TradeDetail trade={sampleTrade()} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector(".trade-detail-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    await user.click(screen.getByRole("button", { name: "Close trade detail" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("requires confirm before deleting", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TradeDetail trade={sampleTrade()} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Delete trade/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Delete trade/i }));
    expect(deleteTrade).not.toHaveBeenCalled();
    expect(screen.getByText("Delete this trade permanently?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Confirm delete/i }));
    expect(deleteTrade).toHaveBeenCalledWith("t1");
    expect(onClose).toHaveBeenCalled();
  });

  it("cancels delete confirmation", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TradeDetail trade={sampleTrade()} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Delete trade/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Delete trade/i }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
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

  it("toggles checklist items done and clears them", async () => {
    const user = userEvent.setup();
    strategyChecklist = [
      { id: "cl-bias", label: "Daily bias" },
      { id: "cl-pd", label: "PD zone" },
    ];
    const trade = sampleTrade({
      checklist: [{ id: "cl-bias", label: "Daily bias", checked: true }],
    });
    storeTrades = [trade];

    render(<TradeDetail trade={trade} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("1/2 done")).toBeInTheDocument();
    });

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();

    await user.click(boxes[1]);
    expect(updateTrade).toHaveBeenCalledWith("t1", {
      checklist: [
        { id: "cl-bias", label: "Daily bias", checked: true },
        { id: "cl-pd", label: "PD zone", checked: true },
      ],
    });

    await user.click(boxes[0]);
    expect(updateTrade).toHaveBeenCalledWith("t1", {
      checklist: [],
    });
  });

  it("checks first item when trade has no checklist yet", async () => {
    const user = userEvent.setup();
    strategyChecklist = [{ id: "cl-bias", label: "Daily bias" }];
    const trade = sampleTrade({ side: "short", checklist: undefined });
    storeTrades = [trade];

    render(<TradeDetail trade={trade} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("short")).toHaveClass("side-short");
    });

    await user.click(screen.getByRole("checkbox"));
    expect(updateTrade).toHaveBeenCalledWith("t1", {
      checklist: [{ id: "cl-bias", label: "Daily bias", checked: true }],
    });
  });

  it("uses live store trade when present for checklist state", async () => {
    strategyChecklist = [{ id: "cl-bias", label: "Daily bias" }];
    const propTrade = sampleTrade({ checklist: undefined });
    storeTrades = [
      sampleTrade({
        checklist: [{ id: "cl-bias", label: "Daily bias", checked: true }],
      }),
    ];

    render(<TradeDetail trade={propTrade} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("1/1 done")).toBeInTheDocument();
    });
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
});
