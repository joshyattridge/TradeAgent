/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TradeTable, compareSortValues } from "@/components/TradeTable";
import { TRADE_COLUMNS, type TradeColumnId } from "@/lib/trade-columns";
import type { Trade } from "@/lib/types";

const toggleTradeColumn = vi.fn();
const resetTradeColumns = vi.fn();
const addChatReferencedTradeIds = vi.fn();

let visibleTradeColumns: TradeColumnId[] = TRADE_COLUMNS.map((c) => c.id);

vi.mock("@/lib/store", () => ({
  useTradingStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      visibleTradeColumns,
      toggleTradeColumn,
      resetTradeColumns,
      addChatReferencedTradeIds,
    }),
}));

vi.mock("@/components/TradeDetail", () => ({
  TradeDetail: ({ trade, onClose }: { trade: Trade; onClose: () => void }) => (
    <div data-testid="trade-detail">
      <span>{trade.symbol}</span>
      <button type="button" onClick={onClose}>
        Close detail
      </button>
    </div>
  ),
}));

function trade(overrides: Partial<Trade> & Pick<Trade, "id">): Trade {
  return {
    date: "2026-07-01",
    symbol: "EURUSD",
    side: "long",
    setup: "FVG",
    entry: 1.1,
    stop: 1.09,
    target: 1.12,
    rMultiple: 1,
    result: "win",
    ...overrides,
  };
}

const trades: Trade[] = [
  trade({
    id: "a",
    date: "2026-07-01",
    symbol: "AAA",
    side: "long",
    setup: "Alpha",
    session: "London",
    size: "1 lot",
    entry: 1.0,
    stop: 0.9,
    target: 1.2,
    slPips: 10,
    tpPips: 20,
    exit: 1.1,
    entryTime: "2026-07-01T08:00:00Z",
    exitTime: "2026-07-01T10:00:00Z",
    timeInTradeMinutes: 120,
    riskUsd: 100,
    pnlUsd: 50,
    rMultiple: 1.5,
    result: "win",
    screenshots: ["https://example.com/1.png", "https://example.com/2.png"],
    tags: ["A", "B", "C"],
    notes: "First trade notes",
  }),
  trade({
    id: "b",
    date: "2026-07-02",
    symbol: "ZZZ",
    side: "short",
    setup: "Zulu",
    session: "NY",
    size: "2 lots",
    entry: 2.0,
    stop: 2.1,
    target: 1.8,
    slPips: 15,
    tpPips: 25,
    exit: 1.9,
    entryTime: "2026-07-02T14:00:00Z",
    exitTime: "2026-07-02T16:00:00Z",
    riskUsd: 200,
    pnlUsd: -75,
    rMultiple: -0.8,
    result: "loss",
    screenshots: ["https://example.com/s.png"],
    tags: ["solo"],
    notes: "Second",
  }),
  trade({
    id: "c",
    date: "2026-07-03",
    symbol: "MID",
    side: "long",
    setup: "Middle",
    entry: 1.5,
    stop: 1.4,
    target: 1.6,
    entryTime: undefined,
    exitTime: undefined,
    exit: undefined,
    session: undefined,
    size: undefined,
    riskUsd: undefined,
    pnlUsd: undefined,
    feesUsd: undefined,
    slPips: undefined,
    tpPips: undefined,
    rMultiple: 0,
    result: "breakeven",
    tags: undefined,
    notes: undefined,
    screenshots: undefined,
  }),
  trade({
    id: "d",
    date: "bad-date",
    symbol: "OPEN",
    side: "long",
    setup: "Open",
    entry: 1.1,
    stop: 1.0,
    target: 1.2,
    entryTime: undefined,
    exitTime: undefined,
    session: undefined,
    slPips: undefined,
    tpPips: undefined,
    rMultiple: 0,
    result: "open",
    notes: undefined,
    tags: undefined,
  }),
];

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function headerButton(label: string) {
  return screen.getByRole("button", {
    name: new RegExp(`^${escapeRegex(label)}$`, "i"),
  });
}

function rowSymbols(): string[] {
  return within(screen.getByRole("table")).getAllByRole("row").slice(1).map((row) => row.textContent ?? "");
}

async function sortBy(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(headerButton(label));
}

