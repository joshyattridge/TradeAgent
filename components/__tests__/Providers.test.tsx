/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSetHydrated = vi.fn();
const mockUnsub = vi.fn();
let hydrationCallback: (() => void) | null = null;
let hasHydrated = false;

vi.mock("@/lib/store", () => ({
  useTradingStore: Object.assign(
    vi.fn((selector: (s: { setHydrated: typeof mockSetHydrated }) => unknown) =>
      selector({ setHydrated: mockSetHydrated }),
    ),
    {
      persist: {
        onFinishHydration: vi.fn((cb: () => void) => {
          hydrationCallback = cb;
          return mockUnsub;
        }),
        hasHydrated: vi.fn(() => hasHydrated),
      },
    },
  ),
}));

import { Providers } from "../Providers";

describe("Providers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSetHydrated.mockClear();
    mockUnsub.mockClear();
    hydrationCallback = null;
    hasHydrated = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders children", () => {
    render(
      <Providers>
        <span>child content</span>
      </Providers>,
    );
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("calls setHydrated immediately when already hydrated", () => {
    hasHydrated = true;
    render(
      <Providers>
        <span>child</span>
      </Providers>,
    );
    expect(mockSetHydrated).toHaveBeenCalledWith(true);
  });

  it("calls setHydrated when hydration callback fires", () => {
    render(
      <Providers>
        <span>child</span>
      </Providers>,
    );
    mockSetHydrated.mockClear();
    hydrationCallback?.();
    expect(mockSetHydrated).toHaveBeenCalledWith(true);
  });

  it("calls setHydrated after 2500ms safety timeout", () => {
    render(
      <Providers>
        <span>child</span>
      </Providers>,
    );
    mockSetHydrated.mockClear();
    vi.advanceTimersByTime(2500);
    expect(mockSetHydrated).toHaveBeenCalledWith(true);
  });

  it("cleans up subscription and timeout on unmount", () => {
    const { unmount } = render(
      <Providers>
        <span>child</span>
      </Providers>,
    );
    unmount();
    expect(mockUnsub).toHaveBeenCalled();
    mockSetHydrated.mockClear();
    vi.advanceTimersByTime(2500);
    expect(mockSetHydrated).not.toHaveBeenCalled();
  });
});
