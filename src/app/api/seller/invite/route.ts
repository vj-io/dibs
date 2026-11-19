// Accept a staff invite link: the signed link (bound to one pending staff row and its email) is the proof instead of
// the inbox. Creates a password account for exactly that email, or, when that email already has an account, needs its
// password. Then that one staff row activates. A used, withdrawn (staff removed) or expired link is refused.
import { z } from "zod";
import { body, clientIp, fail, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { createPasswordUser, passwordUser } from "@/lib/server/supabase";
import { checkFails, finishSignIn, invitePreview, noteFail, Password } from "../_signin";

export const dynamic = "force-dynamic";

const Body = z.object({ token: z.string().min(20).max(2000), password: Password });

export const POST = route("POST /api/seller/invite", async (req: Request) => {
  const ip = clientIp(req);
  await rateLimit(`invite:ip:${ip}`, 20, 3600);
  const b = await body(req, Body);
  const inv = await invitePreview(b.token);
  let user = await createPasswordUser(inv.email, b.password, inv.name);
  if (!user) { // the invited email already has an account: its password proves it is theirs
    await checkFails(inv.email, ip);
    user = await passwordUser(inv.email, b.password);
    if (!user) {
      await noteFail(inv.email, ip);
      fail(401, "bad_login", "This email already has a Dibs account. Enter that account's password.");
    }
  }
  return finishSignIn(user!, { by: "row", staffId: inv.staffId, email: inv.email });
});
