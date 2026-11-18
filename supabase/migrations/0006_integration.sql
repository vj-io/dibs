-- Integration fixes across the engine (0002) and judge mode (0005). Re-runnable; supersedes functions by
-- create or replace. Each change names the defect it fixes.

-- Room cards carry the drop they belong to (judge-mode rooms reuse pooled open channels, so a join replay can carry
-- the previous drop's cards). Every room card goes through _out, so it is stamped here once.
create or replace function _out(p_drop uuid, p_type text, p_ch text, p_msg text, p_payload jsonb,
                                p_pri text default 'normal', p_at timestamptz default null) returns void
language sql as $$
  insert into outbox (drop_id, channel_type, channel_id, msg_type, payload, priority, next_attempt_at)
  values (p_drop, p_type, p_ch, p_msg,
          case when p_type = 'room' and p_msg like 'DB:%' and p_drop is not null then p_payload || jsonb_build_object('dropId', p_drop) else p_payload end,
          p_pri, coalesce(p_at, now())) $$;

-- The drain mirrors DB:State / DB:Item / DB:Stock room cards into open-channel metadata; the engine no longer
-- writes SYS:RoomMeta rows for the same thing (one mirror, not two).
create or replace function _room_stock(p_drop uuid, p_item uuid, p_v bigint) returns void language sql as $$
  select _out(p_drop, 'room', _room(p_drop), 'DB:Stock', _stock_card(p_item, p_v), 'high') $$;

create or replace function _room_state(p_drop uuid, p_v bigint) returns void language sql as $$
  select _out(p_drop, 'room', _room(p_drop), 'DB:State', _state_card(p_drop, p_v), 'high') $$;

-- Judge-mode drop = a sandbox drop handed out from the /try pool.
create or replace function _is_try(p_drop uuid) returns boolean language sql stable as $$
  select exists (select 1 from try_slots where drop_id = p_drop) $$;

-- Hold length for this buyer in this drop: a human in a judge-mode drop gets 90 s, everyone else (bots included) the
-- shop's hold. Applied when the hold starts, so no card, alert or timer ever shows the 20 s demo figure to a human.
create or replace function _hold_secs(p_drop uuid, p_buyer uuid) returns int language sql stable as $$
  select case when _is_try(d.id) and not b.is_bot then 90 else s.hold_seconds end
    from drops d join shops s on s.id = d.shop_id, buyers b where d.id = p_drop and b.id = p_buyer $$;

-- "Paid · confirmed by Asha": status cards name the staff member, not "Seller".
create or replace function _staff_name(p_staff uuid) returns text language sql stable as $$
  select coalesce((select nullif(trim(display_name), '') from staff where id = p_staff), 'Seller') $$;

-- A buyer who may not be served in this shop: banned (live ban) or deleted their data.
create or replace function _barred(p_shop uuid, p_buyer uuid) returns boolean language sql stable as $$
  select exists (select 1 from buyers where id = p_buyer and deleted_at is not null)
      or exists (select 1 from bans where shop_id = p_shop and buyer_id = p_buyer and kind = 'ban' and (until is null or until > now())) $$;

-- ---------------------------------------------------------------- _end_hold (0002) with _hold_secs and staff names
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
  v_ch := _room(v_d.id);
  v_reason := case p_state when 'expired' then 'expired' when 'released' then 'released' else 'cancelled' end;

  update claims set state = p_state, ended_reason = nullif(p_reason, '') where id = p_claim;
  update orders set state = 'cancelled', cancelled_at = v_now where id = v_c.order_id;
  perform _status(v_c.order_id, 'cancelled', case p_actor_type when 'staff' then _staff_name(p_actor) when 'buyer' then 'Buyer' else 'Dibs' end,
                  case p_state when 'expired' then 'Hold ran out' when 'released' then 'Released by the buyer' else nullif(p_reason, '') end);
  perform _desk(v_c.order_id, 'cancelled');

  -- the waitlist head, in queue order; a banned or deleted buyer at the head leaves the queue (never promoted).
  -- Being at max_holds is not a reason to skip: they queued in good faith.
  loop
    select * into v_next from claims
     where drop_item_id = v_c.drop_item_id and variant_id = v_c.variant_id and state = 'waitlisted'
     order by committed_at, id limit 1 for update;
    v_has_next := found;
    exit when not v_has_next or not _barred(v_d.shop_id, v_next.buyer_id);
    update claims set state = 'left', ended_reason = 'banned' where id = v_next.id;
  end loop;
  v_v := _bump(v_d.id);

  if v_has_next then
    select * into v_nb from buyers where id = v_next.buyer_id;
    v_hold := _hold_secs(v_d.id, v_next.buyer_id);
    update claims set state = 'held', expires_at = v_now + make_interval(secs => v_hold), promoted_at = v_now, warned_at = null,
                      demo_extended_at = case when _is_try(v_d.id) and not v_nb.is_bot then v_now end
     where id = v_next.id;
    v_new_order := _create_order(v_next.id);
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

-- ---------------------------------------------------------------- claim_dibs (0002) with _hold_secs
-- max_holds: counted over this buyer's held + payment_claimed claims in the drop, so a buyer promoted past the limit
-- (they queued in good faith) keeps the promotion but cannot claim more until they are back under it.
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
  -- bots and /try visitors (sandbox buyers) only ever claim in sandbox drops
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
    if v_n >= v_shop.waitlist_max then return _claim_res('waitlist_full'); end if;
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

-- ---------------------------------------------------------------- order_confirm / order_ship (0002) with staff names
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
    perform _status(p_order, 'paid', _staff_name(p_staff), v_note);
    perform _desk(p_order, 'paid');
    perform _alert(v_o.drop_id, v_o.buyer_id, 'paid', p_order, 'Payment received for order #' || v_o.order_no || '. It''s yours.');
    perform _audit(v_o.drop_id, 'staff', p_staff, 'payment_confirmed', jsonb_build_object('orderId', p_order));
  else
    if v_c.state <> 'payment_claimed' then return _err('bad_state'); end if;
    update claims set state = 'held', expires_at = clock_timestamp() + interval '5 minutes' where id = v_c.id;
    update orders set state = 'held' where id = p_order;
    perform _bump(v_o.drop_id);
    perform _status(p_order, 'held', _staff_name(p_staff), coalesce(v_note, 'Payment not received'));
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
  perform _status(p_order, 'shipped', _staff_name(p_staff), v_note);
  perform _desk(p_order, 'shipped');
  perform _alert(v_o.drop_id, v_o.buyer_id, 'shipped', p_order, 'Order #' || v_o.order_no || ' has shipped' || coalesce(': ' || v_note, '.'));
  perform _audit(v_o.drop_id, 'staff', p_staff, 'order_shipped', jsonb_build_object('orderId', p_order));
  return _ok();
end $$;


-- ---------------------------------------------------------------- round 2 (security review)

-- C1: a phone number is not an identity (no OTP), so it is no longer unique: the same phone on another device is a
-- new buyer. Same index name, non-unique, so 0001's "create unique index if not exists buyers_phone" stays a no-op.
do $$ begin
  if exists (select 1 from pg_indexes i join pg_class c on c.relname = i.indexname join pg_index x on x.indexrelid = c.oid
              where i.indexname = 'buyers_phone' and x.indisunique) then
    drop index buyers_phone;
  end if;
end $$;
create index if not exists buyers_phone on buyers (phone) where phone is not null;

-- M1 + C1: real totals count real people: no bots, no /try visitors, buyers = distinct phone numbers.
create or replace function impact_totals() returns jsonb language sql stable as $$
  with d as (select d.id from drops d join shops s on s.id = d.shop_id where not d.is_sandbox and not s.is_sandbox and d.status <> 'scheduled'),
       o as (select o.*, c.promoted_at from orders o join claims c on c.id = o.claim_id join buyers b on b.id = o.buyer_id
              where o.drop_id in (select id from d) and not b.is_bot and not b.is_sandbox)
  select jsonb_build_object(
    'drops', (select count(*) from d),
    'buyers', (select count(distinct coalesce(b.phone, b.id::text)) from claims c join buyers b on b.id = c.buyer_id
                where c.drop_id in (select id from d) and not b.is_bot and not b.is_sandbox),
    'claimsWon', (select count(*) from o),
    'paidOrders', (select count(*) from o where state in ('paid','shipped')),
    'paidValuePaise', (select coalesce(sum(amount_paise), 0) from o where state in ('paid','shipped')),
    'waitlistSaves', (select count(*) from o where state in ('paid','shipped') and promoted_at is not null)) $$;

-- L2: SYS:DestroyRoom waits 10 minutes; on the room's own channel key it would sit at the head and hold back every
-- later room card. It gets its own key (the drain reads the room id from the payload).
update outbox set channel_id = 'destroy:' || channel_id
 where msg_type = 'SYS:DestroyRoom' and status = 'pending' and channel_id not like 'destroy:%';

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
  perform _out(p_drop, 'room', 'destroy:' || v_ch, 'SYS:DestroyRoom', jsonb_build_object('channelId', v_ch), 'normal', now() + interval '10 minutes');
  perform _audit(p_drop, 'staff', p_staff, 'drop_ended', jsonb_build_object('missed', v_missed));
  return _ok(jsonb_build_object('liveItemId', null));
end $$;

-- L4: an ended drop's sweep takes the drop lock only when something would change (a hold due, or a waitlist place
-- that can no longer be served); `missed` is counted so the caller drains those alerts at once.
create or replace function _unservable(p_drop uuid) returns boolean language sql stable as $$
  select exists (
    select 1 from (
      select row_number() over (partition by c.drop_item_id, c.variant_id order by c.committed_at, c.id) as rn,
             (select count(*) from claims h where h.drop_item_id = c.drop_item_id and h.variant_id = c.variant_id
                 and h.state in ('held','payment_claimed')) as holds
        from claims c where c.drop_id = p_drop and c.state = 'waitlisted') q
     where q.rn > q.holds) $$;

