// Shop club (PRD FR-26, flag FEATURE_COMMUNITY). Server only.
// Nexconn community channel `club_<20 hex of shop id>` with subchannels drops (bot posts only), chat, reviews.
// Creating, joining and bot posts go through the outbox (SYS:EnsureClub / JoinClub / LeaveClub / ClubSend, all on the
// club's channel id, so EnsureClub is always sent first). Member chat is screened here, then sent by the Server API as
// the buyer. club_posts is the record pages read (the community history API is off on our plan: 1009).
import { scamRules } from "../ai/scam-shield.ts";
import { BOT_ID } from "../codec.ts";
import type { ClubManage, ClubPostView, ClubSummary } from "../types.ts";
import { sql } from "./db.ts";
import { flags } from "./flags.ts";
import { fail, notFound } from "./http.ts";
import { bus } from "./mockbus.ts";
import * as nx from "./nexconn.ts";

/** Mock mode always has the club (dev and tests only); Nexconn mode needs FEATURE_COMMUNITY=1. */
export const clubOn = () => flags.features.community || flags.mode === "mock";
export const clubIdFor = (shopId: string) => "club_" + shopId.replace(/-/g, "").slice(0, 20);
/** The id live.ts watches and the mock bus group: `<clubId>.<sub>`. */
export const clubKey = (clubId: string, sub: nx.ClubSub) => `${clubId}.${sub}`;

export const CLUB_BLOCKED_TEXT = "Phone numbers and UPI IDs can't be shared in the club. Use your order chat.";
const MAX_CHAT = 200, MAX_POST = 280;
// queries.ts shareUrl, repeated: queries pulls in next/headers, and the outbox drain (plain node too) loads this module
const shareUrl = (slug: string, code: string) => `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/s/${slug}/d/${code}`;

type Shop = { id: string; slug: string; name: string; logo_url: string | null; is_sandbox: boolean; nexconn_club_id: string | null; since: Date | null };

/** A demo shop's club starts again with its slot: only rows since the slot was handed out count. */
async function shopWhere(by: { slug?: string; id?: string }): Promise<Shop> {
  if (!clubOn()) notFound();
  const [s] = await sql<Shop[]>`
    select s.id, s.slug, s.name, s.logo_url, s.is_sandbox, s.nexconn_club_id,
           case when s.is_sandbox then (select max(t.started_at) from try_slots t where t.shop_id = s.id) end as since
      from shops s where ${by.id ? sql`s.id = ${by.id}` : sql`s.slug = ${by.slug ?? ""}`}`;
  return s ?? notFound();
}
const since = (s: Shop) => s.since ?? new Date(0);

const enqueue = (tx: typeof sql, clubId: string, msgType: string, payload: Record<string, string>) =>
  tx`insert into outbox (channel_type, channel_id, msg_type, payload) values ('group', ${clubId}, ${msgType}, ${tx.json(payload)})`;

async function drain(clubId: string) {
  const { drainOutbox } = await import("./outbox.ts"); // outbox imports this module for SYS:*Club rows
  await drainOutbox({ channels: [clubId], budgetMs: 3000 });
}

/** The club's id; the first call creates it (one SYS:EnsureClub, ahead of every other row of the club). */
async function ensureClub(s: Shop): Promise<string> {
  if (s.nexconn_club_id) return s.nexconn_club_id;
  const id = clubIdFor(s.id);
  await sql.begin(async (tx) => {
    const r = await tx`update shops set nexconn_club_id = ${id} where id = ${s.id} and nexconn_club_id is null returning 1`;
    if (r.length) await enqueue(tx as never, id, "SYS:EnsureClub", { channelId: id, name: `${s.name} club` });
  });
  return id;
}

/** Executes a SYS:*Club outbox row (called from outbox.ts `execute`). */
export async function execClub(type: string, p: Record<string, string>, live: boolean): Promise<void> {
  const subs = nx.CLUB_SUBS;
  switch (type) {
    case "SYS:EnsureClub":
      if (live) return nx.ensureClub(p.channelId, p.name);
      return subs.forEach((s) => bus().ensureGroup(clubKey(p.channelId, s), [BOT_ID]));
    case "SYS:JoinClub":
      if (live) return nx.joinClub(p.channelId, p.userId);
      return subs.forEach((s) => bus().ensureGroup(clubKey(p.channelId, s), [p.userId]));
    case "SYS:LeaveClub":
      if (live) return nx.leaveClub(p.channelId, p.userId);
      return subs.forEach((s) => bus().leaveGroup(clubKey(p.channelId, s), [p.userId]));
    case "SYS:ClubSend":
      if (live) { await nx.sendClub(p.channelId, p.sub as nx.ClubSub, { text: p.text }); return; }
      bus().publish("group", clubKey(p.channelId, p.sub as nx.ClubSub), BOT_ID, p.text, "Dibs");
      return;
  }
  throw new Error(`unknown club row ${type}`);
}

