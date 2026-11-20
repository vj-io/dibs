-- 0018: a faster buyer demo. There a bot's hold lasts 6 s (was 12 s, 0009), so the judge, #3 on piece 1's waitlist,
-- sees a bot promoted about 6 s after the drop and is promoted about 12 s after it: about 11 s after the tap instead of
-- about 24. The seller demo keeps 12 s (its bots tap I've paid 5-8 s after winning, inside the hold); a human still
-- gets 90 s; real drops are unaffected. Must match SCRIPT.holdMs in src/lib/server/bots.ts. Re-runnable.

create or replace function _hold_secs(p_drop uuid, p_buyer uuid) returns int language sql stable as $$
  select case when not _is_try(d.id) then s.hold_seconds when not b.is_bot then 90
              when exists (select 1 from try_slots t where t.drop_id = d.id and t.role = 'buyer') then 6 else 12 end
    from drops d join shops s on s.id = d.shop_id, buyers b where d.id = p_drop and b.id = p_buyer $$;
-- create or replace keeps the function's existing grants (0002/0006).
