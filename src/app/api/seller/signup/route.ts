// Email + password account, created confirmed through the Admin API: no email is sent, so the mailer's hourly
// limit can't lock a seller out. Then signs in like the code path, except that a pending staff invite for this
// email is NOT activated (a password proves nothing about the inbox): the account starts without a shop.
import { z } from "zod";
import { body, clientIp, fail, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { createPasswordUser } from "@/lib/server/supabase";
import { Email, finishSignIn, Password } from "../_signin";

export const dynamic = "force-dynamic";

const Body = z.object({ email: Email, password: Password, name: z.string().trim().min(1).max(40) });

export const POST = route("POST /api/seller/signup", async (req: Request) => {
  const b = await body(req, Body);
  await rateLimit(`signup:ip:${clientIp(req)}`, 10, 3600, "Too many new accounts from this network. Try again in an hour.");
  const user = await createPasswordUser(b.email, b.password, b.name);
  if (!user) fail(409, "account_exists", "There's already an account with this email. Sign in instead.");
  return finishSignIn(user!, { by: "none" });
});
