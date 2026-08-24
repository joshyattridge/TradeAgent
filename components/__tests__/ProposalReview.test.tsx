/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalReview } from "@/components/ProposalReview";
import type { ChatProposal, ProposalChange } from "@/lib/chat-proposals";
import type { Strategy, Trade } from "@/lib/types";

const acceptPendingProposal = vi.fn();
const rejectPendingProposal = vi.fn();
const closeProposalReview = vi.fn();

let pendingProposal: ChatProposal | null = null;
let proposalReviewOpen = false;

vi.mock("@/lib/store", () => ({
  useTradingStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      pendingProposal,
      proposalReviewOpen,
      acceptPendingProposal,
      rejectPendingProposal,
      closeProposalReview,
    }),
}));

function sampleTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    date: "2026-07-01",
    symbol: "EURUSD",
    side: "long",
    entry: 1.1,
    stop: 1.09,
    target: 1.12,
    rMultiple: 1,
    result: "win",
    notes: "Note",
    ...overrides,
  };
}

function proposal(changes: ProposalChange[], summary = "Review changes"): ChatProposal {
  return {
    id: "p1",
    createdAt: new Date().toISOString(),
    actions: {},
    changes,
    summary,
  };
}

describe("ProposalReview", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    pendingProposal = null;
    proposalReviewOpen = false;
  });

  it("returns null when not mounted, closed, or missing proposal", () => {
    const { container, rerender } = render(<ProposalReview />);
    expect(container.firstChild).toBeNull();

    pendingProposal = proposal([]);
    proposalReviewOpen = true;
    rerender(<ProposalReview />);
    expect(container.firstChild).toBeNull();

    proposalReviewOpen = false;
    rerender(<ProposalReview />);
    expect(container.firstChild).toBeNull();
  });

  it("renders add change with populated and fallback fields", async () => {
    pendingProposal = proposal([
      {
        kind: "add",
        trade: sampleTrade({
          id: "new-1",
          screenshots: ["https://example.com/a.png", "pending", ""],
          tags: ["A+"],
          session: "London",
        }),
      },
      {
        kind: "add",
        trade: sampleTrade({
          id: "new-2",
          symbol: "GBPUSD",
          side: "short",
          notes: "",
          tags: [],
          session: undefined,
          result: "open",
        }),
      },
    ]);
    proposalReviewOpen = true;
    render(<ProposalReview />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    expect(screen.getAllByText("New trade")).toHaveLength(2);
    expect(screen.getAllByText("short")[0]).toHaveClass("side-short");
    expect(screen.getAllByAltText("").length).toBeGreaterThan(0);
    expect(screen.getByText("London")).toBeInTheDocument();
  });

  it("renders update and delete changes", async () => {
    pendingProposal = proposal([
      {
        kind: "update",
        id: "t1",
        before: sampleTrade({ notes: "Old" }),
        after: sampleTrade({ notes: "New" }),
        changedKeys: ["notes"],
      },
      {
        kind: "delete",
        id: "t1",
        before: sampleTrade({ symbol: "XAUUSD", side: "short" }),
      },
    ]);
    proposalReviewOpen = true;
    render(<ProposalReview />);

    await waitFor(() => {
      expect(screen.getByText("Update")).toBeInTheDocument();
    });
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.getByText(/removed from the journal/i)).toBeInTheDocument();
    expect(screen.getByText("t1")).toBeInTheDocument();
  });

  it("renders strategy change with name change and markdown diff lines", async () => {
    const before: Strategy = {
      name: "Old Strategy",
      markdown: "line one\nline two\n",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const after: Strategy = {
      name: "New Strategy",
      markdown: "line one\nline three\n",
      updatedAt: "2026-01-02T00:00:00Z",
    };

    pendingProposal = proposal([{ kind: "strategy", before, after }]);
    proposalReviewOpen = true;
    render(<ProposalReview />);

    await waitFor(() => {
      expect(screen.getByText("Strategy")).toBeInTheDocument();
    });
    expect(screen.getAllByText("New Strategy")[0]).toBeInTheDocument();
    expect(screen.getByText("Old Strategy")).toHaveClass("proposal-field__value--before");
    expect(screen.getAllByText("New Strategy")[1]).toHaveClass("proposal-field__value--after");
    expect(document.querySelector(".proposal-md-line--remove")).toBeTruthy();
    expect(document.querySelector(".proposal-md-line--add")).toBeTruthy();
  });

  it("shows unchanged strategy diff preview when markdown is identical", async () => {
    const strategy: Strategy = {
      name: "Same",
      markdown: Array.from({ length: 45 }, (_, i) => `line ${i}`).join("\n"),
      updatedAt: "2026-01-01T00:00:00Z",
    };
    pendingProposal = proposal([{ kind: "strategy", before: strategy, after: { ...strategy } }]);
    proposalReviewOpen = true;
    render(<ProposalReview />);

    await waitFor(() => {
      expect(screen.getByLabelText("Strategy markdown diff")).toBeInTheDocument();
    });
    expect(document.querySelectorAll(".proposal-md-line").length).toBe(40);
    expect(document.querySelector(".proposal-md-line--same")).toBeTruthy();
  });

  it("renders strategy checklist diff including empty before/after", async () => {
    const before: Strategy = {
      name: "Plan",
      markdown: "# Plan\n",
      updatedAt: "2026-01-01T00:00:00Z",
      checklist: [{ id: "a", label: "Bias" }],
    };
    const afterEmpty: Strategy = {
      ...before,
      checklist: [],
    };
    pendingProposal = proposal([
      { kind: "strategy", before, after: afterEmpty },
    ]);
    proposalReviewOpen = true;
    const { rerender } = render(<ProposalReview />);

    await waitFor(() => {
      expect(screen.getByLabelText("Checklist comparison")).toBeInTheDocument();
    });
    expect(screen.getByText("Bias")).toHaveClass("proposal-checklist__old");
    expect(screen.getByText("1 removed")).toBeInTheDocument();
    expect(screen.getByText("Removed")).toBeInTheDocument();

    pendingProposal = proposal([
      {
        kind: "strategy",
        before: { ...before, checklist: [] },
        after: {
          ...before,
          checklist: [{ id: "b", label: "PD zone" }],
        },
      },
    ]);
    rerender(<ProposalReview />);
    await waitFor(() => {
      expect(screen.getByText("PD zone")).toBeInTheDocument();
    });
    expect(screen.getByText("1 added")).toBeInTheDocument();
    expect(screen.getByText("Added")).toBeInTheDocument();
  });

  it("renders strategy checklist rename, kept items, and reorder note", async () => {
    const before: Strategy = {
      name: "Plan",
      markdown: "# Plan\n",
      updatedAt: "2026-01-01T00:00:00Z",
      checklist: [
        { id: "a", label: "Bias" },
        { id: "b", label: "FVG" },
      ],
    };
    pendingProposal = proposal([
      {
        kind: "strategy",
        before,
        after: {
          ...before,
          checklist: [
            { id: "b", label: "FVG" },
            { id: "a", label: "HTF bias" },
          ],
        },
      },
    ]);
    proposalReviewOpen = true;
    render(<ProposalReview />);

    await waitFor(() => {
      expect(screen.getByText("1 renamed · Order changed")).toBeInTheDocument();
    });
    expect(screen.getByText("Bias")).toHaveClass("proposal-checklist__old");
    expect(screen.getByText("HTF bias")).toBeInTheDocument();
    expect(screen.getByText("FVG")).toBeInTheDocument();
    expect(screen.getByText("Renamed")).toBeInTheDocument();
    expect(screen.queryByText("Kept")).not.toBeInTheDocument();
  });

  it("renders trade checklist diffs and new-trade checklist rows", async () => {
    pendingProposal = proposal([
      {
        kind: "add",
        trade: sampleTrade({
          id: "new-cl",
          checklist: [
            { id: "a", label: "Bias", checked: true },
            { id: "b", label: "FVG", checked: false },
          ],
        }),
      },
      {
        kind: "update",
        id: "t1",
        before: sampleTrade({
          notes: "Old",
          checklist: [
            { id: "a", label: "Bias", checked: false },
            { id: "keep", label: "Session", checked: true },
            { id: "gone", label: "Old step", checked: true },
          ],
        }),
        after: sampleTrade({
          notes: "New",
          checklist: [
            { id: "a", label: "HTF bias", checked: true },
            { id: "keep", label: "Session", checked: true },
            { id: "c", label: "New step", checked: true },
          ],
        }),
        changedKeys: ["notes", "checklist"],
      },
      {
        kind: "update",
        id: "t-empty",
        before: sampleTrade({ id: "t-empty", checklist: undefined }),
        after: sampleTrade({
          id: "t-empty",
          checklist: [{ id: "n", label: "From scratch", checked: true }],
        }),
        changedKeys: ["checklist"],
      },
      {
        kind: "update",
        id: "t-clear",
        before: sampleTrade({
          id: "t-clear",
          checklist: [{ id: "x", label: "Cleared item", checked: false }],
        }),
        after: sampleTrade({ id: "t-clear", checklist: undefined }),
        changedKeys: ["checklist"],
      },
      {
        kind: "update",
        id: "t-same-cl",
        before: sampleTrade({
          id: "t-same-cl",
          checklist: [{ id: "s", label: "Same item", checked: true }],
        }),
        after: sampleTrade({
          id: "t-same-cl",
          checklist: [{ id: "s", label: "Same item", checked: true }],
        }),
        changedKeys: ["checklist"],
      },
    ]);
    proposalReviewOpen = true;
    render(<ProposalReview />);

    await waitFor(() => {
      expect(screen.getAllByLabelText("Checklist").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByLabelText("Checklist comparison").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Done").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not done").length).toBeGreaterThan(0);
    expect(screen.getByText("Old step")).toHaveClass("proposal-checklist__old");
    expect(screen.getByText("HTF bias")).toBeInTheDocument();
    expect(screen.getByText("From scratch")).toBeInTheDocument();
    expect(screen.getByText("Cleared item")).toBeInTheDocument();
    expect(screen.getByText("Same item")).toBeInTheDocument();
    expect(screen.getByText(/1 updated/)).toBeInTheDocument();
  });

  it("accepts, rejects, closes via backdrop, X, and Escape", async () => {
    const user = userEvent.setup();
    pendingProposal = proposal([{ kind: "add", trade: sampleTrade({ id: "x" }) }], "Save me");
    proposalReviewOpen = true;
    render(<ProposalReview />);

    await waitFor(() => {
      expect(screen.getByText("Save me")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(rejectPendingProposal).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Accept/i }));
    expect(acceptPendingProposal).toHaveBeenCalled();

    closeProposalReview.mockClear();
    await user.click(document.body.querySelector(".proposal-backdrop")!);
    expect(closeProposalReview).toHaveBeenCalled();

    closeProposalReview.mockClear();
    await user.click(screen.getByRole("button", { name: "Hide review panel" }));
    expect(closeProposalReview).toHaveBeenCalled();

    closeProposalReview.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(closeProposalReview).toHaveBeenCalled();
  });

  it("does not close when clicking inside the panel", async () => {
    const user = userEvent.setup();
    pendingProposal = proposal([{ kind: "add", trade: sampleTrade() }]);
    proposalReviewOpen = true;
    render(<ProposalReview />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("dialog"));
    expect(closeProposalReview).not.toHaveBeenCalled();
  });

  it("renders update with short side and unlabeled trade keys", async () => {
    pendingProposal = proposal([
      {
        kind: "update",
        id: "t-short",
        before: sampleTrade({ side: "short", notes: "Old" }),
        after: sampleTrade({ side: "short", notes: "New" }),
        changedKeys: ["notes", "id"],
      },
      {
        kind: "delete",
        id: "t-del-long",
        before: sampleTrade({ symbol: "XAUUSD", side: "long" }),
      },
      {
        kind: "delete",
        id: "t-del-short",
        before: sampleTrade({ symbol: "GBPUSD", side: "short" }),
      },
    ]);
    proposalReviewOpen = true;
    render(<ProposalReview />);

    await waitFor(() => {
      expect(screen.getAllByText("short")[0]).toHaveClass("side-short");
      expect(screen.getAllByText("long")[0]).toHaveClass("side-long");
      expect(screen.getAllByText("id").length).toBeGreaterThan(0);
    });
  });

  it("renders empty screenshots placeholder", async () => {
    pendingProposal = proposal([
      {
        kind: "update",
        id: "shots",
        before: sampleTrade({ screenshots: undefined }),
        after: sampleTrade({ screenshots: [] }),
        changedKeys: ["screenshots"],
      },
    ]);
    proposalReviewOpen = true;
    render(<ProposalReview />);

    await waitFor(() => {
      expect(screen.getAllByText("Screenshots").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders add fallback field rows when no proposed keys are populated", async () => {
    pendingProposal = proposal([
      {
        kind: "add",
        trade: {
          id: "empty",
          date: "",
          symbol: "",
          side: "" as Trade["side"],
          entry: undefined as unknown as number,
          stop: undefined as unknown as number,
          target: undefined as unknown as number,
          rMultiple: undefined as unknown as number,
          result: undefined as unknown as Trade["result"],
        },
      },
    ]);
    proposalReviewOpen = true;
    render(<ProposalReview />);

    await waitFor(() => {
      expect(screen.getByText("New trade")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Symbol").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Side").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Result").length).toBeGreaterThan(0);
  });

  it("ignores non-Escape keys", async () => {
    pendingProposal = proposal([{ kind: "add", trade: sampleTrade() }]);
    proposalReviewOpen = true;
    render(<ProposalReview />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "Enter" });
    expect(closeProposalReview).not.toHaveBeenCalled();
  });
});
