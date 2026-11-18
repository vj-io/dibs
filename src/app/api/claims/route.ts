// The Dibs tap. received_at = server clock when the request arrived; the engine decides inside one locked
// transaction. Every outcome is HTTP 200 with `result` + the PRD copy in `message`; 5 calls per second per buyer.
import { after } from "next/server";
import { z } from "zod";
import { afterWrite } from "@/lib/server/after";
import { fn, sql } from "@/lib/server/db";
import { body, json, notFound, route } from "@/lib/server/http";
import { sweep } from "@/lib/server/queries";
import { rateLimit } from "@/lib/server/ratelimit";
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
  const [, meta] = await Promise.all([
    rateLimit(`claim:${b.buyerId}`, 5, 1, "Easy! One tap is enough."),
    // a human in a judge-mode drop holds for 90 s (_hold_secs in 0006); buyers here are never bots
    sql<{ drop_id: string; hold_seconds: number; max_holds: number }[]>`
      select i.drop_id, case when exists (select 1 from try_slots t where t.drop_id = d.id) then 90 else s.hold_seconds end as hold_seconds, s.max_holds from drop_items i join drops d on d.id = i.drop_id join shops s on s.id = d.shop_id
       where i.id = ${input.itemId}`,
  ]);
  if (!meta[0]) notFound();
  const { drop_id: dropId } = meta[0];
  if (await sweep(dropId)) await afterWrite(dropId); // an expired hold ahead hands its unit on before this tap queues
  const r = await fn<Omit<ClaimResult, "message">>("claim_dibs", input.itemId, input.variantKey, b.buyerId, receivedAt);
  // the buyer gets the result at once; the drain starts the moment the response is sent (same instance, waitUntil)
  if (r.result === "won" || r.result === "waitlisted") after(() => afterWrite(dropId));
  return json({ ...r, message: message(r, meta[0]) } satisfies ClaimResult);
});
