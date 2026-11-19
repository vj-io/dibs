-- 0008: claim burst performance. Re-runnable; supersedes functions by create or replace. Numbers: docs/perf.md.
-- Every change keeps the lock order and the results of 0002/0006/0007; none of them takes a new lock.

-- ---------------------------------------------------------------- 1. hot helpers in plpgsql
-- A non-inlined SQL-language function is planned again on every call; plpgsql keeps its plans for the session (PostgREST
-- keeps its 10 sessions open). Same bodies as 0002/0006, same volatility. (_hold_secs is left to 0009, which redefines it.)
create or replace function _room(p_drop uuid) returns text language plpgsql stable as $$
begin
  return (select coalesce(nexconn_channel_id, 'dr_' || code) from drops where id = p_drop);
end $$;

create or replace function _out(p_drop uuid, p_type text, p_ch text, p_msg text, p_payload jsonb,
                                p_pri text default 'normal', p_at timestamptz default null) returns void
language plpgsql as $$
begin
  insert into outbox (drop_id, channel_type, channel_id, msg_type, payload, priority, next_attempt_at)
  values (p_drop, p_type, p_ch, p_msg,
          case when p_type = 'room' and p_msg like 'DB:%' and p_drop is not null then p_payload || jsonb_build_object('dropId', p_drop) else p_payload end,
          p_pri, coalesce(p_at, now()));
end $$;

create or replace function _bump(p_drop uuid) returns bigint language plpgsql as $$
declare v bigint;
begin
  update drops set version = version + 1 where id = p_drop returning version into v;
  return v;
end $$;

create or replace function _audit(p_drop uuid, p_actor_type text, p_actor uuid, p_type text, p_payload jsonb) returns void
language plpgsql as $$
begin
  insert into audit_events (shop_id, drop_id, actor_type, actor_id, type, payload)
  select shop_id, id, p_actor_type, p_actor, p_type, p_payload from drops where id = p_drop;
end $$;

create or replace function _variants(p_item uuid) returns jsonb language plpgsql stable as $$
begin
  return (select coalesce(jsonb_agg(jsonb_build_object(
           'key', pv.key, 'label', pv.label, 'left', s.available,
           'waiting', (select count(*) from claims c where c.drop_item_id = s.drop_item_id and c.variant_id = s.variant_id and c.state = 'waitlisted'))
         order by pv.sort, pv.key), '[]'::jsonb)
    from item_stock s join product_variants pv on pv.id = s.variant_id where s.drop_item_id = p_item);
end $$;

create or replace function _stock_card(p_item uuid, p_v bigint) returns jsonb language plpgsql stable as $$
begin
  return (select jsonb_build_object('t', 'DB:Stock', 'v', p_v, 'itemId', i.id,
           'state', case when i.state = 'queued' then 'closed' else i.state end, 'variants', _variants(i.id))
    from drop_items i where i.id = p_item);
end $$;

create or replace function _room_stock(p_drop uuid, p_item uuid, p_v bigint) returns void language plpgsql as $$
begin
  perform _out(p_drop, 'room', _room(p_drop), 'DB:Stock', _stock_card(p_item, p_v), 'high');
end $$;

create or replace function _is_try(p_drop uuid) returns boolean language plpgsql stable as $$
begin
  return exists (select 1 from try_slots where drop_id = p_drop);
end $$;


-- ---------------------------------------------------------------- 2. claim_dibs (0006) with a lock-free waitlist_full
-- A tap on a sold-out variant whose waitlist is full used to queue for the drop lock only to be told "waitlist full"
-- (98 of 300 taps in the load test). One statement = one snapshot: if, in that committed state, the item is live, the
-- variant has no unit, the waitlist is at its cap and this buyer could claim (not barred, not already in), the locked
-- path would answer waitlist_full at that same instant, so we answer it without the lock. A unit coming back either
-- promotes the waitlist head (the count drops below the cap) or raises available above 0; both make the check fail
-- and the tap takes the locked path, which re-decides everything. Anything else ("maybe") also takes the locked path.
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

-- ---------------------------------------------------------------- 3. "my status" in one round trip (sweep folded in, like api_state)
create or replace function api_me(p_drop uuid, p_buyer uuid) returns jsonb language plpgsql as $$
declare v_sweep jsonb;
begin
  v_sweep := sweep_drop(p_drop);   -- takes the drop lock only when a hold is due (0006 fast path)
  return jsonb_build_object(
    'swept', coalesce((v_sweep->>'expired')::int, 0) + coalesce((v_sweep->>'warned')::int, 0) + coalesce((v_sweep->>'missed')::int, 0) > 0,
    'status', my_status(p_drop, p_buyer));
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function api_me(uuid, uuid) from public, anon, authenticated';
    execute 'grant execute on function api_me(uuid, uuid) to service_role';
  end if;
end $$;
notify pgrst, 'reload schema';