async function barred(shopId: string, buyerId: string): Promise<boolean> {
  return (await sql`select _barred(${shopId}::uuid, ${buyerId}::uuid) as b`)[0].b === true;
}

// ---------------------------------------------------------------- buyers

export async function join(slug: string, buyerId: string): Promise<{ memberCount: number }> {
  const s = await shopWhere({ slug });
  if (await barred(s.id, buyerId)) fail(403, "banned", "You can't join this club.");
  const club = await ensureClub(s);
  await sql.begin(async (tx) => {
    const r = await tx`insert into club_members (shop_id, buyer_id) values (${s.id}, ${buyerId}) on conflict do nothing returning 1`;
    if (r.length) await enqueue(tx as never, club, "SYS:JoinClub", { channelId: club, userId: `b_${buyerId}` });
  });
  await drain(club);
  return { memberCount: await memberCount(s) };
}

export async function leave(slug: string, buyerId: string): Promise<{ memberCount: number }> {
  const s = await shopWhere({ slug });
  await removeMember(s, buyerId);
  return { memberCount: await memberCount(s) };
}

async function removeMember(s: Shop, buyerId: string): Promise<boolean> {
  let gone = false;
  await sql.begin(async (tx) => {
    gone = (await tx`delete from club_members where shop_id = ${s.id} and buyer_id = ${buyerId} returning 1`).length > 0;
    if (gone && s.nexconn_club_id) await enqueue(tx as never, s.nexconn_club_id, "SYS:LeaveClub", { channelId: s.nexconn_club_id, userId: `b_${buyerId}` });
  });
  if (gone && s.nexconn_club_id) await drain(s.nexconn_club_id);
  return gone;
}

const memberCount = async (s: Shop) =>
  Number((await sql`select count(*)::int as n from club_members where shop_id = ${s.id} and joined_at >= ${since(s)}`)[0].n);

/** Members only. Rules-only scam shield first (blocked = never sent), then the Server API sends it as the buyer. */
export async function sendChat(slug: string, buyerId: string, text: string) {
  const s = await shopWhere({ slug });
  const member = (await sql`select 1 from club_members where shop_id = ${s.id} and buyer_id = ${buyerId} and joined_at >= ${since(s)}`).length > 0;
  if (!member || !s.nexconn_club_id) fail(403, "not_member", "Join the club to chat.");
  if (await barred(s.id, buyerId)) fail(403, "banned", "You can't post in this club.");
  if ((await sql`select 1 from bans where shop_id = ${s.id} and buyer_id = ${buyerId} and kind = 'mute' and (until is null or until > now())`).length) {
    fail(403, "muted", "The seller has muted you for now.");
  }
  if (!(await sql`select throttle_take(${`clubchat:${buyerId}`}, 2) as ok`)[0].ok) fail(429, "slow_down", "One message every 2 s.");
  const body = text.trim().slice(0, MAX_CHAT);
  const rule = scamRules(body);
  if (rule.blocked) {
    await sql`insert into moderation_events (shop_id, buyer_id, rule, action) values (${s.id}, ${buyerId}, ${`club_chat:${rule.rule}`}, 'blocked')`;
    fail(422, "blocked", CLUB_BLOCKED_TEXT);
  }
  const club = s.nexconn_club_id!, uid = `b_${buyerId}`;
  const [me] = await sql<{ display_name: string }[]>`select display_name from buyers where id = ${buyerId}`;
  const [row] = await sql<{ id: string; created_at: Date }[]>`
    insert into club_posts (shop_id, kind, buyer_id, text) values (${s.id}, 'chat', ${buyerId}, ${body}) returning id::text, created_at`;
  let msgId: string | null;
  try {
    msgId = flags.mode === "mock" ? bus().publish("group", clubKey(club, "chat"), uid, body, me?.display_name).id
      : await nx.sendClub(club, "chat", { text: body }, uid);
  } catch (e) {
    await sql`delete from club_posts where id = ${row.id}`;
    console.error("[club] send", e instanceof Error ? e.message : e);
    return fail(502, "send_failed", "Couldn't send. Try again.");
  }
  if (msgId) await sql`update club_posts set nexconn_msg_id = ${msgId} where id = ${row.id}`;
  return { id: msgId ?? `p${row.id}`, channel: clubKey(club, "chat"), from: uid, fromName: me?.display_name, at: row.created_at.getTime(), kind: "text" as const, text: body };
}

