// Safety-net sweep (Supabase pg_cron every minute, Vercel cron daily), Bearer CRON_SECRET: sweeps live drops and
// ended drops that still have holds or waitlists, then drains the outbox. Timing goes to health_events.
import { createHash, timingSafeEqual } from "node:crypto";
import { fn, sql } from "@/lib/server/db";
import { fail, json, route } from "@/lib/server/http";
import { drainOutbox } from "@/lib/server/outbox";
import type { SweepResult } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const digest = (s: string) => createHash("sha256").update(s).digest();

export const GET = route("GET /api/cron/sweep", async (req: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !timingSafeEqual(digest(req.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))) fail(401, "unauthorized");
  const t0 = Date.now();
  // judge mode: a demo drop whose runner died stays live and keeps its pooled slot busy; the script ends at 3 min
  const stale = await sql<{ id: string; owner: string }[]>`
    select d.id, (select st.id from staff st where st.shop_id = d.shop_id and st.role = 'owner' and st.active limit 1) as owner
      from drops d where d.is_sandbox and d.status = 'live' and d.starts_at < now() - interval '10 minutes'`;
  for (const d of stale) {
    try {
      await fn("drop_end", d.id, d.owner);
      await sql`update bot_schedule set done_at = clock_timestamp() where drop_id = ${d.id} and done_at is null`;
    } catch (e) { console.error("[cron] end stale demo", d.id, e); }
  }
  const drops = await sql<{ id: string }[]>`
    select d.id from drops d where d.status = 'live'
       or (d.status = 'ended' and exists (select 1 from claims c where c.drop_id = d.id and c.state in ('held','waitlisted')))`;
  const total: Required<SweepResult> = { expired: 0, promoted: 0, returned: 0, warned: 0, missed: 0 };
  let ok = true;
  for (const d of drops) {
    if (Date.now() - t0 > 30_000) { ok = false; break; } // the next run picks up the rest
    try {
      const r = await fn<SweepResult>("sweep_drop", d.id);
      for (const k of Object.keys(total) as (keyof SweepResult)[]) total[k] += r[k] ?? 0;
    } catch (e) { ok = false; console.error("[cron] sweep", d.id, e); }
  }
  const outbox = await drainOutbox({ max: 500, budgetMs: Math.max(5000, 50_000 - (Date.now() - t0)) });
  await sql`insert into health_events (kind, ok, code, ms) values ('cron_sweep', ${ok}, ${String(drops.length)}, ${Date.now() - t0})`.catch(() => {});
  return json({ drops: drops.length, endedDemos: stale.length, ...total, outbox });
});
