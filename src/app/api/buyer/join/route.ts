// Buyer join: name + Indian mobile, no OTP (MVP). Creates or reuses the buyer by phone, sets the buyer cookie.
import { after } from "next/server";
import { z } from "zod";
import { displayName } from "@/lib/codec";
import { sql } from "@/lib/server/db";
import { flags } from "@/lib/server/flags";
import { body, clientIp, fail, json, route } from "@/lib/server/http";
import { issueToken } from "@/lib/server/nexconn";
import { rateLimit } from "@/lib/server/ratelimit";
import { setBuyer } from "@/lib/server/session";
import { isIndianPhone } from "@/lib/upi";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().trim().min(1).max(40),
  phone: z.string().max(20),
  shopSlug: z.string().regex(/^[a-z0-9-]{3,30}$/),
});

export const POST = route("POST /api/buyer/join", async (req: Request) => {
  await rateLimit(`join:${clientIp(req)}`, 60, 60, "Too many joins from this network. Wait a minute and try again.");
  const b = await body(req, Body);
  const phone = isIndianPhone(b.phone) ?? fail(400, "invalid_phone", "Enter a 10-digit Indian mobile number.");
  const [shop] = await sql<{ id: string }[]>`select id from shops where slug = ${b.shopSlug}`;
  if (!shop) fail(404, "not_found", "We couldn't find that shop.");
  const dn = displayName(b.name);

  const [buyer] = await sql<{ id: string }[]>`
    insert into buyers (name, display_name, phone) values (${b.name}, ${dn}, ${phone})
    on conflict (phone) where not is_bot and phone is not null and deleted_at is null
    do update set name = excluded.name, display_name = excluded.display_name
    returning id`;
  const [ban] = await sql`select 1 from bans where shop_id = ${shop.id} and buyer_id = ${buyer.id} and kind = 'ban' and (until is null or until > now())`;
  if (ban) fail(403, "banned", "This shop has blocked you from its drops.");
  await sql`update buyers set nexconn_user_id = ${"b_" + buyer.id} where id = ${buyer.id} and nexconn_user_id is null`;

  await setBuyer(buyer.id);
  // register the Nexconn user so order groups can add it; a failure here is harmless (the token route retries)
  if (flags.mode === "nexconn") after(() => issueToken(`b_${buyer.id}`, dn).then(() => {}, () => {}));
  return json({ buyerId: buyer.id, displayName: dn });
});
