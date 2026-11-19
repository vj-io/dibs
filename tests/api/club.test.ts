// Shop club API over real HTTP against a mock-mode server with DIBS_TEST_LOGIN=1 (the club is always on in mock mode).
// Run: API_BASE=http://localhost:3100 node --env-file=.env.local --test tests/api/club.test.ts
// Shops and buyers made here are deleted at the end (club rows cascade); their communities are dismissed if one was made.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import postgres from "postgres";

const BASE = process.env.API_BASE ?? "http://localhost:3100";
const admin = postgres(process.env.DATABASE_URL_SESSION!, { ssl: "require", max: 2, onnotice: () => {} });
const shops: string[] = [], buyers: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON in tests
type J = Record<string, any>;
class Client {
  jar = new Map<string, string>();
  async call(method: string, path: string, body?: unknown) {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(this.jar.size ? { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const kv = c.split(";")[0], i = kv.indexOf("=");
      this.jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
    }
    const text = await res.text();
    let parsed: J = {};
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: parsed, text };
  }
  get = (p: string) => this.call("GET", p);
  post = (p: string, b?: unknown) => this.call("POST", p, b ?? {});
}
const tag = () => randomUUID().slice(0, 8);
const ok = (r: { status: number; text: string }, status = 200) => assert.equal(r.status, status, r.text);

async function seller() {
  const c = new Client();
  ok(await c.post("/api/seller/session", { testEmail: `t-${tag()}@dibs.test` }));
  const slug = `t-${tag()}`;
  const shop = await c.post("/api/shops", { name: "Club Test Shop", slug, upiId: "test@upi", payeeName: "Test", holdMinutes: 10 });
  ok(shop);
  shops.push(shop.body.shopId);
  return { c, slug, shopId: shop.body.shopId as string };
}
async function buyer(slug: string, name = "Priya Sharma") {
  const c = new Client();
  const r = await c.post("/api/buyer/join", { name, phone: `9${randomInt(1e8, 1e9)}`, shopSlug: slug });
  ok(r);
  buyers.push(r.body.buyerId);
  return { c, id: r.body.buyerId as string };
}

before(async () => {
  const r = await fetch(BASE + "/api/config").catch(() => null);
  assert.ok(r?.ok, `server not reachable at ${BASE}`);
  assert.equal((await r!.json()).mode, "mock", "run the server with REALTIME_MODE=mock");
});
after(async () => {
  if (shops.length) {
    await admin`delete from outbox where channel_id in (select nexconn_club_id from shops where id in ${admin(shops)})`;
    await admin`delete from shops where id in ${admin(shops)}`;
  }
  if (buyers.length) await admin`delete from buyers where id in ${admin(buyers)}`;
  await admin.end({ timeout: 5 });
});

