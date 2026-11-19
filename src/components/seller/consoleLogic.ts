// Pure helpers for the live console: the seller-demo coach line, and a ledger order that holds still under the pointer.
import type { ConsoleState, DropState } from "../../lib/types.ts";

export const DEMO_BUYERS = 40;

/** Where the coach's step happens: the drop controls, a console section ("Show me" scrolls there), or the end controls. */
export type CoachStep = "drop" | "claims" | "moderation" | "end" | "results";

/**
 * One line of guidance for the seller demo (sandbox drops), from the furthest step the real console state has reached:
 * Drop next -> watch the ledger -> holds expire and the queue moves -> confirm a "says paid" order -> ship it
 * -> mute the buyer the scam shield caught -> end the drop.
 */
export function sellerCoach(state: Pick<DropState, "status" | "live" | "items">, c: Pick<ConsoleState, "ledger" | "moderation" | "bans">): { text: string; step: CoachStep } {
  if (state.status === "ended") return { text: "That's the whole drop. Open the results to see the numbers.", step: "results" };
  if (state.status === "scheduled") return { text: `Press Go live, then Drop next — ${DEMO_BUYERS} demo buyers are waiting`, step: "drop" };
  const has = (s: string) => c.ledger.some((r) => r.state === s);
  const caught = c.moderation.some((m) => m.rule !== "staff" && m.buyerId && !c.bans.some((b) => b.buyerId === m.buyerId));
  if (has("shipped")) return caught ? { text: "Mute the buyer the scam shield caught", step: "moderation" } : { text: "End the drop and see the results", step: "end" };
  if (has("paid")) return { text: "Mark it shipped", step: "claims" };
  if (has("payment_claimed")) return { text: "Open an order that says paid and confirm it", step: "claims" };
  if (has("waitlisted") || has("expired") || c.ledger.some((r) => r.promoted)) return { text: "Demo holds run out fast: watch the queue move by itself", step: "claims" };
  if (c.ledger.length || state.live || state.items.some((i) => i.state !== "queued")) return { text: "Watch the ledger: first taps win, the rest queue", step: "claims" };
  return { text: `Press Drop next — ${DEMO_BUYERS} demo buyers are waiting`, step: "drop" };
}

/**
 * Oldest message time the team desk feed shows. A demo shop is a reused slot: its desk channel still carries earlier
 * visitors' cards and chat, and their drops are gone, so nothing older than this shop's oldest drop is this visit's
 * (same idea as the sale room's floor). Real shops: no floor. Drops not loaded yet: show nothing rather than a stranger's.
 */
export function deskFeedFloor(isSandbox: boolean, drops: { createdAt: string }[] | null): number {
  if (!isSandbox) return 0;
  if (drops === null) return Infinity;
  return drops.length ? Math.min(...drops.map((d) => Date.parse(d.createdAt))) - 2000 : 0;
}

/** `sorted` in the order of `frozen` (ids captured when the pointer/focus entered); rows that are new go last. */
export function holdOrder<T extends { claimId: string }>(sorted: T[], frozen: string[] | null): T[] {
  if (!frozen) return sorted;
  const pos = new Map(frozen.map((id, i) => [id, i]));
  return sorted.map((r, i) => ({ r, k: pos.get(r.claimId) ?? frozen.length + i })).sort((a, b) => a.k - b.k).map((x) => x.r);
}
