// Seller sign-in by email code / magic link. The browser verifies the code with Supabase Auth and posts the access
// token here. Staff row by auth user id -> signed in; else a pending invite for that email -> activated (the code
// proved the inbox); else needsShop (a 30-minute seller cookie lets POST /api/shops create the shop). DELETE signs out.
import { z } from "zod";
import { body, fail, json, route } from "@/lib/server/http";
import { clearStaff } from "@/lib/server/session";
import { clearSellerClaim, testLoginEnabled, testUser, userFromToken } from "@/lib/server/supabase";
import { finishSignIn } from "../_signin";

export const dynamic = "force-dynamic";

const Body = z.union([
  z.object({ accessToken: z.string().min(20).max(4000) }),
  z.object({ testEmail: z.email().max(200) }),
]);

export const POST = route("POST /api/seller/session", async (req: Request) => {
  const b = await body(req, Body);
  if ("accessToken" in b) return finishSignIn(await userFromToken(b.accessToken), { by: "email" });
  if (!testLoginEnabled()) return fail(400, "invalid", "accessToken is required.");
  return finishSignIn(testUser(b.testEmail), { by: "none" }); // a test sign-in never activates a real invite
});

export const DELETE = route("DELETE /api/seller/session", async () => {
  await clearStaff();
  await clearSellerClaim();
  return json({ ok: true });
});