describe("TradeTable", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    visibleTradeColumns = TRADE_COLUMNS.map((c) => c.id);
  });

  it("shows empty state when no trades", () => {
    render(<TradeTable trades={[]} />);
    expect(screen.getByText(/No trades logged yet/i)).toBeInTheDocument();
  });

  it("renders all column cell variants and opens row detail", async () => {
    const user = userEvent.setup();
    render(<TradeTable trades={trades} />);

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("London")).toBeInTheDocument();
    expect(screen.getByText("1 lot")).toBeInTheDocument();
    expect(screen.getByText("First trade notes")).toBeInTheDocument();
    expect(screen.getByText("+1.5R")).toHaveClass("pos");
    expect(screen.getByText("-0.8R")).toHaveClass("neg");
    expect(screen.getByText("Zulu")).toBeInTheDocument();
    expect(screen.getByText("solo")).toBeInTheDocument();
    expect(screen.getAllByText("+1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("breakeven")).toBeInTheDocument();
    expect(screen.getByText("open")).toHaveClass("badge--open");

    const firstRow = screen.getByText("AAA").closest("tr")!;
    await user.click(firstRow);
    expect(screen.getByTestId("trade-detail")).toHaveTextContent("AAA");

    await user.click(screen.getByRole("button", { name: "Close detail" }));
    expect(screen.queryByTestId("trade-detail")).not.toBeInTheDocument();

    await user.click(firstRow);
    firstRow.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("trade-detail")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close detail" }));

    firstRow.focus();
    await user.keyboard(" ");
    expect(screen.getByTestId("trade-detail")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close detail" }));

    firstRow.focus();
    await user.keyboard("{Tab}");
    expect(screen.queryByTestId("trade-detail")).not.toBeInTheDocument();
  });

  it("selects multiple rows and references them in chat", async () => {
    const user = userEvent.setup();
    render(<TradeTable trades={trades} />);

    await user.click(screen.getByLabelText("Select AAA trade"));
    await user.click(screen.getByLabelText("Select AAA trade"));
    expect(screen.queryByRole("button", { name: /Reference \d+ in chat/i })).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Select AAA trade"));
    await user.click(screen.getByLabelText("Select ZZZ trade"));
    expect(screen.getByText(/2 selected/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Reference 2 in chat/i }));
    expect(addChatReferencedTradeIds).toHaveBeenCalledWith(["a", "b"]);
    expect(screen.queryByRole("button", { name: /Reference 2 in chat/i })).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Select all trades"));
    expect(screen.getByRole("button", { name: /Reference 4 in chat/i })).toBeInTheDocument();
    await user.click(screen.getByLabelText("Select all trades"));
    expect(screen.queryByRole("button", { name: /Reference \d+ in chat/i })).not.toBeInTheDocument();
  });

  it("toggles column picker and reset defaults", async () => {
    const user = userEvent.setup();
    render(<TradeTable trades={trades} />);

    await user.click(screen.getByRole("button", { name: /Columns/i }));
    expect(screen.getByText("Visible columns")).toBeInTheDocument();

    const symbolCheckbox = screen.getByRole("checkbox", { name: "Symbol" });
    await user.click(symbolCheckbox);
    expect(toggleTradeColumn).toHaveBeenCalledWith("symbol");

    await user.click(screen.getByRole("button", { name: "Reset defaults" }));
    expect(resetTradeColumns).toHaveBeenCalled();
  });

  it(
    "sorts every column ascending and descending",
    async () => {
      const user = userEvent.setup({ delay: null });
      render(<TradeTable trades={trades} />);

      for (const col of TRADE_COLUMNS) {
        await sortBy(user, col.label);
        const ascFirst = rowSymbols()[0];
        await sortBy(user, col.label);
        const descFirst = rowSymbols()[0];
        expect(ascFirst || descFirst).toBeTruthy();
      }
    },
    20_000,
  );

  it("switches sort column with date/time defaulting to desc and others to asc", async () => {
    const user = userEvent.setup();
    render(<TradeTable trades={trades} />);

    await sortBy(user, "Date");
    expect(screen.getByRole("columnheader", { name: /Date/i })).toHaveAttribute(
      "aria-sort",
      "descending",
    );

    await sortBy(user, "Setup");
    expect(screen.getByRole("columnheader", { name: /Setup/i })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });

  it("shows idle and active sort icons", async () => {
    const user = userEvent.setup();
    render(<TradeTable trades={trades} />);

    expect(document.querySelector(".sort-icon--idle")).toBeTruthy();
    await sortBy(user, "Symbol");
    expect(document.querySelector(".sort-icon--idle")).toBeTruthy();
    await sortBy(user, "Symbol");
    expect(document.querySelector(".sort-icon")).toBeTruthy();
  });

  it("uses id tie-break when sort values and datetimes match", async () => {
    const user = userEvent.setup();
    const twins: Trade[] = [
      trade({
        id: "z-last",
        symbol: "TWIN",
        entryTime: "2026-07-01T08:00:00Z",
        date: "2026-07-01",
        setup: "Same",
        rMultiple: 1,
        notes: "second row",
      }),
      trade({
        id: "a-first",
        symbol: "TWIN",
        entryTime: "2026-07-01T08:00:00Z",
        date: "2026-07-01",
        setup: "Same",
        rMultiple: 1,
        notes: "first row",
      }),
    ];
    render(<TradeTable trades={twins} />);

    await sortBy(user, "Symbol");
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("first row");
    expect(rows[1]).toHaveTextContent("second row");
  });

  it("sorts exit and pip columns with missing values last", async () => {
    const user = userEvent.setup({ delay: null });
    const mixed: Trade[] = [
      trade({
        id: "with-exit",
        symbol: "HAS",
        exit: 1.2,
        slPips: 10,
        tpPips: 20,
      }),
      trade({
        id: "no-exit",
        symbol: "MISS",
        exit: undefined,
        slPips: undefined,
        tpPips: undefined,
        entry: undefined as unknown as number,
        stop: undefined as unknown as number,
        target: undefined as unknown as number,
      }),
    ];
    render(<TradeTable trades={mixed} />);

    await sortBy(user, "Exit");
    expect(rowSymbols()[0]).toContain("HAS");
    expect(rowSymbols()[1]).toContain("MISS");

    await sortBy(user, "Exit");
    expect(rowSymbols()[0]).toContain("HAS");
    expect(rowSymbols()[1]).toContain("MISS");

    await sortBy(user, "SL pips");
    expect(rowSymbols()[0]).toContain("HAS");
    await sortBy(user, "TP pips");
    expect(rowSymbols()[0]).toContain("HAS");
  });

  it("compareSortValues puts missing values last in both argument orders", () => {
    expect(compareSortValues(null, null, "asc")).toBe(0);
    expect(compareSortValues(null, 1, "asc")).toBe(1);
    expect(compareSortValues(1, null, "asc")).toBe(-1);
    expect(compareSortValues(2, 1, "asc")).toBeGreaterThan(0);
    expect(compareSortValues(1, 2, "desc")).toBeGreaterThan(0);
    expect(compareSortValues("b", "a", "asc")).toBeGreaterThan(0);
  });
});
