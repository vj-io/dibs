-- Dibs claim engine. Every function returns jsonb; every state change writes claim/order rows,
-- audit_events and outbox rows and bumps drops.version in the same transaction.
--
-- LOCK ORDER (every writer, no exceptions):
--   1. the drop row (SELECT ... FOR NO KEY UPDATE) -- exactly one drop per transaction
--   2. item_stock row(s)                            -- FOR UPDATE
--   3. claim rows                                   -- the hold being ended, then the waitlist head
--   4. order rows, then shops (order_seq), then staff (last_assigned_at)
-- Every writer that touches a drop takes the drop row first, so all writes inside one drop are
-- serialised there (they all bump drops.version anyway, which needs that row). Writers for different
-- drops can only meet on shops/staff rows, which are always taken last, so no cycle (no deadlock) is
-- possible. NO KEY UPDATE (not UPDATE) keeps inserts of claims/items (FK KEY SHARE on drops) unblocked.
-- Consequences: a claim racing item_close / drop_end is either fully before it or sees the closed state;
-- committed_at (clock_timestamp() taken after the locks) is in commit order, so waitlist FIFO by
-- committed_at is exactly commit order.
--
-- ITEM STATE RULES: drops.live_item_id is the current item; it is the only item that can be 'live'
-- or 'sold_out' (drop_next/item_close/drop_end close it; item_reopen refuses 'another_live' while a
-- different current item exists). So a returned unit on a sold_out item puts it back to 'live' (the
-- code still checks live_item_id defensively; if not current it becomes 'closed'). A unit returned on
-- a closed item goes back to item_stock.available: that is what "unsold" means (closed with available
-- > 0); claims are refused while closed and item_reopen sells it again. This keeps, for every stock row,
--   total = available + count(claims in held, payment_claimed, paid, shipped).

-- ---------------------------------------------------------------- helpers

create or replace function _room(p_drop uuid) returns text language sql stable as $$
  select coalesce(nexconn_channel_id, 'dr_' || code) from drops where id = p_drop $$;

create or replace function _buyer_uid(p_buyer uuid) returns text language sql stable as $$
  select coalesce(nexconn_user_id, 'b_' || id) from buyers where id = p_buyer $$;

create or replace function _staff_uid(p_staff uuid) returns text language sql stable as $$
  select coalesce(nexconn_user_id, 's_' || id) from staff where id = p_staff $$;

create or replace function _staff_ok(p_staff uuid, p_shop uuid) returns boolean language sql stable as $$
  select exists (select 1 from staff where id = p_staff and shop_id = p_shop and active) $$;

create or replace function _mmss(p_sec int) returns text language sql immutable as $$
  select lpad((p_sec / 60)::text, 2, '0') || ':' || lpad((p_sec % 60)::text, 2, '0') $$;

create or replace function _urlencode(p text) returns text language sql immutable as $$
  select coalesce(string_agg(case when ch ~ '^[A-Za-z0-9._~-]$' then ch
                                  else regexp_replace(upper(encode(convert_to(ch, 'UTF8'), 'hex')), '(..)', '%\1', 'g') end, '' order by ord), '')
    from regexp_split_to_table(p, '') with ordinality as t(ch, ord) $$;

create or replace function _out(p_drop uuid, p_type text, p_ch text, p_msg text, p_payload jsonb,
                                p_pri text default 'normal', p_at timestamptz default null) returns void
language sql as $$
  insert into outbox (drop_id, channel_type, channel_id, msg_type, payload, priority, next_attempt_at)
  values (p_drop, p_type, p_ch, p_msg, p_payload, p_pri, coalesce(p_at, now())) $$;

create or replace function _bump(p_drop uuid) returns bigint language sql as $$
  update drops set version = version + 1 where id = p_drop returning version $$;

create or replace function _audit(p_drop uuid, p_actor_type text, p_actor uuid, p_type text, p_payload jsonb) returns void
language sql as $$
  insert into audit_events (shop_id, drop_id, actor_type, actor_id, type, payload)
  select shop_id, id, p_actor_type, p_actor, p_type, p_payload from drops where id = p_drop $$;

create or replace function _variants(p_item uuid) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', pv.key, 'label', pv.label, 'left', s.available,
           'waiting', (select count(*) from claims c where c.drop_item_id = s.drop_item_id and c.variant_id = s.variant_id and c.state = 'waitlisted'))
         order by pv.sort, pv.key), '[]'::jsonb)
    from item_stock s join product_variants pv on pv.id = s.variant_id where s.drop_item_id = p_item $$;

create or replace function _stock_card(p_item uuid, p_v bigint) returns jsonb language sql stable as $$
  select jsonb_build_object('t', 'DB:Stock', 'v', p_v, 'itemId', i.id,
           'state', case when i.state = 'queued' then 'closed' else i.state end, 'variants', _variants(i.id))
    from drop_items i where i.id = p_item $$;

create or replace function _item_card(p_item uuid, p_v bigint) returns jsonb language sql stable as $$
  select jsonb_build_object('t', 'DB:Item', 'v', p_v, 'itemId', i.id, 'position', i.position, 'title', p.title,
           'pricePaise', p.price_paise, 'note', p.note, 'photos', to_jsonb(p.photos), 'liveAt', i.live_at, 'variants', _variants(i.id))
    from drop_items i join products p on p.id = i.product_id where i.id = p_item $$;

create or replace function _state_card(p_drop uuid, p_v bigint) returns jsonb language sql stable as $$
  select jsonb_build_object('t', 'DB:State', 'v', p_v, 'status', status, 'liveItemId', live_item_id, 'startsAt', starts_at)
    from drops where id = p_drop $$;

