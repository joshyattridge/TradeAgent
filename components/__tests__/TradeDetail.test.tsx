/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TradeDetail } from "@/components/TradeDetail";
import type { StrategyChecklistItem, Trade } from "@/lib/types";

const deleteTrade = vi.fn();
const updateTrade = vi.fn();
const addChatReferencedTradeId = vi.fn();
const hideTrade = vi.fn();
const unhideTrade = vi.fn();

let strategyChecklist: StrategyChecklistItem[] = [];
let storeTrades: Trade[] = [];

vi.mock("@/lib/store", () => ({
  useTradingStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      deleteTrade,
      updateTrade,
      addChatReferencedTradeId,
      hideTrade,
      unhideTrade,
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

  it("renders win badge, P&L, and populated optional fields", async () => {
    render(<TradeDetail trade={sampleTrade()} onClose={vi.fn()} />);

    const dialog = await screen.findByRole("dialog");
    const view = within(dialog);

    expect(view.getByText("win")).toBeInTheDocument();
    expect(view.queryByText("+2.0R")).not.toBeInTheDocument();
    expect(view.queryByText("1H FVG Continuation")).not.toBeInTheDocument();
    expect(view.getByLabelText("Session")).toHaveValue("London");
    expect(view.getByLabelText("Size")).toHaveValue("0.40 lots");
    expect(view.getByLabelText("Risk $")).toHaveValue("100");
    expect(view.getByLabelText("Notes")).toHaveValue("Clean fill");
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

    expect(await screen.findByText("loss")).toBeInTheDocument();
    expect(screen.queryByText("-1.0R")).not.toBeInTheDocument();

    rerender(
      <TradeDetail trade={sampleTrade({ result: "open", rMultiple: 0, pnlUsd: undefined })} onClose={vi.fn()} />,
    );
    expect(await screen.findByDisplayValue("open")).toHaveClass("badge--open");

    rerender(
      <TradeDetail trade={sampleTrade({ result: "breakeven", rMultiple: 0 })} onClose={vi.fn()} />,
    );
    expect(await screen.findByText("breakeven")).toBeInTheDocument();

    rerender(
      <TradeDetail trade={sampleTrade({ result: "missed", pnlUsd: undefined })} onClose={vi.fn()} />,
    );
    expect(await screen.findByDisplayValue("missed")).toHaveClass("badge--missed");
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
    expect(addChatReferencedTradeId).toHaveBeenCalledWith("ref-1");
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
      expect(screen.getByDisplayValue("short")).toBeInTheDocument();
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

  it("saves edited fields on blur and ignores invalid numbers", async () => {
    const user = userEvent.setup();
    render(<TradeDetail trade={sampleTrade()} onClose={vi.fn()} />);
    await screen.findByRole("dialog");

    await user.clear(screen.getByLabelText("Symbol"));
    await user.type(screen.getByLabelText("Symbol"), "GBPUSD");
    await user.tab();
    expect(updateTrade).toHaveBeenCalledWith("t1", { symbol: "GBPUSD" });

    updateTrade.mockClear();
    const pnl = screen.getByLabelText("$ P&L");
    await user.clear(pnl);
    await user.type(pnl, "abc");
    await user.tab();
    expect(updateTrade).not.toHaveBeenCalled();

    await user.clear(pnl);
    await user.type(pnl, "75");
    await user.tab();
    expect(updateTrade).toHaveBeenCalledWith("t1", { pnlUsd: 75 });
  });

  it("opens a screenshot lightbox and closes it from overlay, button, and Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TradeDetail trade={sampleTrade()} onClose={onClose} />);
    await screen.findByRole("dialog", { name: /trade details/i });

    fireEvent.keyDown(window, { key: "Tab" });
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /full screen/i }));
    expect(screen.getByRole("dialog", { name: "Screenshot" })).toBeInTheDocument();

    fireEvent.click(screen.getByAltText("Trade screenshot"));
    expect(screen.getByRole("dialog", { name: "Screenshot" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Screenshot" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /full screen/i }));
    await user.click(screen.getByRole("button", { name: "Close screenshot" }));
    expect(screen.queryByRole("dialog", { name: "Screenshot" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /trade details/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /full screen/i }));
    fireEvent.click(screen.getByRole("dialog", { name: "Screenshot" }));
    expect(screen.queryByRole("dialog", { name: "Screenshot" })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /trade details/i })).toBeInTheDocument();

    fireEvent.click(document.querySelector(".trade-detail-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("edits remaining trade fields, tags, notes, and chat reference", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TradeDetail trade={sampleTrade()} onClose={onClose} />);
    await screen.findByRole("dialog");

    await user.selectOptions(screen.getByLabelText("Side"), "short");
    expect(updateTrade).toHaveBeenCalledWith("t1", { side: "short" });

    await user.selectOptions(screen.getByLabelText("Result"), "loss");
    expect(updateTrade).toHaveBeenCalledWith("t1", { result: "loss" });

    await user.selectOptions(screen.getByLabelText("Result"), "missed");
    expect(updateTrade).toHaveBeenCalledWith("t1", { result: "missed" });

    async function blurChange(label: string, value: string) {
      const el = screen.getByLabelText(label);
      await user.clear(el);
      await user.type(el, value);
      await user.tab();
    }

    await blurChange("Date", "2026-08-01");
    expect(updateTrade).toHaveBeenCalledWith("t1", { date: "2026-08-01" });
    await blurChange("Session", "New York");
    expect(updateTrade).toHaveBeenCalledWith("t1", { session: "New York" });
    await blurChange("Size", "2 lots");
    expect(updateTrade).toHaveBeenCalledWith("t1", { size: "2 lots" });
    await blurChange("Risk $", "50");
    expect(updateTrade).toHaveBeenCalledWith("t1", { riskUsd: 50 });
    await blurChange("Entry", "1.2");
    expect(updateTrade).toHaveBeenCalledWith("t1", { entry: 1.2 });
    await blurChange("Exit", "1.3");
    expect(updateTrade).toHaveBeenCalledWith("t1", { exit: 1.3 });
    await blurChange("SL", "1.19");
    expect(updateTrade).toHaveBeenCalledWith("t1", { stop: 1.19 });
    await blurChange("TP", "1.4");
    expect(updateTrade).toHaveBeenCalledWith("t1", { target: 1.4 });
    await blurChange("SL pips", "12");
    expect(updateTrade).toHaveBeenCalledWith("t1", { slPips: 12 });
    await blurChange("TP pips", "30");
    expect(updateTrade).toHaveBeenCalledWith("t1", { tpPips: 30 });
    await blurChange("Entry time", "2026-08-01T10:00:00Z");
    expect(updateTrade).toHaveBeenCalledWith("t1", {
      entryTime: "2026-08-01T10:00:00Z",
    });
    await blurChange("Exit time", "2026-08-01T11:00:00Z");
    expect(updateTrade).toHaveBeenCalledWith("t1", {
      exitTime: "2026-08-01T11:00:00Z",
    });
    await blurChange("Duration minutes", "45");
    expect(updateTrade).toHaveBeenCalledWith("t1", { timeInTradeMinutes: 45 });
    await blurChange("Fees $", "3.5");
    expect(updateTrade).toHaveBeenCalledWith("t1", { feesUsd: 3.5 });

    updateTrade.mockClear();
    fireEvent.blur(screen.getByLabelText("Symbol"));
    expect(updateTrade).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Session"));
    fireEvent.blur(screen.getByLabelText("Session"));
    expect(updateTrade).toHaveBeenCalledWith("t1", { session: undefined });

    screen.getByLabelText("Entry").focus();
    updateTrade.mockClear();
    await user.clear(screen.getByLabelText("Entry"));
    fireEvent.blur(screen.getByLabelText("Entry"));
    expect(updateTrade).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Exit"));
    fireEvent.blur(screen.getByLabelText("Exit"));
    expect(updateTrade).toHaveBeenCalledWith("t1", { exit: undefined });

    const tags = screen.getByLabelText("Tags");
    await user.clear(tags);
    await user.type(tags, "a, b");
    fireEvent.blur(tags);
    expect(updateTrade).toHaveBeenCalledWith("t1", { tags: ["a", "b"] });

    await user.clear(tags);
    fireEvent.blur(tags);
    expect(updateTrade).toHaveBeenCalledWith("t1", { tags: undefined });

    const notes = screen.getByLabelText("Notes");
    await user.clear(notes);
    await user.type(notes, "Rewritten");
    fireEvent.blur(notes);
    expect(updateTrade).toHaveBeenCalledWith("t1", { notes: "Rewritten" });

    await user.clear(notes);
    fireEvent.blur(notes);
    expect(updateTrade).toHaveBeenCalledWith("t1", { notes: undefined });

    await user.click(screen.getByRole("button", { name: "Reference in chat" }));
    expect(addChatReferencedTradeId).toHaveBeenCalledWith("t1");
    expect(onClose).toHaveBeenCalled();
  });

  it("skips no-op tag and note saves on empty optional trades", async () => {
    render(
      <TradeDetail
        trade={sampleTrade({
          session: undefined,
          size: undefined,
          notes: undefined,
          tags: undefined,
          entryTime: undefined,
          exitTime: undefined,
          slPips: undefined,
          tpPips: undefined,
        })}
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("dialog");
    updateTrade.mockClear();
    fireEvent.blur(screen.getByLabelText("Tags"));
    fireEvent.blur(screen.getByLabelText("Notes"));
    fireEvent.blur(screen.getByLabelText("Session"));
    fireEvent.blur(screen.getByLabelText("Size"));
    fireEvent.blur(screen.getByLabelText("Entry time"));
    fireEvent.blur(screen.getByLabelText("Exit time"));
    expect(updateTrade).not.toHaveBeenCalled();
  });

  it("hides and unhides from the detail footer", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TradeDetail trade={sampleTrade()} onClose={vi.fn()} />,
    );
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Hide trade" }));
    expect(hideTrade).toHaveBeenCalledWith("t1");

    rerender(
      <TradeDetail trade={sampleTrade({ hidden: true })} onClose={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: "Unhide trade" }));
    expect(unhideTrade).toHaveBeenCalledWith("t1");
  });
});
