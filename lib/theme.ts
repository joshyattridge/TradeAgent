export const THEME_STORAGE_KEY = "tradeagent-theme";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_OPTIONS = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
] as const satisfies ReadonlyArray<{ id: ThemePreference; label: string }>;

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean,
): ResolvedTheme {
  if (preference === "light" || preference === "dark") return preference;
  return systemDark ? "dark" : "light";
}

export function readThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function writeThemePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Private mode / quota — theme still applies for this session.
  }
}

export function applyTheme(
  preference: ThemePreference,
  resolved: ResolvedTheme,
  root: HTMLElement = document.documentElement,
) {
  root.setAttribute("data-theme", preference);
  root.setAttribute("data-resolved-theme", resolved);
  root.style.colorScheme = preference === "system" ? "light dark" : preference;
}

export function readCssVar(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/** Blocking snippet so the first paint matches the saved / system theme. */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var s=localStorage.getItem(k);var p=s==="light"||s==="dark"||s==="system"?s:"system";var d=window.matchMedia("(prefers-color-scheme: dark)").matches;var r=p==="light"||p==="dark"?p:(d?"dark":"light");var e=document.documentElement;e.setAttribute("data-theme",p);e.setAttribute("data-resolved-theme",r);e.style.colorScheme=p==="system"?"light dark":p;}catch(err){}})();`;
