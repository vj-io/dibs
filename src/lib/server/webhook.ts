// Sale-room text pipeline: scam shield -> typed-claim helper -> answer bot. Fed by the Nexconn message:send webhook,
// the mock send route and demo-bot chat (handleRoomText), plus the pre-message callback (rules only). Server only.
import { createHash } from "node:crypto";
import { isQuestion } from "../ai/answer-bot.ts";
import { promptText } from "../ai/claim-helper.ts";
import * as jobs from "../ai/jobs.ts";
import { setAiRecorder } from "../ai/model.ts";
import { scamRules } from "../ai/scam-shield.ts";
import { ASSISTANT_ID, BOT_ID, type Card } from "../codec.ts";
import { screenClubText } from "./club.ts";
import { sql } from "./db.ts";
import { flags } from "./flags.ts";
import { bus } from "./mockbus.ts";
import * as nx from "./nexconn.ts";
import { drainOutbox } from "./outbox.ts";

setAiRecorder((r) => {
  if (process.env.DATABASE_URL) sql`insert into ai_calls (job, model, ms, ok) values (${r.job}, ${r.model}, ${r.ms}, ${r.ok})`.catch(() => {});
});

/** PRD Key copy, "Scam block (to sender)". */
export const BLOCKED_TEXT = "Phone numbers and UPI IDs can't be shared in the sale room. Use your order chat.";

export type RoomText = { channelId: string; fromUserId: string; messageId: string; text: string; sentAt?: number };
export type TextDeps = {
  scamVerdict: typeof jobs.scamVerdict;
  resolveClaimIntent: typeof jobs.resolveClaimIntent;
  answerQuestion: typeof jobs.answerQuestion;
  sendAssistant: (channelId: string, text: string) => Promise<void>;
};
export type RoomTextResult = "ignored" | "duplicate" | "no_drop" | "blocked" | "prompted" | "answered" | "passed";

let assistantReady: Promise<unknown> | undefined;
async function sendAssistant(channelId: string, text: string) {
  if (flags.mode === "mock") { bus().publish("room", channelId, ASSISTANT_ID, text, "Dibs assistant"); return; }
  await (assistantReady ??= nx.issueToken(ASSISTANT_ID, "Dibs assistant").catch((e) => { assistantReady = undefined; throw e; }));
  await nx.sendRoom(channelId, ASSISTANT_ID, { text }, "low");
}

export const realDeps: TextDeps = { ...jobs, sendAssistant };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const take = async (key: string, seconds: number) => (await sql`select throttle_take(${key}, ${seconds}) as ok`)[0].ok === true;
const out = (dropId: string, type: "room" | "user", channel: string, card: Card, priority = "normal") =>
  sql`select _out(${dropId}, ${type}, ${channel}, ${card.t}, ${sql.json(card as never)}, ${priority})`;

type Ctx = {
  drop_id: string; code: string; version: string; status: string; shop_id: string; faq: string[];
  item_id: string | null; position: number | null; item_state: string | null; title: string | null; price_paise: string | null;
  note: string | null; variants: { key: string; label: string; left: number }[] | null; recent: number[];
};

