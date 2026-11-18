"use client";
/* eslint-disable @next/next/no-img-element -- product photos are SVG drawings or pre-compressed Storage images */
import { useEffect, useRef, useState } from "react";
import { cx } from "./cx";
import { Icon } from "./icons";

/**
 * Swipeable product photos (native scroll-snap), up to 4, 4:5 portrait, with dots.
 * The first photo loads eagerly; `onFirstLoad` fires once it has loaded (enable Dibs after it).
 */
export function PhotoCarousel({ photos, alt, onFirstLoad, className, children }: {
  photos: string[]; alt: string; onFirstLoad?: () => void; className?: string;
  /** Overlay (e.g. a SOLD stamp), positioned over the photos. */
  children?: React.ReactNode;
}) {
  const list = photos.slice(0, 4);
  const row = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLImageElement>(null);
  const [idx, setIdx] = useState(0);
  const fired = useRef(false);
  const loaded = () => { if (!fired.current) { fired.current = true; onFirstLoad?.(); } };

  // A cached first photo can finish loading before hydration attaches onLoad.
  useEffect(() => { if (first.current?.complete && first.current.naturalWidth && !fired.current) { fired.current = true; onFirstLoad?.(); } }, [onFirstLoad]);

  const go = (i: number) => {
    const el = row.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };

  if (!list.length) {
    return (
      <div className={cx("grid aspect-[4/5] place-items-center self-start rounded-wobble border-[2.5px] border-ink bg-grey text-grey-ink", className)}>
        <span className="flex flex-col items-center gap-1 font-hand text-lg"><Icon name="bag" size={32} />No photo yet</span>
      </div>
    );
  }

  return (
    <div className={cx("relative self-start overflow-hidden rounded-wobble border-[2.5px] border-ink bg-card", className)}>
      <div ref={row} className="snap-row aspect-[4/5] w-full" aria-roledescription="carousel" aria-label={`${alt}: photos`}
        onScroll={(e) => { const el = e.currentTarget; setIdx(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); }}>
        {list.map((src, i) => (
          <img key={src + i} ref={i === 0 ? first : undefined} src={src}
            alt={list.length > 1 ? `${alt}, photo ${i + 1} of ${list.length}` : alt}
            loading={i === 0 ? "eager" : "lazy"} fetchPriority={i === 0 ? "high" : "low"} decoding="async" draggable={false}
            onLoad={i === 0 ? loaded : undefined}
            className="h-full w-full object-cover" />
        ))}
      </div>
      {list.length > 1 && (
        <div className="absolute inset-x-0 bottom-0 flex justify-center">
          {list.map((_, i) => (
            <button key={i} type="button" onClick={() => go(i)} aria-label={`Photo ${i + 1}`} aria-current={i === idx ? "true" : undefined}
              className="grid size-12 place-items-center">
              <span className={cx("block rounded-full border-2 border-ink motion-safe:transition-all", i === idx ? "h-3 w-5 bg-lime" : "size-3 bg-card")} />
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}