test("shop club: join, chat, announce, review, moderation and permissions", async () => {
  const A = await seller(), B = await seller();
  const anon = new Client();

  // public summary before anyone joins: read-only, no club yet
  const s0 = await anon.get(`/api/club/${A.slug}`);
  ok(s0);
  assert.equal(s0.body.memberCount, 0);
  assert.equal(s0.body.me, null);
  assert.equal(s0.body.clubId, null);
  ok(await anon.get("/api/club/no-such-shop"), 404);
  ok(await anon.post("/api/club/join", { shopSlug: A.slug }), 401);

  // join: the club is created once (SYS:EnsureClub ahead of the join row) and the member is added
  const b1 = await buyer(A.slug, "Priya Sharma"), b2 = await buyer(A.slug, "Rohan Singh");
  const j = await b1.c.post("/api/club/join", { shopSlug: A.slug });
  ok(j);
  assert.equal(j.body.memberCount, 1);
  ok(await b1.c.post("/api/club/join", { shopSlug: A.slug })); // again: no-op
  const s1 = await b1.c.get(`/api/club/${A.slug}`);
  assert.match(s1.body.clubId, /^club_[0-9a-f]{20}$/);
  assert.equal(s1.body.me.member, true);
  const rows = await admin`select msg_type, status from outbox where channel_id = ${s1.body.clubId} order by id`;
  assert.deepEqual(rows.map((r) => r.msg_type), ["SYS:EnsureClub", "SYS:JoinClub"]);
  assert.ok(rows.every((r) => r.status === "sent"), JSON.stringify(rows));

  // chat: members only, scam shield, record kept
  ok(await b2.c.post("/api/club/send", { shopSlug: A.slug, text: "hello" }), 403);
  const sent = await b1.c.post("/api/club/send", { shopSlug: A.slug, text: "Love the last drop!" });
  ok(sent);
  assert.equal(sent.body.message.channel, `${s1.body.clubId}.chat`);
  const burst = await Promise.all([1, 2].map(() => b1.c.post("/api/club/send", { shopSlug: A.slug, text: "too fast" })));
  assert.ok(burst.some((r) => r.status === 429), "one line every 2 s"); // (one of the two may still pass: throttle window)
  await new Promise((r) => setTimeout(r, 2100));
  const blocked = await b1.c.post("/api/club/send", { shopSlug: A.slug, text: "call me on 9876543210 for a better price" });
  ok(blocked, 422);
  assert.equal(blocked.body.error, "blocked");
  const mod = await admin`select rule, action from moderation_events where shop_id = ${A.shopId} and buyer_id = ${b1.id}`;
  assert.deepEqual(mod.map((m) => [m.rule, m.action]), [["club_chat:phone", "blocked"]]);
  assert.equal((await b2.c.get(`/api/club/${A.slug}`)).body.chat.length, 0, "non-members get no chat lines");
  assert.ok((await b1.c.get(`/api/club/${A.slug}`)).body.chat.some((c: J) => c.text === "Love the last drop!"));

  // announce: staff only, own shop; buyers refused
  ok(await b1.c.post("/api/club/announce", { text: "I'm not staff" }), 401);
  ok(await A.c.post("/api/club/announce", { text: "New jhumkas Saturday 7 pm" }));
  ok(await A.c.post("/api/club/announce", { text: "x", dropCode: "ZZZZZZ" }), 404);

  // auto post for a scheduled drop, once
  const p = await A.c.post("/api/products", { title: "Silver jhumka", pricePaise: 145000, photos: ["/demo/jhumka.jpg"], variants: [{ key: "one", label: "One size", qty: 2 }] });
  ok(p);
  const d = await A.c.post("/api/drops", { title: "Saturday drop", startsAt: new Date(Date.now() + 3600_000).toISOString(), productIds: [p.body.product.id] });
  ok(d);
  const s2 = await anon.get(`/api/club/${A.slug}`); // page load posts it when the drop routes did not
  assert.equal(s2.body.nextDrop.code, d.body.code);
  await anon.get(`/api/club/${A.slug}`);
  const ann = (await anon.get(`/api/club/${A.slug}`)).body.announcements;
  assert.deepEqual(ann.map((a: J) => a.text.slice(0, 12)), ["New jhumkas ", "📣 New drop:"]);
  assert.equal(ann[1].drop.code, d.body.code);

  // review: only with a paid order of this buyer in this shop, once
  ok(await A.c.post(`/api/drops/${d.body.dropId}/live`));
  assert.equal((await anon.get(`/api/club/${A.slug}`)).body.nextDrop.status, "live"); // and posts "is live now"
  const st = await anon.get(`/api/drops/${d.body.dropId}/state`);
  const item = st.body.items[0].itemId;
  ok(await A.c.post(`/api/drops/${d.body.dropId}/next`));
  const claim = await b1.c.post("/api/claims", { itemId: item, variantKey: "one" });
  assert.equal(claim.body.result, "won", claim.text);
  const orderId = claim.body.orderId;
  ok(await b1.c.post("/api/club/review", { orderId, stars: 5, text: "Great" }), 403); // held, not paid
  ok(await b1.c.post(`/api/orders/${orderId}/paid-claim`, { utr: "123456789012" }));
  ok(await A.c.post(`/api/orders/${orderId}/confirm`, { received: true }));
  ok(await b2.c.post("/api/club/review", { orderId, stars: 5, text: "Not my order" }), 404);
  ok(await b1.c.post("/api/club/review", { orderId, stars: 6, text: "" }), 400);
  ok(await b1.c.post("/api/club/review", { orderId, stars: 4, text: "pay me at priya@okaxis instead" }), 422);
  const rv = await b1.c.post("/api/club/review", { orderId, stars: 4, text: "Lovely finish, arrived in 3 days." });
  ok(rv);
  assert.equal(rv.body.review.name, "Priya S.");
  ok(await b1.c.post("/api/club/review", { orderId, stars: 5, text: "again" }), 409);
  assert.equal((await anon.get(`/api/club/${A.slug}`)).body.reviews.length, 1);
  const sub = await admin`select payload->>'sub' as sub, payload->>'text' as text from outbox where channel_id = ${s1.body.clubId} and msg_type = 'SYS:ClubSend' order by id`;
  assert.deepEqual(sub.map((r) => r.sub), ["drops", "drops", "drops", "reviews"]); // staff post, scheduled, live, review
  assert.match(sub[3].text, /^★★★★☆ Priya S\.: Lovely/);

  // staff of another shop: refused; own staff: hide (logged) and remove
  ok(await B.c.post("/api/club/hide", { reviewId: rv.body.review.id, reason: "spam spam" }), 404);
  ok(await B.c.post("/api/club/remove", { buyerId: b1.id }), 404);
  ok(await b1.c.post("/api/club/hide", { reviewId: rv.body.review.id, reason: "spam spam" }), 401);
  ok(await A.c.post("/api/club/hide", { reviewId: rv.body.review.id, reason: "Not about this order" }));
  assert.equal((await anon.get(`/api/club/${A.slug}`)).body.reviews.length, 0);
  const m = await A.c.get("/api/club/manage");
  ok(m);
  assert.equal(m.body.reviews[0].hiddenReason, "Not about this order");
  assert.equal(m.body.memberCount, 1);
  assert.ok(m.body.chat.some((c: J) => c.text === "Love the last drop!"));
  ok(await A.c.post("/api/club/remove", { buyerId: b1.id }));
  assert.equal((await anon.get(`/api/club/${A.slug}`)).body.memberCount, 0);
  const log = await admin`select action from moderation_events where shop_id = ${A.shopId} order by id`;
  assert.deepEqual(log.map((l) => l.action), ["blocked", "blocked", "hidden", "removed"]);

  // banned buyer cannot join
  ok(await A.c.post(`/api/drops/${d.body.dropId}/moderate`, { buyerId: b2.id, action: "ban", reason: "spam" }));
  const nb = await b2.c.post("/api/club/join", { shopSlug: A.slug });
  ok(nb, 403);
  assert.equal(nb.body.error, "banned");

  // a member the seller removed cannot join again
  const back = await b1.c.post("/api/club/join", { shopSlug: A.slug });
  ok(back, 403);
  assert.equal(back.body.error, "removed");
  assert.equal((await b1.c.get(`/api/club/${A.slug}`)).body.me.banned, true);
  assert.equal((await anon.get(`/api/club/${A.slug}`)).body.memberCount, 0);

  // leave
  const b3 = await buyer(A.slug, "Kiran Rao");
  ok(await b3.c.post("/api/club/join", { shopSlug: A.slug }));
  const lv = await b3.c.post("/api/club/leave", { shopSlug: A.slug });
  ok(lv);
  assert.equal(lv.body.memberCount, 0);
  ok(await b3.c.post("/api/club/send", { shopSlug: A.slug, text: "still here?" }), 403);

  // join and leave: 6 a minute per buyer each
  for (let i = 0; i < 5; i++) ok(await b3.c.post("/api/club/join", { shopSlug: A.slug }));
  ok(await b3.c.post("/api/club/join", { shopSlug: A.slug }), 429);
  for (let i = 0; i < 5; i++) ok(await b3.c.post("/api/club/leave", { shopSlug: A.slug }));
  ok(await b3.c.post("/api/club/leave", { shopSlug: A.slug }), 429);
});

