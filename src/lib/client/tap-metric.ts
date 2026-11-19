"use client";
// Fire-and-forget: tells the server how long a tap took to show its result. Never throws, never blocks the UI.
export function reportTap(m: { dropId: string; result: string; clientMs: number; serverMs?: number | null }): void {
  try {
    const type = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType;
    const body = JSON.stringify({
      dropId: m.dropId, result: m.result, clientMs: Math.round(m.clientMs),
      ...(m.serverMs != null && { serverMs: Math.round(m.serverMs) }),
      ...(type && { conn: type }),
    });
    // keepalive fetch rather than sendBeacon: it carries the JSON content type and the buyer cookie the same way
    void fetch("/api/metrics/tap", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch { /* metrics must never break a claim */ }
}
