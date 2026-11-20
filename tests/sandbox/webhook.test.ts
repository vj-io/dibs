// Webhook / sale-room text pipeline with synthetic signed requests and injected model fakes (no AI quota).
// Real Postgres, mock transport, one sandbox slot.
import "./env.ts";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { claimIntent } from "../../src/lib/ai/claim-helper.ts";
import { scamRules } from "../../src/lib/ai/scam-shield.ts";
import { cancelPending } from "../../src/lib/server/bots.ts";
import { fn, sql } from "../../src/lib/server/db.ts";
import { bus } from "../../src/lib/server/mockbus.ts";
import { drainOutbox } from "../../src/lib/server/outbox.ts";
import { type TryStart } from "../../src/lib/server/sandbox.ts";
import { startTryRetry as startTry } from "./helpers.ts";
import { BLOCKED_TEXT, handleOrderMsg, handlePreMessage, handleRoomText, handleWebhook, orderMsgs, roomTexts, type TextDeps } from "../../src/lib/server/webhook.ts";

const creds = { appKey: "test-key", appSecret: "test-secret" };
function signed(body: unknown, at = Date.now(), secret = creds.appSecret): Request {
  const nonce = Math.random().toString(36).slice(2), ts = String(at);
  return new Request("http://x/api/nexconn/webhook", {
    method: "POST", body: JSON.stringify(body),
    headers: { AppKey: creds.appKey, Nonce: nonce, Timestamp: ts, Signature: createHash("sha1").update(secret + nonce + ts).digest("hex") },
  });
}
const msgBody = (channelId: string, userId: string, text: string, messageId = "m_" + Math.random().toString(36).slice(2)) => ({
  type: "message:send", id: "e1", time: Date.now(),
  data: [{ userId, channelId, channelType: 4, messageType: "RC:TxtMsg", content: JSON.stringify({ content: text }), time: Date.now(), messageId, os: "Websocket" }],
});

let calls: string[] = [];
const said: string[] = [];
const fakes: TextDeps = {
  scamVerdict: async (t) => { calls.push("scam"); const r = scamRules(t); return r.blocked ? { action: "block", rule: r.rule! } : /dm me/i.test(t) ? { action: "review", rule: "ai" } : { action: "pass", rule: "" }; },
  resolveClaimIntent: async (t, live, recent) => { calls.push("claim"); const r = claimIntent(t, live, recent); return r.kind === "unclear" ? { kind: "none" } : r; },
  answerQuestion: async () => { calls.push("answer"); return "Ships in 3–5 days."; },
  sendAssistant: async (_ch, text) => { said.push(text); },
};

let s: TryStart;
let ch: string;
const judge = () => "b_" + s.buyerId;
const id = () => "m_" + Math.random().toString(36).slice(2);

before(async () => {
  s = await startTry("buyer", "Hook Tester");
  await cancelPending(s.dropId);                        // no scripted bots: this file drives the room itself
  await sql`select sandbox_next(${s.dropId}, ${s.ownerId}, 0, null, null)`;
  ch = s.channelId;
  await sql`delete from throttles where key like ${"%" + ch + "%"}`;
});
after(async () => {
  await fn("drop_end", s.dropId, s.ownerId);
  await sql.end({ timeout: 5 });
});

test("bad signature and stale timestamp are refused", async () => {
  assert.equal((await handleWebhook(signed(msgBody(ch, judge(), "hi"), Date.now(), "wrong"), { creds })).status, 401);
  assert.equal((await handleWebhook(signed(msgBody(ch, judge(), "hi"), Date.now() - 6 * 60_000), { creds })).status, 401);
  const jobs: (() => Promise<unknown>)[] = [];
  const ok = await handleWebhook(signed(msgBody(ch, judge(), "Wow 😍")), { creds, deps: fakes, defer: (j) => jobs.push(j) });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, accepted: 1 });
  await Promise.all(jobs.map((j) => j()));
});