create or replace function sweep_drop(p_drop uuid) returns jsonb language plpgsql as $$
declare
  v_hold int; v_status text; v_now timestamptz := clock_timestamp(); r record; v_c claims;
  n_exp int := 0; n_prom int := 0; n_ret int := 0; n_warn int := 0; n_missed int := 0; v_pos int;
begin
  select s.hold_seconds, d.status into v_hold, v_status from drops d join shops s on s.id = d.shop_id where d.id = p_drop;
  if not found then return jsonb_build_object('expired', 0, 'promoted', 0, 'returned', 0, 'warned', 0, 'missed', 0); end if;
  if not exists (select 1 from claims c where c.drop_id = p_drop and c.state = 'held'
                    and (c.expires_at <= v_now or (v_hold >= 300 and c.warned_at is null and c.expires_at <= v_now + interval '2 minutes')))
     and not (v_status = 'ended' and _unservable(p_drop)) then
    return jsonb_build_object('expired', 0, 'promoted', 0, 'returned', 0, 'warned', 0, 'missed', 0);
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

  if v_status = 'ended' then n_missed := _mark_missed(p_drop); end if;
  return jsonb_build_object('expired', n_exp, 'promoted', n_prom, 'returned', n_ret, 'warned', n_warn, 'missed', n_missed);
