-- API package: product photo bucket, per-minute sweep trigger (pg_cron + pg_net), outbox lookup index.
-- Re-runnable. Anything that needs an extension or schema the project lacks is skipped with a notice.

-- One-row deploy config read by the per-minute cron job. The lead fills it at deploy time:
--   insert into app_config (id, app_url, cron_secret) values (1, 'https://<app>', '<CRON_SECRET>')
--   on conflict (id) do update set app_url = excluded.app_url, cron_secret = excluded.cron_secret;
create table if not exists app_config (
  id int primary key default 1 check (id = 1),
  app_url text,
  cron_secret text
);
alter table app_config enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on app_config from anon, authenticated';
  end if;
end $$;

-- "has this staff member already been added to this order room?" (GET /api/orders/:id)
create index if not exists outbox_ensure_group on outbox (channel_id) where msg_type = 'SYS:EnsureGroup';

-- Storage bucket for product photos: public read, images only, 5 MB.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('product-photos', 'product-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  else
    raise notice 'storage schema missing: bucket product-photos not created';
  end if;
end $$;

-- Per-minute GET <app_url>/api/cron/sweep with the bearer secret. Vercel Hobby crons run only daily.
do $$ begin
  begin
    create extension if not exists pg_cron;
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_cron / pg_net unavailable (%): per-minute sweep not scheduled', sqlerrm;
    return;
  end;
  perform cron.schedule('dibs-sweep', '* * * * *', $job$
    select net.http_get(
      url := c.app_url || '/api/cron/sweep',
      headers := jsonb_build_object('Authorization', 'Bearer ' || c.cron_secret),
      timeout_milliseconds := 55000)
      from app_config c where c.id = 1 and c.app_url is not null and c.cron_secret is not null
  $job$);
end $$;
