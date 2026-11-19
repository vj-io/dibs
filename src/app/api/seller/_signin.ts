// Shared by the seller sign-in routes: turns a verified Auth user into the staff cookie (or the 30-minute seller
// cookie when the user has no shop yet), and the failed-login throttle. Server only.
//
// Which proof activates a staff invite:
//   "email"  – the emailed code / magic link proved the inbox: the newest pending invite for that email activates.
//   "row"    – an invite link (signed, bound to one staff row + email): exactly that row activates.
//   "none"   – password sign-in / sign-up proves nothing about the inbox, so a pending invite stays pending.
import { after } from "next/server";
import { z } from "zod";
import { afterWrite } from "@/lib/server/after";
import { fn, sql } from "@/lib/server/db";
import { flags } from "@/lib/server/flags";
import { fail, json } from "@/lib/server/http";
import { issueToken } from "@/lib/server/nexconn";
import { appUrl, deskIdFor, enqueue, sellerMe } from "@/lib/server/queries";
import { setStaff } from "@/lib/server/session";
import { clearSellerClaim, readInvite, setSellerClaim, signInvite, type AuthUser } from "@/lib/server/supabase";

type Row = { id: string; shop_id: string; role: "owner" | "staff" };
export type InviteProof = { by: "email" } | { by: "row"; staffId: string; email: string } | { by: "none" };

async function activate(user: AuthUser, inviteId: string): Promise<Row> {
  const [taken] = await sql`select 1 from staff where id = ${user.id}`;
  if (taken) fail(409, "account_removed", "This account was removed from a shop. Ask the owner to invite you again with a different email.");
  const [st] = await sql<Row[]>`
    update staff set id = ${user.id}, active = true, nexconn_user_id = ${"s_" + user.id}
     where id = ${inviteId} and not active and lower(email) = ${user.email} returning id, shop_id, role`;
  if (!st) return fail(410, "invite_used", "This invite was already used or withdrawn. Ask the shop owner for a new link.");
  const [shop] = await sql<{ nexconn_desk_id: string | null; name: string }[]>`select nexconn_desk_id, name from shops where id = ${st.shop_id}`;
  const desk = shop.nexconn_desk_id ?? deskIdFor(st.shop_id);
  await enqueue(null, "group", desk, "SYS:EnsureGroup", { channelId: desk, name: `${shop.name} · team desk`.slice(0, 64), memberIds: [`s_${st.id}`, "dibs_bot"] });
  return st;
}

/** Staff row by Auth user id -> staff cookie; else (per `proof`) an invite activates; else needsShop + seller cookie. */
export async function finishSignIn(user: AuthUser, proof: InviteProof): Promise<Response> {
  let [st] = await sql<Row[]>`select id, shop_id, role from staff where id = ${user.id} and active`;
  if (st && proof.by === "row") fail(409, "has_shop", "This email already belongs to a team on Dibs. Ask the owner to invite a different email.");
  if (!st && proof.by === "row") {
    if (proof.email !== user.email) fail(400, "bad_invite", "This invite link is for another email.");
    st = await activate(user, proof.staffId);
  } else if (!st && proof.by === "email") {
    const [invite] = await sql<{ id: string }[]>`
      select id from staff where lower(email) = ${user.email} and not active and email is not null order by created_at desc limit 1`;
    if (invite) st = await activate(user, invite.id);
  }
  if (!st) {
    await setSellerClaim(user);
    return json({ needsShop: true, email: user.email });
  }
  await setStaff({ staffId: st.id, shopId: st.shop_id, role: st.role });
  await clearSellerClaim();
  const me = (await sellerMe(st.id, "fresh"))!;
  if (flags.mode === "nexconn") after(() => issueToken(`s_${st.id}`, me.displayName).then(() => {}, () => {}));
  await afterWrite(null);
  return json({ needsShop: false, me });
}

// ------------------------------------------------------------------ failed-login throttle

const WINDOW = 15 * 60;
export const MAX_FAILS = { pair: 8, ip: 30 };

async function count(key: string): Promise<number> {
  const [r] = await sql<{ n: number }[]>`
    select coalesce(sum(count), 0)::int as n from rate_hits
     where key = ${key} and window_start = to_timestamp(floor(extract(epoch from now()) / ${WINDOW}) * ${WINDOW})`;
  return r.n;
}

/**
 * 429 when this IP has had too many failed passwords in the current 15-minute window: 8 for one email, 30 in all.
 * Never keyed on the email alone: anyone could then lock an owner out of their own account with 8 wrong guesses.
 * ponytail: guesses at one email spread over many IPs are slowed only by Supabase Auth's own limits; add a
 * challenge after N failures per email if that is ever seen.
 */
export async function checkFails(email: string, ip: string) {
  const [e, i] = await Promise.all([count(`pwfail:ei:${email}|${ip}`), count(`pwfail:ip:${ip}`)]);
  if (e >= MAX_FAILS.pair || i >= MAX_FAILS.ip) fail(429, "rate_limited", "Too many wrong passwords. Wait 15 minutes, or use “Email me a code instead”.");
}
export const noteFail = (email: string, ip: string) =>
  Promise.all([fn("rate_add", `pwfail:ei:${email}|${ip}`, WINDOW), fn("rate_add", `pwfail:ip:${ip}`, WINDOW)]);

// ------------------------------------------------------------------ input

/** Domains of throwaway inboxes; a shop needs an address its owner keeps. ponytail: short list, extend when abused. */
const DISPOSABLE = new Set(["mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org", "yopmail.com",
  "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com", "maildrop.cc", "throwawaymail.com", "fakeinbox.com", "mintemail.com",
  "mohmal.com", "emailondeck.com", "tempmailo.com", "burnermail.io", "spamgourmet.com", "mailnesia.com", "tempr.email", "discard.email"]);

export const Email = z.string().trim().toLowerCase().max(200).pipe(z.email("Enter a real email address, like meera@gmail.com."))
  .refine((e) => !DISPOSABLE.has(e.split("@")[1]), "Use an email you keep. Throwaway inboxes can't own a shop.");
/** 8-72: bcrypt (Supabase Auth) reads only the first 72 bytes. */
export const Password = z.string().min(8, "Use at least 8 characters.").max(72, "Use at most 72 characters.");

// ------------------------------------------------------------------ invite links

/** What an invite link's page shows. Throws the same errors as accepting it (bad / expired / used). */
export async function invitePreview(token: string): Promise<{ staffId: string; email: string; name: string; shopName: string }> {
  const inv = await readInvite(token);
  const [r] = await sql<{ display_name: string; name: string }[]>`
    select st.display_name, s.name from staff st join shops s on s.id = st.shop_id
     where st.id = ${inv.staffId} and not st.active and lower(st.email) = ${inv.email}`;
  if (!r) fail(410, "invite_used", "This invite was already used or withdrawn. Ask the shop owner for a new link.");
  return { ...inv, name: r.display_name, shopName: r.name };
}

export const inviteUrl = async (staffId: string, email: string) => `${appUrl()}/seller?invite=${await signInvite(staffId, email)}`;
