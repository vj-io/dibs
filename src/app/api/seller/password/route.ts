// A signed-in staff member sets (or replaces) the password of their own account, e.g. after signing in with an
// emailed code. Demo (judge mode) staff have no Auth account: 404.
import { z } from "zod";
import { body, fail, json, route } from "@/lib/server/http";
import { activeStaff } from "@/lib/server/queries";
import { rateLimit } from "@/lib/server/ratelimit";
import { setOwnPassword } from "@/lib/server/supabase";
import { Password } from "../_signin";

export const dynamic = "force-dynamic";

export const POST = route("POST /api/seller/password", async (req: Request) => {
  const s = await activeStaff();
  await rateLimit(`setpw:${s.staffId}`, 5, 3600);
  const b = await body(req, z.object({ password: Password }));
  if (!(await setOwnPassword(s.staffId, b.password))) fail(404, "no_account", "This sign-in has no account to set a password on.");
  return json({ ok: true });
});
