-- Judge mode (/try): 40 bot buyers, 8 sandbox slots (one "Demo Jewels" shop + one reusable open channel each),
-- try_start() to hand a visitor a fresh sandbox drop, and a tiny sliding throttle. Re-runnable.

alter table try_slots add column if not exists shop_id uuid references shops(id) on delete cascade;
alter table try_slots add column if not exists role text;
alter table try_slots add column if not exists judge_id uuid;          -- the visitor's sandbox buyer
alter table try_slots add column if not exists started_at timestamptz;
alter table try_slots add column if not exists runner_until timestamptz; -- lease of the after() runner loop
alter table try_slots add column if not exists runner_token text;
create unique index if not exists try_slots_drop on try_slots (drop_id) where drop_id is not null;

-- Nexconn registration of demo bots (token issued once, then cached here).
alter table buyers add column if not exists nexconn_registered_at timestamptz;
create unique index if not exists buyers_bot_uid on buyers (nexconn_user_id) where is_bot;

create index if not exists bot_schedule_drop on bot_schedule (drop_id, due_at) where done_at is null;

-- Sliding throttle: a row per key; take() succeeds when the previous hold has run out.
create table if not exists throttles (key text primary key, until timestamptz not null);
alter table throttles enable row level security;
create or replace function throttle_take(p_key text, p_seconds numeric) returns boolean language sql as $$
  insert into throttles as t (key, until) values (p_key, clock_timestamp() + p_seconds * interval '1 second')
  on conflict (key) do update set until = excluded.until where t.until <= clock_timestamp()
  returning true $$;

-- ---------------------------------------------------------------- seed (idempotent; scripts/seed-demo.ts calls it too)
create or replace function sandbox_seed() returns jsonb language plpgsql as $$
declare
  v_names text[] := array[
    'Aarav K.','Priya S.','Rohan M.','Ananya R.','Vihaan P.','Diya G.','Arjun T.','Isha N.','Kabir D.','Meera J.',
    'Aditya V.','Saanvi B.','Reyansh C.','Kavya L.','Ishaan A.','Riya H.','Vivaan S.','Aisha F.','Krishna Y.','Tara K.',
    'Dhruv M.','Nisha P.','Aryan G.','Pooja R.','Sai T.','Neha V.','Atharv D.','Simran K.','Yash B.','Anika C.',
    'Rahul J.','Zoya M.','Karan S.','Lakshmi N.','Om P.','Shreya A.','Dev R.','Ira T.','Manav G.','Pari S.'];
  v_products jsonb := '[
    {"title":"Temple jhumka earrings","price":145000,"note":"Gold-plated brass, lightweight. Pair.","photos":["/demo/jhumka-earrings.svg","/demo/jhumka-earrings-2.svg"],
     "variants":[{"key":"gold","label":"Gold","qty":1},{"key":"silver","label":"Silver","qty":1},{"key":"rose","label":"Rose gold","qty":2}]},
    {"title":"Kundan choker","price":285000,"note":"Kundan stones on a gold-tone base, adjustable dori.","photos":["/demo/kundan-choker.svg","/demo/kundan-choker-2.svg"],
     "variants":[{"key":"green","label":"Emerald green","qty":2},{"key":"red","label":"Ruby red","qty":2}]},
    {"title":"Silver anklet (pair)","price":125000,"note":"925 silver, hallmarked. Small bells.","photos":["/demo/silver-anklet.svg"],
     "variants":[{"key":"S","label":"S","qty":1},{"key":"M","label":"M","qty":2},{"key":"L","label":"L","qty":1}]},
    {"title":"Stone ring","price":89900,"note":"925 silver with a pink stone.","photos":["/demo/stone-ring.svg"],
     "variants":[{"key":"6","label":"Size 6","qty":1},{"key":"7","label":"Size 7","qty":2},{"key":"8","label":"Size 8","qty":1}]},
    {"title":"Bangle set of 4","price":165000,"note":"Gold-plated, meenakari work.","photos":["/demo/bangle-set.svg"],
     "variants":[{"key":"2.4","label":"2.4","qty":2},{"key":"2.6","label":"2.6","qty":2},{"key":"2.8","label":"2.8","qty":1}]},
    {"title":"Pendant chain","price":199900,"note":"925 silver chain with a teardrop pendant.","photos":["/demo/pendant-chain.svg"],
     "variants":[{"key":"16","label":"16 inch","qty":1},{"key":"18","label":"18 inch","qty":2}]}
  ]';
  v_faq jsonb := '["COD not available","Ships in 3–5 days","Returns within 7 days for damaged pieces","925 silver, hallmarked"]';
  v_shop uuid; v_prod uuid; p jsonb; i int; j int;
