/**
 * @vitest-environment jsdom
 */
import "fake-indexeddb/auto";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GalleryPage from "@/app/gallery/page";
import { seedTrades } from "@/lib/seed-data";
import { useTradingStore } from "@/lib/store";

vi.mock("@/components/TradeGallery", () => ({
  TradeGallery: ({ trades }: { trades: unknown[] }) => (
    <div data-testid="trade-gallery">{trades.length} trades</div>
  ),
}));

function resetStore(
  overrides: Partial<ReturnType<typeof useTradingStore.getState>> = {},
) {
  useTradingStore.setState({
    trades: seedTrades,
    hydrated: true,
    ...overrides,
  });
}

describe("GalleryPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetStore();
  });

  it("shows loading state when not hydrated", () => {
    resetStore({ hydrated: false });
    render(<GalleryPage />);
    expect(screen.getByText("Loading gallery…")).toBeInTheDocument();
  });

  it("renders the gallery when hydrated", () => {
    render(<GalleryPage />);
    expect(screen.getByRole("heading", { name: "Gallery" })).toBeInTheDocument();
    expect(
      screen.getByText(/Scroll through chart screenshots from your winning and losing trades/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("trade-gallery")).toHaveTextContent(
      `${seedTrades.length} trades`,
    );
  });
});
