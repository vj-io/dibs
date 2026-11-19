// Nexconn Server API over plain fetch (signed headers, primary + backup domain, 5 s timeout). Server only.
// Every path and field here is in docs/NEXCONN_API_FACTS.md and was exercised live by scripts/nexconn-poc.ts
// (results: docs/NEXCONN_FINDINGS.md). Every call is recorded in a ring buffer and in health_events.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { BOT_ID, encodeCard, type Card } from "../codec.ts";
import { sql } from "./db.ts";
import { flags } from "./flags.ts";

const HOSTS = {
  SG: ["https://api.sg-light-api.com", "https://api-b.sg-light-api.com"],
  NA: ["https://api.us-light-api.com", "https://api-b.us-light-api.com"],
  SA: ["https://api.sau-light-api.com", "https://api-b.sau-light-api.com"],
} as const;

export class NexconnError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = "NexconnError"; }
}

export type CallRecord = { kind: string; ok: boolean; code: string; ms: number; at: number };
const ring: CallRecord[] = [];
/** The last 100 Server API calls of this instance, newest last. */
export const recentCalls = (): readonly CallRecord[] => ring;

let healthTable = true; // set false after the first "relation does not exist", so a missing table costs one query
function record(kind: string, ok: boolean, code: string, ms: number) {
  ring.push({ kind, ok, code, ms, at: Date.now() });
  if (ring.length > 100) ring.shift();
  if (!healthTable || !process.env.DATABASE_URL) return;
  // One insert per Server API call held pooler connections for over a minute in a tap burst (docs/perf.md).
  // Rows are buffered and written in one statement: at once for a failure, otherwise every 25 rows or 5 s.
  pending.push({ kind, ok, code, ms });
  if (!ok || pending.length >= 25 || Date.now() - lastFlush > 5000) flushHealth();
}
const pending: { kind: string; ok: boolean; code: string; ms: number }[] = [];
let lastFlush = Date.now(), flushing = false;
function flushHealth() {
  if (flushing || !pending.length) return;
  flushing = true; lastFlush = Date.now();
  const rows = pending.splice(0, 200);
  sql`insert into health_events ${sql(rows, "kind", "ok", "code", "ms")}`
    .catch((e: { code?: string }) => { if (e?.code === "42P01") healthTable = false; })
    .finally(() => { flushing = false; });
}

type Reply = { code?: number; result?: Record<string, unknown>; errorMessage?: string };

