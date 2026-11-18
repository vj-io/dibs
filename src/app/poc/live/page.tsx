"use client";
// Harness for src/lib/client/live.ts (scripts/nexconn-poc-browser.py --live). Exposes window.live and window.liveLog.
import { useEffect, useState } from "react";
import { getLive } from "@/lib/client/live";

declare global { interface Window { live?: unknown; liveLog?: unknown[]; liveErr?: string } }

export default function LivePoc() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const log: unknown[] = (window.liveLog = []);
    const push = (x: object) => { log.push({ ...x, recvAt: Date.now() }); setN(log.length); };
    getLive().then((l) => {
      l.onStatus((s) => push({ ev: "status", s }));
      l.onAlert((card) => push({ ev: "alert", card }));
      l.onReceipts((r) => push({ ev: "receipts", r }));
      window.live = { l, push };
    }, (e) => { window.liveErr = String(e?.code ?? e); });
  }, []);
  return <p>live events: {n}</p>;
}
