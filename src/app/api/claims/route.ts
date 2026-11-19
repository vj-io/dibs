// The Dibs tap. received_at = server clock when the request arrived; the engine decides inside one locked
// transaction. Every outcome is HTTP 200 with `result` + the PRD copy in `message`; 5 calls per second per buyer.
import { after } from "next/server";
import { z } from "zod";
import { afterWrite } from "@/lib/server/after";
import { rpc } from "@/lib/server/db";
import { body, fail, json, notFound, route } from "@/lib/server/http";
import { requireBuyer } from "@/lib/server/session";
import type { ClaimOutcome, ClaimResult } from "@/lib/types";

export const dynamic = "force-dynamic";

const Body = z.object({ itemId: z.uuid(), variantKey: z.string().min(1).max(32) });
const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

function message(r: Omit<ClaimResult, "message">, shop: { hold_seconds: number; max_holds: number }): string {
  const m: Record<ClaimOutcome, string> = {
    won: `You got it! Pay within ${mmss(shop.hold_seconds)}`,
    waitlisted: `You're #${r.position} on the waitlist. We'll tell you the moment it's yours.`,
    already: r.orderId ? "You already have this piece. Pay to keep it." : `You're already #${r.position ?? "?"} on the waitlist for this piece.`,
    too_many_holds: `You're holding ${shop.max_holds} pieces. Pay or release one to claim more.`,
    waitlist_full: "Sold out · waitlist full",
    not_live: "Not live yet",
    closed: "Closed",
    banned: "You can't claim in this sale room.",
    no_variant: "That size isn't available for this piece.",
  };
  return m[r.result];
}

export const POST = route("POST /api/claims", async (req: Request) => {
  const receivedAt = new Date();
  const b = await requireBuyer();
  const input = await body(req, Body);
  // one round trip: rate limit, item lookup, sweep of expired holds ahead of this tap, then the claim (api_claim, 0007)
  const r = await rpc<{ rateLimited?: boolean; notFound?: boolean; dropId: string; maxHolds: number; holdSeconds: number; swept: boolean; claim: Omit<ClaimResult, "message"> }>(
    "api_claim", { p_item: input.itemId, p_variant_key: input.variantKey, p_buyer: b.buyerId, p_received: receivedAt.toISOString() });
  if (r.rateLimited) fail(429, "rate_limited", "Easy! One tap is enough.");
  if (r.notFound) notFound();
  // the buyer gets the result at once; the drain starts the moment the response is sent (same instance, waitUntil)
  if (r.swept || r.claim.result === "won" || r.claim.result === "waitlisted") after(() => afterWrite(r.dropId));
  const res: ClaimResult = { ...r.claim, message: message(r.claim, { hold_seconds: r.holdSeconds, max_holds: r.maxHolds }) };
  // serverMs: request arrival to response on this instance (the load simulation splits network from server time with it)
  return json({ ...res, serverMs: Date.now() - receivedAt.getTime() });
});