/** One signed POST. `okCodes`: non-zero business codes that mean "already done" (e.g. exists). */
export async function call(kind: string, path: string, payload: unknown, okCodes: number[] = []): Promise<Reply> {
  const key = process.env.NEXCONN_APP_KEY, secret = process.env.NEXCONN_APP_SECRET;
  if (!key || !secret) throw new NexconnError("not_configured", "NEXCONN_APP_KEY / NEXCONN_APP_SECRET missing");
  const t0 = Date.now();
  let last = new NexconnError("unknown", path);
  for (const host of HOSTS[flags.area]) {
    const nonce = randomBytes(9).toString("hex");
    const timestamp = String(Date.now());
    let res: Response;
    try {
      res = await fetch(host + path, {
        method: "POST",
        headers: {
          "App-Key": key, Nonce: nonce, Timestamp: timestamp,
          Signature: createHash("sha1").update(secret + nonce + timestamp).digest("hex"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
    } catch (e) {
      last = new NexconnError("network", `${path}: ${e instanceof Error ? e.message : e}`);
      continue; // backup domain
    }
    if (res.status >= 500) { last = new NexconnError(`http_${res.status}`, `${path}: HTTP ${res.status}`); continue; }
    const body = (await res.json().catch(() => ({}))) as Reply;
    const ms = Date.now() - t0;
    // "already exists" replies come as HTTP 400 with their code (live: 23435, 25409), so okCodes ignore the status
    if ((res.ok && body.code === 0) || okCodes.includes(body.code ?? -1)) {
      record(kind, true, String(body.code), ms);
      return body;
    }
    const code = String(body.code ?? `http_${res.status}`);
    record(kind, false, code, ms);
    throw new NexconnError(code, `${path}: ${body.errorMessage ?? `HTTP ${res.status}`}`);
  }
  record(kind, false, last.code, Date.now() - t0);
  throw last;
}

// ------------------------------------------------------------------ users

/** Registers the user if new (idempotent) and returns an access token. `name` is required by the service. */
export async function issueToken(userId: string, name: string): Promise<string> {
  const b = await call("token", "/v4/auth/access-token/issue", { userId, name: name.slice(0, 64) || userId });
  return String(b.result?.accessToken ?? "");
}

let botReady: Promise<unknown> | undefined;
/** dibs_bot must exist as a user before it sends. Once per instance. */
export const ensureBot = () =>
  (botReady ??= issueToken(BOT_ID, "Dibs").catch((e) => { botReady = undefined; throw e; }));

/**
 * The caller's own Nexconn identity from the session cookies: buyer -> b_<id>, staff -> s_<id>.
 * With both cookies the client must say which (`as`). Display name from the DB.
 */
export async function liveIdentity(as?: "buyer" | "staff"): Promise<{ userId: string; name: string }> {
  const { getBuyer, getStaff } = await import("./session.ts"); // lazy: next/headers stays out of plain-node scripts
  const { fail } = await import("./http.ts");
  const [b, s] = await Promise.all([getBuyer(), getStaff()]);
  const pick = as ?? (b && s ? fail(400, "as_required", "Say which identity: buyer or staff.") : b ? "buyer" : s ? "staff" : null);
  if (pick === "buyer" && b) {
    const [row] = await sql<{ display_name: string | null }[]>`select display_name from buyers where id = ${b.buyerId} and deleted_at is null`;
    if (!row) fail(401, "no_session", "Join the sale room first.");
    return { userId: `b_${b.buyerId}`, name: row.display_name || "Buyer" };
  }
  if (pick === "staff" && s) {
    const [row] = await sql<{ display_name: string | null }[]>`select display_name from staff where id = ${s.staffId} and active`;
    if (!row) fail(401, "no_session", "Sign in as the seller first.");
    return { userId: `s_${s.staffId}`, name: row.display_name || "Staff" };
  }
  return fail(401, "no_session", "Sign in first.");
}

/** true = connected now. */
export async function onlineStatus(userId: string): Promise<boolean> {
  const b = await call("online", "/v4/user/connection-status/get", { userId });
  return String(b.result?.status) === "1";
}

// ------------------------------------------------------------------ wire encoding

/** What a send carries: a DB:* card, plain text, or (POC only) any type + content object. */
export type Wire = { card: Card } | { text: string } | { type: string; content: Record<string, unknown> };

/** Server wire form: `messageType` + JSON-string `content`. Cards become custom types unless the text envelope is on. */
export function encode(w: Wire, envelope = flags.textEnvelope): { messageType: string; content: string } {
  if ("text" in w) return { messageType: "RC:TxtMsg", content: JSON.stringify({ content: w.text }) };
  if ("type" in w) return { messageType: w.type, content: JSON.stringify(w.content) };
  if (envelope) return { messageType: "RC:TxtMsg", content: JSON.stringify({ content: encodeCard(w.card) }) };
  const { t, ...rest } = w.card;
  return { messageType: t, content: JSON.stringify(rest) };
}

export type Priority = "high" | "normal" | "low";
const PRIORITY: Record<Priority, number> = { normal: 0, high: 2, low: 3 }; // open channel only

const firstId = (b: Reply) => (b.result?.messageIds as { messageId: string }[] | undefined)?.[0]?.messageId ?? null;

// ------------------------------------------------------------------ open channel (sale room)

const ROOM_EXISTS = 23435;
/**
 * 23410 = the open channel does not exist (destroyed after its drop ended). Nothing can be delivered there and a
 * retry will never succeed, so cards, metadata and counts for a gone room count as done, not as failures.
 */
const ROOM_GONE = 23410;
/** Create the open channel (idempotent). Kept alive for 7 days of inactivity; destroyRoom ends it earlier. */
export async function ensureRoom(channelId: string): Promise<void> {
  await call("room_create", "/v4/open-channel/create", { channelId, destroyType: 0, ttlMinutes: 10080 }, [ROOM_EXISTS]);
}

export async function destroyRoom(channelId: string): Promise<void> {
  await call("room_destroy", "/v4/open-channel/destroy", { channelIds: [channelId] });
}

/**
 * Sends into an open channel. Priority 2 (high) needs the Console "open channel message priority"
 * service; without it the call fails with 1009 and we resend at normal priority (recorded as a failed call).
 */
export async function sendRoom(channelId: string, fromUserId: string, w: Wire, priority: Priority = "normal", persist = true): Promise<string | null> {
  if (fromUserId === BOT_ID) await ensureBot();
  const body = { fromUserId, toChannelIds: [channelId], ...encode(w), shouldPersist: persist ? 1 : 0, isEchoToSender: 0 };
  try {
    return firstId(await call("room_send", "/v4/open-channel/message/send", { ...body, priority: PRIORITY[priority] }, [ROOM_GONE]));
  } catch (e) {
    if (e instanceof NexconnError && e.code === "1009" && priority !== "normal") return firstId(await call("room_send", "/v4/open-channel/message/send", body, [ROOM_GONE]));
    throw e;
  }
}

/** Server-owned metadata (owner dibs_bot), never auto-deleted. Needs the Console metadata service (else 23426). */
export async function setRoomMeta(channelId: string, metadata: Record<string, string>): Promise<void> {
  await ensureBot();
  await call("room_meta", "/v4/open-channel/metadata/batch/set", { channelId, metadataOwnerId: BOT_ID, metadata, shouldAutoDelete: 0 }, [ROOM_GONE]);
}

/** Participant count as the service reports it (it may lag behind users who dropped). */
export async function roomCount(channelId: string): Promise<number> {
  const b = await call("room_get", "/v4/open-channel/get", { channelId }, [ROOM_GONE]);
  return Number(b.result?.participantCount ?? 0);
}

const MAX_MIN = 43200;
const mins = (m: number) => Math.max(1, Math.min(MAX_MIN, Math.round(m)));
export const muteInRoom = (channelId: string, userId: string, minutes: number) =>
  call("room_mute", "/v4/open-channel/participant/mute-list/add", { channelId, participantIds: [userId], durationMinutes: mins(minutes) }).then(() => {});
export const unmuteInRoom = (channelId: string, userId: string) =>
  call("room_unmute", "/v4/open-channel/participant/mute-list/remove", { channelId, participantIds: [userId] }).then(() => {});
export const banInRoom = (channelId: string, userId: string, minutes: number) =>
  call("room_ban", "/v4/open-channel/participant/ban-list/add", { channelId, participantIds: [userId], durationMinutes: mins(minutes) }).then(() => {});
export const unban = (channelId: string, userId: string) =>
  call("room_unban", "/v4/open-channel/participant/ban-list/remove", { channelId, participantIds: [userId] }).then(() => {});

// ------------------------------------------------------------------ group channel (order room, desk)

const GROUP_EXISTS = 25409;
/**
 * Create the group with these members, or add them if it already exists.
 * Nexconn lets one user be in 1,000 groups (create answers 22413 after that; seen 19 Nov 2026 when dibs_bot, then a
 * member of every order room, reached it). So the bot stays out of order rooms: the buyer owns the room, and the bot's
 * cards still arrive because the Server API lets a non-member send. A team desk (one per shop) keeps the bot as owner,
 * because staff leave desks and an owner cannot leave.
 * ponytail: a staff member is still in every order room of the shop, so 1,000 open order rooms per staff member is the
 * ceiling; dismiss rooms of long-finished orders when a shop gets near it.
 */
export async function ensureGroup(channelId: string, name: string, memberIds: string[]): Promise<void> {
  await ensureBot();
  const people = [...new Set(memberIds.filter((id) => id !== BOT_ID))];
  const botOwns = channelId.startsWith("desk_") || !people.length;
  const userIds = botOwns ? [BOT_ID, ...people] : people;
  const b = await call("group_create", "/v4/group-channel/create", { channelId, name: name.slice(0, 64), owner: userIds[0], userIds }, [GROUP_EXISTS]);
  if (b.code === GROUP_EXISTS) await addGroupMembers(channelId, userIds);
}

const GROUP_GONE = 25410; // "Group channel ID does not exist" (measured 19 Nov 2026): already gone counts as done
/** Deletes a group for good (its order or shop row was deleted). */
export async function dismissGroup(channelId: string): Promise<number> {
  return (await call("group_dismiss", "/v4/group-channel/dismiss", { channelId }, [GROUP_GONE])).code ?? 0;
}

/** Removes members from a group (a removed staff member leaves the desk and their order rooms). */
export async function leaveGroup(channelId: string, userIds: string[]): Promise<void> {
  await call("group_leave", "/v4/group-channel/leave", { channelId, userIds });
}

export async function addGroupMembers(channelId: string, userIds: string[]): Promise<void> {
  await call("group_join", "/v4/group-channel/join", { channelId, userIds });
}

/** Sends into a group as dibs_bot (or `from`), stored and with read receipts requested. */
export async function sendGroup(channelId: string, w: Wire, from = BOT_ID): Promise<string | null> {
  if (from === BOT_ID) await ensureBot();
  return firstId(await call("group_send", "/v4/group-channel/message/send", {
    fromUserId: from, toChannelIds: [channelId], ...encode(w), isEchoToSender: 0, shouldPersist: 1, needReadReceipt: 1,
  }));
}

// ------------------------------------------------------------------ personal alerts

/** A personal message from dibs_bot: system channel when FEATURE_SYSTEM_CHANNEL=1, else a direct message. */
export async function sendUser(userId: string, w: Wire, via: "system" | "direct" = flags.features.systemChannel ? "system" : "direct"): Promise<string | null> {
  await ensureBot();
  const path = via === "system" ? "/v4/system-channel/message/send" : "/v4/direct-channel/message/send";
  // the system endpoint rejects isEchoToSender (live: 1002 "type mismatch"), so neither sends it
  return firstId(await call(`user_${via}`, path, { fromUserId: BOT_ID, toUserIds: [userId], ...encode(w), shouldPersist: 1 }));
}

// ------------------------------------------------------------------ webhooks

/**
 * Checks a Nexconn webhook / pre-messaging callback (fact sheet 2.7): headers `AppKey`, `Nonce`, `Timestamp` (ms),
 * `Signature` = lowercase hex sha1(AppSecret + Nonce + Timestamp). The body is NOT signed, so re-validate its content.
 * Timestamps older or newer than 5 minutes are refused. Not yet seen live (needs a deployed URL + Console setting).
 */
export function verifyWebhook(
  headers: Headers,
  creds = { appKey: process.env.NEXCONN_APP_KEY ?? "", appSecret: process.env.NEXCONN_APP_SECRET ?? "" },
  now = Date.now(),
): boolean {
  const appKey = headers.get("AppKey") ?? "", nonce = headers.get("Nonce") ?? "", ts = headers.get("Timestamp") ?? "", sig = headers.get("Signature") ?? "";
  if (!creds.appKey || !creds.appSecret || !nonce || nonce.length > 128 || !/^\d{10,16}$/.test(ts)) return false;
  if (Math.abs(now - Number(ts)) > 5 * 60_000) return false;
  const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  return eq(appKey, creds.appKey) && eq(sig.toLowerCase(), createHash("sha1").update(creds.appSecret + nonce + ts).digest("hex"));
}

// ------------------------------------------------------------------ moderation

export const CHANNEL_TYPE = { direct: 1, group: 3, room: 4, system: 6, community: 10 } as const;
/** Recalls a message for everyone (clients get onMessageDeleted). `fromUserId` is the original sender. */
export async function deleteMessage(p: { channelType: keyof typeof CHANNEL_TYPE; channelId: string; messageId: string; fromUserId: string; sentAt?: number }): Promise<void> {
  await call("msg_delete", "/v4/message/delete", {
    fromUserId: p.fromUserId, channelType: CHANNEL_TYPE[p.channelType], channelId: p.channelId, messageId: p.messageId,
    ...(p.sentAt ? { sentAt: p.sentAt } : {}),
  });
}

// ------------------------------------------------------------------ community channel (shop club, FEATURE_COMMUNITY)
// Paths from the server SDK api.ts (community-channel/*); codes from scripts/club-poc.ts probe (live, 2026-11-19).

export const CLUB_SUBS = ["drops", "chat", "reviews"] as const;
export type ClubSub = (typeof CLUB_SUBS)[number];

/** Creates the community (first member dibs_bot) and its three public subchannels. Idempotent: a repeat create returns 0 (live). */
export async function ensureClub(channelId: string, name: string): Promise<void> {
  await ensureBot();
  await call("club_create", "/v4/community-channel/create", { userId: BOT_ID, channelId, name: name.slice(0, 64) });
  for (const subchannelId of CLUB_SUBS) {
    await call("club_sub", "/v4/community-channel/subchannel/create", { channelId, subchannelId, channelVisibility: 0 });
  }
}

export const joinClub = (channelId: string, userId: string) =>
  call("club_join", "/v4/community-channel/join", { userId, channelId }).then(() => {});
export const leaveClub = (channelId: string, userId: string) =>
  call("club_leave", "/v4/community-channel/leave", { userId, channelId }).then(() => {});
export const dismissClub = (channelId: string) => call("club_dismiss", "/v4/community-channel/dismiss", { channelId }).then(() => {});

/**
 * Sends into one subchannel, stored. The service accepts a send from a non-member (live), so membership is checked
 * by our routes. Server history (/history-message/list) is off on this plan (1009), so the club keeps its own record.
 */
export async function sendClub(channelId: string, sub: ClubSub, w: Wire, from = BOT_ID): Promise<string | null> {
  if (from === BOT_ID) await ensureBot();
  return firstId(await call("club_send", "/v4/community-channel/message/send", {
    fromUserId: from, toChannelIds: [channelId], subchannelId: sub, ...encode(w), shouldPersist: 1,
  }));
}

/** Recalls one club message for everyone (scam shield on club chat). */
export async function deleteClubMessage(p: { channelId: string; sub: ClubSub; messageId: string; fromUserId: string; sentAt?: number }): Promise<void> {
  await call("msg_delete", "/v4/message/delete", {
    fromUserId: p.fromUserId, channelType: CHANNEL_TYPE.community, channelId: p.channelId, subchannelId: p.sub, messageId: p.messageId,
    ...(p.sentAt ? { sentAt: p.sentAt } : {}),
  });
}