/** Runs the pipeline for one sale-room text. Never throws for a bad message; returns what it did. */
export async function handleRoomText(m: RoomText, deps: TextDeps = realDeps): Promise<RoomTextResult> {
  const text = m.text.trim();
  if (!text || !m.messageId || m.fromUserId === BOT_ID || m.fromUserId === ASSISTANT_ID) return "ignored";
  const seen = await sql`insert into webhook_seen (message_id) values (${m.messageId.slice(0, 200)}) on conflict do nothing returning 1`;
  if (!seen.length) return "duplicate";

  const [ctx] = await sql<Ctx[]>`
    select d.id as drop_id, d.code, d.version, d.status, d.shop_id, s.faq,
           li.id as item_id, li.position, li.state as item_state, p.title, p.price_paise, p.note,
           (select jsonb_agg(jsonb_build_object('key', pv.key, 'label', pv.label, 'left', st.available) order by pv.sort, pv.key)
              from item_stock st join product_variants pv on pv.id = st.variant_id where st.drop_item_id = li.id) as variants,
           (select coalesce(array_agg(position order by position), '{}') from drop_items where drop_id = d.id and state <> 'queued') as recent
      from drops d join shops s on s.id = d.shop_id
      left join drop_items li on li.id = d.live_item_id
      left join products p on p.id = li.product_id
     where coalesce(d.nexconn_channel_id, 'dr_' || d.code) = ${m.channelId}
     order by d.created_at desc limit 1`;
  if (!ctx) return "no_drop";

  const from = m.fromUserId;
  const staffId = from.startsWith("s_") && UUID.test(from.slice(2)) ? from.slice(2) : null;
  const isStaff = !!staffId && (await sql`select 1 from staff where id = ${staffId} and shop_id = ${ctx.shop_id} and active`).length > 0;
  let buyerId: string | null = null;
  if (from.startsWith("b_") && UUID.test(from.slice(2))) buyerId = from.slice(2);
  else if (from.startsWith("demo_bot_")) buyerId = (await sql`select id from buyers where is_bot and nexconn_user_id = ${from}`)[0]?.id ?? null;
  if (buyerId && !(await sql`select 1 from buyers where id = ${buyerId}`).length) buyerId = null;
  // Only a known sender is acted on: a buyer that exists or a demo bot. Staff ids (tokens come only from our server)
  // are never moderated; anything else (a forged or replayed body naming a stranger) is ignored.
  if (!isStaff && (!buyerId || from.startsWith("s_"))) return "ignored";

  const isBot = from.startsWith("demo_bot_");
  // demo bots' canned lines earn at most one assistant answer and one prompt per piece (per drop between pieces)
  const botOnce = (what: string) => take(`bot${what}:${ctx.drop_id}:${ctx.item_id ?? "none"}`, 3600);
  let flagged = false; // blocked or sent to review: the assistant never answers it

  // (a) scam shield: everyone except the shop's team
  if (!isStaff) {
    // a model call per borderline message, at most 1 per buyer per 10 s and 6 per room per minute
    const aiAllowed = async () => (await take(`scamai:${buyerId}`, 10))
      && Number((await sql`select rate_add(${`scamai:${m.channelId}`}, 60) as n`)[0].n) <= 6;
    const v = await deps.scamVerdict(text, aiAllowed);
    if (v.action === "block") {
      await sql`insert into moderation_events (drop_id, buyer_id, nexconn_msg_id, rule, action) values (${ctx.drop_id}, ${buyerId}, ${m.messageId}, ${v.rule}, 'blocked')`;
      if (flags.mode === "nexconn") {
        await nx.deleteMessage({ channelType: "room", channelId: m.channelId, messageId: m.messageId, fromUserId: from, sentAt: m.sentAt })
          .catch((e) => console.error("[webhook] delete", e instanceof Error ? e.message : e));
      }
      await out(ctx.drop_id, "room", m.channelId, { t: "DB:Hide", v: Number(ctx.version), messageId: m.messageId }, "high");
      await out(ctx.drop_id, "user", from, { t: "DB:Alert", kind: "blocked", orderId: null, dropCode: ctx.code, text: BLOCKED_TEXT });
      await drainOutbox({ budgetMs: 3000 });
      return "blocked";
    }
    if (v.action === "review") {
      flagged = true;
      await sql`insert into moderation_events (drop_id, buyer_id, nexconn_msg_id, rule, action) values (${ctx.drop_id}, ${buyerId}, ${m.messageId}, ${v.rule}, 'review')`;
    }
  }

  // (b) typed-claim helper: a buyer, while a piece is live
  if (buyerId && ctx.status === "live" && ctx.item_id && ctx.item_state === "live" && ctx.variants) {
    const live = { itemId: ctx.item_id, position: ctx.position!, variants: ctx.variants.map(({ key, label }) => ({ key, label })) };
    const intent = await deps.resolveClaimIntent(text, live, ctx.recent.filter((n) => n !== ctx.position));
    if (intent.kind === "prompt" && (!isBot || (await botOnce("prompt")))) {
      const [r] = await sql`select rate_add(${`prompt:${buyerId}:${ctx.item_id}`}, 86400) as n`;
      if (r.n === 1) {
        const label = ctx.variants.find((v) => v.key === intent.variantKey)?.label ?? null;
        await out(ctx.drop_id, "user", from, { t: "DB:Prompt", itemId: ctx.item_id, position: ctx.position!, variant: intent.variantKey, text: promptText(ctx.position!, label) });
        await drainOutbox({ budgetMs: 3000 });
        return "prompted";
      }
    }
  }

  // (c) answer bot: at most 1 answer per 10 s per room, the same question not twice in 60 s
  if (!isStaff && !flagged && isQuestion(text)) {
    const norm = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 200);
    const qKey = `ansq:${m.channelId}:${createHash("sha1").update(norm).digest("hex").slice(0, 16)}`, roomKey = `ans:${m.channelId}`;
    if (!(await take(qKey, 60))) return "passed";
    if (!(await take(roomKey, 10))) { await sql`delete from throttles where key = ${qKey}`; return "passed"; }
    if (isBot && !(await botOnce("answer"))) { await sql`delete from throttles where key in (${qKey}, ${roomKey})`; return "passed"; }
    const live = ctx.item_id && ctx.title && ctx.variants
      ? { title: ctx.title, pricePaise: Number(ctx.price_paise), note: ctx.note, variants: ctx.variants.map(({ label, left }) => ({ label, left })) }
      : null;
    const answer = await deps.answerQuestion(text, ctx.faq ?? [], live);
    if (!answer) { await sql`delete from throttles where key = ${roomKey}`; return "passed"; }
    // the answer is about the piece that was live when asked: skip it if the room has moved on
    const [now] = await sql`select live_item_id from drops where id = ${ctx.drop_id}`;
    if ((now?.live_item_id ?? null) !== (ctx.item_id ?? null)) { await sql`delete from throttles where key = ${roomKey}`; return "passed"; }
    await deps.sendAssistant(m.channelId, `“${text.slice(0, 80)}” ${answer}`);
    return "answered";
  }
  return "passed";
}

