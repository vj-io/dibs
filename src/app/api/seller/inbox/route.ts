// Seller inbox: this shop's orders whose buyer wrote since the team last had the order open (newest first, 20).
import { sql } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { activeStaff } from "@/lib/server/queries";
import type { InboxItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route("GET /api/seller/inbox", async () => {
  const s = await activeStaff();
  const items = await sql<InboxItem[]>`
    select o.id as "orderId", o.order_no as "orderNo", b.display_name as buyer, p.title as item,
           o.buyer_unread as unread, o.buyer_last_text as "lastText", o.buyer_msg_at as at
      from orders o join buyers b on b.id = o.buyer_id join claims c on c.id = o.claim_id
      join drop_items i on i.id = c.drop_item_id join products p on p.id = i.product_id
     where o.shop_id = ${s.shopId} and o.buyer_unread > 0
     order by o.buyer_msg_at desc nulls last limit 20`;
  return json({ items });
});