test("a captured header set is accepted once (replay with another body is refused); strangers get the scam rules only", async () => {
  const first = signed(msgBody(ch, judge(), "hello"));
  const headers = new Headers(first.headers);
  assert.equal((await handleWebhook(first, { creds, deps: fakes, defer: () => {} })).status, 200);
  const replay = new Request("http://x/api/nexconn/webhook", { method: "POST", headers, body: JSON.stringify(msgBody(ch, judge(), "pay me at x@ybl")) });
  assert.equal((await handleWebhook(replay, { creds, deps: fakes, defer: () => {} })).status, 409);
  const stranger = "b_00000000-0000-4000-8000-000000000000";
  // scam text from someone who is not this shop's buyer or staff is still removed (rules only) and logged with no buyer
  for (const from of [stranger, "s_00000000-0000-4000-8000-000000000000", "cl_user_42"]) {
    const mid = id();
    assert.equal(await handleRoomText({ channelId: ch, fromUserId: from, messageId: mid, text: "pay 500 to rahul@okaxis" }, fakes), "blocked", from);
    const [row] = await sql`select buyer_id, rule, action from moderation_events where nexconn_msg_id = ${mid}`;
    assert.deepEqual({ ...row }, { buyer_id: null, rule: "upi", action: "blocked" });
    assert.equal((await sql`select 1 from outbox where msg_type = 'DB:Hide' and payload->>'messageId' = ${mid}`).length, 1);
  }
  // anything else from them is ignored: no helper, no answer bot, no model call
  assert.equal(await handleRoomText({ channelId: ch, fromUserId: stranger, messageId: id(), text: "is the green one still there?" }, fakes), "ignored");
});

test("roomTexts keeps only open-channel text", () => {
  const b = msgBody("dr_x", "b_1", "hello");
  assert.equal(roomTexts(b)[0].text, "hello");
  assert.deepEqual(roomTexts({ ...b, type: "message:delete" }), []);
  assert.deepEqual(roomTexts({ ...b, data: [{ ...b.data[0], channelType: 3 }] }), []);
  assert.deepEqual(roomTexts({ ...b, data: [{ ...b.data[0], messageType: "DB:Sold" }] }), []);
});

test("replay of a message id is ignored; dibs_bot and the assistant are ignored", async () => {
  const m = { channelId: ch, fromUserId: judge(), messageId: id(), text: "so pretty" };
  assert.equal(await handleRoomText(m, fakes), "passed");
  assert.equal(await handleRoomText(m, fakes), "duplicate");
  assert.equal(await handleRoomText({ ...m, messageId: id(), fromUserId: "dibs_bot" }, fakes), "ignored");
  assert.equal(await handleRoomText({ ...m, messageId: id(), fromUserId: "dibs_assistant" }, fakes), "ignored");
  assert.equal(await handleRoomText({ ...m, messageId: id(), channelId: "dr_nowhere" }, fakes), "no_drop");
});

test("scam text: blocked, logged without text, hidden in the room, sender told why", { timeout: 120_000 }, async () => {
  const messageId = id();
  bus().publish("room", ch, judge(), "pay here rahul@okaxis", "Hook T.");
  assert.equal(await handleRoomText({ channelId: ch, fromUserId: judge(), messageId, text: "pay 500 advance to rahul.k@okaxis" }, fakes), "blocked");
  const [mod] = await sql`select * from moderation_events where nexconn_msg_id = ${messageId}`;
  assert.equal(mod.rule, "upi");
  assert.equal(mod.action, "blocked");
  assert.equal(mod.buyer_id, s.buyerId);
  assert.ok(!("text" in mod));
  const rows = await sql`select channel_type, channel_id, msg_type, payload, status from outbox where drop_id = ${s.dropId} and msg_type in ('DB:Hide','DB:Alert') and (payload->>'messageId' = ${messageId} or payload->>'kind' = 'blocked')`;
  const hide = rows.find((r) => r.msg_type === "DB:Hide")!, alert = rows.find((r) => r.msg_type === "DB:Alert")!;
  assert.equal(hide.channel_id, ch);
  assert.equal(alert.channel_id, judge());
  assert.equal(alert.payload.text, BLOCKED_TEXT);
  // the room's earlier cards go first (per-channel order, one row per round trip from a laptop): drain until the hide is out
  const hideStatus = () => sql`select status from outbox where drop_id = ${s.dropId} and msg_type = 'DB:Hide' and payload->>'messageId' = ${messageId}`.then((r) => r[0].status);
  for (let end = Date.now() + 90_000; (await hideStatus()) !== "sent" && Date.now() < end;) await drainOutbox({ budgetMs: 10_000, max: 500 });
  assert.equal(await hideStatus(), "sent");
  // the shop's team may post payment details
  calls = [];
  assert.equal(await handleRoomText({ channelId: ch, fromUserId: "s_" + s.ownerId, messageId: id(), text: "pay to demo@upi" }, fakes), "passed");
  assert.ok(!calls.includes("scam"));
  // borderline -> review, and the message carries on
  assert.equal(await handleRoomText({ channelId: ch, fromUserId: judge(), messageId: "rv_" + id(), text: "dm me for cheaper" }, fakes), "passed");
  assert.equal((await sql`select action from moderation_events where drop_id = ${s.dropId} and nexconn_msg_id like 'rv_%'`)[0].action, "review");
});

