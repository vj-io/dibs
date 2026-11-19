-- 0009: demo timings. In a judge-mode drop a bot's hold lasts 12 s (was the shop's 20 s), so the judge's promotion
-- lands about 25 s after the tap instead of about 40; a human still gets 90 s. The shop keeps hold_seconds = 20 (its
-- check constraint is 20..1800) and claim_dibs is untouched: it already asks _hold_secs (0006) when a hold starts.
-- Real drops are unaffected (_is_try is false). Disclosed on /try, /how-it-works and in the README. Re-runnable.

create or replace function _hold_secs(p_drop uuid, p_buyer uuid) returns int language sql stable as $$
  select case when not _is_try(d.id) then s.hold_seconds when b.is_bot then 12 else 90 end
    from drops d join shops s on s.id = d.shop_id, buyers b where d.id = p_drop and b.id = p_buyer $$;
-- create or replace keeps the function's existing grants (0002/0006).

-- A demo order's payment card must not be payable: demo@upi could belong to a stranger. Every DB:Pay card of a
-- sandbox drop carries a plain-text payload instead of a upi:// link, decided here so no client can render one.
-- (GET /api/orders/:id does the same for the order view.)
create or replace function _demo_pay() returns trigger language plpgsql as $$
begin
  if exists (select 1 from drops where id = new.drop_id and is_sandbox) then
    new.payload := new.payload || jsonb_build_object('upiLink', 'Dibs demo: no real payment', 'demo', true);
  end if;
  return new;
end $$;
drop trigger if exists outbox_demo_pay on outbox;
create trigger outbox_demo_pay before insert on outbox for each row when (new.msg_type = 'DB:Pay') execute function _demo_pay();

-- Buyer demo: piece 1 drops p_ms after the judge's screen is first in the room (the room takes 6-7 s to appear, so
-- a clock started at /try/start would often drop it before they arrive). Schedules the scripted "next" once, sets
-- the drop's startsAt to that moment and sends DB:State, so the room shows "Piece 1 drops in 5…". Returns false if
-- already scheduled or a piece is out. p_ms = 0 is not used; the 12 s fallback row comes from scheduleStart.
create or replace function sandbox_first_room(p_drop uuid, p_ms int) returns boolean language plpgsql as $$
declare v_at timestamptz;
begin
  perform 1 from drops where id = p_drop and is_sandbox and status = 'live' for no key update;   -- lock 1: drop
  if not found then return false; end if;
  if exists (select 1 from bot_schedule where drop_id = p_drop and action = 'next' and payload ? 'firstRoom')
     or exists (select 1 from drop_items where drop_id = p_drop and state <> 'queued') then
    return false;
  end if;
  v_at := clock_timestamp() + make_interval(secs => p_ms / 1000.0);
  insert into bot_schedule (drop_id, due_at, action, payload) values (p_drop, v_at, 'next', '{"ifPosition": 0, "firstRoom": true}');
  update drops set starts_at = v_at where id = p_drop;
  perform _room_state(p_drop, _bump(p_drop));
  return true;
end $$;

-- The 12 s fallback (no room tick yet) shows the same countdown.
create or replace function sandbox_set_start(p_drop uuid, p_ms int) returns void language plpgsql as $$
begin
  perform 1 from drops where id = p_drop and is_sandbox for no key update;
  if not found then return; end if;
  update drops set starts_at = clock_timestamp() + make_interval(secs => p_ms / 1000.0) where id = p_drop;
  perform _room_state(p_drop, _bump(p_drop));
end $$;

-- Bot taps that fall due together go to the engine in one call, in due order: one round trip instead of one per bot
-- (over HTTP RPC each claim was a separate request, so ten "80-400 ms" taps landed over 3 s and a judge could beat
-- them). Each tap is an ordinary claim_dibs call; demo bots only.
create or replace function sandbox_taps(p_taps jsonb) returns jsonb language plpgsql as $$
declare t jsonb; v_res jsonb := '[]';
begin
  for t in select value from jsonb_array_elements(p_taps) loop
    if not exists (select 1 from buyers where id = (t->>'buyerId')::uuid and is_bot) then continue; end if;
    v_res := v_res || jsonb_build_array(claim_dibs((t->>'itemId')::uuid, t->>'variant', (t->>'buyerId')::uuid, clock_timestamp())
                                        || jsonb_build_object('buyerId', t->>'buyerId'));
  end loop;
  return v_res;
end $$;

-- The runner's hot path in one call: claim every due action of a demo drop (each runs once, whoever claims it) and
-- report when the next one is due. Called over HTTP RPC so the runner never queues behind its own instance's small
-- Postgres pool (drains and chat moderation share it; that queue stalled the runner for seconds).
create or replace function sandbox_due(p_drop uuid) returns jsonb language sql as $$
  with due as (
    select id from bot_schedule where drop_id = p_drop and done_at is null and due_at <= clock_timestamp()
     order by due_at, id for update skip locked
  ), c as (
    update bot_schedule b set done_at = clock_timestamp() from due where b.id = due.id returning b.id, b.action, b.payload, b.due_at
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', c.id::text, 'action', c.action, 'payload', c.payload) order by c.due_at, c.id) from c), '[]'),
    'ms', (select extract(epoch from (min(due_at) - clock_timestamp())) * 1000 from bot_schedule
            where drop_id = p_drop and done_at is null and id not in (select id from due)),
    'status', (select status from drops where id = p_drop)) $$;
