-- 0019: a tap answered "waitlist full" leaves a trace. It writes no claim row, so the fairness record could not show it;
-- now both places that answer it (the lock-free check and the locked path) write one claim_waitlist_full audit event:
-- itemId, variant, ms after the piece went live and at (clock_timestamp(), the moment the server answered: the locked
-- path's v_now, the same clock a claim's committed_at uses), so the record orders it among the claims.
-- claim_dibs is 0008's body unchanged apart from those lines. No new lock: the audit row's foreign-key check takes key
-- share on the drop, which the drop lock (no key update) does not block. create or replace keeps the existing grants
-- (0002/0006). Re-runnable.

create or replace function claim_dibs(p_item uuid, p_variant_key text, p_buyer uuid, p_received timestamptz) returns jsonb
language plpgsql as $$
declare
  v_drop_id uuid; v_d drops; v_item drop_items; v_shop shops; v_stock item_stock; v_variant product_variants; v_b buyers;
  v_existing claims; v_now timestamptz; v_ms int; v_id uuid; v_order uuid; v_exp timestamptz; v_left int; v_n int; v_v bigint; v_ch text;
begin
  if exists (
    select 1 from drop_items i join drops d on d.id = i.drop_id join shops s on s.id = d.shop_id
      join product_variants pv on pv.product_id = i.product_id and pv.key = p_variant_key
      join item_stock st on st.drop_item_id = i.id and st.variant_id = pv.id
      join buyers b on b.id = p_buyer
     where i.id = p_item and d.status = 'live' and d.live_item_id = p_item and i.state in ('live', 'sold_out')
       and st.available = 0
       and b.deleted_at is null and not ((b.is_bot or b.is_sandbox) and not d.is_sandbox)
       and not exists (select 1 from bans x where x.shop_id = s.id and x.buyer_id = p_buyer and x.kind = 'ban' and (x.until is null or x.until > now()))
       and not exists (select 1 from claims c where c.drop_item_id = p_item and c.buyer_id = p_buyer and c.state in ('held','payment_claimed','waitlisted'))
       and (select count(*) from claims w where w.drop_item_id = p_item and w.variant_id = pv.id and w.state = 'waitlisted') >= s.waitlist_max) then
    select * into v_item from drop_items where id = p_item;
    v_now := clock_timestamp();
    v_ms := greatest(0, round(extract(epoch from (v_now - coalesce(v_item.live_at, v_now))) * 1000))::int;
    perform _audit(v_item.drop_id, 'buyer', p_buyer, 'claim_waitlist_full', jsonb_build_object('itemId', p_item, 'variant', p_variant_key, 'ms', v_ms, 'at', v_now));
    return _claim_res('waitlist_full');
  end if;

  select drop_id into v_drop_id from drop_items where id = p_item;
  if not found then return _claim_res('not_live'); end if;
  select * into v_d from drops where id = v_drop_id for no key update;                 -- lock 1: drop
  select pv.* into v_variant from product_variants pv join drop_items i on i.product_id = pv.product_id
   where i.id = p_item and pv.key = p_variant_key;
  if not found then return _claim_res('no_variant'); end if;
  select * into v_stock from item_stock where drop_item_id = p_item and variant_id = v_variant.id for update;   -- lock 2: stock
  if not found then return _claim_res('no_variant'); end if;
  select * into v_item from drop_items where id = p_item;                              -- re-read after the locks
  if v_d.status = 'ended' or v_item.state = 'closed' then return _claim_res('closed'); end if;
  if v_d.status <> 'live' or v_item.state = 'queued' then return _claim_res('not_live'); end if;
  if v_d.live_item_id is distinct from p_item then return _claim_res('closed'); end if;

  select * into v_b from buyers where id = p_buyer;
  if not found or v_b.deleted_at is not null or ((v_b.is_bot or v_b.is_sandbox) and not v_d.is_sandbox) then return _claim_res('banned'); end if;
  select * into v_shop from shops where id = v_d.shop_id;
  if exists (select 1 from bans where shop_id = v_shop.id and buyer_id = p_buyer and kind = 'ban' and (until is null or until > now())) then
    return _claim_res('banned');
  end if;
  select * into v_existing from claims
   where drop_item_id = p_item and buyer_id = p_buyer and state in ('held','payment_claimed','waitlisted');
  if found then
    return _claim_res('already', v_existing.id, v_existing.order_id, _wait_pos(v_existing.id), v_existing.expires_at, v_existing.ms_after_live);
  end if;

  v_now := clock_timestamp();
  v_ms := greatest(0, round(extract(epoch from (v_now - coalesce(v_item.live_at, v_now))) * 1000))::int;
  v_ch := _room(v_d.id);
  begin
    if v_stock.available > 0 then
      select count(*) into v_n from claims where drop_id = v_d.id and buyer_id = p_buyer and state in ('held','payment_claimed');
      if v_n >= v_shop.max_holds then return _claim_res('too_many_holds'); end if;
      update item_stock set available = available - 1 where drop_item_id = p_item and variant_id = v_variant.id returning available into v_left;
      v_exp := v_now + make_interval(secs => _hold_secs(v_d.id, p_buyer));
      insert into claims (drop_id, drop_item_id, variant_id, buyer_id, state, received_at, committed_at, expires_at, ms_after_live, demo_extended_at)
      values (v_d.id, p_item, v_variant.id, p_buyer, 'held', coalesce(p_received, v_now), v_now, v_exp, v_ms,
              case when _is_try(v_d.id) and not v_b.is_bot then v_now end) returning id into v_id;
      v_order := _create_order(v_id);
      if v_item.state = 'live' and not exists (select 1 from item_stock where drop_item_id = p_item and available > 0) then
        update drop_items set state = 'sold_out' where id = p_item;
      end if;
      v_v := _bump(v_d.id);
      perform _out(v_d.id, 'room', v_ch, 'DB:Sold', jsonb_build_object('t', 'DB:Sold', 'v', v_v, 'itemId', p_item, 'variant', v_variant.key,
        'variantLabel', v_variant.label, 'buyer', v_b.display_name, 'isBot', v_b.is_bot, 'ms', v_ms, 'left', v_left), 'high');
      perform _room_stock(v_d.id, p_item, v_v);
      perform _audit(v_d.id, 'buyer', p_buyer, 'claim_won', jsonb_build_object('claimId', v_id, 'orderId', v_order, 'variant', v_variant.key, 'ms', v_ms));
      return _claim_res('won', v_id, v_order, null, v_exp, v_ms);
    end if;

    select count(*) into v_n from claims where drop_item_id = p_item and variant_id = v_variant.id and state = 'waitlisted';
    if v_n >= v_shop.waitlist_max then
      perform _audit(v_d.id, 'buyer', p_buyer, 'claim_waitlist_full', jsonb_build_object('itemId', p_item, 'variant', v_variant.key, 'ms', v_ms, 'at', v_now));
      return _claim_res('waitlist_full');
    end if;
    insert into claims (drop_id, drop_item_id, variant_id, buyer_id, state, received_at, committed_at, ms_after_live)
    values (v_d.id, p_item, v_variant.id, p_buyer, 'waitlisted', coalesce(p_received, v_now), v_now, v_ms) returning id into v_id;
    v_v := _bump(v_d.id);
    perform _room_stock(v_d.id, p_item, v_v);
    perform _audit(v_d.id, 'buyer', p_buyer, 'claim_waitlisted', jsonb_build_object('claimId', v_id, 'variant', v_variant.key, 'position', v_n + 1));
    return _claim_res('waitlisted', v_id, null, v_n + 1, null, v_ms);
  exception when unique_violation then
    return _claim_res('already');
  end;
end $$;
