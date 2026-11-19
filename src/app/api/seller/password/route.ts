// A signed-in staff member sets (or replaces) the password of their own account, e.g. after signing in with an
// emailed code. Only within 15 minutes of signing in (by password, emailed code or invite link): a 30-day cookie
// alone, e.g. on a shared or stolen device, must not be enough to take the account. Demo (judge mode) staff have
// no Auth account: 404.
import { z } from "zod";
import { body, fail, json, route } from "@/lib/server/http";
import { activeStaff } from "@/lib/server/queries";
import { rateLimit } from "@/lib/server/ratelimit";
import { setOwnPassword } from "@/lib/server/supabase";
import { Password } from "../_signin";

export const dynamic = "force-dynamic";

export const POST = route("POST /api/seller/password", async (req: Request) => {
  const s = await activeStaff();
  if (Date.now() / 1000 - (s.iat ?? 0) > 15 * 60) fail(403, "reauth", "Sign out and sign in again first: a password can only be set within 15 minutes of signing in.");
  await rateLimit(`setpw:${s.staffId}`, 5, 3600);
  const b = await body(req, z.object({ password: Password }));
  if (!(await setOwnPassword(s.staffId, b.password))) fail(404, "no_account", "This sign-in has no account to set a password on.");
  return json({ ok: true });
});
