"use client";
// Small browser hooks shared by the buyer screens.
import { useEffect, useState, useSyncExternalStore } from "react";
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

/** Judge mode safety net: POST /api/try/tick every second while a sandbox room or order page is open.
 *  `where` tells the bot script where the judge is (piece 2 waits until they are back in the room).
 *  Fire-and-forget: a slow tick never blocks the page; after 8 s we stop waiting for it and send the next one.
 *  Returns true while a tick has been in flight for more than 3 s (the coach says "Waiting for the server…"). */
export function useTryTick(dropId: string | null | undefined, where: "room" | "order"): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!dropId) return;
    let stopped = false, since = 0;
    const t = setInterval(() => {
      if (stopped || !navigator.onLine) return;
      const now = Date.now();
      if (since) { setSlow(now - since > 3000); if (now - since < 8000) return; }
      const mine = since = now;
      withTimeout(api("POST /api/try/tick", { dropId, where }), 8000)
        .catch((e: { status?: number }) => { if (e.status === 404) { stopped = true; clearInterval(t); } })
        .finally(() => { if (since === mine) { since = 0; setSlow(false); } });
    }, 1000);
    return () => { stopped = true; clearInterval(t); };
  }, [dropId, where]);
  return slow;
}

/** Rejects after `ms` (the request itself is not cancelled; its late answer is ignored by the caller). */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout", status: 0 })), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** True once `ms` have passed since mount (or since `key` changed): "Still connecting…" after a silent wait. */
export function useSlow(ms: number, key?: unknown): boolean {
  const [slow, setSlow] = useState<{ key: unknown; v: boolean }>({ key, v: false });
  useEffect(() => {
    const t = setTimeout(() => setSlow({ key, v: true }), ms);
    return () => clearTimeout(t);
  }, [ms, key]);
  return slow.key === key && slow.v;
}

/** The PRD's display time for receipts and chat: "20:04". */
export const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
