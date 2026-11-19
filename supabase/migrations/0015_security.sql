-- Security review fixes (19 Nov 2026). Re-runnable. Additive only: the previous release keeps working on this schema
-- (new nullable columns, one new table, one new function; nothing renamed, dropped or re-signed).

-- ---------------------------------------------------------------- 1. inbox proof ends what a squatter set up
-- A password account is created with no proof of the inbox (sign-up, invite link). When the inbox owner first signs
-- in by emailed code (staff_proved, below): every older cookie of that account dies; an owner keeps the shop (an
-- honest seller who forgot the password must not lose it) and is told once to check its UPI ID and payee name; an
-- active staff seat is kept; a seat the shop owner already removed is moved off the user id (staff_detach), so the
-- person can create their own shop.
alter table staff add column if not exists sessions_after timestamptz;  -- a staff cookie issued before this is refused
alter table staff add column if not exists detached_from uuid;          -- the Auth user id this row had before staff_detach
alter table staff add column if not exists proof_notice_at timestamptz; -- owner kept through inbox proof: show the "check your UPI ID" note until dismissed

-- Moves the staff row of an Auth user off that user: new id, inactive, no email (so it is not a pending invite),
-- sessions ended. Order and club references follow it. A staff member's open orders go to the owner and they leave
-- the desk and order rooms, exactly as when the owner removes them; an owner's shop is left without a sign-in.
-- false = this user has no staff row.
create or replace function staff_detach(p_user uuid) returns boolean language plpgsql as $$
declare
  v_st staff; v_new uuid := gen_random_uuid(); v_uid text := 's_' || p_user::text; v_n int;
begin
  select * into v_st from staff where id = p_user for update;
  if not found then return false; end if;
  if v_st.active then  -- a row the owner already removed has handed over its orders and left its rooms
    if v_st.role <> 'owner' then
      update orders set assigned_staff_id = (select id from staff where shop_id = v_st.shop_id and role = 'owner' and active order by created_at limit 1)
       where shop_id = v_st.shop_id and assigned_staff_id = p_user and state in ('held','payment_claimed','paid');
    end if;
    insert into outbox (drop_id, channel_type, channel_id, msg_type, payload)
    select distinct on (o.channel_id) o.drop_id, 'group', o.channel_id, 'SYS:LeaveGroup',
           jsonb_build_object('channelId', o.channel_id, 'memberIds', jsonb_build_array(v_uid))
      from outbox o
     where o.msg_type = 'SYS:EnsureGroup' and o.payload->'memberIds' ? v_uid
       and (o.channel_id = (select nexconn_desk_id from shops where id = v_st.shop_id)
            or o.channel_id in (select nexconn_group_id from orders where shop_id = v_st.shop_id));
  end if;
  -- one statement: the foreign keys to staff(id) have no ON UPDATE CASCADE and are checked when the statement ends
  with moved as (
         update staff set id = v_new, active = false, email = null, nexconn_user_id = null, detached_from = p_user, sessions_after = now()
          where id = p_user returning 1),
       o as (update orders set assigned_staff_id = v_new where assigned_staff_id = p_user returning 1),
       c as (update club_posts set staff_id = v_new where staff_id = p_user returning 1)
  select count(*) into v_n from moved;
  return v_n > 0;
end $$;

-- The first inbox proof of a password account: 'none' (no staff row), 'detached' (a removed seat: the user id is free
-- again) or 'kept' (sessions before now are ended; an owner also gets the one-time notice).
create or replace function staff_proved(p_user uuid) returns text language plpgsql as $$
declare v_st staff;
begin
  select * into v_st from staff where id = p_user for update;
  if not found then return 'none'; end if;
  if not v_st.active then perform staff_detach(p_user); return 'detached'; end if;
  update staff set sessions_after = now(), proof_notice_at = case when role = 'owner' then now() else proof_notice_at end where id = p_user;
  return 'kept';
end $$;

-- ---------------------------------------------------------------- 5. a member the seller removed cannot rejoin
create table if not exists club_removed (
  shop_id uuid not null references shops(id) on delete cascade,
  buyer_id uuid not null references buyers(id) on delete cascade,
  removed_at timestamptz not null default now(),
  primary key (shop_id, buyer_id)
);
alter table club_removed enable row level security;

-- ---------------------------------------------------------------- 7. functions the public API keys could execute
-- A function created in public is executable by PUBLIC whatever the schema's default privileges say, so each new
-- one is revoked by name. service_role keeps its own grant (the server calls sandbox_* through api_call).
do $$
begin
  execute 'revoke all on function sandbox_taps(jsonb), sandbox_due(uuid), _dead_order_group(), _dead_desk_group(), staff_detach(uuid), staff_proved(uuid) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function sandbox_taps(jsonb), sandbox_due(uuid), _dead_order_group(), _dead_desk_group(), staff_detach(uuid), staff_proved(uuid) from anon, authenticated';
    execute 'revoke all on club_removed from anon, authenticated';
  end if;
end $$;