end $$;

-- H5: a ban ends the buyer's waitlist places in the shop's drops that have not ended (held claims are released by
-- the API through release_claim, one drop per transaction, so the normal hand-on path promotes the next buyer).
create or replace function ban_leave_waitlists(p_shop uuid, p_buyer uuid) returns int language plpgsql as $$
declare r record; n int := 0;
begin
  for r in select c.id, c.drop_id, c.drop_item_id, c.variant_id from claims c join drops d on d.id = c.drop_id
            where d.shop_id = p_shop and d.status <> 'ended' and c.buyer_id = p_buyer and c.state = 'waitlisted' loop
    perform 1 from drops where id = r.drop_id for no key update;
    perform 1 from item_stock where drop_item_id = r.drop_item_id and variant_id = r.variant_id for update;
    update claims set state = 'left', ended_reason = 'banned' where id = r.id and state = 'waitlisted';
    if found then
      perform _room_stock(r.drop_id, r.drop_item_id, _bump(r.drop_id));
      perform _audit(r.drop_id, 'system', null, 'waitlist_left', jsonb_build_object('claimId', r.id, 'reason', 'banned'));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- H3: 16 demo slots (each a shop + pooled open channel).
alter table try_slots drop constraint if exists try_slots_slot_check;
alter table try_slots add constraint try_slots_slot_check check (slot between 1 and 16);

