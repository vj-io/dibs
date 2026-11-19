-- Nexconn lets one user be in 1,000 group channels (create answers 22413 after that). Demo resets and deleted shops
-- removed order rows but left their Nexconn groups, so demo staff and bots crept toward the cap (the bot hit it on
-- 19 Nov 2026). Every deleted order or shop now leaves its group id here; the cron sweep dismisses the group and
-- removes the row.
create table if not exists dead_groups (channel_id text primary key, at timestamptz not null default now());
alter table dead_groups enable row level security;

create or replace function _dead_group() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'orders' and old.nexconn_group_id is not null then
    insert into dead_groups (channel_id) values (old.nexconn_group_id) on conflict do nothing;
  elsif tg_table_name = 'shops' and old.nexconn_desk_id is not null then
    insert into dead_groups (channel_id) values (old.nexconn_desk_id) on conflict do nothing;
  end if;
  return old;
end $$;

drop trigger if exists orders_dead_group on orders;
create trigger orders_dead_group after delete on orders for each row execute function _dead_group();
drop trigger if exists shops_dead_group on shops;
create trigger shops_dead_group after delete on shops for each row execute function _dead_group();
