// The buyer's own account across shops (GET), and deleting it (DELETE): name and phone wiped, active holds
// released and waitlists left through the engine; paid / shipped order rows stay for the seller.
import { afterWrite } from "@/lib/server/after";
import { fn, sql } from "@/lib/server/db";
import { fail, json, route } from "@/lib/server/http";
import { clearBuyer, requireBuyer } from "@/lib/server/session";
import type { BuyerSelf, MeOrder, MyAccount } from "@/lib/types";

export const dynamic = "force-dynamic";

async function liveBuyer(): Promise<BuyerSelf> {
  const s = await requireBuyer();
  const [b] = await sql<BuyerSelf[]>`
    select id, name, display_name as "displayName", phone from buyers where id = ${s.buyerId} and deleted_at is null`;
  return b ?? fail(401, "no_session", "Join the sale room first.");
}

export const GET = route("GET /api/me", async () => {
  const buyer = await liveBuyer();
  const orders = await sql<MeOrder[]>`
    select o.id as "orderId", o.order_no as "orderNo", o.state, o.amount_paise::float8 as "amountPaise",
           case when c.state = 'held' then c.expires_at end as "expiresAt", o.created_at as "createdAt",
           p.title, pv.label as "variantLabel", p.photos[1] as photo, d.code as "dropCode",
           json_build_object('name', s.name, 'slug', s.slug) as shop
      from orders o join claims c on c.id = o.claim_id join drop_items i on i.id = c.drop_item_id
      join products p on p.id = i.product_id join product_variants pv on pv.id = c.variant_id
      join drops d on d.id = o.drop_id join shops s on s.id = o.shop_id
     where o.buyer_id = ${buyer.id} order by o.created_at desc limit 200`;
  const waits = await sql<MyAccount["waits"]>`
    select c.id as "claimId", d.id as "dropId", d.code as "dropCode", json_build_object('name', s.name, 'slug', s.slug) as shop,
           p.title, i.position, pv.label as "variantLabel", _wait_pos(c.id) as "waitPosition"
      from claims c join drops d on d.id = c.drop_id join shops s on s.id = d.shop_id join drop_items i on i.id = c.drop_item_id
      join products p on p.id = i.product_id join product_variants pv on pv.id = c.variant_id
     where c.buyer_id = ${buyer.id} and c.state = 'waitlisted' order by c.committed_at`;
  const active = (o: MeOrder) => o.state === "held" || o.state === "payment_claimed";
  return json({ buyer, holds: orders.filter(active), orders: orders.filter((o) => !active(o)), waits } satisfies MyAccount);
});

export const DELETE = route("DELETE /api/me", async () => {
  const buyer = await liveBuyer();
  const claims = await sql<{ id: string; drop_id: string; state: string }[]>`
    select id, drop_id, state from claims where buyer_id = ${buyer.id} and state in ('held','waitlisted','payment_claimed')`;
  let released = 0, left = 0, kept = 0;
  const drops = new Set<string>();
  for (const c of claims) {
    if (c.state === "payment_claimed") { kept++; continue; } // the buyer says they paid: the seller still has to settle it
    const r = c.state === "held"
      ? await fn<{ ok: boolean }>("release_claim", c.id, "buyer", buyer.id, "Buyer deleted their data")
      : await fn<{ ok: boolean }>("leave_waitlist", c.id, buyer.id);
    if (r.ok) { drops.add(c.drop_id); if (c.state === "held") released++; else left++; }
  }
  await sql`update buyers set name = 'Deleted buyer', display_name = 'Deleted buyer', phone = null, deleted_at = now() where id = ${buyer.id}`;
  await clearBuyer();
  if (drops.size) await afterWrite(null);
  return json({ ok: true, released, left, kept });
});
