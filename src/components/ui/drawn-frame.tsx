"use client";
import { useEffect, useRef, useState } from "react";

// Wobbly rectangle at the card's real pixel size, so pathLength-based drawing stays exact
// (a stretched viewBox with non-scaling-stroke breaks dash maths in Chromium).
function frame(w: number, h: number) {
  const j = (n: number) => ((Math.sin(n * 12.9898 + w * 0.01 + h * 0.07) * 43758.5453) % 1) * 2.2;
  const i = 1.5;
  return `M${i + j(1)} ${i + 2} C${w * 0.3} ${i + j(2)}, ${w * 0.7} ${i + 1.5 + j(3)}, ${w - i} ${i + j(4)}`
    + ` C${w - i + j(5)} ${h * 0.3}, ${w - i - 1 + j(6)} ${h * 0.7}, ${w - i + j(7)} ${h - i}`
    + ` C${w * 0.7} ${h - i + j(8)}, ${w * 0.3} ${h - i - 1 + j(9)}, ${i + j(10)} ${h - i + j(11)}`
    + ` C${i - 1 + j(12)} ${h * 0.7}, ${i + j(13)} ${h * 0.3}, ${i + 1 + j(14)} ${i - 1}`;
}

/**
 * Draws the parent card's ink frame when it first scrolls into view (motion-safe only).
 * Until then, and with reduced motion, the card's own CSS border is the final drawn state.
 */
export function DrawnFrame() {
  const ref = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el || !matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      setSize({ w: el.offsetWidth, h: el.offsetHeight });
    }, { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <span ref={ref} aria-hidden="true" className={size && !done ? "drawn-frame" : "hidden"}>
      {size && !done && (
        <svg width={size.w} height={size.h} className="pointer-events-none absolute -left-[2.5px] -top-[2.5px] overflow-visible">
          <path d={frame(size.w, size.h)} fill="none" stroke="var(--color-ink)" strokeWidth={2.6} strokeLinecap="round" pathLength={1} className="draw" onAnimationEnd={() => setDone(true)} />
        </svg>
      )}
    </span>
  );
}