/** One review per paid or shipped order of this buyer: 1-5 stars and up to 280 characters, screened. */
export async function review(buyerId: string, orderId: string, stars: number, text: string): Promise<ClubPostView> {
  const [o] = await sql<{ shop_id: string; state: string }[]>`select shop_id, state from orders where id = ${orderId} and buyer_id = ${buyerId}`;
  if (!o) notFound();
  if (o.state !== "paid" && o.state !== "shipped") fail(403, "not_eligible", "You can review once the seller has confirmed your payment.");
  const s = await shopWhere({ id: o.shop_id });
  const body = text.trim().slice(0, MAX_POST);
  const rule = scamRules(body);
  if (rule.blocked) {
    await sql`insert into moderation_events (shop_id, buyer_id, rule, action) values (${s.id}, ${buyerId}, ${`club_review:${rule.rule}`}, 'blocked')`;
    fail(422, "blocked", CLUB_BLOCKED_TEXT);
  }
  const club = await ensureClub(s);
  const [me] = await sql<{ display_name: string }[]>`select display_name from buyers where id = ${buyerId}`;
  let id: string | null = null;
  await sql.begin(async (tx) => {
    const r = await tx<{ id: string }[]>`
      insert into club_posts (shop_id, kind, buyer_id, order_id, stars, text) values (${s.id}, 'review', ${buyerId}, ${orderId}, ${stars}, ${body})
      on conflict (order_id) do nothing returning id::text`;
    if (!r.length) return;
    id = r[0].id;
    const line = `${"★".repeat(stars)}${"☆".repeat(5 - stars)} ${me?.display_name ?? "Buyer"}${body ? `: ${body}` : ""}`;
    await enqueue(tx as never, club, "SYS:ClubSend", { channelId: club, sub: "reviews", text: line });
  });
  if (!id) fail(409, "already_reviewed", "You've already reviewed this order.");
  await drain(club);
  return (await posts(s, "review", { id: id! }))[0];
}

// ---------------------------------------------------------------- announcements

const IST = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** `wire`: what the #drops message says, when it differs from the record (the page shows the start time itself). */
async function postAnnouncement(s: Shop, a: { text: string; wire?: string; dropId?: string | null; staffId?: string | null; autoKey?: string; link?: string | null }) {
  const club = await ensureClub(s);
  let sent = false;
  await sql.begin(async (tx) => {
    const r = await tx`
      insert into club_posts (shop_id, kind, staff_id, drop_id, auto_key, text)
      values (${s.id}, 'announce', ${a.staffId ?? null}, ${a.dropId ?? null}, ${a.autoKey ?? null}, ${a.text})
      on conflict (auto_key) do nothing returning 1`;
    if (!r.length) return;
    sent = true;
    await enqueue(tx as never, club, "SYS:ClubSend", { channelId: club, sub: "drops", text: [a.wire ?? a.text, a.link].filter(Boolean).join("\n") });
  });
  if (sent) await drain(club);
}

/** Staff post to #drops, optionally pointing at one of the shop's drops (by code). */
export async function announce(shopId: string, staffId: string, text: string, dropCode?: string | null): Promise<void> {
  const s = await shopWhere({ id: shopId });
  let drop: { id: string; code: string } | undefined;
  if (dropCode) {
    [drop] = await sql<{ id: string; code: string }[]>`select id, code from drops where shop_id = ${s.id} and code = ${dropCode.toUpperCase()}`;
    if (!drop) fail(404, "no_drop", "No drop with that code in your shop.");
  }
  await postAnnouncement(s, { text: text.trim().slice(0, MAX_POST), dropId: drop?.id, staffId, link: drop ? shareUrl(s.slug, drop.code) : null });
}

