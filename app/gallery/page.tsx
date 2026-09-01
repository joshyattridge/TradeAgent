"use client";

import { TradeGallery } from "@/components/TradeGallery";
import { useTradingStore } from "@/lib/store";

export default function GalleryPage() {
  const trades = useTradingStore((s) => s.trades);
  const hydrated = useTradingStore((s) => s.hydrated);

  if (!hydrated) {
    return (
      <div className="page">
        <p className="empty-note">Loading gallery…</p>
      </div>
    );
  }

  return (
    <div className="page page--gallery">
      <section className="page-hero">
        <h1>Gallery</h1>
        <p>
          Scroll through chart screenshots from your winning and losing trades.
          Filter one side, enlarge a shot, or open the trade for notes.
        </p>
      </section>

      <TradeGallery trades={trades} />
    </div>
  );
}
