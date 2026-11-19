-- Shop club (PRD FR-26, flag FEATURE_COMMUNITY). Re-runnable.
-- Nexconn carries the club live (community channel club_<20 hex of shop id>, subchannels drops / chat / reviews);
-- these rows are the record the pages read: the community history API is off on our plan (1009).

create table if not exists club_members (
  shop_id uuid not null references shops(id) on delete cascade,
  buyer_id uuid not null references buyers(id) on delete cascade,
  joined_at timestamptz not null default now(),
  muted boolean not null default false,
  primary key (shop_id, buyer_id)
);
create index if not exists club_members_buyer on club_members (buyer_id);

-- announce: #drops (staff or the auto post for a drop; auto_key makes the auto post once per drop and status)
-- review:   #reviews, one per paid/shipped order
-- chat:     #chat, what members said (seller view and history)
create table if not exists club_posts (
  id bigserial primary key,
  shop_id uuid not null references shops(id) on delete cascade,
  kind text not null check (kind in ('announce', 'review', 'chat')),
  buyer_id uuid references buyers(id) on delete cascade,
  staff_id uuid references staff(id) on delete set null,
  drop_id uuid references drops(id) on delete cascade,
  order_id uuid unique references orders(id) on delete cascade,
  auto_key text unique,
  stars int check (stars between 1 and 5),
  text text not null check (length(text) <= 400),
  nexconn_msg_id text,
  hidden_at timestamptz,
  hidden_reason text,
  created_at timestamptz not null default now(),
  check (kind <> 'review' or (order_id is not null and stars is not null and length(text) <= 280))
);
create index if not exists club_posts_shop on club_posts (shop_id, kind, id desc);

-- moderation in a club has no drop: the shop is named instead
alter table moderation_events add column if not exists shop_id uuid references shops(id) on delete cascade;

alter table club_members enable row level security;
alter table club_posts enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on club_members, club_posts from anon, authenticated';
    execute 'revoke all on sequence club_posts_id_seq from anon, authenticated';
  end if;
end $$;
