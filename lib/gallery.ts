import { visibleJournalTrades } from "@/lib/stats";
import { tradeChronologyMs } from "@/lib/trade-format";
import type { Trade } from "@/lib/types";

export type GalleryFilter = "all" | "win" | "loss";

export type GalleryTrade = Trade & { result: "win" | "loss" };

export interface GalleryShot {
  id: string;
  trade: GalleryTrade;
  src: string;
  shotIndex: number;
  shotCount: number;
}

export function isGalleryScreenshot(src: string | undefined): src is string {
  return Boolean(src && src !== "pending");
}

export function isGalleryResult(result: Trade["result"]): result is "win" | "loss" {
  return result === "win" || result === "loss";
}

export function collectGalleryShots(
  trades: Trade[],
  filter: GalleryFilter = "all",
): GalleryShot[] {
  const items: GalleryShot[] = [];
  for (const trade of visibleJournalTrades(trades)) {
    if (!isGalleryResult(trade.result)) continue;
    if (filter !== "all" && trade.result !== filter) continue;
    const galleryTrade: GalleryTrade = { ...trade, result: trade.result };
    const shots = (trade.screenshots ?? []).filter(isGalleryScreenshot);
    shots.forEach((src, shotIndex) => {
      items.push({
        id: `${trade.id}:${shotIndex}`,
        trade: galleryTrade,
        src,
        shotIndex,
        shotCount: shots.length,
      });
    });
  }
  return items.sort((a, b) => {
    const byTime = tradeChronologyMs(b.trade) - tradeChronologyMs(a.trade);
    if (byTime !== 0) return byTime;
    const byId = a.trade.id.localeCompare(b.trade.id);
    if (byId !== 0) return byId;
    return a.shotIndex - b.shotIndex;
  });
}

export function galleryShotCounts(trades: Trade[]) {
  const all = collectGalleryShots(trades, "all");
  let win = 0;
  let loss = 0;
  for (const shot of all) {
    if (shot.trade.result === "win") win += 1;
    else loss += 1;
  }
  return { all: all.length, win, loss };
}

export function uniqueTradesFromShots(shots: GalleryShot[]): GalleryTrade[] {
  const out: GalleryTrade[] = [];
  const seen = new Set<string>();
  for (const shot of shots) {
    if (seen.has(shot.trade.id)) continue;
    seen.add(shot.trade.id);
    out.push(shot.trade);
  }
  return out;
}
