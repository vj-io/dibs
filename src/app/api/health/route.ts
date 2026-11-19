// Staff-only health: realtime mode and flags, Nexconn call log, outbox backlog, cron sweeps, AI calls. No secrets.
import { sql } from "@/lib/server/db";
import { flags, publicConfig } from "@/lib/server/flags";
import { json, route } from "@/lib/server/http";
import { recentCalls } from "@/lib/server/nexconn";
import { activeStaff } from "@/lib/server/queries";
import type { HealthReport } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route("GET /api/health", async () => {
  await activeStaff();
  const [lastHour, [ob], recentFailures, sweeps, ai] = await Promise.all([
    sql<HealthReport["nexconn"]["lastHour"]>`
      select kind, count(*)::int as calls, count(*) filter (where not ok)::int as failures,
             percentile_cont(0.5) within group (order by ms)::int as "p50Ms",
             (array_agg(code order by id desc) filter (where not ok))[1] as "lastErrorCode"
        from health_events where created_at > now() - interval '1 hour' and kind <> 'cron_sweep' group by kind order by kind`,
    // failed = gave up in the last 24 h; stuck = due more than 2 minutes ago and still not sent (not a scheduled row)
    sql<{ pending: number; failed: number; stuck: number; oldest: Date | null }[]>`
      select count(*) filter (where status = 'pending')::int as pending,
             count(*) filter (where status = 'failed' and created_at > now() - interval '24 hours')::int as failed,
             count(*) filter (where status = 'pending' and next_attempt_at < now() - interval '2 minutes')::int as stuck,
             min(created_at) filter (where status = 'pending') as oldest
        from outbox where status <> 'sent'`,
    sql<HealthReport["outbox"]["recentFailures"]>`
      select id::text, msg_type as "msgType", last_error as error, created_at as at from outbox where status = 'failed' and created_at > now() - interval '24 hours' order by id desc limit 10`,
    sql<{ at: Date; ms: number; ok: boolean; code: string | null }[]>`
      select created_at as at, ms, ok, code from health_events where kind = 'cron_sweep' order by id desc limit 5`,
    sql<HealthReport["ai"]>`
      select job, model, count(*)::int as calls, count(*) filter (where ok)::int as ok, round(avg(ms))::int as "avgMs"
        from ai_calls where created_at > now() - interval '24 hours' and model <> 'none' group by job, model order by job, model`,
  ]);
  const cfg = publicConfig();
  return json({
    mode: flags.mode, features: cfg.features, textEnvelope: cfg.textEnvelope,
    nexconn: { recent: recentCalls().slice(-20), lastHour },
    outbox: { pending: ob.pending, failed: ob.failed, stuck: ob.stuck, oldestPendingAt: ob.oldest?.toISOString() ?? null, recentFailures },
    sweeps: sweeps.map((s) => ({ at: s.at.toISOString(), ms: s.ms, ok: s.ok, drops: Number(s.code ?? 0) })),
    ai,
  } satisfies HealthReport);
});
