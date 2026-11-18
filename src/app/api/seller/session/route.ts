// Seller sign-in. The browser verifies the email code with Supabase Auth and posts the access token here.
// Staff row by auth user id -> signed in; else a pending invite for that email -> activated; else needsShop
// (a 30-minute seller cookie lets POST /api/shops create the shop). DELETE signs out.
import { after } from "next/server";
import { z } from "zod";
import { afterWrite } from "@/lib/server/after";
import { sql } from "@/lib/server/db";
import { flags } from "@/lib/server/flags";
import { body, fail, json, route } from "@/lib/server/http";
import { issueToken } from "@/lib/server/nexconn";
import { deskIdFor, enqueue, sellerMe } from "@/lib/server/queries";
import { clearStaff, setStaff } from "@/lib/server/session";
import { clearSellerClaim, setSellerClaim, testLoginEnabled, testUser, userFromToken } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

const Body = z.union([
  z.object({ accessToken: z.string().min(20).max(4000) }),
  z.object({ testEmail: z.email().max(200) }),
]);

export const POST = route("POST /api/seller/session", async (req: Request) => {
  const b = await body(req, Body);
  let user;
  if ("accessToken" in b) user = await userFromToken(b.accessToken);
  else if (testLoginEnabled()) user = testUser(b.testEmail);
  else return fail(400, "invalid", "accessToken is required.");

  let [st] = await sql<{ id: string; shop_id: string; role: "owner" | "staff" }[]>`
    select id, shop_id, role from staff where id = ${user.id} and active`;
  if (!st) {
    const [invite] = await sql<{ id: string }[]>`
      select id from staff where lower(email) = ${user.email} and not active and email is not null order by created_at desc limit 1`;
    if (invite) {
      const [taken] = await sql`select 1 from staff where id = ${user.id}`;
      if (taken) fail(409, "account_removed", "This account was removed from a shop. Ask the owner to invite you again with a different email.");
      [st] = await sql<{ id: string; shop_id: string; role: "owner" | "staff" }[]>`
        update staff set id = ${user.id}, active = true, nexconn_user_id = ${"s_" + user.id} where id = ${invite.id}
        returning id, shop_id, role`;
      const [shop] = await sql<{ nexconn_desk_id: string | null; name: string }[]>`select nexconn_desk_id, name from shops where id = ${st.shop_id}`;
      const desk = shop.nexconn_desk_id ?? deskIdFor(st.shop_id);
      await enqueue(null, "group", desk, "SYS:EnsureGroup", { channelId: desk, name: `${shop.name} · team desk`.slice(0, 64), memberIds: [`s_${st.id}`, "dibs_bot"] });
    }
  }
  if (!st) {
    await setSellerClaim(user);
    return json({ needsShop: true, email: user.email });
  }
  await setStaff({ staffId: st.id, shopId: st.shop_id, role: st.role });
  await clearSellerClaim();
  const me = (await sellerMe(st.id))!;
  if (flags.mode === "nexconn") after(() => issueToken(`s_${st.id}`, me.displayName).then(() => {}, () => {}));
  await afterWrite(null);
  return json({ needsShop: false, me });
});

export const DELETE = route("DELETE /api/seller/session", async () => {
  await clearStaff();
  await clearSellerClaim();
  return json({ ok: true });
});
