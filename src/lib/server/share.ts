// Share-link lookups for link previews, the calendar file and the fairness record. Read-only: no sweep, no viewer count. Server only.
import { fn, sql } from "./db.ts";
import type { DropState } from "../types.ts";
import type { RecordPay, RecordPiece, RecordTap } from "../record.ts";

export type SharedDrop = Omit<DropState, "viewers">;

export async function dropById(id: string): Promise<SharedDrop | null> {
  return fn<SharedDrop | null>("drop_state", id);
}

/** /s/<shop>/d/<code> -> drop, or null when the link is malformed or unknown. */
export async function dropByCode(shop: string, code: string): Promise<SharedDrop | null> {
  if (!/^[a-z0-9-]{3,30}$/.test(shop) || !/^[A-Za-z0-9]{6}$/.test(code)) return null;
  const [d] = await sql<{ id: string }[]>`
    select d.id from drops d join shops s on s.id = d.shop_id where s.slug = ${shop} and d.code = ${code.toUpperCase()}`;
  return d ? dropById(d.id) : null;
}

export const shareUrl = (d: SharedDrop, base: string) => `${base}/s/${d.shop.slug}/d/${d.code}`;

/**
 * The fairness record's rows: pieces in drop order, every claim in commit order (committed_at, id: the waitlist's own
 * order), and paid-order timing. Public: display names only, never a phone; the waitlist place and who got a returned
 * unit come from the engine's audit events.
 */
export async function dropRecord(dropId: string): Promise<{ pieces: RecordPiece[]; taps: RecordTap[]; pay: RecordPay }> {
  const pieces = await sql<RecordPiece[]>`
    select i.id as "itemId", i.position, p.title, i.live_at as "liveAt",
           (select count(*)::int from item_stock s where s.drop_item_id = i.id) as variants
      from drop_items i join products p on p.id = i.product_id where i.drop_id = ${dropId} order by i.position`;
  const taps = await sql<RecordTap[]>`
    with a as (select type, payload from audit_events where drop_id = ${dropId}
                and type in ('claim_waitlisted', 'hold_expired', 'hold_released', 'hold_cancelled'))
    select row_number() over (order by c.committed_at, c.id)::int as seq, c.drop_item_id as "itemId", c.buyer_id as "buyerId",
           b.display_name as buyer, b.is_bot as "isBot", pv.label as "variantLabel", c.state, c.ms_after_live as ms,
           c.promoted_at is not null as promoted, (w.payload->>'position')::int as "waitPos", nb.display_name as "passedTo"
      from claims c join buyers b on b.id = c.buyer_id join product_variants pv on pv.id = c.variant_id
      left join a w on w.type = 'claim_waitlisted' and w.payload->>'claimId' = c.id::text
      left join a h on h.type <> 'claim_waitlisted' and h.payload->>'claimId' = c.id::text
      left join claims nc on nc.id = (h.payload->>'promotedClaimId')::uuid
      left join buyers nb on nb.id = nc.buyer_id
     where c.drop_id = ${dropId} order by seq`;
  const [pay] = await sql<RecordPay[]>`
    select count(*)::int as "paidOrders",
           (extract(epoch from max(o.paid_at) - (select min(live_at) from drop_items where drop_id = ${dropId})) * 1000)::int as "spanMs",
           (percentile_cont(0.5) within group (order by extract(epoch from o.paid_at - o.created_at)) * 1000)::int as "medianPayMs"
      from orders o where o.drop_id = ${dropId} and o.state in ('paid', 'shipped') and o.paid_at is not null`;
  return { pieces, taps, pay };
}