/**
 * The automatic #drops post when a drop is scheduled or goes live: once per drop and status, and only for a shop
 * whose club exists (nobody to tell otherwise). Never throws. Called by the drop routes and on club page loads.
 */
export async function announceDrop(dropId: string): Promise<void> {
  try {
    if (!clubOn()) return;
    const [d] = await sql<{ id: string; code: string; title: string; status: string; starts_at: Date; shop_id: string; club: string | null }[]>`
      select d.id, d.code, d.title, d.status, d.starts_at, d.shop_id, s.nexconn_club_id as club
        from drops d join shops s on s.id = d.shop_id where d.id = ${dropId}`;
    if (!d?.club || d.status === "ended") return;
    const s = await shopWhere({ id: d.shop_id });
    if (d.starts_at < since(s) && d.status === "scheduled") return;
    const text = d.status === "live" ? `🔴 ${d.title} is live now. First tap wins!` : `📣 New drop: ${d.title}.`;
    const wire = d.status === "live" ? text : `${text} Starts ${IST(d.starts_at)}.`;
    await postAnnouncement(s, { text, wire, dropId: d.id, autoKey: `drop:${d.id}:${d.status}`, link: shareUrl(s.slug, d.code) });
  } catch (e) {
    console.error("[club] announceDrop", e instanceof Error ? e.message : e);
  }
}

// ---------------------------------------------------------------- reads

type PostRow = { id: string; kind: string; text: string; stars: number | null; name: string | null; at: Date; hidden_at: Date | null;
  hidden_reason: string | null; code: string | null; status: string | null; starts_at: Date | null; buyer_id: string | null; nexconn_msg_id: string | null };

async function posts(s: Shop, kind: "announce" | "review" | "chat", o: { limit?: number; hidden?: boolean; id?: string } = {}): Promise<ClubPostView[]> {
  const rows = await sql<PostRow[]>`
    select p.id::text, p.kind, p.text, p.stars, b.display_name as name, p.created_at as at, p.hidden_at, p.hidden_reason,
           d.code, d.status, d.starts_at, p.buyer_id, p.nexconn_msg_id
      from club_posts p left join buyers b on b.id = p.buyer_id left join drops d on d.id = p.drop_id
     where p.shop_id = ${s.id} and p.kind = ${kind} and p.created_at >= ${since(s)}
       ${o.hidden ? sql`` : sql`and p.hidden_at is null`} ${o.id ? sql`and p.id = ${o.id}` : sql``}
     order by p.id desc limit ${o.limit ?? 20}`;
  return rows.reverse().map((r) => ({
    id: r.id, text: r.text, at: r.at.toISOString(), stars: r.stars, name: r.name,
    from: r.buyer_id ? `b_${r.buyer_id}` : null, msgId: r.nexconn_msg_id,
    drop: r.code ? { code: r.code, status: r.status as "scheduled" | "live" | "ended", startsAt: r.starts_at!.toISOString(), shareUrl: shareUrl(s.slug, r.code) } : null,
    ...(o.hidden ? { hiddenAt: r.hidden_at?.toISOString() ?? null, hiddenReason: r.hidden_reason } : {}),
  }));
}

/** Public club page data. Chat lines only for members. */
export async function summary(slug: string, buyerId: string | null): Promise<ClubSummary> {
  const s = await shopWhere({ slug });
  const [next] = await sql<{ id: string; code: string; title: string; status: "scheduled" | "live"; starts_at: Date }[]>`
    select id, code, title, status, starts_at from drops
     where shop_id = ${s.id} and status in ('scheduled', 'live') order by (status = 'live') desc, starts_at limit 1`;
  if (next && s.nexconn_club_id) await announceDrop(next.id); // catch-up when the drop routes did not post it (demo slots)
  let me: ClubSummary["me"] = null;
  if (buyerId) {
    const member = (await sql`select 1 from club_members where shop_id = ${s.id} and buyer_id = ${buyerId} and joined_at >= ${since(s)}`).length > 0;
    const reviewable = await sql<{ orderId: string; title: string; orderNo: number }[]>`
      select o.id as "orderId", p.title, o.order_no as "orderNo"
        from orders o join claims c on c.id = o.claim_id join drop_items i on i.id = c.drop_item_id join products p on p.id = i.product_id
       where o.buyer_id = ${buyerId} and o.shop_id = ${s.id} and o.state in ('paid', 'shipped')
         and not exists (select 1 from club_posts r where r.order_id = o.id)
       order by o.created_at desc limit 10`;
    me = { userId: `b_${buyerId}`, member, banned: await barred(s.id, buyerId), reviewable };
  }
  return {
    enabled: true,
    clubId: s.nexconn_club_id,
    since: s.since?.toISOString() ?? null,
    shop: { id: s.id, name: s.name, slug: s.slug, logoUrl: s.logo_url, isSandbox: s.is_sandbox },
    memberCount: await memberCount(s),
    nextDrop: next ? { code: next.code, title: next.title, status: next.status, startsAt: next.starts_at.toISOString(), shareUrl: shareUrl(s.slug, next.code) } : null,
    announcements: await posts(s, "announce", { limit: 10 }),
    reviews: await posts(s, "review", { limit: 20 }),
    chat: me?.member ? await posts(s, "chat", { limit: 50 }) : [],
    me,
  };
}

