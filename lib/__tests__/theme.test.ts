/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyTheme,
  isThemePreference,
  readCssVar,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
} from "@/lib/theme";

describe("theme helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-resolved-theme");
    document.documentElement.style.colorScheme = "";
  });

  it("accepts only system, light, and dark", () => {
    expect(isThemePreference("system")).toBe(true);
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("auto")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it("resolves system to the OS preference", () => {
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("defaults to system when nothing is stored", () => {
    expect(readThemePreference()).toBe("system");
  });

  it("reads and writes the stored preference", () => {
    writeThemePreference("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(readThemePreference()).toBe("dark");
  });

  it("ignores invalid stored values", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readThemePreference()).toBe("system");
  });

  it("applies data attributes and color-scheme", () => {
    applyTheme("system", "dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("system");
    expect(document.documentElement.getAttribute("data-resolved-theme")).toBe(
      "dark",
    );
    expect(document.documentElement.style.colorScheme).toBe("light dark");

    applyTheme("light", "light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("init script applies a stored dark preference before paint", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    window.eval(THEME_INIT_SCRIPT);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-resolved-theme")).toBe(
      "dark",
    );
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("defaults to system when window is unavailable", () => {
    vi.stubGlobal("window", undefined);
    try {
      expect(readThemePreference()).toBe("system");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("defaults to system when storage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readThemePreference()).toBe("system");
  });

  it("swallows storage write failures", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeThemePreference("dark")).not.toThrow();
  });

  it("reads computed CSS variables and falls back when empty", () => {
    document.documentElement.style.setProperty("--teal", " #2dd4bf ");
    expect(readCssVar("--teal", "#0d9488")).toBe("#2dd4bf");
    document.documentElement.style.removeProperty("--teal");
    expect(readCssVar("--missing-token", "#0d9488")).toBe("#0d9488");
  });

  it("falls back when document is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: undefined,
    });
    try {
      expect(readCssVar("--teal", "#0d9488")).toBe("#0d9488");
    } finally {
      if (original) Object.defineProperty(globalThis, "document", original);
    }
  });
});
