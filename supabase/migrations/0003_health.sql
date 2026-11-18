-- Realtime layer: Server API call log for /health, and the outbox in-flight lease used by drainOutbox().
-- Re-runnable. ai_calls already exists in 0001.

create table if not exists health_events (
  id bigserial primary key,
  kind text not null,
  ok boolean not null,
  code text,
  ms int,
  created_at timestamptz not null default now()
);
create index if not exists health_events_created on health_events (created_at desc);

-- A drain claims a row by setting locked_until (short lease) in one autocommit statement, sends outside any
-- transaction, then marks it sent / retried. A crashed drain's lease simply expires (transaction pooler safe).
alter table outbox add column if not exists locked_until timestamptz;
alter table outbox add column if not exists last_error text;
