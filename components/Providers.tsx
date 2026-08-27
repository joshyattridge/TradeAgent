"use client";

import { useEffect } from "react";
import { ThemeProvider } from "@/components/ThemeProvider";
import { useTradingStore } from "@/lib/store";

export function Providers({ children }: { children: React.ReactNode }) {
  const setHydrated = useTradingStore((s) => s.setHydrated);

  useEffect(() => {
    // Async IndexedDB rehydrate — mark ready when persist finishes (or already has).
    const unsub = useTradingStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    if (useTradingStore.persist.hasHydrated()) {
      setHydrated(true);
    }
    // Safety net if hydration hangs (blocked IDB, private mode quirks)
    const t = window.setTimeout(() => setHydrated(true), 2500);
    return () => {
      unsub();
      window.clearTimeout(t);
    };
  }, [setHydrated]);

  return <ThemeProvider>{children}</ThemeProvider>;
}