begin
  for i in 1..40 loop
    insert into buyers (name, display_name, nexconn_user_id, is_bot, is_sandbox)
    select v_names[i], v_names[i], 'demo_bot_' || lpad(i::text, 2, '0'), true, true
     where not exists (select 1 from buyers where is_bot and nexconn_user_id = 'demo_bot_' || lpad(i::text, 2, '0'));
    update buyers set name = v_names[i], display_name = v_names[i], is_sandbox = true
     where is_bot and nexconn_user_id = 'demo_bot_' || lpad(i::text, 2, '0');
  end loop;

  for i in 1..8 loop
    insert into shops (slug, name, upi_id, payee_name, hold_seconds, faq, is_sandbox)
    values ('demo-jewels-' || i, 'Demo Jewels', 'demo@upi', 'Demo Jewels', 20, v_faq, true)
    on conflict (slug) do update set name = excluded.name, upi_id = excluded.upi_id, payee_name = excluded.payee_name,
      hold_seconds = 20, faq = excluded.faq, is_sandbox = true
    returning id into v_shop;
    update shops set nexconn_desk_id = 'desk_' || left(replace(id::text, '-', ''), 20) where id = v_shop;
    insert into staff (shop_id, role, display_name) select v_shop, 'owner', 'Demo owner'
     where not exists (select 1 from staff where shop_id = v_shop and role = 'owner');
    insert into staff (shop_id, role, display_name) select v_shop, 'staff', 'Asha (demo staff)'
     where not exists (select 1 from staff where shop_id = v_shop and role = 'staff' and display_name = 'Asha (demo staff)');

    j := 0;
    for p in select value from jsonb_array_elements(v_products) loop
      j := j + 1;
      select id into v_prod from products where shop_id = v_shop and title = p->>'title';
      if v_prod is null then
        -- created_at fixes the running order (drop position = order by created_at)
        insert into products (shop_id, title, price_paise, note, photos, created_at)
        values (v_shop, p->>'title', (p->>'price')::bigint, p->>'note', array(select jsonb_array_elements_text(p->'photos')),
                timestamptz '2026-01-01' + j * interval '1 minute')
        returning id into v_prod;
      else
        update products set price_paise = (p->>'price')::bigint, note = p->>'note',
          photos = array(select jsonb_array_elements_text(p->'photos')), created_at = timestamptz '2026-01-01' + j * interval '1 minute'
         where id = v_prod;
      end if;
      insert into product_variants (product_id, key, label, qty, sort)
      select v_prod, x.value->>'key', x.value->>'label', (x.value->>'qty')::int, x.ord::int
        from jsonb_array_elements(p->'variants') with ordinality as x(value, ord)
      on conflict (product_id, key) do update set label = excluded.label, qty = excluded.qty, sort = excluded.sort;
      v_prod := null;
    end loop;

    insert into try_slots (slot, channel_id, shop_id) values (i, 'dr_demo' || i, v_shop)
    on conflict (slot) do update set channel_id = excluded.channel_id, shop_id = excluded.shop_id;
  end loop;

  return jsonb_build_object('bots', (select count(*) from buyers where is_bot), 'slots', (select count(*) from try_slots where shop_id is not null));
end $$;

