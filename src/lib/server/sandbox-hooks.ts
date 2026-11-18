// Judge-mode hooks. API routes call these after engine writes; they do nothing for real drops.
// Owned by the judge-mode package (bots, scripted taps, demo staff). Server only.
import { cancelPending, onItemLive, onPaidClaim, slotOf, startRunner } from "./bots.ts";

export type DropEvent =
  | { type: "item_live"; dropId: string; itemId: string }
  | { type: "drop_live"; dropId: string }
  | { type: "order_paid_claim"; dropId: string; orderId: string }
  | { type: "drop_ended"; dropId: string };

/** Called after the engine write and the inline outbox drain. Must never throw. */
export async function onDropEvent(event: DropEvent): Promise<void> {
  try {
    const slot = await slotOf(event.dropId);
    if (!slot) return; // a real drop (or a sandbox drop already replaced)
    if (event.type === "item_live") await onItemLive(slot, event.itemId);
    else if (event.type === "order_paid_claim") await onPaidClaim(slot, event.orderId);
    else if (event.type === "drop_ended") await cancelPending(event.dropId);
    if (event.type !== "drop_ended") await startRunner(event.dropId);
  } catch (e) {
    console.error("[sandbox] onDropEvent", event.type, e instanceof Error ? e.message : e);
  }
}
