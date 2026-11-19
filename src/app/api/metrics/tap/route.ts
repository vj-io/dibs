// Real tap-to-result time, measured in the buyer's browser. Stores timings only: no names, phones or buyer ids.
import { sql } from "@/lib/server/db";
import { body, json, notFound, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { requireBuyer } from "@/lib/server/session";
import { TapMetric } from "@/lib/server/tap-metric";

export const dynamic = "force-dynamic";

export const POST = route("POST /api/metrics/tap", async (req: Request) => {
  const { buyerId } = await requireBuyer();
  await rateLimit(`tapmetric:${buyerId}`, 10, 60);
  const m = await body(req, TapMetric);
  const rows = await sql`
    insert into tap_metrics (drop_id, is_sandbox, result, client_ms, server_ms, conn)
    select id, is_sandbox, ${m.result}, ${m.clientMs}, ${m.serverMs ?? null}, ${m.conn ?? null} from drops where id = ${m.dropId}
    returning id`;
  if (!rows.length) notFound();
  return json({ ok: true });
});