-- ---------------------------------------------------------------- try_start
-- Takes the slot idle longest (never fails while a slot exists), wipes its previous sandbox drop (cascade), creates a
-- fresh live drop with full stock, a sandbox buyer for the visitor, and the room/desk outbox rows.
create or replace function try_start(p_role text, p_name text, p_display text) returns jsonb language plpgsql as $$
declare
  v_slot try_slots; v_shop shops; v_owner uuid; v_staff uuid; v_drop uuid; v_code text; v_buyer uuid; r record; v_ch text;
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if p_role not in ('buyer','seller') then raise exception 'bad role'; end if;
  select * into v_slot from try_slots where shop_id is not null order by last_active_at nulls first, slot limit 1 for update skip locked;
  if not found then  -- every slot is being reset right now: wait for the oldest
    select * into v_slot from try_slots where shop_id is not null order by last_active_at nulls first, slot limit 1 for update;
  end if;
  if not found then raise exception 'no sandbox slots: run scripts/seed-demo.ts'; end if;
  select * into v_shop from shops where id = v_slot.shop_id;
  select id into v_owner from staff where shop_id = v_shop.id and role = 'owner';
  select id into v_staff from staff where shop_id = v_shop.id and role = 'staff' order by created_at limit 1;
  v_ch := v_slot.channel_id;

  -- previous visit: its drop (claims, orders, outbox, schedule ... cascade) and its visitor
  delete from drops where shop_id = v_shop.id;
  if v_slot.judge_id is not null then delete from buyers where id = v_slot.judge_id and is_sandbox and not is_bot; end if;
  update shops set order_seq = 0 where id = v_shop.id;
  update staff set last_assigned_at = null where shop_id = v_shop.id;

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
  for r in select buyer_id from bans where shop_id = v_shop.id loop     -- the last visitor's mutes/bans must not carry over
    perform _out(v_drop, 'room', v_ch, 'SYS:Unban', jsonb_build_object('channelId', v_ch, 'userId', _buyer_uid(r.buyer_id)), 'high');
  end loop;
  delete from bans where shop_id = v_shop.id;
  perform _out(v_drop, 'group', v_shop.nexconn_desk_id, 'SYS:EnsureGroup', jsonb_build_object('channelId', v_shop.nexconn_desk_id,
    'name', 'Demo Jewels team', 'memberIds', (select jsonb_agg(_staff_uid(id)) from staff where shop_id = v_shop.id)));

  insert into buyers (name, display_name, is_sandbox) values (p_name, p_display, true) returning id into v_buyer;
  perform drop_go_live(v_drop, v_owner);

  update try_slots set drop_id = v_drop, role = p_role, visitor = p_display, judge_id = v_buyer, started_at = now(),
         last_active_at = now(), runner_until = null, runner_token = null where slot = v_slot.slot;
  return jsonb_build_object('slot', v_slot.slot, 'dropId', v_drop, 'code', v_code, 'channelId', v_ch, 'shopId', v_shop.id,
    'shopSlug', v_shop.slug, 'ownerId', v_owner, 'staffId', v_staff, 'buyerId', v_buyer);
end $$;

-- Scripted "Drop next" for a sandbox drop: drop_next, then the bot plan for the new piece timed from its live_at
-- (same transaction, so the first bot taps are not late by a round trip). p_if_position: only when the highest
-- piece shown so far is that position (two scripted "next" rows can never skip a piece). p_expect: the piece the plan was made for.
create or replace function sandbox_next(p_drop uuid, p_staff uuid, p_if_position int, p_expect uuid, p_plan jsonb) returns jsonb
language plpgsql as $$
declare v_pos int; v_r jsonb; v_live uuid; v_at timestamptz;
begin
  if not exists (select 1 from drops where id = p_drop and is_sandbox) then return _err('not_sandbox'); end if;
  if p_if_position is not null then
    select coalesce(max(position), 0) into v_pos from drop_items where drop_id = p_drop and state <> 'queued';
    if v_pos <> p_if_position then return _err('skipped'); end if;
  end if;
  v_r := drop_next(p_drop, p_staff);
  v_live := (v_r->>'liveItemId')::uuid;
  if v_live is not null and v_live = p_expect then
    select live_at into v_at from drop_items where id = v_live;
    insert into bot_schedule (drop_id, due_at, action, payload)
    select p_drop, v_at + make_interval(secs => (x->>'ms')::float8 / 1000), x->>'action', x->'payload'
      from jsonb_array_elements(coalesce(p_plan, '[]')) x;
  end if;
  return v_r;
end $$;

select sandbox_seed();

do $$
begin
  execute 'revoke execute on all functions in schema public from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on all functions in schema public from anon, authenticated';
    execute 'revoke all on all tables in schema public from anon, authenticated';
  end if;
end $$;
