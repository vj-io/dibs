// API tests over real HTTP against a running server started with REALTIME_MODE=mock DIBS_TEST_LOGIN=1.
// Run: API_BASE=http://localhost:3103 node --env-file=.env.local --test tests/api/*.test.ts
// Every shop is a normal shop (unique slug; demo shops are read-only and unjoinable) and is deleted at the end, with its buyers.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomInt, randomUUID } from "node:crypto";
import postgres from "postgres";

const BASE = process.env.API_BASE ?? "http://localhost:3103";
const admin = postgres(process.env.DATABASE_URL_SESSION!, { ssl: "require", max: 2, onnotice: () => {} });
const shops: string[] = [], buyers: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON in tests
type J = Record<string, any>;

class Client {
  jar = new Map<string, string>();
  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: J; text: string }> {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...headers,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(this.jar.size ? { Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(";");
      const i = kv.indexOf("=");
      const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
      const gone = !v || attrs.some((a) => /max-age=0\b/i.test(a.trim()) || (/^expires=/i.test(a.trim()) && Date.parse(a.trim().slice(8)) < Date.now()));
      if (gone) this.jar.delete(k); else this.jar.set(k, v);
    }
    const text = await res.text();
    let parsed: J = {};
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: parsed, text };
  }
  get = (p: string) => this.call("GET", p);
  post = (p: string, b?: unknown) => this.call("POST", p, b ?? {});
  patch = (p: string, b: unknown) => this.call("PATCH", p, b);
  del = (p: string) => this.call("DELETE", p);
}

const tag = () => randomUUID().slice(0, 8);
const phone = () => `9${randomInt(1e8, 1e9)}`;
const ok = (r: { status: number; text: string }, status = 200) => assert.equal(r.status, status, r.text);

async function seller(): Promise<{ c: Client; shopId: string; slug: string; staffId: string; email: string }> {
  const c = new Client();
  const email = `t-${tag()}@dibs.test`;
  const s = await c.post("/api/seller/session", { testEmail: email });
  ok(s);
  assert.equal(s.body.needsShop, true);
  const slug = `t-${tag()}`;
  const shop = await c.post("/api/shops", { name: "Test Shop", slug, upiId: "test@upi", payeeName: "Test & Sons", holdMinutes: 10, faq: ["Ships in 3 days"] });
  ok(shop);
  shops.push(shop.body.shopId);
  return { c, shopId: shop.body.shopId, slug, staffId: shop.body.staffId, email };
}

async function buyer(slug: string, name = "Priya Sharma") {
  const c = new Client();
  const p = phone();
  const r = await c.post("/api/buyer/join", { name, phone: p, shopSlug: slug });
  ok(r);
  buyers.push(r.body.buyerId);
  return { c, id: r.body.buyerId as string, phone: p };
}

async function product(c: Client, qty = 1, title = "Silver jhumka") {
  const r = await c.post("/api/products", { title, pricePaise: 145000, photos: ["/demo/jhumka.jpg"], variants: [{ key: "one", label: "One size", qty }] });
  ok(r);
  return r.body.product.id as string;
}

before(async () => {
  const r = await fetch(BASE + "/api/config").catch(() => null);
  assert.ok(r?.ok, `server not reachable at ${BASE}`);
  assert.equal((await r!.json()).mode, "mock", "run the server with REALTIME_MODE=mock");
});

after(async () => {
  if (shops.length) await admin`delete from shops where id in ${admin(shops)}`;
  if (buyers.length) await admin`delete from buyers where id in ${admin(buyers)}`;
  await admin.end({ timeout: 5 });
});

