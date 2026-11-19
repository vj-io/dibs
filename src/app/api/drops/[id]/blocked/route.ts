// The buyer's app refused a sale-room message before sending it (same rules as the scam shield). This records the
// attempt so the seller's moderation log shows it. The server runs the rules again: a text that is not blocked
// records nothing. No message text is stored.
import { z } from "zod";
import { scamRules } from "@/lib/ai/scam-shield";
import { sql } from "@/lib/server/db";
import { body, json, notFound, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { requireBuyer } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const Body = z.object({ text: z.string().min(1).max(500) });

export const POST = route("POST /api/drops/:id/blocked", async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { buyerId } = await requireBuyer();
  await rateLimit(`blocked:${buyerId}`, 6, 60);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const v = scamRules((await body(req, Body)).text);
  if (!v.blocked) return json({ ok: true, recorded: false });
  const rows = await sql`
    insert into moderation_events (drop_id, buyer_id, rule, action)
    select d.id, ${buyerId}, ${v.rule}, 'blocked' from drops d where d.id = ${id}
    returning id`;
  if (!rows.length) notFound();
  return json({ ok: true, recorded: true });
});