test("typed claim: one private prompt per buyer per piece, and no answer bot after it", async () => {
  calls = [];
  assert.equal(await handleRoomText({ channelId: ch, fromUserId: judge(), messageId: id(), text: "booked! silver" }, fakes), "prompted");
  assert.ok(!calls.includes("answer"));
  const [p] = await sql`select payload from outbox where drop_id = ${s.dropId} and msg_type = 'DB:Prompt' and channel_id = ${judge()}`;
  assert.equal(p.payload.text, "Want this? Tap to Dibs #1 · Silver");
  assert.equal(p.payload.variant, "silver");
  assert.equal(await handleRoomText({ channelId: ch, fromUserId: judge(), messageId: id(), text: "mine" }, fakes), "passed");
  assert.equal((await sql`select count(*)::int as n from outbox where drop_id = ${s.dropId} and msg_type = 'DB:Prompt'`)[0].n, 1);
});

test("answer bot: 1 answer per 10 s per room, same question not twice in 60 s", async () => {
  await sql`delete from throttles where key like ${"%" + ch + "%"}`;
  said.length = 0;
  const ask = (text: string) => handleRoomText({ channelId: ch, fromUserId: judge(), messageId: id(), text }, fakes);
  assert.equal(await ask("shipping?"), "answered");
  assert.match(said[0], /^“shipping\?” Ships in 3–5 days\.$/);
  assert.equal(await ask("COD hai?"), "passed", "room throttle: 10 s");
  await sql`delete from throttles where key = ${"ans:" + ch}`;     // 10 s later
  assert.equal(await ask("Shipping ?"), "passed", "same question within 60 s");
  assert.equal(await ask("COD hai?"), "answered", "a different question after 10 s");
  assert.equal(said.length, 2);
});

test("pre-message callback: rules only, block with the PRD copy, pass on any doubt", async () => {
  const pm = (userId: string, text: string, secret?: string) => {
    const b = msgBody(ch, userId, text);
    return signed({ type: "open_channel:pre_messaging", data: [{ appKey: creds.appKey, ...b.data[0] }] }, Date.now(), secret);
  };
  const jobs: (() => Promise<unknown>)[] = [];
  const t0 = Date.now();
  assert.deepEqual(await handlePreMessage(pm(judge(), "call me 9876543210"), { creds, defer: (j) => jobs.push(j) }), { pass: 0, extra: BLOCKED_TEXT });
  assert.ok(Date.now() - t0 < 300);
  await Promise.all(jobs.map((j) => j()));
  assert.ok((await sql`select 1 from moderation_events where drop_id = ${s.dropId} and rule = 'phone'`).length);
  assert.deepEqual(await handlePreMessage(pm(judge(), "M size hai?"), { creds }), { pass: 1 });
  assert.deepEqual(await handlePreMessage(pm("s_" + s.ownerId, "pay to demo@upi"), { creds }), { pass: 1 });
  assert.deepEqual(await handlePreMessage(pm(judge(), "rahul@okaxis", "wrong"), { creds }), { pass: 1 });
  assert.deepEqual(await handlePreMessage(new Request("http://x", { method: "POST", body: "{" }), { creds }), { pass: 1 });
});

const clearThrottles = () => sql`delete from throttles where key like ${"%" + ch + "%"} or key like ${"%" + s.dropId + "%"}`;

test("demo bots: one assistant answer and one prompt per piece; humans still answered", async () => {
  await clearThrottles();
  said.length = 0;
  const bot = (n: string) => ({ channelId: ch, fromUserId: n, messageId: id() });
  const fromBot = async (uid: string, text: string) => {
    await sql`delete from throttles where key = ${"ans:" + ch}`;              // pretend 10 s passed between lines
    return handleRoomText({ ...bot(uid), text }, fakes);
  };
  assert.equal(await fromBot("demo_bot_05", "price?"), "answered");
  assert.equal(await fromBot("demo_bot_06", "COD hai?"), "passed", "second bot question on the same piece");
  assert.equal(await fromBot("demo_bot_07", "booked! silver"), "prompted");
  assert.equal(await fromBot("demo_bot_08", "mine silver"), "passed", "second bot prompt on the same piece");
  await sql`delete from throttles where key = ${"ans:" + ch}`;
  assert.equal(await handleRoomText({ channelId: ch, fromUserId: judge(), messageId: id(), text: "returns kab tak?" }, fakes), "answered", "a human question");
  assert.equal(said.length, 2);
});

