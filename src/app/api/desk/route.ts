// Team desk for staff: the shop's orders grouped by state (newest first, 100 per group), with filters
// ?assigned=me|all|<staffId> and ?state=<one state>; plus the desk group id and the team for reassigning.
import { z } from "zod";
import { afterWrite } from "@/lib/server/after";
import { sql } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { activeStaff, sweep } from "@/lib/server/queries";
import type { Desk, DeskOrder, OrderState } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATES: OrderState[] = ["held", "payment_claimed", "paid", "shipped", "cancelled"];
const Query = z.object({
  assigned: z.union([z.literal("me"), z.literal("all"), z.uuid()]).default("all"),
  state: z.enum(["held", "payment_claimed", "paid", "shipped", "cancelled"]).optional(),
});

export const GET = route("GET /api/desk", async (req: Request) => {
  const s = await activeStaff();
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  const who = q.assigned === "me" ? s.staffId : q.assigned === "all" ? null : q.assigned;
  // Holds that ran out while nobody had the drop open (e.g. after End drop) end here, so they never list as waiting.
  const due = await sql<{ id: string }[]>`
    select d.id from drops d where d.shop_id = ${s.shopId}
       and exists (select 1 from claims c where c.drop_id = d.id and c.state = 'held' and c.expires_at <= now())`;
  for (const d of due) if (await sweep(d.id)) await afterWrite(d.id);
  const rows = await sql<{ o: DeskOrder }[]>`
    select to_jsonb(x) - 'rn' as o from (
      select o.id as "orderId", o.order_no as "orderNo", o.state, b.display_name as buyer, case when d.is_sandbox then null else b.phone end as phone, p.title as item, -- no phones in demo shops
             pv.label as "variantLabel", o.amount_paise::float8 as "amountPaise",
             case when st.id is null then null else json_build_object('staffId', st.id, 'displayName', st.display_name) end as "assignedTo",
             case when o.state = 'held' and c.state = 'held' then c.expires_at end as "expiresAt", o.created_at as "createdAt",
             d.code as "dropCode", o.utr, o.nexconn_group_id as "nexconnGroupId",
             row_number() over (partition by o.state order by o.created_at desc) as rn
        from orders o join claims c on c.id = o.claim_id join drop_items i on i.id = c.drop_item_id
        join products p on p.id = i.product_id join product_variants pv on pv.id = c.variant_id
        join buyers b on b.id = o.buyer_id join drops d on d.id = o.drop_id left join staff st on st.id = o.assigned_staff_id
       where o.shop_id = ${s.shopId}
         ${who ? sql`and o.assigned_staff_id = ${who}` : sql``}
         ${q.state ? sql`and o.state = ${q.state}` : sql``}) x
     where rn <= 100 order by x."createdAt" desc`;
  const orders = Object.fromEntries(STATES.map((st) => [st, [] as DeskOrder[]])) as Desk["orders"];
  for (const { o } of rows) orders[o.state].push(o);
  const [shop] = await sql<{ nexconn_desk_id: string | null }[]>`select nexconn_desk_id from shops where id = ${s.shopId}`;
  const staff = await sql<Desk["staff"]>`
    select id as "staffId", display_name as "displayName", role from staff where shop_id = ${s.shopId} and active order by role = 'owner' desc, created_at`;
  return json({ deskGroupId: shop.nexconn_desk_id, me: s.staffId, staff, orders } satisfies Desk);
});
