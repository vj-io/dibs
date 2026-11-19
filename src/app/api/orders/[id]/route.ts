// One order for its buyer or the shop's staff: item, payment details, status history, timer, order-room id.
// The buyer's phone only for staff. Staff opening an order room they are not in get added (outbox, idempotent).
import { afterWrite } from "@/lib/server/after";
import { sql } from "@/lib/server/db";
import { flags } from "@/lib/server/flags";
import { bus } from "@/lib/server/mockbus";
import { drainOutbox } from "@/lib/server/outbox";
import { json, route, uuidParam } from "@/lib/server/http";
import { enqueue, orderAccess, sweep } from "@/lib/server/queries";
import type { OrderView } from "@/lib/types";
import { upiLink } from "@/lib/upi";

const DEMO_PAY = "Dibs demo: no real payment"; // same text as the DB:Pay trigger in 0009

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route("GET /api/orders/:id", async (req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const a = await orderAccess(id, new URL(req.url).searchParams.get("as") === "staff" ? "staff" : "buyer");
  const o = a.order;
  const wrote = await sweep(o.drop_id);
  if (a.as === "staff") {
    // Any staff of the shop may open any of its orders. Group history refuses non-members (mock and Nexconn alike),
    // so the membership is in place before this answers: the client asks for history right after.
    const uid = `s_${a.staff.staffId}`, group = o.nexconn_group_id;
    const member = flags.mode === "mock" ? bus().history(group, uid) !== null
      : (await sql`select 1 from outbox where channel_id = ${group} and msg_type = 'SYS:EnsureGroup' and status = 'sent'
                     and payload->'memberIds' ? ${uid} limit 1`).length > 0;
    if (!member) {
      const [queued] = await sql`select 1 from outbox where channel_id = ${group} and msg_type = 'SYS:EnsureGroup' and status = 'pending'
                                   and payload->'memberIds' ? ${uid} limit 1`;
      if (!queued) await enqueue(o.drop_id, "group", group, "SYS:EnsureGroup", { channelId: group, name: `Order #${o.order_no}`, memberIds: [uid] });
      await drainOutbox({ channels: [group], budgetMs: 5000 });
    }
  }
  if (wrote) await afterWrite(o.drop_id);

  const [r] = await sql<{
    state: OrderView["state"]; claim_state: string; expires_at: Date | null; utr: string | null; tracking_note: string | null;
    paid_at: Date | null; shipped_at: Date | null; cancelled_at: Date | null; item_id: string; position: number; title: string;
    note: string | null; photos: string[]; vkey: string; vlabel: string; drop_code: string; drop_title: string; drop_sandbox: boolean;
    shop_name: string; shop_slug: string; support_whatsapp: string | null; upi_id: string | null; payee: string;
    staff_id: string | null; staff_name: string | null; buyer_name: string; phone: string | null;
  }[]>`
    select o.state, c.state as claim_state, c.expires_at, o.utr, o.tracking_note, o.paid_at, o.shipped_at, o.cancelled_at,
           i.id as item_id, i.position, p.title, p.note, p.photos, pv.key as vkey, pv.label as vlabel,
           d.code as drop_code, d.title as drop_title, d.is_sandbox as drop_sandbox,
           s.name as shop_name, s.slug as shop_slug, s.support_whatsapp, s.upi_id, coalesce(s.payee_name, s.name) as payee,
           st.id as staff_id, st.display_name as staff_name, b.display_name as buyer_name, b.phone
      from orders o join claims c on c.id = o.claim_id join drop_items i on i.id = c.drop_item_id
      join products p on p.id = i.product_id join product_variants pv on pv.id = c.variant_id
      join drops d on d.id = o.drop_id join shops s on s.id = o.shop_id join buyers b on b.id = o.buyer_id
      left join staff st on st.id = o.assigned_staff_id
     where o.id = ${id}`;
  const history = await sql<OrderView["history"]>`
    select case when e.type like 'hold_%' and e.payload->>'promotedClaimId' = ${o.claim_id} then 'hold_promoted' else e.type end as type,
           e.created_at as at, e.actor_type as actor,
           coalesce(e.payload->>'note', nullif(e.payload->>'reason', ''), case when e.type = 'payment_claimed' then 'UTR ' || (e.payload->>'utr') end) as note
      from audit_events e
     where e.drop_id = ${o.drop_id}
       and (e.payload->>'orderId' = ${id} or e.payload->>'claimId' = ${o.claim_id} or e.payload->>'promotedClaimId' = ${o.claim_id})
     order by e.id`;
  const amount = Number(o.amount_paise);
  const view: OrderView = {
    viewer: a.as, orderId: o.id, orderNo: o.order_no, claimId: o.claim_id, state: r.state, amountPaise: amount,
    createdAt: o.created_at.toISOString(),
    expiresAt: r.state === "held" && r.claim_state === "held" && r.expires_at ? r.expires_at.toISOString() : null,
    utr: r.utr, trackingNote: r.tracking_note, paidAt: r.paid_at?.toISOString() ?? null, shippedAt: r.shipped_at?.toISOString() ?? null,
    cancelledAt: r.cancelled_at?.toISOString() ?? null,
    item: { itemId: r.item_id, position: r.position, title: r.title, note: r.note, photos: r.photos },
    variant: { key: r.vkey, label: r.vlabel },
    drop: { id: o.drop_id, code: r.drop_code, title: r.drop_title, isSandbox: r.drop_sandbox },
    shop: { id: o.shop_id, name: r.shop_name, slug: r.shop_slug, supportWhatsapp: r.support_whatsapp },
    payment: { upiId: r.upi_id, payee: r.payee, amountPaise: amount,
      // a demo shop's card is never payable (demo@upi could be a stranger's): plain text instead of a upi:// link
      upiLink: r.drop_sandbox ? DEMO_PAY : r.upi_id ? upiLink({ upiId: r.upi_id, payee: r.payee, amountPaise: amount, orderNo: o.order_no }) : null,
      demo: r.drop_sandbox },
    buyer: a.as === "staff" ? { displayName: r.buyer_name, phone: r.drop_sandbox ? null : r.phone /* demo sellers are anonymous */ } : { displayName: r.buyer_name },
    assignedTo: r.staff_id ? { staffId: r.staff_id, displayName: r.staff_name! } : null,
    nexconnGroupId: o.nexconn_group_id,
    history,
  };
  return json(view);
});
