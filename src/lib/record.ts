// Fairness record (/s/<shop>/d/<code>/record): every tap on a drop in the order the database committed it.
// Pure: the query lives in server/share.ts; this turns its rows into plain words. Never sees a phone number.
import { displayName, tapTime } from "./codec.ts";
import type { ClaimState, DropStatus } from "./types.ts";

/** A piece in drop order. variants = how many sizes it has (the size shows on each tap only when there is a choice). */
export type RecordPiece = { itemId: string; position: number; title: string; liveAt: Date | string | null; variants: number };
/** One claim. seq = the server's commit order across the drop; waitPos = place in line when it joined; passedTo = who got the unit next. */
export type RecordTap = {
  seq: number; itemId: string; buyerId: string; buyer: string; isBot: boolean; variantLabel: string; state: ClaimState;
  ms: number | null; promoted: boolean; waitPos: number | null; passedTo: string | null;
};
/** Paid orders: how many, first piece live -> last confirmed payment, and the median order -> confirmed payment. */
export type RecordPay = { paidOrders: number; spanMs: number | null; medianPayMs: number | null };

export type TapLine = { name: string; isBot: boolean; variant: string | null; time: string | null; steps: string[] };
export type PieceRecord = { position: number; title: string; liveAt: Date | string | null; taps: TapLine[] };
export type Totals = { pieces: number; taps: number; buyers: number; fastestMs: number | null };

/** The public name the ticker shows ("Priya S."), with any digit dropped so a number can never reach this page. */
export const publicName = (name: string) => displayName(name.replace(/\d/g, ""));

const END: Record<ClaimState, string> = {
  held: "Holding, not paid yet",
  payment_claimed: "Says paid, seller checking",
  paid: "Paid",
  shipped: "Paid",
  waitlisted: "Still in line",
  left: "Left the line",
  missed: "Missed: no piece came back",
  expired: "Hold ran out",
  released: "Released the hold",
  cancelled: "Hold cancelled by the seller",
};

/** What happened to one tap, in order: "Waitlisted #1" -> "Got it from the waitlist" -> "Paid". */
export function steps(t: RecordTap): string[] {
  const queued = t.promoted || t.state === "waitlisted" || t.state === "left" || t.state === "missed";
  const s = [queued ? (t.waitPos ? `Waitlisted #${t.waitPos}` : "Waitlisted") : "Won"];
  if (t.promoted) s.push("Got it from the waitlist");
  s.push(END[t.state]);
  if (t.passedTo) s.push(`went to ${publicName(t.passedTo)}`);
  return s;
}

export function buildRecord(pieces: RecordPiece[], taps: RecordTap[]): { pieces: PieceRecord[]; totals: Totals } {
  const ordered = [...taps].sort((a, b) => a.seq - b.seq);
  const ms = ordered.flatMap((t) => (t.ms == null ? [] : [t.ms]));
  return {
    pieces: [...pieces].sort((a, b) => a.position - b.position).map((p) => ({
      position: p.position, title: p.title, liveAt: p.liveAt,
      taps: ordered.filter((t) => t.itemId === p.itemId).map((t) => ({
        name: publicName(t.buyer), isBot: t.isBot, variant: p.variants > 1 ? t.variantLabel : null,
        time: t.ms == null ? null : tapTime(t.ms), steps: steps(t),
      })),
    })),
    totals: { pieces: pieces.length, taps: taps.length, buyers: new Set(taps.map((t) => t.buyerId)).size, fastestMs: ms.length ? Math.min(...ms) : null },
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "3 pieces · 9 taps · 3 buyers" */
export const totalsLine = (t: Totals) => [plural(t.pieces, "piece"), plural(t.taps, "tap"), plural(t.buyers, "buyer")].join(" · ");

/** "Fair drop: 3 pieces · 9 taps · fastest tap 3.1 s" (link previews and the share message). */
export function recordHeadline(t: Totals, status: DropStatus, isSandbox: boolean): string {
  const label = isSandbox ? "Demo drop" : status === "live" ? "Live drop so far" : status === "scheduled" ? "Drop not started" : "Fair drop";
  const parts = [plural(t.pieces, "piece"), plural(t.taps, "tap")];
  if (t.fastestMs != null) parts.push(`fastest tap ${tapTime(t.fastestMs)}`);
  return `${label}: ${parts.join(" · ")}`;
}

/** 45 s, then minutes to one decimal ("5.5 minutes"). */
export const duration = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${(ms / 60_000).toFixed(1)} minutes`);

/** Up to two lines about paid orders; none when nothing is paid yet. */
export function payLines(p: RecordPay, isSandbox: boolean): string[] {
  if (!p.paidOrders || p.spanMs == null) return [];
  const lines = [`${plural(p.paidOrders, isSandbox ? "demo order" : "order")} sold and paid in ${duration(p.spanMs)}${isSandbox ? " (demo payments, not real money)" : ""}`];
  if (p.medianPayMs != null) lines.push(`Median time from order to confirmed payment: ${duration(p.medianPayMs)}`);
  return lines;
}

const CLOCK = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
/** "20 Nov, 12:15:15 pm IST" */
export const istTime = (at: Date | string) => `${CLOCK.format(new Date(at))} IST`;
