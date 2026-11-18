// Staff mute (default 10 min), ban (default permanent) or unban a buyer: bans table + Nexconn room lists (outbox) + audit.
import { z } from "zod";
import { afterWrite } from "@/lib/server/after";
import { fn, sql } from "@/lib/server/db";
import { body, json, notFound, route, uuidParam } from "@/lib/server/http";
import { staffForDrop } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

// buyerId (ledger, moderation log) or userId = the Nexconn sender id a chat line carries (b_<uuid>, demo_bot_NN)
const Body = z.object({
  buyerId: z.uuid().optional(),
  userId: z.string().regex(/^(b_[0-9a-f-]{36}|demo_bot_\d{2})$/).optional(),
  action: z.enum(["mute", "ban", "unban"]),
  minutes: z.number().int().min(1).max(43200).optional(),
  reason: z.string().trim().max(200).optional(),
}).refine((b) => !!b.buyerId !== !!b.userId, "send buyerId or userId");
const FOREVER = 43200; // the Nexconn maximum; the bans row has until = null

export const POST = route("POST /api/drops/:id/moderate", async (req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const s = await staffForDrop(id);
  const b = await body(req, Body);
  const byUid = b.userId?.startsWith("b_") ? b.userId.slice(2) : null;
  const [buyer] = await sql<{ id: string; uid: string }[]>`
    select id, coalesce(nexconn_user_id, 'b_' || id) as uid from buyers
     where ${b.buyerId ? sql`id = ${b.buyerId}` : byUid ? sql`id = ${byUid} and not is_bot` : sql`is_bot and nexconn_user_id = ${b.userId!}`}`;
  if (!buyer) notFound();
  const buyerId = buyer.id;
  const minutes = b.minutes ?? (b.action === "mute" ? 10 : null);
  await sql.begin(async (tx) => {
    const [d] = await tx<{ ch: string }[]>`select coalesce(nexconn_channel_id, 'dr_' || code) as ch from drops where id = ${id}`;
    if (b.action === "unban") {
      await tx`delete from bans where shop_id = ${s.shopId} and buyer_id = ${buyerId}`;
    } else {
      await tx`insert into bans (shop_id, buyer_id, kind, until, reason)
               values (${s.shopId}, ${buyerId}, ${b.action}, ${minutes == null ? null : new Date(Date.now() + minutes * 60_000)}, ${b.reason ?? null})
               on conflict (shop_id, buyer_id, kind) do update set until = excluded.until, reason = excluded.reason, created_at = now()`;
    }
    const msg = b.action === "mute" ? "SYS:Mute" : b.action === "ban" ? "SYS:Ban" : "SYS:Unban";
    await tx`insert into outbox (drop_id, channel_type, channel_id, msg_type, payload, priority)
             values (${id}, 'room', ${d.ch}, ${msg}, ${tx.json({ channelId: d.ch, userId: buyer.uid, minutes: minutes ?? FOREVER })}, 'high')`;
    await tx`insert into moderation_events (drop_id, buyer_id, rule, action) values (${id}, ${buyerId}, 'staff', ${b.action})`;
    await tx`insert into audit_events (shop_id, drop_id, actor_type, actor_id, type, payload)
             values (${s.shopId}, ${id}, 'staff', ${s.staffId}, ${"buyer_" + b.action}, ${tx.json({ buyerId, minutes, reason: b.reason ?? null })})`;
  });
  if (b.action === "ban") {
    // a banned buyer is never served: their waitlist places in this shop's open drops end, and their unpaid holds go
    // to the next buyer through the normal hand-on path (one engine call per claim: one drop lock per transaction)
    await fn("ban_leave_waitlists", s.shopId, buyerId);
    const held = await sql<{ id: string }[]>`
      select c.id from claims c join drops d on d.id = c.drop_id
       where d.shop_id = ${s.shopId} and d.status <> 'ended' and c.buyer_id = ${buyerId} and c.state = 'held'`;
    for (const c of held) await fn("release_claim", c.id, "staff", s.staffId, "Buyer banned by the shop");
  }
  await afterWrite(id);
  return json({ ok: true });
});
