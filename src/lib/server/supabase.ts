// Supabase service-role client, used ONLY for Auth (seller accounts: email code, magic link, or email + password;
// staff invite links) and product photo Storage. Business data never goes through supabase-js. Also the short-lived
// "seller" cookie: a signed-in email that has no shop yet, so POST /api/shops can create one. Server only.
import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { fail } from "./http.ts";

export const PHOTO_BUCKET = "product-photos";

let client: SupabaseClient | undefined;
export function service(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase URL / service role key missing");
  return (client ??= createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }));
}

/** Public URL prefix of a shop's photo folder; product photos must start with it (or be a /demo/ path). */
export const photoPrefix = (shopId: string) =>
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${shopId}/`;

export type AuthUser = { id: string; email: string };

const key = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be 32+ characters");
  return new TextEncoder().encode(s);
};

/**
 * Verifies a Supabase access token (after email OTP: this proves the person controls the inbox). 401 when invalid.
 * A password set without that proof (password sign-up, invite link: app_metadata.dibs_pw_unproven) is replaced with a
 * random one here, so whoever squatted an email with a password loses it the moment the inbox owner signs in.
 */
export async function userFromToken(accessToken: string): Promise<AuthUser> {
  const { data, error } = await service().auth.getUser(accessToken);
  if (error || !data.user?.email) return fail(401, "bad_token", "That sign-in link has expired. Ask for a new code.");
  if (data.user.app_metadata?.dibs_pw_unproven) {
    const { error: e2 } = await service().auth.admin.updateUserById(data.user.id, {
      password: randomBytes(24).toString("base64url"), app_metadata: { dibs_pw_unproven: false },
    });
    if (e2) throw new Error(`password reset after inbox proof failed: ${e2.code ?? e2.status}`);
  }
  return { id: data.user.id, email: data.user.email.toLowerCase() };
}

// ------------------------------------------------------------------ email + password (no email is ever sent)

/** Creates a confirmed Auth user with a password (Admin API). null = an account with this email already exists. */
export async function createPasswordUser(email: string, password: string, name: string): Promise<AuthUser | null> {
  const { data, error } = await service().auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name }, app_metadata: { dibs_pw_unproven: true },
  });
  if (error) {
    if (error.code === "email_exists" || error.code === "user_already_exists" || error.status === 422 && /already/i.test(error.message)) return null;
    if (error.code === "weak_password") fail(400, "weak_password", "Choose a longer password that's harder to guess.");
    throw new Error(`createUser failed: ${error.code ?? error.status}`);
  }
  return { id: data.user.id, email: data.user.email!.toLowerCase() };
}

/** Checks an email + password with Supabase Auth (anon key, its own client: no shared session). null = wrong. */
export async function passwordUser(email: string, password: string): Promise<AuthUser | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Supabase URL / anon key missing");
  const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error || !data.user?.email) {
    if (error && (error.status ?? 0) >= 500) fail(503, "auth_unavailable", "Sign-in is slow right now. Try again in a minute.");
    if (error && error.status === 429) fail(429, "rate_limited", "Too many sign-in attempts. Wait a minute and try again."); // Supabase Auth's own limit
    if (error && error.status !== 400 && error.code !== "invalid_credentials") throw new Error(`signInWithPassword failed: ${error.code ?? error.status}`);
    return null;
  }
  return { id: data.user.id, email: data.user.email.toLowerCase() };
}

/** Sets the password of a signed-in staff member's own Auth user (staff id = Auth user id). false = no such user. */
export async function setOwnPassword(userId: string, password: string): Promise<boolean> {
  const { error } = await service().auth.admin.updateUserById(userId, { password });
  if (error?.status === 404 || error?.code === "user_not_found") return false;
  if (error?.code === "weak_password") fail(400, "weak_password", "Choose a longer password that's harder to guess.");
  if (error) throw new Error(`updateUserById failed: ${error.code ?? error.status}`);
  return true;
}

// ------------------------------------------------------------------ staff invite links (7 days, no email needed)

/** Signed link token bound to one pending staff row and its email. Revoked by removal (row loses its email) or use. */
export const signInvite = (staffId: string, email: string) =>
  new SignJWT({ kind: "invite", sid: staffId, email }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(key());

export async function readInvite(token: string): Promise<{ staffId: string; email: string }> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (payload.kind === "invite" && typeof payload.sid === "string" && typeof payload.email === "string") return { staffId: payload.sid, email: payload.email };
  } catch (e) {
    if ((e as { code?: string }).code === "ERR_JWT_EXPIRED") fail(410, "invite_expired", "This invite link has expired. Ask the shop owner for a new one.");
  }
  return fail(400, "bad_invite", "This invite link isn't valid. Ask the shop owner to copy it again.");
}

/** Test-only sign-in: DIBS_TEST_LOGIN=1 and never on any Vercel deployment (VERCEL is set there). Id derived from the email. */
export const testLoginEnabled = () => process.env.DIBS_TEST_LOGIN === "1" && !process.env.VERCEL;
export function testUser(email: string): AuthUser {
  const h = createHash("sha256").update("dibs-test:" + email.toLowerCase()).digest("hex");
  return { id: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`, email: email.toLowerCase() };
}

// ------------------------------------------------------------------ seller claim cookie (30 minutes)

const SELLER = "dibs_seller";

export async function setSellerClaim(u: AuthUser) {
  const token = await new SignJWT({ kind: "seller", uid: u.id, email: u.email }).setProtectedHeader({ alg: "HS256" })
    .setIssuedAt().setExpirationTime("30m").sign(key());
  (await cookies()).set(SELLER, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 1800 });
}
export async function getSellerClaim(): Promise<AuthUser | null> {
  const token = (await cookies()).get(SELLER)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return payload.kind === "seller" && typeof payload.uid === "string" && typeof payload.email === "string"
      ? { id: payload.uid, email: payload.email } : null;
  } catch { return null; }
}
export const clearSellerClaim = async () => { (await cookies()).delete(SELLER); };
