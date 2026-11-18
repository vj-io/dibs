"use client";
// Small browser hooks shared by the buyer screens.
import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/client/api";

// ---- a shared 1 s clock (render-safe "now")
let now = Date.now();
const clockSubs = new Set<() => void>();
let clock: ReturnType<typeof setInterval> | null = null;
function subscribeClock(cb: () => void) {
  clockSubs.add(cb);
  if (!clock) clock = setInterval(() => { now = Date.now(); clockSubs.forEach((f) => f()); }, 1000);
  now = Date.now();
  return () => { clockSubs.delete(cb); if (!clockSubs.size && clock) { clearInterval(clock); clock = null; } };
}
/** Date.now(), updated once a second; 0 during server render. */
export const useNow = () => useSyncExternalStore(subscribeClock, () => now, () => 0);

// ---- browser online flag
function subscribeOnline(cb: () => void) {
  addEventListener("online", cb);
  addEventListener("offline", cb);
  return () => { removeEventListener("online", cb); removeEventListener("offline", cb); };
}
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

// ---- phone or laptop (UPI button vs QR)
const isPhoneNow = () => matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
export const useIsPhone = () => useSyncExternalStore(() => () => {}, isPhoneNow, () => false);

/** Judge mode safety net: POST /api/try/tick every second while a sandbox room or order page is open. */
export function useTryTick(dropId: string | null | undefined) {
  useEffect(() => {
    if (!dropId) return;
    let stopped = false, busy = false;
    const t = setInterval(() => {
      if (busy || stopped || !navigator.onLine) return;
      busy = true;
      api("POST /api/try/tick", { dropId })
        .catch((e: { status?: number }) => { if (e.status === 404) { stopped = true; clearInterval(t); } })
        .finally(() => { busy = false; });
    }, 1000);
    return () => { stopped = true; clearInterval(t); };
  }, [dropId]);
}

/** The PRD's display time for receipts and chat: "20:04". */
export const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
