"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cx } from "./cx";
import { Icon } from "./icons";

// One shared 250 ms clock for every countdown on the page.
let now = Date.now();
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function subscribe(cb: () => void) {
  subs.add(cb);
  if (!timer) timer = setInterval(() => { now = Date.now(); subs.forEach((f) => f()); }, 250);
  now = Date.now();
  return () => { subs.delete(cb); if (!subs.size && timer) { clearInterval(timer); timer = null; } };
}
const useNow = () => useSyncExternalStore(subscribe, () => now, () => null);

export const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

/** Screen-reader message for the current remaining time: changes only at 2:00, 1:00, 0:10 and 0:00. */
export function countdownAnnouncement(sec: number): string {
  if (sec <= 0) return "Time is up.";
  if (sec <= 10) return "10 seconds left.";
  if (sec <= 60) return "Under 1 minute left.";
  if (sec <= 120) return "Under 2 minutes left.";
  return "";
}

export type CountdownProps = {
  /** ISO time the hold ends. */
  expiresAt: string;
  /** Freezes the display (e.g. while payment is being checked). */
  paused?: boolean;
  /** Called once when the time reaches 0 (not while paused). */
  onDone?: () => void;
  /** Under this many seconds the timer turns urgent (pink). Default 120. */
  urgentBelow?: number;
  size?: "sm" | "md" | "lg";
  /** Visible lead-in, e.g. "Pay within". */
  label?: string;
  className?: string;
  /** false: never speaks (rows in a list, where many timers would talk over each other). Default true. */
  announce?: boolean;
};

/** MM:SS in mono. aria-live is off on the ticking digits; a polite region speaks only at 2:00, 1:00 and 0:10. */
export function Countdown({ expiresAt, paused, onDone, urgentBelow = 120, size = "md", label, className, announce = true }: CountdownProps) {
  const t = useNow();
  const [frozenAt, setFrozenAt] = useState<number | null>(null);
  if (paused && frozenAt === null && t !== null) setFrozenAt(t);
  if (!paused && frozenAt !== null) setFrozenAt(null);

  const at = paused ? (frozenAt ?? t) : t;
  const end = Date.parse(expiresAt);
  const sec = at === null || Number.isNaN(end) ? null : Math.max(0, Math.ceil((end - at) / 1000));
  const urgent = sec !== null && sec < urgentBelow && !paused;

  // speak only when a threshold is crossed while this timer is on screen, never the one it starts in
  // (a 1:30 hold used to announce "Under 2 minutes left." the moment it appeared)
  const msg = sec === null ? "" : countdownAnnouncement(sec);
  const [start, setStart] = useState<{ at: string; msg: string } | null>(null);
  if (sec !== null && start?.at !== expiresAt) setStart({ at: expiresAt, msg });
  const spoken = announce && !paused && start?.at === expiresAt && msg !== start.msg ? msg : "";

  const done = useRef(false);
  useEffect(() => { done.current = false; }, [expiresAt]);
  useEffect(() => {
    if (sec === 0 && !paused && !done.current) { done.current = true; onDone?.(); }
  }, [sec, paused, onDone]);

  return (
    <span className={cx(
      "inline-flex items-center gap-1.5 rounded-pill border-2 border-ink font-mono font-bold tabular-nums leading-none",
      { sm: "px-2 py-1 text-sm", md: "px-2.5 py-1.5 text-base", lg: "px-3.5 py-2 text-2xl" }[size],
      paused ? "bg-grey text-ink" : urgent ? "bg-pink text-ink" : "bg-card text-ink",
      className,
    )}>
      <Icon name={paused ? "pause" : "clock"} size={size === "lg" ? 22 : 16} stroke={2.6} className={urgent ? "tick-urgent" : undefined} />
      {label && <span className="font-sans font-semibold">{label}</span>}
      <span aria-live="off" role="timer" aria-label={sec === null ? undefined : `${Math.floor(sec / 60)} minutes ${sec % 60} seconds left`}>
        {sec === null ? "--:--" : mmss(sec)}
      </span>
      {paused && <span className="font-sans font-semibold">paused</span>}
      {announce && <span className="sr-only" aria-live="polite">{spoken}</span>}
    </span>
  );
}