test("demo shop: staff cannot post, remove or hide in its public club; the manage screen still loads and says it is a demo", async () => {
  const A = await seller();
  const b = await buyer(A.slug);
  ok(await b.c.post("/api/club/join", { shopSlug: A.slug }));
  await admin`update shops set is_sandbox = true where id = ${A.shopId}`; // what a judge-mode demo shop is
  try {
    for (const [path, body] of [["announce", { text: "pay to scam@upi" }], ["remove", { buyerId: b.id }], ["hide", { reviewId: "1", reason: "because" }]] as const) {
      const r = await A.c.post(`/api/club/${path}`, body);
      ok(r, 403);
      assert.equal(r.body.error, "demo_read_only");
    }
    const m = await A.c.get("/api/club/manage");
    ok(m);
    assert.equal(m.body.isSandbox, true);
    assert.equal(m.body.memberCount, 1, "the member is still there");
    assert.equal((await new Client().get(`/api/club/${A.slug}`)).body.announcements.length, 0, "nothing reached the public page");
  } finally {
    await admin`update shops set is_sandbox = false where id = ${A.shopId}`;
  }
});

test("webhook: club texts are picked out of message:send with their subchannel; room texts are not", async () => {
  const { clubTexts, roomTexts } = await import("../../src/lib/server/webhook.ts");
  const body = { type: "message:send", data: [
    { channelType: "COMMUNITY", channelId: "club_abc", subchannelId: "chat", userId: "b_x", messageId: "m1", messageType: "RC:TxtMsg", content: JSON.stringify({ content: "call 9876543210" }), time: 5 },
    { channelType: 10, channelId: "club_abc", subchannelId: "drops", userId: "b_y", messageId: "m2", messageType: "RC:TxtMsg", content: JSON.stringify({ content: "hi" }) },
    { channelType: 4, channelId: "dr_ABCDEF", userId: "b_z", messageId: "m3", messageType: "RC:TxtMsg", content: JSON.stringify({ content: "room" }) },
    { channelType: 10, channelId: "club_abc", userId: "b_y", messageId: "m4", messageType: "RC:TxtMsg", content: JSON.stringify({ content: "no sub" }) },
  ] };
  assert.deepEqual(clubTexts(body).map((t) => [t.messageId, t.sub, t.text, t.sentAt]), [["m1", "chat", "call 9876543210", 5], ["m2", "drops", "hi", undefined]]);
  assert.deepEqual(roomTexts(body).map((t) => t.messageId), ["m3"]);
});
