-- 0016: my_status tells a buyer a little more about their own claims, so the buyer demo's last card can show the
-- judge's real numbers and the waitlist line can show when the queue moves next. Additive: same signature, new keys
-- only (older clients ignore them). Re-runnable.
--   holds[].ms          ms after the piece went live that this buyer tapped (claims.ms_after_live)
--   holds[].promotedMs  a hold that came off the waitlist: ms from the tap to the promotion (promoted_at), else null
--   holds[].waitedAt    that hold's place in line when tapped (the claim_waitlisted audit row), else null
--   waits[].nextEndsAt  the earliest running hold on the same piece and size (the next time the line can move), else null
create or replace function my_status(p_drop uuid, p_buyer uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'holds', (select coalesce(jsonb_agg(jsonb_build_object('claimId', c.id, 'orderId', c.order_id, 'itemId', i.id, 'position', i.position,
                'title', p.title, 'variantLabel', pv.label, 'state', c.state,
                'expiresAt', case when c.state = 'held' then c.expires_at end, 'pricePaise', p.price_paise,
                'ms', c.ms_after_live,
                'promotedMs', case when c.promoted_at is not null
                                   then round(extract(epoch from (c.promoted_at - c.committed_at)) * 1000)::int end,
                'waitedAt', case when c.promoted_at is not null
                                 then (select (e.payload->>'position')::int from audit_events e
                                        where e.drop_id = c.drop_id and e.type = 'claim_waitlisted' and e.payload->>'claimId' = c.id::text
                                        limit 1) end) order by c.committed_at), '[]'::jsonb)
                from claims c join drop_items i on i.id = c.drop_item_id join products p on p.id = i.product_id
                join product_variants pv on pv.id = c.variant_id
               where c.drop_id = p_drop and c.buyer_id = p_buyer and c.state in ('held','payment_claimed','paid','shipped')),
    'waits', (select coalesce(jsonb_agg(jsonb_build_object('claimId', c.id, 'itemId', i.id, 'position', i.position, 'title', p.title,
                'variantKey', pv.key, 'variantLabel', pv.label, 'waitPosition', _wait_pos(c.id),
                'nextEndsAt', (select min(h.expires_at) from claims h
                                where h.drop_item_id = c.drop_item_id and h.variant_id = c.variant_id and h.state = 'held'))
              order by c.committed_at), '[]'::jsonb)
                from claims c join drop_items i on i.id = c.drop_item_id join products p on p.id = i.product_id
                join product_variants pv on pv.id = c.variant_id
               where c.drop_id = p_drop and c.buyer_id = p_buyer and c.state = 'waitlisted'),
    'mutedUntil', (select case when bool_or(b.until is null) then 'infinity'::timestamptz else max(b.until) end from bans b
                    where b.shop_id = d.shop_id and b.buyer_id = p_buyer and b.kind = 'mute' and (b.until is null or b.until > now())),
    'banned', exists (select 1 from bans b where b.shop_id = d.shop_id and b.buyer_id = p_buyer and b.kind = 'ban' and (b.until is null or b.until > now())))
  from drops d where d.id = p_drop $$;

notify pgrst, 'reload schema';