create or replace function sandbox_seed() returns jsonb language plpgsql as $$
declare v_shop uuid; v_src uuid; i int;
begin
  -- bots and slots 1..8 come from 0005's seed (it runs when 0005 is applied); slots 9..16 copy slot 1's shop
  select shop_id into v_src from try_slots where slot = 1;
  if v_src is null then raise exception 'run 0005 sandbox_seed() first'; end if;
  for i in 9..16 loop
    insert into shops (slug, name, upi_id, payee_name, hold_seconds, faq, is_sandbox)
    select 'demo-jewels-' || i, name, upi_id, payee_name, 20, faq, true from shops where id = v_src
    on conflict (slug) do update set name = excluded.name, upi_id = excluded.upi_id, payee_name = excluded.payee_name,
      hold_seconds = 20, faq = excluded.faq, is_sandbox = true
    returning id into v_shop;
    update shops set nexconn_desk_id = 'desk_' || left(replace(id::text, '-', ''), 20) where id = v_shop;
    insert into products (shop_id, title, price_paise, note, photos, created_at)
    select v_shop, p.title, p.price_paise, p.note, p.photos, p.created_at from products p
     where p.shop_id = v_src and not exists (select 1 from products q where q.shop_id = v_shop and q.title = p.title);
    insert into product_variants (product_id, key, label, qty, sort)
    select q.id, v.key, v.label, v.qty, v.sort from products p join product_variants v on v.product_id = p.id
      join products q on q.shop_id = v_shop and q.title = p.title where p.shop_id = v_src
    on conflict (product_id, key) do update set label = excluded.label, qty = excluded.qty, sort = excluded.sort;
    insert into try_slots (slot, channel_id, shop_id) values (i, 'dr_demo' || i, v_shop)
    on conflict (slot) do update set channel_id = excluded.channel_id, shop_id = excluded.shop_id;
  end loop;
  return jsonb_build_object('bots', (select count(*) from buyers where is_bot), 'slots', (select count(*) from try_slots where shop_id is not null));
end $$;

