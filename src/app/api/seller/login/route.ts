// Email + password sign-in, checked with Supabase Auth on the server. One answer for every failure (no hint whether
// the email has an account); failures are counted per IP (for one email, and in all) and refused for 15 minutes
// past the limit. The email alone is never the key, so wrong guesses from elsewhere cannot lock the owner out.
import { z } from "zod";
import { body, clientIp, fail, route } from "@/lib/server/http";
import { passwordUser } from "@/lib/server/supabase";
import { checkFails, finishSignIn, noteFail } from "../_signin";

export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().min(1).max(200) });

export const POST = route("POST /api/seller/login", async (req: Request) => {
  const b = await body(req, Body);
  const ip = clientIp(req);
  await checkFails(b.email, ip);
  const user = z.email().safeParse(b.email).success && b.password.length <= 72 ? await passwordUser(b.email, b.password) : null;
  if (!user) {
    await noteFail(b.email, ip);
    fail(401, "bad_login", "That email and password don't match. Try again, or use “Email me a code instead”.");
  }
  return finishSignIn(user!, { by: "none" });
});