test("the assistant never answers a message sent to review, and skips an answer once the piece changed", async () => {
  await clearThrottles();
  calls = [];
  assert.equal(await handleRoomText({ channelId: ch, fromUserId: judge(), messageId: id(), text: "dm me, what price?" }, fakes), "passed");
  assert.ok(!calls.includes("answer"));
  const moving: TextDeps = { ...fakes, answerQuestion: async () => { await sql`select drop_next(${s.dropId}, ${s.ownerId})`; return "It is ₹1,450."; } };
  said.length = 0;
  assert.equal(await handleRoomText({ channelId: ch, fromUserId: judge(), messageId: id(), text: "kitne ka hai?" }, moving), "passed");
  assert.equal(said.length, 0);
});

test("order room: each buyer message counts once for the seller inbox (text kept, photo without); nobody else counts", async () => {
  const [live] = await sql`select st.drop_item_id as item, pv.key from drops d join item_stock st on st.drop_item_id = d.live_item_id
                             join product_variants pv on pv.id = st.variant_id where d.id = ${s.dropId} and st.available > 0 limit 1`;
  assert.ok(live, "a piece is live with stock left");
  const won = await fn<{ result: string; orderId: string }>("claim_dibs", live.item, live.key, s.buyerId, new Date());
  assert.equal(won.result, "won");
  const [{ g }] = await sql`select nexconn_group_id as g from orders where id = ${won.orderId}`;
  const groupBody = (userId: string, messageType: string, content: object, messageId = id()) => ({
    type: "message:send", id: "e1", time: Date.now(),
    data: [{ userId, channelId: g, channelType: 3, messageType, content: JSON.stringify(content), time: Date.now(), messageId, os: "Websocket" }],
  });
  // parsing: group text and media; never read receipts, open-channel text, or other events
  assert.deepEqual(orderMsgs(groupBody(judge(), "RC:TxtMsg", { content: "hi" }, "x1")), [{ channelId: g, fromUserId: judge(), messageId: "x1", text: "hi" }]);
  assert.equal(orderMsgs(groupBody(judge(), "RC:ImgMsg", { imageUri: "https://x.test/p.jpg" }))[0].text, null);
  assert.deepEqual(orderMsgs(groupBody(judge(), "RC:RRRspMsg", {})), []);
  assert.deepEqual(orderMsgs(msgBody(ch, judge(), "hello")), []);
  assert.deepEqual(orderMsgs({ ...groupBody(judge(), "RC:TxtMsg", { content: "hi" }), type: "message:delete" }), []);
  assert.deepEqual(roomTexts(groupBody(judge(), "RC:TxtMsg", { content: "hi" })), [], "the sale-room path still skips groups");

  // through the signed webhook, run in defer like the route's after()
  const jobs: (() => Promise<unknown>)[] = [];
  const mid = id();
  const res = await handleWebhook(signed(groupBody(judge(), "RC:TxtMsg", { content: "  when will I get it?  " }, mid)), { creds, deps: fakes, defer: (j) => jobs.push(j) });
  assert.equal(res.status, 200);
  await Promise.all(jobs.map((j) => j()));
  const row = async () => (await sql`select buyer_unread, buyer_last_text, buyer_msg_at from orders where id = ${won.orderId}`)[0];
  const r1 = await row();
  assert.deepEqual([r1.buyer_unread, r1.buyer_last_text], [1, "when will I get it?"]);
  assert.ok(r1.buyer_msg_at);
  assert.equal(await handleOrderMsg({ channelId: g, fromUserId: judge(), messageId: mid, text: "when will I get it?" }), "duplicate");
  assert.equal(await handleOrderMsg({ channelId: g, fromUserId: judge(), messageId: id(), text: "x".repeat(300) }), "counted");
  assert.equal((await row()).buyer_last_text, "x".repeat(140));
  assert.equal(await handleOrderMsg({ channelId: g, fromUserId: judge(), messageId: id(), text: null }), "counted");
  // the shop's team, the bot, another buyer, another channel: not counted
  for (const [from, channel] of [["s_" + s.ownerId, g], ["dibs_bot", g], ["b_00000000-0000-4000-8000-000000000000", g], [judge(), "ord_nowhere"]]) {
    assert.equal(await handleOrderMsg({ channelId: channel, fromUserId: from, messageId: id(), text: "hello" }), "ignored", from);
  }
  const r2 = await row();
  assert.deepEqual([r2.buyer_unread, r2.buyer_last_text], [3, null]);
});
