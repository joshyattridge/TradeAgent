"use client";

import { useEffect } from "react";
import { useTradingStore } from "@/lib/store";

export function Providers({ children }: { children: React.ReactNode }) {
  const setHydrated = useTradingStore((s) => s.setHydrated);

  useEffect(() => {
    setHydrated(true);
  }, [setHydrated]);

  return <>{children}</>;
}
