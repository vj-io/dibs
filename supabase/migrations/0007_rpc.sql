-- 0007: engine calls over HTTP (PostgREST RPC) instead of one Postgres connection per function instance.
-- Why: in the 300-tap production test, Vercel started hundreds of instances at once and each opened its own
-- connections; the pooler's 200-client limit was hit (EMAXCONN) and most taps failed. PostgREST keeps one small
-- pool and queues requests, so a burst waits in line instead of failing.
-- Only the service role may call these (the server holds that key; browsers never do).

-- Generic dispatcher: api_call('claim_dibs', '["<item>","m","<buyer>","2026-..."]') -> to_jsonb(result).
-- Arguments are cast to the target function's declared parameter types, so callers pass plain JSON values.
create or replace function api_call(p_fn text, p_args jsonb) returns jsonb language plpgsql as $$
declare
  v_types oid[];
  v_parts text[] := '{}';
  v_res jsonb;
  n int := coalesce(jsonb_array_length(p_args), 0);
begin
  if p_fn !~ '^[a-z][a-z_0-9]*$' or p_fn like 'api\_%' or p_fn like 'pg\_%' then
    raise exception 'bad function name';
  end if;
  select string_to_array(p.proargtypes::text, ' ')::oid[] into v_types
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = p_fn and p.pronargs = n
   limit 1;
  if not found then raise exception 'unknown function %(%)', p_fn, n; end if;
  for i in 1..n loop
    v_parts := v_parts || format('(($1->>%s)::%s)', i - 1, format_type(v_types[i], null));
  end loop;
  execute format('select to_jsonb(%I(%s))', p_fn, array_to_string(v_parts, ', ')) using p_args into v_res;
  return v_res;
end $$;

-- The whole tap in one round trip: rate limit, item lookup, sweep of expired holds ahead, then the claim.
create or replace function api_claim(p_item uuid, p_variant_key text, p_buyer uuid, p_received timestamptz) returns jsonb
language plpgsql as $$
declare
  v_rate int;
  v_drop uuid; v_max_holds int;
  v_sweep jsonb; v_claim jsonb;
begin
  v_rate := rate_add('claim:' || p_buyer::text, 1);
  if v_rate > 5 then return jsonb_build_object('rateLimited', true); end if;
  select i.drop_id, s.max_holds into v_drop, v_max_holds
    from drop_items i join drops d on d.id = i.drop_id join shops s on s.id = d.shop_id
   where i.id = p_item;
  if not found then return jsonb_build_object('notFound', true); end if;
  -- sweep only when a hold in this drop has actually run out: the sweep takes the drop lock, and in a burst
  -- every tap would otherwise queue for that lock twice
  if exists (select 1 from claims c where c.drop_id = v_drop and c.state = 'held' and c.expires_at <= now()) then
    v_sweep := sweep_drop(v_drop);
  end if;
  v_claim := claim_dibs(p_item, p_variant_key, p_buyer, p_received);
  return jsonb_build_object(
    'dropId', v_drop, 'maxHolds', v_max_holds, 'holdSeconds', _hold_secs(v_drop, p_buyer),
    'swept', coalesce((v_sweep->>'expired')::int, 0) + coalesce((v_sweep->>'warned')::int, 0) + coalesce((v_sweep->>'missed')::int, 0) > 0,
    'claim', v_claim);
end $$;

-- Public state and "my status" with the sweep folded in (one round trip each).
create or replace function api_state(p_drop uuid) returns jsonb language plpgsql as $$
declare v_sweep jsonb;
begin
  v_sweep := sweep_drop(p_drop);
  return jsonb_build_object(
    'swept', coalesce((v_sweep->>'expired')::int, 0) + coalesce((v_sweep->>'warned')::int, 0) + coalesce((v_sweep->>'missed')::int, 0) > 0,
    'state', drop_state(p_drop));
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function api_call(text, jsonb), api_claim(uuid, text, uuid, timestamptz), api_state(uuid) from public, anon, authenticated';
    execute 'grant execute on function api_call(text, jsonb), api_claim(uuid, text, uuid, timestamptz), api_state(uuid) to service_role';
  end if;
end $$;
notify pgrst, 'reload schema';
