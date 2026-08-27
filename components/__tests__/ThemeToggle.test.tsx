/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { THEME_STORAGE_KEY } from "@/lib/theme";

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mq = {
    matches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (
      _type: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => {
      listeners.add(listener);
    },
    removeEventListener: (
      _type: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => {
      listeners.delete(listener);
    },
    dispatchEvent: () => false,
    setMatches(next: boolean) {
      mq.matches = next;
      const event = { matches: next } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
  vi.stubGlobal("matchMedia", () => mq);
  return mq;
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-resolved-theme");
    document.documentElement.style.colorScheme = "";
    mockMatchMedia(false);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("defaults to System and can select Dark", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle labels />
      </ThemeProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await user.click(screen.getByRole("radio", { name: "Dark" }));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-resolved-theme")).toBe(
      "dark",
    );
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("follows the OS when preference is System", async () => {
    const mq = mockMatchMedia(true);
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("system");
    expect(document.documentElement.getAttribute("data-resolved-theme")).toBe(
      "dark",
    );

    act(() => {
      mq.setMatches(false);
    });

    expect(document.documentElement.getAttribute("data-resolved-theme")).toBe(
      "light",
    );
  });

  it("syncs the preference from other tabs", async () => {
    render(
      <ThemeProvider>
        <ThemeToggle labels />
      </ThemeProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    localStorage.setItem(THEME_STORAGE_KEY, "light");
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: THEME_STORAGE_KEY }),
      );
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("ignores unrelated storage events", async () => {
    render(
      <ThemeProvider>
        <ThemeToggle labels />
      </ThemeProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "other-key" }));
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("system");
  });

  it("does not persist a choice without a provider", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle labels />);
    await act(async () => {
      await Promise.resolve();
    });

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});
