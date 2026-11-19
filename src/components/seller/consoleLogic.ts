// Pure helpers for the live console: the seller-demo coach line, and a ledger order that holds still under the pointer.
import type { ConsoleState, DropState } from "../../lib/types.ts";

export const DEMO_BUYERS = 40;

/**
 * One line of guidance for the seller demo (sandbox drops), from the furthest step the real console state has reached:
 * Drop next -> watch the ledger -> holds expire and the queue moves -> confirm a "says paid" order -> ship it
 * -> mute the buyer the scam shield caught -> end the drop.
 */
export function sellerCoach(state: Pick<DropState, "status" | "live" | "items">, c: Pick<ConsoleState, "ledger" | "moderation" | "bans">): string {
  if (state.status === "ended") return "That's the whole drop. Open the results to see the numbers.";
  if (state.status === "scheduled") return `Press Go live, then Drop next — ${DEMO_BUYERS} demo buyers are waiting`;
  const has = (s: string) => c.ledger.some((r) => r.state === s);
  const caught = c.moderation.some((m) => m.rule !== "staff" && m.buyerId && !c.bans.some((b) => b.buyerId === m.buyerId));
  if (has("shipped")) return caught ? "Mute the buyer the scam shield caught" : "End the drop and see the results";
  if (has("paid")) return "Mark it shipped";
  if (has("payment_claimed")) return "Open an order that says paid and confirm it";
  if (has("waitlisted") || has("expired") || c.ledger.some((r) => r.promoted)) return "Demo holds run out fast: watch the queue move by itself";
  if (c.ledger.length || state.live || state.items.some((i) => i.state !== "queued")) return "Watch the ledger: first taps win, the rest queue";
  return `Press Drop next — ${DEMO_BUYERS} demo buyers are waiting`;
}

/** `sorted` in the order of `frozen` (ids captured when the pointer/focus entered); rows that are new go last. */
export function holdOrder<T extends { claimId: string }>(sorted: T[], frozen: string[] | null): T[] {
  if (!frozen) return sorted;
  const pos = new Map(frozen.map((id, i) => [id, i]));
  return sorted.map((r, i) => ({ r, k: pos.get(r.claimId) ?? frozen.length + i })).sort((a, b) => a.k - b.k).map((x) => x.r);
}
