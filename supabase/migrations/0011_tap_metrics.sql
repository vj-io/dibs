-- 0011: real tap-to-result timing, measured in the buyer's browser (tap pressed -> claim result on screen).
-- No names, phones or buyer ids are stored. RLS on, no policies: only the server (service role / owner) touches it.

create table if not exists tap_metrics (
  id bigserial primary key,
  drop_id uuid not null references drops on delete cascade,
  is_sandbox boolean not null default false,
  result text not null,
  client_ms int not null check (client_ms between 0 and 60000),
  server_ms int,
  conn text,
  created_at timestamptz not null default now()
);
create index if not exists tap_metrics_drop_idx on tap_metrics (drop_id, created_at);
alter table tap_metrics enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on tap_metrics from anon, authenticated';
    execute 'revoke all on sequence tap_metrics_id_seq from anon, authenticated';
  end if;
end $$;

-- { n, medianMs, p95Ms } over client_ms; medianMs / p95Ms are null when n = 0 ("not measured yet").
-- p_drop null = every drop; sandbox rows only count when p_sandbox is true.
create or replace function tap_metrics_summary(p_drop uuid default null, p_sandbox boolean default false) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'n', count(*),
    'medianMs', (percentile_cont(0.5) within group (order by client_ms))::int,
    'p95Ms', (percentile_cont(0.95) within group (order by client_ms))::int)
  from tap_metrics
  where (p_drop is null or drop_id = p_drop) and (p_sandbox or not is_sandbox)
$$;
