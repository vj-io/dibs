// Judge-mode hooks. API routes call these after engine writes; they do nothing for real drops.
// Owned by the judge-mode package (bots, scripted taps, demo staff). Server only.
export type DropEvent =
  | { type: "item_live"; dropId: string; itemId: string }
  | { type: "drop_live"; dropId: string }
  | { type: "order_paid_claim"; dropId: string; orderId: string }
  | { type: "drop_ended"; dropId: string };

/** Called after the engine write and the inline outbox drain. Must never throw. */
export async function onDropEvent(_event: DropEvent): Promise<void> {}