-- H1 + H3: try_start never takes a slot whose drop is live and was in use in the last 150 s (the client ticks every
-- second, the seller console every 5 s): it answers { busy, retryInSeconds } instead. Each start gets a fresh demo
-- owner and demo staff (the previous visitor's staff rows are deleted, so their cookies stop working at once).
create or replace function try_start(p_role text, p_name text, p_display text) returns jsonb language plpgsql as $$
declare
  v_slot try_slots; v_shop shops; v_owner uuid; v_staff uuid; v_drop uuid; v_code text; v_buyer uuid; r record; v_ch text;
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_wait int;
begin
  if p_role not in ('buyer','seller') then raise exception 'bad role'; end if;
  select t.* into v_slot from try_slots t left join drops d on d.id = t.drop_id
   where t.shop_id is not null and not (d.status = 'live' and t.last_active_at > now() - interval '150 seconds')
   order by t.last_active_at nulls first, t.slot limit 1 for update of t skip locked;
  if not found then
    select greatest(1, ceil(extract(epoch from (min(last_active_at) + interval '150 seconds' - now()))))::int into v_wait from try_slots where shop_id is not null;
    if v_wait is null then raise exception 'no sandbox slots: run scripts/seed-demo.ts'; end if;
    return jsonb_build_object('busy', true, 'retryInSeconds', least(v_wait, 150));
  end if;
  select * into v_shop from shops where id = v_slot.shop_id;
  v_ch := v_slot.channel_id;

  delete from drops where shop_id = v_shop.id;
  if v_slot.judge_id is not null then delete from buyers where id = v_slot.judge_id and is_sandbox and not is_bot; end if;
  delete from staff where shop_id = v_shop.id;
  insert into staff (shop_id, role, display_name) values (v_shop.id, 'owner', 'Demo owner') returning id into v_owner;
  insert into staff (shop_id, role, display_name) values (v_shop.id, 'staff', 'Asha (demo staff)') returning id into v_staff;
  update shops set order_seq = 0 where id = v_shop.id;

  loop
    v_code := (select string_agg(substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1), '') from generate_series(1, 6));
    exit when not exists (select 1 from drops where code = v_code);
  end loop;
  insert into drops (shop_id, code, title, starts_at, nexconn_channel_id, is_sandbox)
  values (v_shop.id, v_code, 'Demo drop', now(), v_ch, true) returning id into v_drop;
  insert into drop_items (drop_id, product_id, position)
  select v_drop, p.id, row_number() over (order by p.created_at, p.id) from products p where p.shop_id = v_shop.id;
  insert into item_stock (drop_item_id, variant_id, total, available)
  select i.id, pv.id, pv.qty, pv.qty from drop_items i join product_variants pv on pv.product_id = i.product_id where i.drop_id = v_drop;

  perform _out(v_drop, 'room', v_ch, 'SYS:EnsureRoom', jsonb_build_object('channelId', v_ch, 'name', 'Demo Jewels'), 'high');
  for r in select buyer_id from bans where shop_id = v_shop.id loop
    perform _out(v_drop, 'room', v_ch, 'SYS:Unban', jsonb_build_object('channelId', v_ch, 'userId', _buyer_uid(r.buyer_id)), 'high');
  end loop;
  delete from bans where shop_id = v_shop.id;
  perform _out(v_drop, 'group', v_shop.nexconn_desk_id, 'SYS:EnsureGroup', jsonb_build_object('channelId', v_shop.nexconn_desk_id,
    'name', 'Demo Jewels team', 'memberIds', jsonb_build_array(_staff_uid(v_owner), _staff_uid(v_staff))));

  insert into buyers (name, display_name, is_sandbox) values (p_name, p_display, true) returning id into v_buyer;
  perform drop_go_live(v_drop, v_owner);

  update try_slots set drop_id = v_drop, role = p_role, visitor = p_display, judge_id = v_buyer, started_at = now(),
         last_active_at = now(), runner_until = null, runner_token = null where slot = v_slot.slot;
  return jsonb_build_object('slot', v_slot.slot, 'dropId', v_drop, 'code', v_code, 'channelId', v_ch, 'shopId', v_shop.id,
    'shopSlug', v_shop.slug, 'ownerId', v_owner, 'staffId', v_staff, 'buyerId', v_buyer);
end $$;

select sandbox_seed();

-- M4: webhook replay guard: a signed (nonce, timestamp) pair is accepted once inside its 5-minute window.
create table if not exists webhook_nonces (nonce text primary key, at timestamptz not null default now());
alter table webhook_nonces enable row level security;
create or replace function webhook_nonce_take(p_nonce text) returns boolean language plpgsql as $$
begin
  if random() < 0.02 then delete from webhook_nonces where at < now() - interval '10 minutes'; end if;
  insert into webhook_nonces (nonce) values (p_nonce) on conflict do nothing;
  return found;
end $$;

-- Only the server (postgres) may call any of this.
do $$
begin
  execute 'revoke execute on all functions in schema public from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on all functions in schema public from anon, authenticated';
  end if;
end $$;
