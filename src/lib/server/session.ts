// Buyer and staff sessions: one signed HttpOnly cookie each (jose HS256, 30 days). Server only.
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { fail } from "./http.ts";

export type BuyerSession = { kind: "buyer"; buyerId: string };
/** `iat`: when the cookie was issued (seconds), read back from the token; staff.sessions_after and password changes check it. */
export type StaffSession = { kind: "staff"; staffId: string; shopId: string; role: "owner" | "staff"; iat?: number };

const BUYER = "dibs_buyer", STAFF = "dibs_staff";
const MAX_AGE = 60 * 60 * 24 * 30;
const key = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be 32+ characters");
  return new TextEncoder().encode(s);
};

async function write(name: string, payload: BuyerSession | StaffSession, maxAge = MAX_AGE) {
  const token = await new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${maxAge}s`).sign(key());
  (await cookies()).set(name, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge });
}
async function read<T>(name: string, kind: string): Promise<T | null> {
  const token = (await cookies()).get(name)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return payload.kind === kind ? (payload as unknown as T) : null;
  } catch { return null; }
}

export const setBuyer = (buyerId: string) => write(BUYER, { kind: "buyer", buyerId });
/** `maxAgeSec`: judge mode's demo owner gets 2 hours, not 30 days. */
export const setStaff = (s: Omit<StaffSession, "kind">, maxAgeSec?: number) => write(STAFF, { kind: "staff", ...s }, maxAgeSec);
export const clearBuyer = async () => { (await cookies()).delete(BUYER); };
export const clearStaff = async () => { (await cookies()).delete(STAFF); };
export const getBuyer = () => read<BuyerSession>(BUYER, "buyer");
export const getStaff = () => read<StaffSession>(STAFF, "staff");

export async function requireBuyer(): Promise<BuyerSession> {
  return (await getBuyer()) ?? fail(401, "no_session", "Join the sale room first.");
}
/** Staff session; with `shopId`, also checks the staff member belongs to that shop. */
export async function requireStaff(shopId?: string): Promise<StaffSession> {
  const s = (await getStaff()) ?? fail(401, "no_session", "Sign in as the seller first.");
  if (shopId && s.shopId !== shopId) fail(403, "forbidden");
  return s;
}

export const buyerNexconnId = (buyerId: string) => `b_${buyerId}`;
export const staffNexconnId = (staffId: string) => `s_${staffId}`;
