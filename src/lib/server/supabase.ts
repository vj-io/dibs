// Supabase service-role client, used ONLY for Auth (verifying a seller's access token) and product photo Storage.
// Business data never goes through supabase-js. Also the short-lived "seller" cookie: a signed-in email that has
// no shop yet, so POST /api/shops can create one. Server only.
import { createHash } from "node:crypto";
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

/** Verifies a Supabase access token (after email OTP). 401 when invalid. */
export async function userFromToken(accessToken: string): Promise<AuthUser> {
  const { data, error } = await service().auth.getUser(accessToken);
  if (error || !data.user?.email) return fail(401, "bad_token", "That sign-in link has expired. Ask for a new code.");
  return { id: data.user.id, email: data.user.email.toLowerCase() };
}

/** Test-only sign-in: on when DIBS_TEST_LOGIN=1 outside production. The id is derived from the email. */
export const testLoginEnabled = () => process.env.DIBS_TEST_LOGIN === "1" && process.env.VERCEL_ENV !== "production";
export function testUser(email: string): AuthUser {
  const h = createHash("sha256").update("dibs-test:" + email.toLowerCase()).digest("hex");
  return { id: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`, email: email.toLowerCase() };
}

// ------------------------------------------------------------------ seller claim cookie (30 minutes)

const SELLER = "dibs_seller";
const key = () => new TextEncoder().encode(process.env.SESSION_SECRET ?? "");

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
