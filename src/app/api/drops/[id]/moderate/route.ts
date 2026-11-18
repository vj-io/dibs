// Staff mute (default 10 min), ban (default permanent) or unban a buyer: bans table + Nexconn room lists (outbox) + audit.
import { z } from "zod";
import { afterWrite } from "@/lib/server/after";
import { sql } from "@/lib/server/db";
import { body, json, notFound, route, uuidParam } from "@/lib/server/http";
import { staffForDrop } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  buyerId: z.uuid(),
  action: z.enum(["mute", "ban", "unban"]),
  minutes: z.number().int().min(1).max(43200).optional(),
  reason: z.string().trim().max(200).optional(),
});
const FOREVER = 43200; // the Nexconn maximum; the bans row has until = null

export const POST = route("POST /api/drops/:id/moderate", async (req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const s = await staffForDrop(id);
  const b = await body(req, Body);
  const [buyer] = await sql<{ uid: string }[]>`select coalesce(nexconn_user_id, 'b_' || id) as uid from buyers where id = ${b.buyerId}`;
  if (!buyer) notFound();
  const minutes = b.minutes ?? (b.action === "mute" ? 10 : null);
  await sql.begin(async (tx) => {
    const [d] = await tx<{ ch: string }[]>`select coalesce(nexconn_channel_id, 'dr_' || code) as ch from drops where id = ${id}`;
    if (b.action === "unban") {
      await tx`delete from bans where shop_id = ${s.shopId} and buyer_id = ${b.buyerId}`;
    } else {
      await tx`insert into bans (shop_id, buyer_id, kind, until, reason)
               values (${s.shopId}, ${b.buyerId}, ${b.action}, ${minutes == null ? null : new Date(Date.now() + minutes * 60_000)}, ${b.reason ?? null})
               on conflict (shop_id, buyer_id, kind) do update set until = excluded.until, reason = excluded.reason, created_at = now()`;
    }
    const msg = b.action === "mute" ? "SYS:Mute" : b.action === "ban" ? "SYS:Ban" : "SYS:Unban";
    await tx`insert into outbox (drop_id, channel_type, channel_id, msg_type, payload, priority)
             values (${id}, 'room', ${d.ch}, ${msg}, ${tx.json({ channelId: d.ch, userId: buyer.uid, minutes: minutes ?? FOREVER })}, 'high')`;
    await tx`insert into moderation_events (drop_id, buyer_id, rule, action) values (${id}, ${b.buyerId}, 'staff', ${b.action})`;
    await tx`insert into audit_events (shop_id, drop_id, actor_type, actor_id, type, payload)
             values (${s.shopId}, ${id}, 'staff', ${s.staffId}, ${"buyer_" + b.action}, ${tx.json({ buyerId: b.buyerId, minutes, reason: b.reason ?? null })})`;
  });
  await afterWrite(id);
  return json({ ok: true });
});