type Hook = { type?: unknown; data?: unknown };
const isOpen = (t: unknown) => t === 4 || t === "4" || (typeof t === "string" && /open/i.test(t));

/** Sale-room texts in a message:send webhook body (open channel, RC:TxtMsg). Anything else is skipped. */
export function roomTexts(body: Hook): RoomText[] {
  if (body?.type !== "message:send" || !Array.isArray(body.data)) return [];
  const res: RoomText[] = [];
  for (const d of body.data as Record<string, unknown>[]) {
    if (!d || !isOpen(d.channelType) || d.messageType !== "RC:TxtMsg") continue;
    if (typeof d.channelId !== "string" || typeof d.userId !== "string" || typeof d.messageId !== "string") continue;
    let text: unknown = d.content;
    try { if (typeof text === "string") text = JSON.parse(text); } catch { continue; }
    text = (text as { content?: unknown })?.content;
    if (typeof text !== "string") continue;
    res.push({ channelId: d.channelId, fromUserId: d.userId, messageId: d.messageId, text: text.slice(0, 2000), sentAt: typeof d.time === "number" ? d.time : undefined });
  }
  return res;
}

const isCommunity = (t: unknown) => t === 10 || t === "10" || (typeof t === "string" && /communit/i.test(t));

/** Shop-club texts (community channel, RC:TxtMsg, with their subchannel) in a message:send webhook body. */
export function clubTexts(body: Hook): (RoomText & { sub: string })[] {
  if (body?.type !== "message:send" || !Array.isArray(body.data)) return [];
  const club = (body.data as Record<string, unknown>[]).filter((d) => d && isCommunity(d.channelType) && typeof d.subchannelId === "string");
  const texts = roomTexts({ type: body.type, data: club.map((d) => ({ ...d, channelType: 4 })) }); // same text parsing as the room
  return texts.map((t) => ({ ...t, sub: String(club.find((d) => d.messageId === t.messageId)?.subchannelId) }));
}