// ---------------------------------------------------------------- staff

export async function manage(shopId: string): Promise<ClubManage> {
  const s = await shopWhere({ id: shopId });
  const members = await sql<{ buyerId: string; name: string; joinedAt: Date }[]>`
    select m.buyer_id as "buyerId", b.display_name as name, m.joined_at as "joinedAt"
      from club_members m join buyers b on b.id = m.buyer_id
     where m.shop_id = ${s.id} and m.joined_at >= ${since(s)} order by m.joined_at desc limit 100`;
  return {
    clubId: s.nexconn_club_id, shopSlug: s.slug, memberCount: await memberCount(s),
    members: members.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString() })),
    chat: await posts(s, "chat", { limit: 30 }),
    reviews: await posts(s, "review", { limit: 50, hidden: true }),
    announcements: await posts(s, "announce", { limit: 10 }),
  };
}

export async function staffRemove(shopId: string, staffId: string, buyerId: string): Promise<void> {
  const s = await shopWhere({ id: shopId });
  if (!(await removeMember(s, buyerId))) notFound();
  await sql`insert into moderation_events (shop_id, buyer_id, rule, action) values (${s.id}, ${buyerId}, ${`club_member_removed_by:${staffId}`}, 'removed')`;
}

export async function hideReview(shopId: string, staffId: string, postId: string, reason: string): Promise<void> {
  const [r] = await sql<{ buyer_id: string | null }[]>`
    update club_posts set hidden_at = now(), hidden_reason = ${reason}
     where id = ${postId} and shop_id = ${shopId} and kind = 'review' and hidden_at is null returning buyer_id`;
  if (!r) notFound();
  await sql`insert into moderation_events (shop_id, buyer_id, nexconn_msg_id, rule, action)
            values (${shopId}, ${r.buyer_id}, ${`review:${postId}`}, ${`club_review_hidden_by:${staffId}: ${reason}`}, 'hidden')`;
}

// ---------------------------------------------------------------- webhook (members sending straight from the SDK)

/**
 * Scam shield for a club text that reached Nexconn without our route (a member's client sending directly):
 * rules only; a blocked text is recalled and logged. Our own sends were screened before they went out.
 */
export async function screenClubText(m: { channelId: string; sub: string; fromUserId: string; messageId: string; text: string; sentAt?: number }): Promise<"ignored" | "blocked" | "passed"> {
  if (m.fromUserId === BOT_ID || !m.fromUserId.startsWith("b_") || !(nx.CLUB_SUBS as readonly string[]).includes(m.sub)) return "ignored";
  const r = scamRules(m.text);
  if (!r.blocked) return "passed";
  const [s] = await sql<{ id: string }[]>`select id from shops where nexconn_club_id = ${m.channelId}`;
  if (!s) return "ignored";
  const buyerId = m.fromUserId.slice(2);
  await nx.deleteClubMessage({ channelId: m.channelId, sub: m.sub as nx.ClubSub, messageId: m.messageId, fromUserId: m.fromUserId, sentAt: m.sentAt })
    .catch((e) => console.error("[club] recall", e instanceof Error ? e.message : e));
  await sql`insert into moderation_events (shop_id, buyer_id, nexconn_msg_id, rule, action)
            select ${s.id}, id, ${m.messageId}, ${`club_${m.sub}:${r.rule}`}, 'blocked' from buyers where id::text = ${buyerId}`;
  return "blocked";
}