-- DB:Stock to the room + db_item metadata.
create or replace function _room_stock(p_drop uuid, p_item uuid, p_v bigint) returns void language plpgsql as $$
declare v_card jsonb := _stock_card(p_item, p_v); v_ch text := _room(p_drop);
begin
  perform _out(p_drop, 'room', v_ch, 'DB:Stock', v_card, 'high');
  perform _out(p_drop, 'room', v_ch, 'SYS:RoomMeta', jsonb_build_object('channelId', v_ch, 'key', 'db_item', 'value', v_card::text), 'high');
end $$;

-- DB:State to the room + db_state metadata.
create or replace function _room_state(p_drop uuid, p_v bigint) returns void language plpgsql as $$
declare v_card jsonb := _state_card(p_drop, p_v); v_ch text := _room(p_drop);
begin
  perform _out(p_drop, 'room', v_ch, 'DB:State', v_card, 'high');
  perform _out(p_drop, 'room', v_ch, 'SYS:RoomMeta', jsonb_build_object('channelId', v_ch, 'key', 'db_state', 'value', v_card::text), 'high');
end $$;

create or replace function _alert(p_drop uuid, p_buyer uuid, p_kind text, p_order uuid, p_text text) returns void language sql as $$
  select _out(p_drop, 'user', _buyer_uid(p_buyer), 'DB:Alert',
              jsonb_build_object('t', 'DB:Alert', 'kind', p_kind, 'orderId', p_order,
                                 'dropCode', (select code from drops where id = p_drop), 'text', p_text)) $$;