describe("Dibs API", () => {
  let A: Awaited<ReturnType<typeof seller>>, B: Awaited<ReturnType<typeof seller>>;
  let dropId = "", itemIds: string[] = [], orderId = "", b1: Awaited<ReturnType<typeof buyer>>, b2: Awaited<ReturnType<typeof buyer>>;

  test("full loop: shop, product, drop, live, claim race, release, promotion, pay, confirm, ship", async () => {
    A = await seller();
    const me = await A.c.get("/api/seller/me");
    ok(me);
    assert.equal(me.body.me.role, "owner");
    assert.match(me.body.me.shop.deskGroupId, /^desk_[0-9a-f]{20}$/);
    const desk = await admin`select 1 from outbox where channel_id = ${me.body.me.shop.deskGroupId} and msg_type = 'SYS:EnsureGroup'`;
    assert.equal(desk.length, 1, "team desk group queued once");

    const p1 = await product(A.c), p2 = await product(A.c, 1, "Gold ring");
    const d = await A.c.post("/api/drops", { title: "Friday drop", startsAt: new Date().toISOString(), productIds: [p1, p2] });
    ok(d);
    dropId = d.body.dropId;
    assert.match(d.body.code, /^[A-Z0-9]{6}$/);
    assert.ok(d.body.shareUrl.endsWith(`/s/${A.slug}/d/${d.body.code}`));
    const room = await admin`select msg_type from outbox where drop_id = ${dropId} order by id`;
    assert.equal(room[0].msg_type, "SYS:EnsureRoom", "room is created before its first card");

    const pub = await new Client().get(`/api/drops/by-code/${A.slug}/${d.body.code.toLowerCase()}`);
    ok(pub);
    assert.equal(pub.body.dropId, dropId);
    assert.equal(pub.body.state.status, "scheduled");

    b1 = await buyer(A.slug, "Priya Sharma");
    b2 = await buyer(A.slug, "Rohan Singh");
    const early = await b1.c.post("/api/claims", { itemId: pub.body.state.items[0].itemId, variantKey: "one" });
    ok(early);
    assert.equal(early.body.result, "not_live");
    assert.equal(early.body.message, "Not live yet");

    ok(await A.c.post(`/api/drops/${dropId}/live`));
    const next = await A.c.post(`/api/drops/${dropId}/next`);
    ok(next);
    itemIds = pub.body.state.items.map((i: J) => i.itemId);
    assert.equal(next.body.liveItemId, itemIds[0]);

    const [r1, r2] = await Promise.all([
      b1.c.post("/api/claims", { itemId: itemIds[0], variantKey: "one" }),
      b2.c.post("/api/claims", { itemId: itemIds[0], variantKey: "one" }),
    ]);
    ok(r1); ok(r2);
    const results = [r1.body.result, r2.body.result].sort();
    assert.deepEqual(results, ["waitlisted", "won"], "one unit: exactly one winner");
    const [winner, loser] = r1.body.result === "won" ? [b1, b2] : [b2, b1];
    const won = r1.body.result === "won" ? r1.body : r2.body, lost = r1.body.result === "won" ? r2.body : r1.body;
    assert.equal(won.message, "You got it! Pay within 10:00");
    assert.equal(lost.position, 1);
    assert.equal(lost.message, "You're #1 on the waitlist. We'll tell you the moment it's yours.");
    // keep b1 = winner, b2 = loser for the rest
    b1 = winner; b2 = loser;

    const again = await b1.c.post("/api/claims", { itemId: itemIds[0], variantKey: "one" });
    assert.equal(again.body.result, "already");

    const mine = await b1.c.get(`/api/drops/${dropId}/me`);
    ok(mine);
    assert.equal(mine.body.holds.length, 1);
    const st = await b2.c.get(`/api/drops/${dropId}/me`);
    assert.equal(st.body.waits[0].waitPosition, 1);

    // b2 cannot read or release b1's order / claim
    ok(await b2.c.get(`/api/orders/${won.orderId}`), 403);
    ok(await b2.c.post(`/api/claims/${won.claimId}/release`), 403);

    ok(await b1.c.post(`/api/claims/${won.claimId}/release`));
    const promoted = await b2.c.get(`/api/drops/${dropId}/me`);
    assert.equal(promoted.body.holds.length, 1, "waitlisted buyer promoted on release");
    assert.equal(promoted.body.waits.length, 0);
    orderId = promoted.body.holds[0].orderId;

    const view = await b2.c.get(`/api/orders/${orderId}`);
    ok(view);
    assert.equal(view.body.viewer, "buyer");
    assert.equal(view.body.state, "held");
    assert.ok(view.body.expiresAt);
    assert.match(view.body.payment.upiLink, /^upi:\/\/pay\?pa=test%40upi&pn=Test%20%26%20Sons&am=1450\.00&cu=INR&tn=Dibs%20order%20\d+$/);
    assert.equal("phone" in view.body.buyer, false, "buyer view has no phone");
    assert.ok(view.body.history.some((h: J) => h.type === "hold_promoted"));

    ok(await b2.c.post(`/api/orders/${orderId}/paid-claim`, { utr: "123456789012" }));
    const hb = await b2.c.post(`/api/orders/${orderId}/heartbeat`);
    ok(hb);
    assert.deepEqual(hb.body, { state: "payment_claimed", expiresAt: null });
    ok(await b2.c.post(`/api/orders/${orderId}/confirm`, { received: true }), 403); // the order's buyer is not staff
    ok(await A.c.post(`/api/orders/${orderId}/ship`, {}), 409); // not paid yet
    ok(await A.c.post(`/api/orders/${orderId}/confirm`, { received: true }));
    ok(await A.c.post(`/api/orders/${orderId}/ship`, { trackingNote: "DTDC 123" }));

    const sv = await A.c.get(`/api/orders/${orderId}`);
    ok(sv);
    assert.equal(sv.body.viewer, "staff");
    assert.equal(sv.body.state, "shipped");
    assert.equal(sv.body.buyer.phone, b2.phone, "staff see the phone");
    assert.equal(sv.body.trackingNote, "DTDC 123");
    const joined = await admin`select 1 from outbox where channel_id = ${sv.body.nexconnGroupId} and msg_type = 'SYS:EnsureGroup' and payload->'memberIds' ? ${"s_" + A.staffId}`;
    assert.ok(joined.length >= 1, "staff is in the order room");
    // membership is in place by the time GET /api/orders/:id answers: group history right after must not be refused
    ok(await A.c.get(`/api/mock/send?history=${sv.body.nexconnGroupId}&as=staff`));

    const deskRes = await A.c.get("/api/desk?assigned=all");
    ok(deskRes);
    assert.ok(deskRes.body.orders.shipped.some((o: J) => o.orderId === orderId));
    assert.ok(deskRes.body.orders.cancelled.some((o: J) => o.orderId === won.orderId));

    const beat = await A.c.post(`/api/drops/${dropId}/heartbeat`);
    ok(beat);
    assert.ok(beat.body.console.ledger.length >= 2);
    assert.equal(beat.body.viewers, null);
    const dash = await A.c.get(`/api/drops/${dropId}/dashboard`);
    ok(dash);
    assert.equal(dash.body.paidOrders, 1);
    assert.equal(dash.body.waitlistSaves, 1);
  });

  test("expiry: a forced-expired hold promotes the next buyer through the sweep", async () => {
    ok(await A.c.post(`/api/drops/${dropId}/next`));
    const b3 = await buyer(A.slug, "Asha K"), b4 = await buyer(A.slug, "Meera R");
    const w = await b3.c.post("/api/claims", { itemId: itemIds[1], variantKey: "one" });
    assert.equal(w.body.result, "won");
    assert.equal((await b4.c.post("/api/claims", { itemId: itemIds[1], variantKey: "one" })).body.result, "waitlisted");
    await admin`update claims set expires_at = now() - interval '1 second' where id = ${w.body.claimId}`;
    ok(await new Client().get(`/api/drops/${dropId}/state`)); // public read runs the sweep
    const m = await b4.c.get(`/api/drops/${dropId}/me`);
    assert.equal(m.body.holds.length, 1);
    assert.equal(m.body.holds[0].state, "held");
  });

  test("phone numbers never appear in public responses or sale-room cards", async () => {
    const pub = new Client();
    const texts = [
      (await pub.get(`/api/drops/${dropId}/state`)).text,
      (await pub.get(`/api/drops/by-code/${A.slug}/${(await admin`select code from drops where id = ${dropId}`)[0].code}`)).text,
      (await b2.c.get(`/api/drops/${dropId}/me`)).text,
      (await b2.c.get(`/api/orders/${orderId}`)).text,
    ];
    const phones = (await admin`select phone from buyers where id in ${admin(buyers)} and phone is not null`).map((r) => r.phone as string);
    assert.ok(phones.length >= 2);
    for (const t of texts) for (const p of phones) assert.ok(!t.includes(p), "phone leaked");
    const room = await admin`select payload::text as p from outbox where drop_id = ${dropId} and channel_type in ('room', 'user')`;
    for (const r of room) for (const p of phones) assert.ok(!r.p.includes(p), "phone in a sale-room card");
  });

  test("permission walls: unauthenticated", async () => {
    const anon = new Client();
    const fake = randomUUID();
    for (const [m, p] of [
      ["GET", "/api/products"], ["POST", "/api/products"], ["GET", "/api/drops"], ["POST", `/api/drops/${dropId}/live`],
      ["POST", `/api/drops/${dropId}/heartbeat`], ["GET", `/api/drops/${dropId}/dashboard`], ["POST", `/api/drops/${dropId}/moderate`],
      ["GET", `/api/drops/${dropId}/me`], ["POST", "/api/claims"], ["GET", `/api/orders/${orderId}`], ["POST", `/api/orders/${orderId}/paid-claim`],
      ["GET", "/api/desk"], ["GET", "/api/health"], ["GET", "/api/me"], ["DELETE", "/api/me"], ["GET", `/api/shops/${A.shopId}`],
      ["POST", `/api/claims/${fake}/release`], ["POST", "/api/shops"], ["POST", "/api/products/upload-url"],
    ] as const) {
      const r = await anon.call(m, p, m === "GET" || m === "DELETE" ? undefined : { itemId: fake, variantKey: "one", name: "x", slug: "abc", contentType: "image/png" });
      assert.equal(r.status, 401, `${m} ${p} -> ${r.status} ${r.text}`);
    }
    ok(await anon.get("/api/cron/sweep"), 401);
    ok(await anon.call("GET", "/api/cron/sweep", undefined, { Authorization: `Bearer ${process.env.CRON_SECRET}` }));
    ok(await anon.get("/api/impact"));
    assert.deepEqual((await anon.get("/api/buyer/me")).body, { buyer: null });
  });

  test("permission walls: buyer on staff routes, staff of another shop, non-owner staff", async () => {
    // buyer cookie only: every staff route refuses
    for (const p of [`/api/drops/${dropId}/next`, `/api/drops/${dropId}/end`]) ok(await b2.c.post(p), 401);
    for (const p of [`/api/orders/${orderId}/ship`, `/api/orders/${orderId}/cancel`, `/api/orders/${orderId}/assign`]) {
      ok(await b2.c.post(p, { reason: "x", staffId: A.staffId }), 403); // own order, but not staff
    }
    ok(await b1.c.post(`/api/orders/${orderId}/ship`, {}), 403); // another buyer's order
    ok(await b2.c.get("/api/desk"), 401);
    ok(await b2.c.post(`/api/drops/${dropId}/moderate`, { buyerId: b1.id, action: "ban" }), 401);

    B = await seller();
    ok(await B.c.post(`/api/drops/${dropId}/live`), 403);
    ok(await B.c.post(`/api/drops/${dropId}/next`), 403);
    ok(await B.c.post(`/api/drops/${dropId}/end`), 403);
    ok(await B.c.post(`/api/drops/${dropId}/items/${itemIds[0]}/close`), 403);
    ok(await B.c.post(`/api/drops/${dropId}/items/${itemIds[0]}/reopen`), 403);
    ok(await B.c.post(`/api/drops/${dropId}/heartbeat`), 403);
    ok(await B.c.get(`/api/drops/${dropId}/dashboard`), 403);
    ok(await B.c.post(`/api/drops/${dropId}/moderate`, { buyerId: b1.id, action: "ban" }), 403);
    ok(await B.c.get(`/api/orders/${orderId}`), 403);
    ok(await B.c.post(`/api/orders/${orderId}/confirm`, { received: false }), 403);
    ok(await B.c.post(`/api/orders/${orderId}/assign`, { staffId: B.staffId }), 403);
    ok(await B.c.get(`/api/shops/${A.shopId}`), 403);
    ok(await B.c.patch(`/api/shops/${A.shopId}`, { name: "Hijacked" }), 403);
    ok(await B.c.post(`/api/shops/${A.shopId}/staff`, { email: "x@y.test", name: "X" }), 403);
    const aProducts = (await A.c.get("/api/products")).body.products as J[];
    ok(await B.c.patch(`/api/products/${aProducts[0].id}`, { title: "Mine now" }), 404);
    ok(await B.c.del(`/api/products/${aProducts[0].id}`), 404);
    ok(await B.c.post("/api/drops", { title: "x", startsAt: new Date().toISOString(), productIds: [aProducts[0].id] }), 400);
    assert.equal((await B.c.get("/api/desk")).body.orders.shipped.length, 0, "desk shows only own shop");

    // invited staff: can read the shop, cannot change settings; removal ends the session. A test sign-in never
    // activates an invite (it proves nothing about the email), so the activation a real email code does is done here.
    const email = `t-${tag()}@dibs.test`;
    const inv = await A.c.post(`/api/shops/${A.shopId}/staff`, { email, name: "Asha" });
    ok(inv);
    assert.equal(inv.body.member.status, "pending");
    const sc = new Client();
    const early = await sc.post("/api/seller/session", { testEmail: email });
    assert.equal(early.body.needsShop, true, "test login does not take over a pending invite");
    const h = createHash("sha256").update("dibs-test:" + email).digest("hex");
    const uid = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
    await admin`update staff set id = ${uid}, active = true, nexconn_user_id = ${"s_" + uid} where id = ${inv.body.member.staffId}`;
    const s = await sc.post("/api/seller/session", { testEmail: email });
    ok(s);
    assert.equal(s.body.needsShop, false);
    assert.equal(s.body.me.role, "staff");
    ok(await sc.get(`/api/shops/${A.shopId}`));
    ok(await sc.patch(`/api/shops/${A.shopId}`, { name: "Staff rename" }), 403);
    ok(await sc.post(`/api/orders/${orderId}/assign`, { staffId: s.body.me.staffId }));
    ok(await A.c.del(`/api/shops/${A.shopId}/staff/${s.body.me.staffId}`));
    ok(await sc.get("/api/products"), 401);
  });

  test("seller inbox: a buyer's order-room message is listed for the shop's team until one of them opens the order", async () => {
    const g = (await b2.c.get(`/api/orders/${orderId}`)).body.nexconnGroupId as string;
    ok(await b2.c.post("/api/mock/send", { target: { type: "group", id: g }, text: "  when will I get it?  ", as: "buyer" }));
    let items: J[] = [];
    for (let end = Date.now() + 10_000; !items.length && Date.now() < end;) { // counted in after(), once the send has answered
      items = (await A.c.get("/api/seller/inbox")).body.items;
      if (!items.length) await new Promise((r) => setTimeout(r, 300));
    }
    const [orderNo] = await admin`select order_no from orders where id = ${orderId}`;
    assert.equal(items.length, 1);
    assert.deepEqual({ ...items[0], at: typeof items[0].at, buyer: typeof items[0].buyer },
      { orderId, orderNo: orderNo.order_no, buyer: "string", item: "Silver jhumka", unread: 1, lastText: "when will I get it?", at: "string" });
    assert.deepEqual((await B.c.get("/api/seller/inbox")).body.items, [], "another shop sees none");
    ok(await new Client().get("/api/seller/inbox"), 401);
    ok(await b2.c.get("/api/seller/inbox"), 401);
    ok(await new Client().post(`/api/orders/${orderId}/seen`), 401);
    ok(await b2.c.post(`/api/orders/${orderId}/seen`), 403); // the order's buyer is not staff
    ok(await B.c.post(`/api/orders/${orderId}/seen`), 403);
    assert.equal((await A.c.get("/api/seller/inbox")).body.items.length, 1, "refused calls cleared nothing");
    const deskUnread = async () => Object.values((await A.c.get("/api/desk")).body.orders as Record<string, J[]>).flat().find((o) => o.orderId === orderId)?.unread;
    assert.equal(await deskUnread(), 1, "the desk row carries the count");
    ok(await A.c.post(`/api/orders/${orderId}/seen`));
    assert.deepEqual((await A.c.get("/api/seller/inbox")).body.items, []);
    assert.equal(await deskUnread(), 0);
  });

  test("moderation: ban blocks claims and joining; unban restores", async () => {
    const b5 = await buyer(A.slug, "Vik Patel");
    ok(await A.c.post(`/api/drops/${dropId}/moderate`, { buyerId: b5.id, action: "ban", reason: "spam" }));
    const c = await b5.c.post("/api/claims", { itemId: itemIds[1], variantKey: "one" });
    assert.equal(c.body.result, "banned");
    ok(await b5.c.post("/api/buyer/join", { name: "Vik Patel", phone: b5.phone, shopSlug: A.slug }), 403);
    const out = await admin`select msg_type from outbox where drop_id = ${dropId} and msg_type like 'SYS:%' and payload->>'userId' = ${"b_" + b5.id}`;
    assert.deepEqual(out.map((r) => r.msg_type), ["SYS:Ban"]);
    ok(await A.c.post(`/api/drops/${dropId}/moderate`, { buyerId: b5.id, action: "mute" }));
    assert.ok((await b5.c.get(`/api/drops/${dropId}/me`)).body.mutedUntil);
    ok(await A.c.post(`/api/drops/${dropId}/moderate`, { buyerId: b5.id, action: "unban" }));
    // from a chat line: the Nexconn sender id instead of the buyer id
    ok(await A.c.post(`/api/drops/${dropId}/moderate`, { userId: "b_" + b5.id, action: "mute" }));
    assert.ok((await b5.c.get(`/api/drops/${dropId}/me`)).body.mutedUntil);
    ok(await A.c.post(`/api/drops/${dropId}/moderate`, { userId: "b_" + b5.id, action: "unban" }));
    ok(await A.c.post(`/api/drops/${dropId}/moderate`, { userId: "demo_bot_99", action: "mute" }), 404);
    ok(await A.c.post(`/api/drops/${dropId}/moderate`, { userId: "s_x", action: "mute" }), 400);
    ok(await b5.c.post("/api/buyer/join", { name: "Vik Patel", phone: b5.phone, shopSlug: A.slug }));
  });

  test("join: a phone number never opens someone else's account; demo shops are read-only and not joinable", async () => {
    const b6 = await buyer(A.slug, "Meera Iyer");
    const thief = new Client();
    const t = await thief.post("/api/buyer/join", { name: "Meera Iyer", phone: b6.phone, shopSlug: A.slug });
    ok(t);
    buyers.push(t.body.buyerId);
    assert.notEqual(t.body.buyerId, b6.id, "same phone on another device is a new buyer");
    const again = await b6.c.post("/api/buyer/join", { name: "Meera I", phone: b6.phone, shopSlug: A.slug });
    assert.equal(again.body.buyerId, b6.id, "the cookie holder keeps their own row");
    ok(await thief.post("/api/buyer/join", { name: "Call 9876543210", phone: b6.phone, shopSlug: A.slug }), 400);
    ok(await thief.post("/api/buyer/join", { name: "pay@ybl", phone: b6.phone, shopSlug: A.slug }), 400);
    ok(await thief.post("/api/buyer/join", { name: "Priya", phone: b6.phone, shopSlug: "demo-jewels-1" }), 403);
    const demo = new Client();
    const d = await demo.post("/api/try/start", { role: "seller" });
    if (d.status === 503) return; // every demo room busy: nothing more to check here
    ok(d);
    const me = (await demo.get("/api/seller/me")).body.me;
    const ro = await demo.patch(`/api/shops/${me.shop.id}`, { name: "Hacked" });
    assert.equal(ro.status, 403);
    assert.equal(ro.body.error, "demo_read_only");
    assert.equal((await demo.post("/api/products", { title: "x", pricePaise: 1000, variants: [{ key: "a", label: "A", qty: 1 }] })).body.error, "demo_read_only");
    ok(await demo.post(`/api/drops/${d.body.dropId}/end`));
  });

  test("validation failures", async () => {
    const anon = new Client();
    const bad = async (r: Promise<{ status: number; body: J; text: string }>, code = "invalid", status = 400) => {
      const x = await r;
      assert.equal(x.status, status, x.text);
      assert.equal(x.body.error, code, x.text);
      assert.ok(x.body.message);
    };
    await bad(anon.post("/api/buyer/join", { name: "Xi", phone: "12345", shopSlug: A.slug }), "invalid_phone");
    await bad(anon.post("/api/buyer/join", { name: "", phone: phone(), shopSlug: A.slug }));
    await bad(anon.post("/api/buyer/join", { name: "Xi", phone: phone(), shopSlug: "no-such-shop-zz" }), "not_found", 404);
    await bad(A.c.patch(`/api/shops/${A.shopId}`, { slug: "Bad Slug!" }));
    await bad(A.c.patch(`/api/shops/${A.shopId}`, { upiId: "not-a-upi" }));
    await bad(A.c.patch(`/api/shops/${A.shopId}`, { holdMinutes: 40 }));
    await bad(A.c.patch(`/api/shops/${A.shopId}`, { maxHolds: 6 }));
    await bad(A.c.patch(`/api/shops/${A.shopId}`, { faq: Array(11).fill("line") }));
    await bad(A.c.patch(`/api/shops/${A.shopId}`, { faq: ["x".repeat(201)] }));
    await bad(A.c.patch(`/api/shops/${A.shopId}`, { slug: B.slug }), "slug_taken", 409);
    await bad(A.c.post("/api/products", { title: "X", pricePaise: 1000, variants: [] }));
    await bad(A.c.post("/api/products", { title: "X", pricePaise: 1000, variants: [{ key: "a", label: "A", qty: 1 }], photos: ["https://evil.test/x.jpg"] }));
    await bad(A.c.post("/api/products", { title: "X", pricePaise: 1000, variants: [{ key: "a", label: "A", qty: 1 }, { key: "a", label: "B", qty: 1 }] }));
    await bad(A.c.post("/api/drops", { title: "X", startsAt: "tomorrow", productIds: [randomUUID()] }));
    await bad(A.c.post("/api/products/upload-url", { contentType: "image/gif" }));
    await bad(b2.c.post("/api/claims", { itemId: "nope", variantKey: "one" }));
    await bad(b2.c.post(`/api/orders/${orderId}/paid-claim`, { utr: "12 34" }));
    await bad(A.c.post(`/api/orders/${orderId}/cancel`, { reason: "" }));
    await bad(A.c.post(`/api/drops/${dropId}/moderate`, { buyerId: b2.id, action: "kick" }));
    await bad(anon.get("/api/drops/not-a-uuid/state"), "not_found", 404);
    await bad(anon.get(`/api/drops/${randomUUID()}/state`), "not_found", 404);
    const inUse = (await A.c.get("/api/products")).body.products.find((p: J) => p.inLiveDrop);
    await bad(A.c.del(`/api/products/${inUse.id}`), "in_use", 409);
  });

  test("rate limit: more than 5 claims a second from one buyer get 429", async () => {
    const b6 = await buyer(A.slug, "Fast Tapper");
    const rs = await Promise.all(Array.from({ length: 12 }, () => b6.c.post("/api/claims", { itemId: itemIds[1], variantKey: "one" })));
    const codes = rs.map((r) => r.status);
    assert.ok(codes.includes(429), `no 429 in ${codes}`);
    assert.ok(codes.includes(200));
    assert.equal(rs.find((r) => r.status === 429)!.body.error, "rate_limited");
  });

  test("health is staff-only and shows no secrets; DELETE /api/me anonymises", async () => {
    const h = await A.c.get("/api/health");
    ok(h);
    assert.equal(h.body.mode, "mock");
    for (const k of ["NEXCONN_APP_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "SESSION_SECRET", "CRON_SECRET", "DATABASE_URL"]) {
      const v = process.env[k];
      if (v) assert.ok(!h.text.includes(v), `${k} leaked`);
    }
    ok(await b2.c.get("/api/health"), 401);

    const acct = await b2.c.get("/api/me");
    ok(acct);
    assert.equal(acct.body.buyer.phone, b2.phone);
    assert.ok(acct.body.orders.some((o: J) => o.orderId === orderId));
    const del = await b2.c.del("/api/me");
    ok(del);
    const [row] = await admin`select name, phone, deleted_at from buyers where id = ${b2.id}`;
    assert.equal(row.name, "Deleted buyer");
    assert.equal(row.phone, null);
    assert.ok(row.deleted_at);
    const [o] = await admin`select state from orders where id = ${orderId}`;
    assert.equal(o.state, "shipped", "shipped order row kept");
    assert.deepEqual((await b2.c.get("/api/buyer/me")).body, { buyer: null });

    ok(await A.c.post(`/api/drops/${dropId}/end`));
    ok(await A.c.del("/api/seller/session"));
    ok(await A.c.get("/api/products"), 401);
  });
});
