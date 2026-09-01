"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { TradeDetail } from "@/components/TradeDetail";
import {
  collectGalleryShots,
  galleryShotCounts,
  uniqueTradesFromShots,
  type GalleryFilter,
  type GalleryShot,
} from "@/lib/gallery";
import {
  formatPnlUsd,
  formatTradeDate,
  formatTradeDateTime,
} from "@/lib/trade-format";
import type { Trade } from "@/lib/types";

function badgeClass(result: "win" | "loss") {
  return result === "win" ? "badge badge--win" : "badge badge--loss";
}

function emptyCopy(filter: GalleryFilter, hasAny: boolean) {
  if (hasAny && filter === "win") return "No screenshots on winning trades.";
  if (hasAny && filter === "loss") return "No screenshots on losing trades.";
  return "No screenshots on winning or losing trades yet. Attach charts when you log a trade.";
}

function pnlTone(value?: number) {
  if (value == null) return "";
  return value >= 0 ? "pos" : "neg";
}

function ShotNavButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      className={`trade-detail__nav trade-detail__nav--${direction}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      aria-label={direction === "prev" ? "Previous screenshot" : "Next screenshot"}
    >
      <Icon size={22} />
    </button>
  );
}

function shotLabel(shot: GalleryShot) {
  const when = shot.trade.entryTime
    ? formatTradeDateTime(shot.trade.entryTime, shot.trade.date)
    : formatTradeDate(shot.trade.date);
  const chart =
    shot.shotCount > 1 ? ` · chart ${shot.shotIndex + 1} of ${shot.shotCount}` : "";
  return `${shot.trade.symbol} ${shot.trade.side} · ${when}${chart}`;
}

export function TradeGallery({ trades }: { trades: Trade[] }) {
  const [filter, setFilter] = useState<GalleryFilter>("all");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const counts = useMemo(() => galleryShotCounts(trades), [trades]);
  const shots = useMemo(
    () => collectGalleryShots(trades, filter),
    [trades, filter],
  );
  const uniqueTrades = useMemo(() => uniqueTradesFromShots(shots), [shots]);

  const selectedIndex = selectedId
    ? uniqueTrades.findIndex((t) => t.id === selectedId)
    : -1;
  const selected = uniqueTrades[selectedIndex] ?? null;
  const canNavigateTrades = uniqueTrades.length > 1;
  const lightboxShot =
    lightboxIndex != null ? (shots[lightboxIndex] ?? null) : null;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setLightboxIndex(null);
    setSelectedId(null);
  }, [filter]);

  useEffect(() => {
    if (lightboxIndex == null) return;
    if (!shots.length) {
      setLightboxIndex(null);
      return;
    }
    if (lightboxIndex >= shots.length) {
      setLightboxIndex(shots.length - 1);
    }
  }, [lightboxIndex, shots.length]);

  useEffect(() => {
    if (lightboxIndex == null) return;
    const index = lightboxIndex;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setLightboxIndex(null);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (index > 0) setLightboxIndex(index - 1);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (index < shots.length - 1) {
          setLightboxIndex(index + 1);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [lightboxIndex, shots.length]);

  function onSelectOffset(offset: number) {
    const nextIndex = Math.max(
      0,
      Math.min(uniqueTrades.length - 1, selectedIndex + offset),
    );
    setSelectedId(uniqueTrades[nextIndex].id);
  }

  function openTrade(tradeId: string) {
    setLightboxIndex(null);
    setSelectedId(tradeId);
  }

  const filters: { id: GalleryFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: counts.all },
    { id: "win", label: "Wins", count: counts.win },
    { id: "loss", label: "Losses", count: counts.loss },
  ];

  return (
    <>
      <div className="gallery-toolbar">
        <div className="unit-toggle" role="radiogroup" aria-label="Show screenshots">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={filter === item.id}
              className={`unit-toggle__btn${filter === item.id ? " is-active" : ""}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              <span className="gallery-toolbar__n">{item.count}</span>
            </button>
          ))}
        </div>
        <p className="gallery-toolbar__hint">
          Scroll the feed · click a chart to enlarge · arrows move between shots
        </p>
      </div>

      {shots.length ? (
        <div className="gallery-feed">
          {shots.map((shot, index) => {
            return (
              <article
                key={shot.id}
                className={`gallery-card gallery-card--${shot.trade.result}`}
              >
                <button
                  type="button"
                  className="gallery-card__shot"
                  onClick={() => setLightboxIndex(index)}
                  aria-label={`View ${shotLabel(shot)} full screen`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={shot.src} alt={shotLabel(shot)} />
                </button>
                <div className="gallery-card__meta">
                  <div className="gallery-card__identity">
                    <strong className="mono">{shot.trade.symbol}</strong>
                    <span
                      className={
                        shot.trade.side === "long" ? "side-long" : "side-short"
                      }
                    >
                      {shot.trade.side}
                    </span>
                    <span className={badgeClass(shot.trade.result)}>
                      {shot.trade.result}
                    </span>
                    {shot.shotCount > 1 ? (
                      <span className="gallery-card__shot-n">
                        {shot.shotIndex + 1}/{shot.shotCount}
                      </span>
                    ) : null}
                  </div>
                  <div className="gallery-card__facts">
                    <span className="gallery-card__when">
                      {shot.trade.entryTime
                        ? formatTradeDateTime(
                            shot.trade.entryTime,
                            shot.trade.date,
                          )
                        : formatTradeDate(shot.trade.date)}
                    </span>
                    <span className={`mono ${pnlTone(shot.trade.pnlUsd)}`}>
                      {formatPnlUsd(shot.trade.pnlUsd)}
                    </span>
                    <button
                      type="button"
                      className="ghost-btn gallery-card__open"
                      onClick={() => openTrade(shot.trade.id)}
                    >
                      Open trade
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="empty-note">{emptyCopy(filter, counts.all > 0)}</p>
      )}

      {selected ? (
        <TradeDetail
          trade={selected}
          onClose={() => setSelectedId(null)}
          onPrev={canNavigateTrades ? () => onSelectOffset(-1) : undefined}
          onNext={canNavigateTrades ? () => onSelectOffset(1) : undefined}
          hasPrev={selectedIndex > 0}
          hasNext={selectedIndex < uniqueTrades.length - 1}
          navLabel={`${selectedIndex + 1} of ${uniqueTrades.length}`}
        />
      ) : null}

      {mounted && lightboxShot && lightboxIndex != null
        ? createPortal(
            <div
              className="trade-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label="Screenshot"
              onClick={() => setLightboxIndex(null)}
            >
              <button
                type="button"
                className="trade-lightbox__close"
                aria-label="Close screenshot"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex(null);
                }}
              >
                <X size={18} />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={lightboxShot.src}
                alt={shotLabel(lightboxShot)}
                onClick={(e) => e.stopPropagation()}
              />
              <div
                className="gallery-lightbox__bar"
                onClick={(e) => e.stopPropagation()}
              >
                <p>
                  <span className="mono">{lightboxShot.trade.symbol}</span>
                  {" · "}
                  <span className={badgeClass(lightboxShot.trade.result)}>
                    {lightboxShot.trade.result}
                  </span>
                  {" · "}
                  <span className={pnlTone(lightboxShot.trade.pnlUsd)}>
                    {formatPnlUsd(lightboxShot.trade.pnlUsd)}
                  </span>
                  {lightboxShot.shotCount > 1
                    ? ` · ${lightboxShot.shotIndex + 1} of ${lightboxShot.shotCount}`
                    : ""}
                  {` · ${lightboxIndex + 1} / ${shots.length}`}
                </p>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => openTrade(lightboxShot.trade.id)}
                >
                  Open trade
                </button>
              </div>
              {shots.length > 1 ? (
                <>
                  <ShotNavButton
                    direction="prev"
                    disabled={lightboxIndex === 0}
                    onClick={() => setLightboxIndex(lightboxIndex - 1)}
                  />
                  <ShotNavButton
                    direction="next"
                    disabled={lightboxIndex === shots.length - 1}
                    onClick={() => setLightboxIndex(lightboxIndex + 1)}
                  />
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