-- Order-room and desk cards for an order.
create or replace function _order_card(p_order uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('t', 'DB:Order', 'orderId', o.id, 'orderNo', o.order_no, 'item', p.title, 'variantLabel', pv.label,
           'pricePaise', o.amount_paise, 'expiresAt', case when c.state in ('held') then c.expires_at end, 'photo', p.photos[1])
    from orders o join claims c on c.id = o.claim_id join drop_items i on i.id = c.drop_item_id
    join products p on p.id = i.product_id join product_variants pv on pv.id = c.variant_id where o.id = p_order $$;

create or replace function _status(p_order uuid, p_state text, p_by text, p_note text) returns void language sql as $$
  select _out(o.drop_id, 'group', o.nexconn_group_id, 'DB:Status',
              jsonb_build_object('t', 'DB:Status', 'orderId', o.id, 'state', p_state, 'by', p_by, 'note', p_note, 'at', clock_timestamp()))
    from orders o where o.id = p_order $$;

create or replace function _desk(p_order uuid, p_event text) returns void language sql as $$
  select _out(o.drop_id, 'group', s.nexconn_desk_id, 'DB:Desk',
              jsonb_build_object('t', 'DB:Desk', 'orderId', o.id, 'orderNo', o.order_no, 'buyer', b.display_name, 'item', p.title,
                                 'variantLabel', pv.label, 'amountPaise', o.amount_paise, 'assignedTo', st.display_name,
                                 'state', o.state, 'event', p_event))
    from orders o join shops s on s.id = o.shop_id join buyers b on b.id = o.buyer_id join claims c on c.id = o.claim_id
    join drop_items i on i.id = c.drop_item_id join products p on p.id = i.product_id join product_variants pv on pv.id = c.variant_id
    left join staff st on st.id = o.assigned_staff_id
   where o.id = p_order and s.nexconn_desk_id is not null $$;

-- Creates the order for a claim that just became a hold. Caller holds drop/stock/claim locks.
-- Writes SYS:EnsureGroup, DB:Order, DB:Pay (order room) and DB:Desk 'new'.
create or replace function _create_order(p_claim uuid) returns uuid language plpgsql as $$
declare
  v_c claims; v_shop shops; v_price bigint; v_title text; v_no int; v_staff uuid; v_oid uuid := gen_random_uuid();
  v_group text; v_members jsonb; v_payee text;
begin
  select * into v_c from claims where id = p_claim;
  select p.price_paise, p.title into v_price, v_title from drop_items i join products p on p.id = i.product_id where i.id = v_c.drop_item_id;
  update shops set order_seq = order_seq + 1 where id = (select shop_id from drops where id = v_c.drop_id) returning * into v_shop;
  v_no := v_shop.order_seq;
  if v_shop.high_value_paise is not null and v_price >= v_shop.high_value_paise then
    select id into v_staff from staff where shop_id = v_shop.id and role = 'owner' and active;
  end if;
  if v_staff is null then
    select st.id into v_staff from staff st where st.shop_id = v_shop.id and st.active
     order by (select count(*) from orders o where o.assigned_staff_id = st.id and o.state in ('held','payment_claimed','paid')),
              st.last_assigned_at nulls first, st.id
     limit 1;
  end if;
  if v_staff is not null then update staff set last_assigned_at = clock_timestamp() where id = v_staff; end if;
  v_group := 'ord_' || left(replace(v_oid::text, '-', ''), 20);
  insert into orders (id, shop_id, drop_id, claim_id, buyer_id, order_no, amount_paise, nexconn_group_id, assigned_staff_id, state)
  values (v_oid, v_shop.id, v_c.drop_id, p_claim, v_c.buyer_id, v_no, v_price, v_group, v_staff, 'held');
  update claims set order_id = v_oid where id = p_claim;

  v_members := jsonb_build_array(_buyer_uid(v_c.buyer_id)) || case when v_staff is null then '[]'::jsonb else jsonb_build_array(_staff_uid(v_staff)) end || '["dibs_bot"]'::jsonb;
  perform _out(v_c.drop_id, 'group', v_group, 'SYS:EnsureGroup',
               jsonb_build_object('channelId', v_group, 'name', left('Order #' || v_no || ' · ' || v_title, 64), 'memberIds', v_members));
  perform _out(v_c.drop_id, 'group', v_group, 'DB:Order', _order_card(v_oid));
  v_payee := coalesce(v_shop.payee_name, v_shop.name);
  perform _out(v_c.drop_id, 'group', v_group, 'DB:Pay', jsonb_build_object('t', 'DB:Pay', 'orderId', v_oid, 'amountPaise', v_price,
    'upiId', coalesce(v_shop.upi_id, ''), 'payee', v_payee,
    'upiLink', 'upi://pay?pa=' || coalesce(v_shop.upi_id, '') || '&pn=' || _urlencode(v_payee) || '&am=' || to_char(v_price / 100.0, 'FM999999999990.00')
               || '&cu=INR&tn=Dibs%20order%20' || v_no));
  perform _desk(v_oid, 'new');
  return v_oid;
end $$;

-- Ends a hold (expired | released | cancelled) and hands the unit on: promote the waitlist head
-- (locked in queue order, never skipped) or return the unit to stock. Caller holds drop, stock and
-- claim locks and has checked the claim is held / payment_claimed. Returns 'promoted' | 'returned'.
create or replace function _end_hold(p_claim uuid, p_state text, p_actor_type text, p_actor uuid, p_reason text) returns text
language plpgsql as $$
declare
  v_c claims; v_d drops; v_item drop_items; v_label text; v_key text; v_hold int; v_now timestamptz := clock_timestamp();
  v_next claims; v_has_next boolean; v_v bigint; v_new_order uuid; v_nb buyers; v_reason text; v_ch text;
begin
  select * into v_c from claims where id = p_claim;
  select * into v_d from drops where id = v_c.drop_id;
  select * into v_item from drop_items where id = v_c.drop_item_id;
  select key, label into v_key, v_label from product_variants where id = v_c.variant_id;
  select hold_seconds into v_hold from shops where id = v_d.shop_id;
  v_ch := _room(v_d.id);
  v_reason := case p_state when 'expired' then 'expired' when 'released' then 'released' else 'cancelled' end;

  update claims set state = p_state, ended_reason = nullif(p_reason, '') where id = p_claim;
  update orders set state = 'cancelled', cancelled_at = v_now where id = v_c.order_id;
  perform _status(v_c.order_id, 'cancelled', case p_actor_type when 'staff' then 'Seller' when 'buyer' then 'Buyer' else 'Dibs' end,
                  case p_state when 'expired' then 'Hold ran out' when 'released' then 'Released by the buyer' else nullif(p_reason, '') end);
  perform _desk(v_c.order_id, 'cancelled');

  select * into v_next from claims
   where drop_item_id = v_c.drop_item_id and variant_id = v_c.variant_id and state = 'waitlisted'
   order by committed_at, id limit 1 for update;
  v_has_next := found;
  v_v := _bump(v_d.id);

  if v_has_next then
    update claims set state = 'held', expires_at = v_now + make_interval(secs => v_hold), promoted_at = v_now, warned_at = null
     where id = v_next.id;
    v_new_order := _create_order(v_next.id);
    select * into v_nb from buyers where id = v_next.buyer_id;
    perform _out(v_d.id, 'room', v_ch, 'DB:Back', jsonb_build_object('t', 'DB:Back', 'v', v_v, 'itemId', v_item.id, 'variant', v_key,
      'variantLabel', v_label, 'buyer', v_nb.display_name, 'isBot', v_nb.is_bot, 'reason', v_reason), 'high');
    perform _room_stock(v_d.id, v_item.id, v_v);
    perform _alert(v_d.id, v_next.buyer_id, 'promoted', v_new_order, 'It''s yours! The buyer ahead didn''t pay. Pay within ' || _mmss(v_hold));
    if p_state = 'expired' then
      perform _alert(v_d.id, v_c.buyer_id, 'expired', v_c.order_id, 'Your hold on #' || v_item.position || ' ran out. It went to the next buyer.');
    end if;
    perform _audit(v_d.id, p_actor_type, p_actor, 'hold_' || p_state,
                   jsonb_build_object('claimId', p_claim, 'reason', p_reason, 'promotedClaimId', v_next.id, 'orderId', v_new_order));
    return 'promoted';
  end if;

  update item_stock set available = available + 1 where drop_item_id = v_c.drop_item_id and variant_id = v_c.variant_id;
  if v_item.state = 'sold_out' then
    if v_d.status = 'live' and v_d.live_item_id = v_item.id then
      update drop_items set state = 'live' where id = v_item.id;
      v_item.state := 'live';
    else
      update drop_items set state = 'closed', closed_at = coalesce(closed_at, v_now) where id = v_item.id;
      v_item.state := 'closed';
    end if;
  end if;
  if v_item.state = 'live' then
    perform _out(v_d.id, 'room', v_ch, 'DB:Back', jsonb_build_object('t', 'DB:Back', 'v', v_v, 'itemId', v_item.id, 'variant', v_key,
      'variantLabel', v_label, 'buyer', null, 'isBot', false, 'reason', v_reason), 'high');
  end if;
  perform _room_stock(v_d.id, v_item.id, v_v);
  if p_state = 'expired' then
    perform _alert(v_d.id, v_c.buyer_id, 'expired', v_c.order_id, 'Your hold on #' || v_item.position || ' ran out.');
  end if;
  perform _audit(v_d.id, p_actor_type, p_actor, 'hold_' || p_state, jsonb_build_object('claimId', p_claim, 'reason', p_reason, 'returned', true));
  return 'returned';
end $$;

-- After a drop ends: waitlisted claims with no hold left ahead of them become 'missed'.
-- Position k can only ever be served if at least k holds (held / payment_claimed) are still ahead.
create or replace function _mark_missed(p_drop uuid) returns int language plpgsql as $$
declare r record; n int := 0;
begin
  for r in
    with q as (
      select c.id, c.buyer_id,
             row_number() over (partition by c.drop_item_id, c.variant_id order by c.committed_at, c.id) as rn,
             (select count(*) from claims h where h.drop_item_id = c.drop_item_id and h.variant_id = c.variant_id
                 and h.state in ('held','payment_claimed')) as holds
        from claims c where c.drop_id = p_drop and c.state = 'waitlisted')
    update claims set state = 'missed', ended_reason = 'drop_ended' from q where claims.id = q.id and q.rn > q.holds
    returning claims.id, claims.buyer_id
  loop
    perform _alert(p_drop, r.buyer_id, 'missed', null, 'Missed it this time');
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function _ok(p_extra jsonb default '{}') returns jsonb language sql immutable as $$
  select jsonb_build_object('ok', true) || p_extra $$;
create or replace function _err(p_code text) returns jsonb language sql immutable as $$
  select jsonb_build_object('ok', false, 'error', p_code) $$;

create or replace function _claim_res(p_result text, p_claim uuid default null, p_order uuid default null, p_pos int default null,
                                      p_exp timestamptz default null, p_ms int default null) returns jsonb language sql immutable as $$
  select jsonb_build_object('result', p_result, 'claimId', p_claim, 'orderId', p_order, 'position', p_pos, 'expiresAt', p_exp, 'ms', p_ms) $$;

create or replace function _wait_pos(p_claim uuid) returns int language sql stable as $$
  select (select count(*)::int from claims w where w.drop_item_id = c.drop_item_id and w.variant_id = c.variant_id and w.state = 'waitlisted'
             and (w.committed_at, w.id) <= (c.committed_at, c.id))
    from claims c where c.id = p_claim and c.state = 'waitlisted' $$;

-- ---------------------------------------------------------------- claim

create or replace function claim_dibs(p_item uuid, p_variant_key text, p_buyer uuid, p_received timestamptz) returns jsonb
language plpgsql as $$
declare
  v_drop_id uuid; v_d drops; v_item drop_items; v_shop shops; v_stock item_stock; v_variant product_variants; v_b buyers;
  v_existing claims; v_now timestamptz; v_ms int; v_id uuid; v_order uuid; v_exp timestamptz; v_left int; v_n int; v_v bigint; v_ch text;
begin
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
  if not found or v_b.deleted_at is not null or (v_b.is_bot and not v_d.is_sandbox) then return _claim_res('banned'); end if;
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
      v_exp := v_now + make_interval(secs => v_shop.hold_seconds);
      insert into claims (drop_id, drop_item_id, variant_id, buyer_id, state, received_at, committed_at, expires_at, ms_after_live)
      values (v_d.id, p_item, v_variant.id, p_buyer, 'held', coalesce(p_received, v_now), v_now, v_exp, v_ms) returning id into v_id;
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
    if v_n >= v_shop.waitlist_max then return _claim_res('waitlist_full'); end if;
    insert into claims (drop_id, drop_item_id, variant_id, buyer_id, state, received_at, committed_at, ms_after_live)
    values (v_d.id, p_item, v_variant.id, p_buyer, 'waitlisted', coalesce(p_received, v_now), v_now, v_ms) returning id into v_id;
    v_v := _bump(v_d.id);
    perform _room_stock(v_d.id, p_item, v_v);
    perform _audit(v_d.id, 'buyer', p_buyer, 'claim_waitlisted', jsonb_build_object('claimId', v_id, 'variant', v_variant.key, 'position', v_n + 1));
    return _claim_res('waitlisted', v_id, null, v_n + 1, null, v_ms);
  exception when unique_violation then
    -- backstop for claims_one_active; unreachable while the drop lock serialises claims
    return _claim_res('already');
  end;
end $$;

-- ---------------------------------------------------------------- sweep

create or replace function sweep_drop(p_drop uuid) returns jsonb language plpgsql as $$
declare
  v_hold int; v_status text; v_now timestamptz := clock_timestamp(); r record; v_c claims;
  n_exp int := 0; n_prom int := 0; n_ret int := 0; n_warn int := 0; v_pos int;
begin
  select s.hold_seconds, d.status into v_hold, v_status from drops d join shops s on s.id = d.shop_id where d.id = p_drop;
  if not found then return jsonb_build_object('expired', 0, 'promoted', 0, 'returned', 0, 'warned', 0); end if;
  -- fast path without any lock: nothing due
  if not exists (select 1 from claims c where c.drop_id = p_drop and c.state = 'held'
                    and (c.expires_at <= v_now or (v_hold >= 300 and c.warned_at is null and c.expires_at <= v_now + interval '2 minutes')))
     and not (v_status = 'ended' and exists (select 1 from claims c where c.drop_id = p_drop and c.state = 'waitlisted')) then
    return jsonb_build_object('expired', 0, 'promoted', 0, 'returned', 0, 'warned', 0);
  end if;

  perform 1 from drops where id = p_drop for no key update;                            -- lock 1: drop
  v_now := clock_timestamp();
  for r in select c.id, c.drop_item_id, c.variant_id from claims c
            where c.drop_id = p_drop and c.state = 'held' and c.expires_at <= v_now order by c.expires_at, c.id loop
    perform 1 from item_stock where drop_item_id = r.drop_item_id and variant_id = r.variant_id for update;   -- lock 2
    select * into v_c from claims where id = r.id and state = 'held' and expires_at <= v_now for update skip locked;  -- lock 3
    if not found then continue; end if;
    n_exp := n_exp + 1;
    if _end_hold(v_c.id, 'expired', 'system', null, 'expired') = 'promoted' then n_prom := n_prom + 1; else n_ret := n_ret + 1; end if;
  end loop;

  if v_hold >= 300 then
    for r in select c.id, c.buyer_id, c.order_id, c.drop_item_id from claims c
              where c.drop_id = p_drop and c.state = 'held' and c.warned_at is null
                and c.expires_at > v_now and c.expires_at <= v_now + interval '2 minutes'
              for update skip locked loop
      update claims set warned_at = v_now where id = r.id;
      select position into v_pos from drop_items where id = r.drop_item_id;
      perform _alert(p_drop, r.buyer_id, 'expiring', r.order_id, 'Your hold on #' || v_pos || ' ends in 2 minutes. Pay now to keep it.');
      n_warn := n_warn + 1;
    end loop;
  end if;

  if v_status = 'ended' then perform _mark_missed(p_drop); end if;
  return jsonb_build_object('expired', n_exp, 'promoted', n_prom, 'returned', n_ret, 'warned', n_warn);
end $$;

-- ---------------------------------------------------------------- buyer actions

create or replace function release_claim(p_claim uuid, p_actor_type text, p_actor_id uuid, p_reason text) returns jsonb
language plpgsql as $$
declare v_drop uuid; v_item uuid; v_var uuid; v_shop uuid; v_c claims;
begin
  select drop_id, drop_item_id, variant_id into v_drop, v_item, v_var from claims where id = p_claim;
  if not found then return _err('not_found'); end if;
  select shop_id into v_shop from drops where id = v_drop for no key update;
  perform 1 from item_stock where drop_item_id = v_item and variant_id = v_var for update;
  select * into v_c from claims where id = p_claim for update;
  if p_actor_type = 'buyer' then
    if v_c.buyer_id is distinct from p_actor_id then return _err('forbidden'); end if;
    if v_c.state <> 'held' then return _err('bad_state'); end if;
    perform _end_hold(p_claim, 'released', 'buyer', p_actor_id, p_reason);
  elsif p_actor_type = 'staff' then
    if not _staff_ok(p_actor_id, v_shop) then return _err('forbidden'); end if;
    if v_c.state not in ('held','payment_claimed') then return _err('bad_state'); end if;
    perform _end_hold(p_claim, 'cancelled', 'staff', p_actor_id, p_reason);
  else
    return _err('bad_actor');
  end if;
  return _ok();
end $$;

create or replace function leave_waitlist(p_claim uuid, p_buyer uuid) returns jsonb language plpgsql as $$
declare v_drop uuid; v_item uuid; v_var uuid; v_c claims;
begin
  select drop_id, drop_item_id, variant_id into v_drop, v_item, v_var from claims where id = p_claim;
  if not found then return _err('not_found'); end if;
  perform 1 from drops where id = v_drop for no key update;
  perform 1 from item_stock where drop_item_id = v_item and variant_id = v_var for update;
  select * into v_c from claims where id = p_claim for update;
  if v_c.buyer_id <> p_buyer then return _err('forbidden'); end if;
  if v_c.state <> 'waitlisted' then return _err('bad_state'); end if;
  update claims set state = 'left', ended_reason = 'left' where id = p_claim;
  perform _room_stock(v_drop, v_item, _bump(v_drop));
  perform _audit(v_drop, 'buyer', p_buyer, 'waitlist_left', jsonb_build_object('claimId', p_claim));
  return _ok();
end $$;

create or replace function order_paid_claim(p_order uuid, p_buyer uuid, p_utr text) returns jsonb language plpgsql as $$
declare v_o orders; v_c claims; v_utr text := nullif(trim(coalesce(p_utr, '')), ''); v_name text;
begin
  select * into v_o from orders where id = p_order;
  if not found then return _err('not_found'); end if;
  perform 1 from drops where id = v_o.drop_id for no key update;
  select * into v_c from claims where id = v_o.claim_id for update;
  select * into v_o from orders where id = p_order for update;
  if v_o.buyer_id <> p_buyer then return _err('forbidden'); end if;
  if v_c.state = 'payment_claimed' then return _ok(); end if;
  if v_c.state <> 'held' then return _err('bad_state'); end if;
  if v_c.expires_at <= clock_timestamp() then return _err('expired'); end if;
  update claims set state = 'payment_claimed' where id = v_c.id;
  update orders set state = 'payment_claimed', utr = coalesce(v_utr, utr) where id = p_order;
  perform _bump(v_o.drop_id);
  select display_name into v_name from buyers where id = p_buyer;
  perform _status(p_order, 'payment_claimed', v_name, case when v_utr is not null then 'UTR ' || v_utr end);
  perform _desk(p_order, 'payment_claimed');
  perform _audit(v_o.drop_id, 'buyer', p_buyer, 'payment_claimed', jsonb_build_object('orderId', p_order, 'utr', v_utr));
  return _ok();
end $$;

-- ---------------------------------------------------------------- staff actions on orders

create or replace function order_confirm(p_order uuid, p_staff uuid, p_received boolean, p_note text) returns jsonb language plpgsql as $$
declare v_o orders; v_c claims; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into v_o from orders where id = p_order;
  if not found then return _err('not_found'); end if;
  if not _staff_ok(p_staff, v_o.shop_id) then return _err('forbidden'); end if;
  perform 1 from drops where id = v_o.drop_id for no key update;
  select * into v_c from claims where id = v_o.claim_id for update;
  perform 1 from orders where id = p_order for update;
  if p_received then
    if v_c.state not in ('held','payment_claimed') then return _err('bad_state'); end if;
    update claims set state = 'paid' where id = v_c.id;
    update orders set state = 'paid', paid_at = clock_timestamp() where id = p_order;
    perform _bump(v_o.drop_id);
    perform _status(p_order, 'paid', 'Seller', v_note);
    perform _desk(p_order, 'paid');
    perform _alert(v_o.drop_id, v_o.buyer_id, 'paid', p_order, 'Payment received for order #' || v_o.order_no || '. It''s yours.');
    perform _audit(v_o.drop_id, 'staff', p_staff, 'payment_confirmed', jsonb_build_object('orderId', p_order));
  else
    if v_c.state <> 'payment_claimed' then return _err('bad_state'); end if;
    update claims set state = 'held', expires_at = clock_timestamp() + interval '5 minutes' where id = v_c.id;
    update orders set state = 'held' where id = p_order;
    perform _bump(v_o.drop_id);
    perform _status(p_order, 'held', 'Seller', coalesce(v_note, 'Payment not received'));
    perform _out(v_o.drop_id, 'group', v_o.nexconn_group_id, 'DB:Order', _order_card(p_order));
    perform _alert(v_o.drop_id, v_o.buyer_id, 'not_received', p_order,
      'The seller has not received your payment' || coalesce(' (' || v_note || ')', '') || '. Your hold is back: pay within 05:00.');
    perform _audit(v_o.drop_id, 'staff', p_staff, 'payment_not_received', jsonb_build_object('orderId', p_order, 'note', v_note));
  end if;
  return _ok();
end $$;

create or replace function order_ship(p_order uuid, p_staff uuid, p_note text) returns jsonb language plpgsql as $$
declare v_o orders; v_c claims; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into v_o from orders where id = p_order;
  if not found then return _err('not_found'); end if;
  if not _staff_ok(p_staff, v_o.shop_id) then return _err('forbidden'); end if;
  perform 1 from drops where id = v_o.drop_id for no key update;
  select * into v_c from claims where id = v_o.claim_id for update;
  perform 1 from orders where id = p_order for update;
  if v_c.state <> 'paid' then return _err('bad_state'); end if;
  update claims set state = 'shipped' where id = v_c.id;
  update orders set state = 'shipped', shipped_at = clock_timestamp(), tracking_note = v_note where id = p_order;
  perform _bump(v_o.drop_id);
  perform _status(p_order, 'shipped', 'Seller', v_note);
  perform _desk(p_order, 'shipped');
  perform _alert(v_o.drop_id, v_o.buyer_id, 'shipped', p_order, 'Order #' || v_o.order_no || ' has shipped' || coalesce(': ' || v_note, '.'));
  perform _audit(v_o.drop_id, 'staff', p_staff, 'order_shipped', jsonb_build_object('orderId', p_order));
  return _ok();
end $$;

create or replace function order_assign(p_order uuid, p_staff uuid, p_to uuid) returns jsonb language plpgsql as $$
declare v_o orders;
begin
  select * into v_o from orders where id = p_order;
  if not found then return _err('not_found'); end if;
  if not _staff_ok(p_staff, v_o.shop_id) then return _err('forbidden'); end if;
  if not _staff_ok(p_to, v_o.shop_id) then return _err('bad_staff'); end if;
  perform 1 from drops where id = v_o.drop_id for no key update;
  select * into v_o from orders where id = p_order for update;
  if v_o.state = 'cancelled' then return _err('bad_state'); end if;
  update orders set assigned_staff_id = p_to where id = p_order;
  update staff set last_assigned_at = clock_timestamp() where id = p_to;
  perform _bump(v_o.drop_id);
  perform _out(v_o.drop_id, 'group', v_o.nexconn_group_id, 'SYS:EnsureGroup',
               jsonb_build_object('channelId', v_o.nexconn_group_id, 'name', 'Order #' || v_o.order_no, 'memberIds', jsonb_build_array(_staff_uid(p_to))));
  perform _desk(p_order, 'assigned');
  perform _audit(v_o.drop_id, 'staff', p_staff, 'order_assigned', jsonb_build_object('orderId', p_order, 'to', p_to));
  return _ok();
end $$;

-- ---------------------------------------------------------------- drop controls

create or replace function drop_go_live(p_drop uuid, p_staff uuid) returns jsonb language plpgsql as $$
declare v_d drops;
begin
  select * into v_d from drops where id = p_drop for no key update;
  if not found then return _err('not_found'); end if;
  if not _staff_ok(p_staff, v_d.shop_id) then return _err('forbidden'); end if;
  if v_d.status = 'ended' then return _err('bad_state'); end if;
  if v_d.status = 'live' then return _ok(jsonb_build_object('liveItemId', v_d.live_item_id)); end if;
  update drops set status = 'live' where id = p_drop;
  perform _room_state(p_drop, _bump(p_drop));
  perform _audit(p_drop, 'staff', p_staff, 'drop_live', '{}');
  return _ok(jsonb_build_object('liveItemId', null));
end $$;

create or replace function drop_next(p_drop uuid, p_staff uuid) returns jsonb language plpgsql as $$
declare v_d drops; v_now timestamptz; v_prev uuid; v_next uuid; v_v bigint;
begin
  select * into v_d from drops where id = p_drop for no key update;
  if not found then return _err('not_found'); end if;
  if not _staff_ok(p_staff, v_d.shop_id) then return _err('forbidden'); end if;
  if v_d.status <> 'live' then return _err('bad_state'); end if;
  v_now := clock_timestamp();
  update drop_items set state = 'closed', closed_at = v_now where id = v_d.live_item_id and state in ('live','sold_out') returning id into v_prev;
  select id into v_next from drop_items where drop_id = p_drop and state = 'queued' order by position limit 1;
  if v_next is not null then
    update drop_items set state = 'live', live_at = v_now where id = v_next;
  end if;
  update drops set live_item_id = v_next where id = p_drop;
  v_v := _bump(p_drop);
  if v_prev is not null then perform _room_stock(p_drop, v_prev, v_v); end if;
  if v_next is not null then
    perform _out(p_drop, 'room', _room(p_drop), 'DB:Item', _item_card(v_next, v_v), 'high');
    perform _room_stock(p_drop, v_next, v_v);
  end if;
  perform _room_state(p_drop, v_v);
  perform _audit(p_drop, 'staff', p_staff, 'drop_next', jsonb_build_object('closed', v_prev, 'live', v_next));
  return _ok(jsonb_build_object('liveItemId', v_next));
end $$;

create or replace function item_close(p_item uuid, p_staff uuid) returns jsonb language plpgsql as $$
declare v_drop uuid; v_d drops; v_state text; v_v bigint;
begin
  select drop_id into v_drop from drop_items where id = p_item;
  if not found then return _err('not_found'); end if;
  select * into v_d from drops where id = v_drop for no key update;
  if not _staff_ok(p_staff, v_d.shop_id) then return _err('forbidden'); end if;
  select state into v_state from drop_items where id = p_item;
  if v_state = 'closed' then return _ok(jsonb_build_object('liveItemId', v_d.live_item_id)); end if;
  update drop_items set state = 'closed', closed_at = clock_timestamp() where id = p_item;
  if v_d.live_item_id = p_item then update drops set live_item_id = null where id = v_drop; v_d.live_item_id := null; end if;
  v_v := _bump(v_drop);
  perform _room_stock(v_drop, p_item, v_v);
  perform _room_state(v_drop, v_v);
  perform _audit(v_drop, 'staff', p_staff, 'item_closed', jsonb_build_object('itemId', p_item));
  return _ok(jsonb_build_object('liveItemId', v_d.live_item_id));
end $$;

create or replace function item_reopen(p_item uuid, p_staff uuid) returns jsonb language plpgsql as $$
declare v_drop uuid; v_d drops; v_state text; v_v bigint;
begin
  select drop_id into v_drop from drop_items where id = p_item;
  if not found then return _err('not_found'); end if;
  select * into v_d from drops where id = v_drop for no key update;
  if not _staff_ok(p_staff, v_d.shop_id) then return _err('forbidden'); end if;
  select state into v_state from drop_items where id = p_item;
  if v_d.status <> 'live' or v_state <> 'closed' then return _err('bad_state'); end if;
  if v_d.live_item_id is not null and v_d.live_item_id <> p_item then return _err('another_live'); end if;
  if not exists (select 1 from item_stock where drop_item_id = p_item and available > 0) then return _err('nothing_unsold'); end if;
  update drop_items set state = 'live', live_at = clock_timestamp(), closed_at = null where id = p_item;
  update drops set live_item_id = p_item where id = v_drop;
  v_v := _bump(v_drop);
  perform _out(v_drop, 'room', _room(v_drop), 'DB:Item', _item_card(p_item, v_v), 'high');
  perform _room_stock(v_drop, p_item, v_v);
  perform _room_state(v_drop, v_v);
  perform _audit(v_drop, 'staff', p_staff, 'item_reopened', jsonb_build_object('itemId', p_item));
  return _ok(jsonb_build_object('liveItemId', p_item));
end $$;

create or replace function drop_end(p_drop uuid, p_staff uuid) returns jsonb language plpgsql as $$
declare v_d drops; v_prev uuid; v_v bigint; v_missed int; v_ch text;
begin
  select * into v_d from drops where id = p_drop for no key update;
  if not found then return _err('not_found'); end if;
  if not _staff_ok(p_staff, v_d.shop_id) then return _err('forbidden'); end if;
  if v_d.status = 'ended' then return _ok(jsonb_build_object('liveItemId', null)); end if;
  update drop_items set state = 'closed', closed_at = clock_timestamp() where id = v_d.live_item_id and state in ('live','sold_out') returning id into v_prev;
  update drops set status = 'ended', ended_at = clock_timestamp(), live_item_id = null where id = p_drop;
  v_missed := _mark_missed(p_drop);
  v_v := _bump(p_drop);
  if v_prev is not null then perform _room_stock(p_drop, v_prev, v_v); end if;
  perform _room_state(p_drop, v_v);
  v_ch := _room(p_drop);
  perform _out(p_drop, 'room', v_ch, 'SYS:DestroyRoom', jsonb_build_object('channelId', v_ch), 'normal', now() + interval '10 minutes');
  perform _audit(p_drop, 'staff', p_staff, 'drop_ended', jsonb_build_object('missed', v_missed));
  return _ok(jsonb_build_object('liveItemId', null));
end $$;

-- ---------------------------------------------------------------- read-only

create or replace function drop_state(p_drop uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'dropId', d.id, 'code', d.code, 'title', d.title, 'status', d.status, 'startsAt', d.starts_at, 'version', d.version,
    'isSandbox', d.is_sandbox, 'channelId', coalesce(d.nexconn_channel_id, 'dr_' || d.code),
    'shop', jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'logoUrl', s.logo_url),
    'live', (select _item_card(i.id, d.version) || jsonb_build_object('state', i.state) from drop_items i where i.id = d.live_item_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('itemId', i.id, 'position', i.position, 'title', p.title,
                'pricePaise', p.price_paise, 'photo', p.photos[1], 'state', i.state) order by i.position), '[]'::jsonb)
                from drop_items i join products p on p.id = i.product_id where i.drop_id = d.id),
    'recent', (select coalesce(jsonb_agg(x.payload order by x.id desc), '[]'::jsonb) from
                (select id, payload from outbox where drop_id = d.id and msg_type in ('DB:Sold','DB:Back') order by id desc limit 8) x))
  from drops d join shops s on s.id = d.shop_id where d.id = p_drop $$;

