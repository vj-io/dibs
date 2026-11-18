// Buyer join: name + Indian mobile, no OTP (MVP). Without OTP a phone number proves nothing, so a join never attaches
// to an existing buyer row: the caller's own buyer (cookie) is updated, anyone else gets a new row (same phone on a
// new device = a new buyer; hold limits apply per device). Bans follow the phone too. Sets the buyer cookie.
import { after } from "next/server";
import { z } from "zod";
import { displayName } from "@/lib/codec";
import { sql } from "@/lib/server/db";
import { flags } from "@/lib/server/flags";
import { body, clientIp, fail, json, route } from "@/lib/server/http";
import { issueToken } from "@/lib/server/nexconn";
import { rateLimit } from "@/lib/server/ratelimit";
import { getBuyer, setBuyer } from "@/lib/server/session";
import { scamRules } from "@/lib/ai/scam-shield";
import { isIndianPhone } from "@/lib/upi";

export const dynamic = "force-dynamic";

// Letters in any script, spaces, dots, apostrophes, hyphens. The name shows in public ticker cards, which the scam
// shield never sees, so no digits, @, links or anything the shield would block.
const NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]{1,39}$/u;
const Body = z.object({
  name: z.string().trim().refine((n) => NAME.test(n) && !scamRules(n).blocked, "Use letters only for your name (2–40)."),
  phone: z.string().max(20),
  shopSlug: z.string().regex(/^[a-z0-9-]{3,30}$/),
});

export const POST = route("POST /api/buyer/join", async (req: Request) => {
  await rateLimit(`join:${clientIp(req)}`, 60, 60, "Too many joins from this network. Wait a minute and try again.");
  const b = await body(req, Body);
  const phone = isIndianPhone(b.phone) ?? fail(400, "invalid_phone", "Enter a 10-digit Indian mobile number.");
  const [shop] = await sql<{ id: string; is_sandbox: boolean }[]>`select id, is_sandbox from shops where slug = ${b.shopSlug}`;
  if (!shop) fail(404, "not_found", "We couldn't find that shop.");
  if (shop.is_sandbox) fail(403, "demo_join_via_try", "This is a demo room. Start your own at /try.");
  const dn = displayName(b.name);

  const [ban] = await sql`
    select 1 from bans x join buyers bb on bb.id = x.buyer_id
     where x.shop_id = ${shop.id} and x.kind = 'ban' and (x.until is null or x.until > now()) and bb.phone = ${phone}`;
  if (ban) fail(403, "banned", "This shop has blocked you from its drops.");
  const me = await getBuyer();
  const mine = me ? await sql<{ id: string }[]>`
    update buyers set name = ${b.name}, display_name = ${dn}, phone = ${phone}
     where id = ${me.buyerId} and deleted_at is null and not is_bot and not is_sandbox returning id` : [];
  const [buyer] = mine.length ? mine
    : await sql<{ id: string }[]>`insert into buyers (name, display_name, phone) values (${b.name}, ${dn}, ${phone}) returning id`;
  const [own] = await sql`select 1 from bans where shop_id = ${shop.id} and buyer_id = ${buyer.id} and kind = 'ban' and (until is null or until > now())`;
  if (own) fail(403, "banned", "This shop has blocked you from its drops.");
  await sql`update buyers set nexconn_user_id = ${"b_" + buyer.id} where id = ${buyer.id} and nexconn_user_id is null`;

  await setBuyer(buyer.id);
  // register the Nexconn user so order groups can add it; a failure here is harmless (the token route retries)
  if (flags.mode === "nexconn") after(() => issueToken(`b_${buyer.id}`, dn).then(() => {}, () => {}));
  return json({ buyerId: buyer.id, displayName: dn });
});
