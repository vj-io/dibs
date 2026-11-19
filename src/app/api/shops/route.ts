// Creates the shop for a signed-in seller with no shop yet: shop row, owner staff row, team-desk group (outbox).
import { z } from "zod";
import { afterWrite } from "@/lib/server/after";
import { sql } from "@/lib/server/db";
import { body, fail, json, route } from "@/lib/server/http";
import { deskIdFor, isShopPhoto, sellerMe, ShopFields } from "@/lib/server/queries";
import { getStaff, setStaff } from "@/lib/server/session";
import { claimCurrent, clearSellerClaim, getSellerClaim } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

const Body = ShopFields.required({ name: true, slug: true }).extend({ ownerName: z.string().trim().min(1).max(40).optional() });

export const POST = route("POST /api/shops", async (req: Request) => {
  if (await getStaff().then((s) => s && sellerMe(s.staffId, s.iat))) fail(409, "has_shop", "You already have a shop.");
  const user = (await getSellerClaim()) ?? fail(401, "no_session", "Sign in with your email first.");
  const b = await body(req, Body);
  if (!(await claimCurrent(user))) fail(401, "no_session", "Sign in with your email first.");
  const [taken] = await sql`select 1 from shops where slug = ${b.slug}`;
  if (taken) fail(409, "slug_taken", "That shop link is taken. Try another.");
  const [removed] = await sql`select 1 from staff where id = ${user.id}`;
  if (removed) fail(409, "account_removed", "This account was removed from a shop. Use a different email.");

  const ownerName = b.ownerName ?? user.email.split("@")[0].slice(0, 40);
  const ids = await sql.begin(async (tx) => {
    const [shop] = await tx<{ id: string; name: string }[]>`
      insert into shops (slug, name, upi_id, payee_name, support_whatsapp, hold_seconds, max_holds, high_value_paise, auto_advance, faq)
      values (${b.slug}, ${b.name}, ${b.upiId ?? null}, ${b.payeeName ?? null}, ${b.supportWhatsapp ?? null}, ${(b.holdMinutes ?? 10) * 60},
              ${b.maxHolds ?? 3}, ${b.highValuePaise ?? null}, ${b.autoAdvance ?? false}, ${tx.json(b.faq ?? [])})
      returning id, name`;
    if (b.logoUrl) {
      if (!isShopPhoto(shop.id, b.logoUrl)) fail(400, "invalid", "logoUrl: upload the logo first.");
      await tx`update shops set logo_url = ${b.logoUrl} where id = ${shop.id}`;
    }
    const desk = deskIdFor(shop.id);
    await tx`update shops set nexconn_desk_id = ${desk} where id = ${shop.id}`;
    await tx`insert into staff (id, shop_id, role, display_name, email, nexconn_user_id)
             values (${user.id}, ${shop.id}, 'owner', ${ownerName}, ${user.email}, ${"s_" + user.id})`;
    await tx`insert into outbox (channel_type, channel_id, msg_type, payload)
             values ('group', ${desk}, 'SYS:EnsureGroup',
                     ${tx.json({ channelId: desk, name: `${shop.name} · team desk`.slice(0, 64), memberIds: [`s_${user.id}`, "dibs_bot"] })})`;
    return { shopId: shop.id };
  }).catch((e: { code?: string }) => e?.code === "23505" ? fail(409, "slug_taken", "That shop link is taken. Try another.") : Promise.reject(e));
  await setStaff({ staffId: user.id, shopId: ids.shopId, role: "owner" });
  await clearSellerClaim();
  await afterWrite(null);
  return json({ shopId: ids.shopId, staffId: user.id, me: (await sellerMe(user.id, "fresh"))! });
});