create or replace function my_status(p_drop uuid, p_buyer uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'holds', (select coalesce(jsonb_agg(jsonb_build_object('claimId', c.id, 'orderId', c.order_id, 'itemId', i.id, 'position', i.position,
                'title', p.title, 'variantLabel', pv.label, 'state', c.state,
                'expiresAt', case when c.state = 'held' then c.expires_at end, 'pricePaise', p.price_paise) order by c.committed_at), '[]'::jsonb)
                from claims c join drop_items i on i.id = c.drop_item_id join products p on p.id = i.product_id
                join product_variants pv on pv.id = c.variant_id
               where c.drop_id = p_drop and c.buyer_id = p_buyer and c.state in ('held','payment_claimed','paid','shipped')),
    'waits', (select coalesce(jsonb_agg(jsonb_build_object('claimId', c.id, 'itemId', i.id, 'position', i.position, 'title', p.title,
                'variantKey', pv.key, 'variantLabel', pv.label, 'waitPosition', _wait_pos(c.id)) order by c.committed_at), '[]'::jsonb)
                from claims c join drop_items i on i.id = c.drop_item_id join products p on p.id = i.product_id
                join product_variants pv on pv.id = c.variant_id
               where c.drop_id = p_drop and c.buyer_id = p_buyer and c.state = 'waitlisted'),
    'mutedUntil', (select case when bool_or(b.until is null) then 'infinity'::timestamptz else max(b.until) end from bans b
                    where b.shop_id = d.shop_id and b.buyer_id = p_buyer and b.kind = 'mute' and (b.until is null or b.until > now())),
    'banned', exists (select 1 from bans b where b.shop_id = d.shop_id and b.buyer_id = p_buyer and b.kind = 'ban' and (b.until is null or b.until > now())))
  from drops d where d.id = p_drop $$;