type Creds = { appKey: string; appSecret: string };
export type WebhookOpts = { defer?: (job: () => Promise<unknown>) => void; deps?: TextDeps; creds?: Creds; now?: number };

/** POST /api/nexconn/webhook. Answers fast (Nexconn waits 5 s); the pipeline runs in `defer` (after() in the route). */
export async function handleWebhook(req: Request, o: WebhookOpts = {}): Promise<Response> {
  if (!nx.verifyWebhook(req.headers, o.creds, o.now)) return Response.json({ error: "bad_signature" }, { status: 401 });
  // the signature covers nonce + timestamp only, so a captured header set is good for one body, once
  const nonce = `${req.headers.get("Nonce")}:${req.headers.get("Timestamp")}`;
  if (!(await sql`select webhook_nonce_take(${nonce}) as ok`)[0].ok) return Response.json({ error: "replayed" }, { status: 409 });
  let body: Hook;
  try { body = JSON.parse(await req.text()); } catch { return Response.json({ error: "invalid" }, { status: 400 }); }
  const msgs = roomTexts(body);
  const defer = o.defer ?? ((job) => { void job(); });
  for (const m of msgs) defer(() => handleRoomText(m, o.deps).catch((e) => console.error("[webhook]", e instanceof Error ? e.message : e)));
  for (const m of clubTexts(body)) defer(() => screenClubText(m).catch((e) => console.error("[webhook] club", e instanceof Error ? e.message : e)));
  return Response.json({ ok: true, accepted: msgs.length });
}

export type PreMessageReply = { pass: 0 | 1; extra?: string };

/** Pre-message callback: rules only, never slower than ~300 ms, pass on any doubt. Logging runs in `defer`. */
export async function handlePreMessage(req: Request, o: Omit<WebhookOpts, "deps"> = {}): Promise<PreMessageReply> {
  const decide = async (): Promise<PreMessageReply> => {
    if (!nx.verifyWebhook(req.headers, o.creds, o.now)) return { pass: 1 };
    const body = JSON.parse(await req.text()) as Hook;
    const d = (Array.isArray(body?.data) ? body.data[0] : null) as Record<string, unknown> | null;
    if (!d || d.messageType !== "RC:TxtMsg" || typeof d.userId !== "string" || typeof d.channelId !== "string") return { pass: 1 };
    const from = d.userId, channelId = d.channelId;
    if (from === BOT_ID || from === ASSISTANT_ID || from.startsWith("s_")) return { pass: 1 }; // s_ ids get tokens only from our server
    let text: unknown = d.content;
    if (typeof text === "string") text = JSON.parse(text);
    text = (text as { content?: unknown })?.content;
    if (typeof text !== "string") return { pass: 1 };
    const r = scamRules(text);
    if (!r.blocked) return { pass: 1 };
    const msgId = typeof d.messageId === "string" ? d.messageId : null;
    const bid = from.startsWith("b_") && UUID.test(from.slice(2)) ? from.slice(2) : null;
    (o.defer ?? ((job) => { void job(); }))(() => sql`
      insert into moderation_events (drop_id, buyer_id, nexconn_msg_id, rule, action)
      select d.id, coalesce((select id from buyers where id = ${bid}::uuid), (select id from buyers where is_bot and nexconn_user_id = ${from})),
             ${msgId}, ${r.rule}, 'blocked'
        from drops d where coalesce(d.nexconn_channel_id, 'dr_' || d.code) = ${channelId} order by d.created_at desc limit 1`
      .catch((e) => console.error("[premessage] log", e instanceof Error ? e.message : e)));
    return { pass: 0, extra: BLOCKED_TEXT };
  };
  const timeout = new Promise<PreMessageReply>((res) => setTimeout(() => res({ pass: 1 }), 250));
  return Promise.race([decide().catch((): PreMessageReply => ({ pass: 1 })), timeout]);
}
