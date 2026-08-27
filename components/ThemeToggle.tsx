"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_OPTIONS, type ThemePreference } from "@/lib/theme";
import { useTheme } from "@/components/ThemeProvider";

const ICONS: Record<ThemePreference, typeof Sun> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

export function ThemeToggle({
  labels = false,
}: {
  labels?: boolean;
}) {
  const { preference, setPreference } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div
      className={`theme-toggle${labels ? " theme-toggle--labels" : ""}`}
      role="radiogroup"
      aria-label="Appearance"
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = ICONS[option.id];
        const active = mounted && preference === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            className={`theme-toggle__btn${active ? " is-active" : ""}`}
            onClick={() => setPreference(option.id)}
            title={option.label}
          >
            {labels ? (
              option.label
            ) : (
              <>
                <Icon size={15} strokeWidth={2.2} aria-hidden />
                <span className="sr-only">{option.label}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
