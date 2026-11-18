-- Dibs schema. Re-runnable: every object is created only if missing.
-- Money in paise (bigint), times timestamptz. RLS is on for every table with no policies:
-- the server connects as postgres (bypasses RLS); the anon/authenticated keys read nothing.

create extension if not exists pgcrypto;

create table if not exists shops (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  logo_url text,
  upi_id text,
  payee_name text,
  support_whatsapp text,
  hold_seconds int not null default 600 check (hold_seconds between 20 and 1800),
  max_holds int not null default 3 check (max_holds between 1 and 10),
  waitlist_max int not null default 20 check (waitlist_max between 0 and 200),
  high_value_paise bigint check (high_value_paise > 0),
  auto_advance boolean not null default false,
  faq jsonb not null default '[]',
  nexconn_desk_id text,
  nexconn_club_id text,
  order_seq int not null default 0,            -- last order_no issued (per-shop running number)
  is_sandbox boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists staff (
  id uuid primary key default gen_random_uuid(),  -- = Supabase auth user id for real staff
  shop_id uuid not null references shops(id) on delete cascade,
  role text not null check (role in ('owner','staff')),
  display_name text not null,
  email text,
  nexconn_user_id text,
  active boolean not null default true,
  last_assigned_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists staff_one_owner on staff (shop_id) where role = 'owner';
create index if not exists staff_shop on staff (shop_id);

create table if not exists buyers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_name text not null,
  phone text,
  nexconn_user_id text,
  is_bot boolean not null default false,
  is_sandbox boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists buyers_phone on buyers (phone) where not is_bot and phone is not null and deleted_at is null;

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  title text not null,
  price_paise bigint not null check (price_paise > 0),
  note text,
  photos text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists products_shop on products (shop_id);

create table if not exists product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  key text not null,
  label text not null,
  qty int not null check (qty >= 0),
  sort int not null default 0,
  unique (product_id, key)
);

create table if not exists drops (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  code text not null unique check (length(code) = 6),
  title text not null,
  starts_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','live','ended')),
  live_item_id uuid,                            -- current item (state live or sold_out); null between items
  nexconn_channel_id text,
  version bigint not null default 0,
  viewer_cap int not null default 400,
  is_sandbox boolean not null default false,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists drops_shop on drops (shop_id);
create index if not exists drops_live on drops (status) where status = 'live';

create table if not exists drop_items (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid not null references drops(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  position int not null,
  state text not null default 'queued' check (state in ('queued','live','sold_out','closed')),
  live_at timestamptz,
  closed_at timestamptz,
  unique (drop_id, position)
);
create unique index if not exists drop_items_one_live on drop_items (drop_id) where state = 'live';

create table if not exists item_stock (
  drop_item_id uuid not null references drop_items(id) on delete cascade,
  variant_id uuid not null references product_variants(id) on delete cascade,
  total int not null check (total >= 0),
  available int not null check (available >= 0),
  primary key (drop_item_id, variant_id),
  check (available <= total)
);

create table if not exists claims (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid not null references drops(id) on delete cascade,
  drop_item_id uuid not null references drop_items(id) on delete cascade,
  variant_id uuid not null references product_variants(id) on delete cascade,
  buyer_id uuid not null references buyers(id) on delete cascade,
  state text not null check (state in ('held','payment_claimed','paid','shipped','waitlisted','expired','released','cancelled','left','missed')),
  received_at timestamptz,
  committed_at timestamptz not null,
  expires_at timestamptz,
  ms_after_live int,
  order_id uuid,
  promoted_at timestamptz,                      -- set when a waitlisted claim became a hold ("waitlist save" if paid)
  warned_at timestamptz,                        -- "expiring in 2 min" alert sent
  ended_reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists claims_one_active on claims (drop_item_id, buyer_id) where state in ('held','payment_claimed','waitlisted');
create index if not exists claims_queue on claims (drop_item_id, variant_id, state, committed_at);
create index if not exists claims_drop_state on claims (drop_id, state, expires_at);
create index if not exists claims_buyer on claims (buyer_id, drop_id);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  drop_id uuid not null references drops(id) on delete cascade,
  claim_id uuid not null unique references claims(id) on delete cascade,
  buyer_id uuid not null references buyers(id) on delete cascade,
  order_no int not null,
  amount_paise bigint not null check (amount_paise > 0),
  nexconn_group_id text not null,
  assigned_staff_id uuid references staff(id) on delete set null,
  state text not null check (state in ('held','payment_claimed','paid','shipped','cancelled')),
  utr text,
  tracking_note text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  shipped_at timestamptz,
  cancelled_at timestamptz,
  unique (shop_id, order_no)
);
create index if not exists orders_assignee on orders (assigned_staff_id, state);
create index if not exists orders_drop on orders (drop_id);
create index if not exists orders_buyer on orders (buyer_id);

-- kind 'ban' blocks claims; kind 'mute' only silences chat. until null = permanent.
create table if not exists bans (
  shop_id uuid not null references shops(id) on delete cascade,
  buyer_id uuid not null references buyers(id) on delete cascade,
  kind text not null default 'ban' check (kind in ('ban','mute')),
  until timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  primary key (shop_id, buyer_id, kind)
);

create table if not exists outbox (
  id bigserial primary key,
  drop_id uuid references drops(id) on delete cascade,
  channel_type text not null check (channel_type in ('room','group','user')),
  channel_id text not null,
  msg_type text not null,
  payload jsonb not null,
  priority text not null default 'normal' check (priority in ('high','normal','low')),
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists outbox_pending on outbox (next_attempt_at, id) where status = 'pending';
create index if not exists outbox_channel on outbox (channel_id, id);
create index if not exists outbox_drop on outbox (drop_id, id);

create table if not exists audit_events (
  id bigserial primary key,
  shop_id uuid references shops(id) on delete cascade,
  drop_id uuid references drops(id) on delete cascade,
  actor_type text not null,                     -- buyer | staff | system
  actor_id uuid,
  type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists audit_drop on audit_events (drop_id, id);

create table if not exists moderation_events (
  id bigserial primary key,
  drop_id uuid references drops(id) on delete cascade,
  buyer_id uuid references buyers(id) on delete set null,
  nexconn_msg_id text,
  rule text not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index if not exists moderation_drop on moderation_events (drop_id, id);

create table if not exists webhook_seen (
  message_id text primary key,
  received_at timestamptz not null default now()
);

create table if not exists ai_calls (
  id bigserial primary key,
  job text not null,
  model text,
  ms int,
  ok boolean not null,
  created_at timestamptz not null default now()
);

-- DB-backed rate limit counters (fixed windows). rate_add() lives in 0002.
create table if not exists rate_hits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);

-- Judge-mode bot actions (another package fills in the behaviour).
create table if not exists bot_schedule (
  id bigserial primary key,
  drop_id uuid not null references drops(id) on delete cascade,
  due_at timestamptz not null,
  action text not null,
  payload jsonb not null default '{}',
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists bot_schedule_due on bot_schedule (due_at) where done_at is null;

-- Pool of 8 sandbox sale rooms reused by /try (another package fills in the behaviour).
create table if not exists try_slots (
  slot int primary key check (slot between 1 and 8),
  channel_id text not null unique,
  drop_id uuid references drops(id) on delete set null,
  visitor text,
  last_active_at timestamptz
);

-- RLS on, no policies; anon/authenticated get no table or function privileges.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon, authenticated';
    execute 'revoke all on all sequences in schema public from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on tables from anon, authenticated';
    execute 'alter default privileges in schema public revoke all on sequences from anon, authenticated';
  end if;
end $$;