-- Seller console: ledger (with phone, staff only), per-variant stock and waitlists, moderation log.
create or replace function console_state(p_drop uuid, p_staff uuid) returns jsonb language plpgsql stable as $$
declare v_shop uuid;
begin
  select shop_id into v_shop from drops where id = p_drop;
  if not found then return _err('not_found'); end if;
  if not _staff_ok(p_staff, v_shop) then return _err('forbidden'); end if;
  return _ok(jsonb_build_object(
    'ledger', (select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb) from (
        select c.committed_at as at, jsonb_build_object('claimId', c.id, 'itemId', i.id, 'position', i.position, 'title', p.title,
          'buyerId', b.id, 'buyer', b.display_name, 'phone', b.phone, 'isBot', b.is_bot, 'variantKey', pv.key, 'variantLabel', pv.label,
          'state', c.state, 'committedAt', c.committed_at, 'ms', c.ms_after_live, 'expiresAt', c.expires_at, 'promoted', c.promoted_at is not null,
          'waitPosition', _wait_pos(c.id), 'orderId', o.id, 'orderNo', o.order_no, 'orderState', o.state, 'assignedTo', st.display_name,
          'endedReason', c.ended_reason) as j
          from claims c join drop_items i on i.id = c.drop_item_id join products p on p.id = i.product_id
          join product_variants pv on pv.id = c.variant_id join buyers b on b.id = c.buyer_id
          left join orders o on o.id = c.order_id left join staff st on st.id = o.assigned_staff_id
         where c.drop_id = p_drop order by c.committed_at desc limit 500) x),
    'stock', (select coalesce(jsonb_agg(jsonb_build_object('itemId', i.id, 'position', i.position, 'title', p.title, 'state', i.state,
                'variants', _variants(i.id)) order by i.position), '[]'::jsonb)
                from drop_items i join products p on p.id = i.product_id where i.drop_id = p_drop),
    'moderation', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'buyerId', m.buyer_id, 'buyer', b.display_name, 'rule', m.rule,
                'action', m.action, 'at', m.created_at) order by m.id desc), '[]'::jsonb)
                from moderation_events m left join buyers b on b.id = m.buyer_id where m.drop_id = p_drop),
    'bans', (select coalesce(jsonb_agg(jsonb_build_object('buyerId', x.buyer_id, 'buyer', b.display_name, 'kind', x.kind, 'until', x.until,
                'reason', x.reason)), '[]'::jsonb)
                from bans x join buyers b on b.id = x.buyer_id where x.shop_id = v_shop and (x.until is null or x.until > now()))));
end $$;

-- Per-drop results. viewers is not tracked in the database (null = "not measured yet").
create or replace function drop_dashboard(p_drop uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'dropId', p_drop, 'viewers', null,
    'taps', (select count(*) from claims where drop_id = p_drop),
    'holds', (select count(*) from orders where drop_id = p_drop),
    'paidOrders', (select count(*) from orders where drop_id = p_drop and state in ('paid','shipped')),
    'paidValuePaise', (select coalesce(sum(amount_paise), 0) from orders where drop_id = p_drop and state in ('paid','shipped')),
    'waitlistSaves', (select count(*) from orders o join claims c on c.id = o.claim_id
                       where o.drop_id = p_drop and o.state in ('paid','shipped') and c.promoted_at is not null),
    'medianWinMs', (select percentile_cont(0.5) within group (order by ms_after_live) from claims
                     where drop_id = p_drop and order_id is not null and promoted_at is null)) $$;

-- Real totals for /impact: sandbox shops/drops and bot buyers never count.
create or replace function impact_totals() returns jsonb language sql stable as $$
  with d as (select d.id from drops d join shops s on s.id = d.shop_id where not d.is_sandbox and not s.is_sandbox and d.status <> 'scheduled'),
       o as (select o.*, c.promoted_at from orders o join claims c on c.id = o.claim_id join buyers b on b.id = o.buyer_id
              where o.drop_id in (select id from d) and not b.is_bot)
  select jsonb_build_object(
    'drops', (select count(*) from d),
    'buyers', (select count(distinct c.buyer_id) from claims c join buyers b on b.id = c.buyer_id where c.drop_id in (select id from d) and not b.is_bot),
    'claimsWon', (select count(*) from o),
    'paidOrders', (select count(*) from o where state in ('paid','shipped')),
    'paidValuePaise', (select coalesce(sum(amount_paise), 0) from o where state in ('paid','shipped')),
    'waitlistSaves', (select count(*) from o where state in ('paid','shipped') and promoted_at is not null)) $$;

-- Fixed-window counter: returns the hit count for this key in the current window (including this hit).
create or replace function rate_add(p_key text, p_window_seconds int) returns int language plpgsql as $$
declare v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds); v_n int;
begin
  insert into rate_hits (key, window_start, count) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set count = rate_hits.count + 1 returning count into v_n;
  if random() < 0.01 then delete from rate_hits where window_start < now() - interval '1 day'; end if;
  return v_n;
end $$;

-- Only the server (postgres) may call any of this.
do $$
begin
  execute 'revoke execute on all functions in schema public from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on all functions in schema public from anon, authenticated';
    execute 'alter default privileges in schema public revoke execute on functions from public, anon, authenticated';
  end if;
end $$;
