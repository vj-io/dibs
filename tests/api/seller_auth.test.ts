// Seller accounts without email: password sign-up / sign-in, failed-login throttle, staff invite links, set password,
// sample pieces, and the orders CSV. Real HTTP against the shared mock dev server, real Supabase Auth (Admin API).
// Run: API_BASE=http://localhost:3100 node --env-file=.env.local --test tests/api/seller_auth.test.ts
// Every Auth user it creates has "-<run>-" in its email and is deleted at the end, with its shops and buyers.
// Each client sends its own X-Forwarded-For (the dev server has no proxy), so per-IP limits don't collide across tests.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import postgres from "postgres";

const BASE = process.env.API_BASE ?? "http://localhost:3100";
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL!, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = postgres(process.env.DATABASE_URL_SESSION!, { ssl: "require", max: 2, onnotice: () => {} });
const RUN = randomUUID().slice(0, 8);
const shops: string[] = [], buyers: string[] = [];
let n = 0;
const email = (what: string) => `${what}-${RUN}-${++n}@dibs.test`;
const PW = "correct horse battery";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON in tests
type J = Record<string, any>;

class Client {
  jar = new Map<string, string>();
  ip = `10.${randomInt(255)}.${randomInt(255)}.${randomInt(1, 255)}`;
  async call(method: string, path: string, body?: unknown): Promise<{ status: number; body: J; text: string; headers: Headers }> {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        "X-Forwarded-For": this.ip,
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
    return { status: res.status, body: parsed, text, headers: res.headers };
  }
  get = (p: string) => this.call("GET", p);
  post = (p: string, b?: unknown) => this.call("POST", p, b ?? {});
  del = (p: string) => this.call("DELETE", p);
}
const ok = (r: { status: number; text: string }, status = 200) => assert.equal(r.status, status, r.text);

async function newShop(c: Client, name = "Pw Shop") {
  const r = await c.post("/api/shops", { name, slug: `t-${RUN}-${++n}`, upiId: "test@upi", payeeName: "Test" });
  ok(r);
  shops.push(r.body.shopId);
  return r.body as { shopId: string; staffId: string };
}
async function testOwner() {
  const c = new Client();
  ok(await c.post("/api/seller/session", { testEmail: email("owner") }));
  return { c, ...(await newShop(c, "Invite Shop")) };
}

const authH = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" };
async function authUsers(): Promise<{ id: string; email: string }[]> {
  const out: { id: string; email: string }[] = [];
  for (let page = 1; page < 50; page++) {
    const r = await (await fetch(`${SB}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: authH })).json() as { users?: { id: string; email: string }[] };
    out.push(...(r.users ?? []).filter((u) => u.email?.includes(`-${RUN}-`)));
    if ((r.users ?? []).length < 200) break;
  }
  return out;
}

before(async () => {
  const r = await fetch(BASE + "/api/config").catch(() => null);
  assert.ok(r?.ok, `server not reachable at ${BASE}`);
});

after(async () => {
  const users = await authUsers();
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await admin`delete from shops where id in (select shop_id from staff where id in ${admin(ids)} and role = 'owner')`;
    await admin`delete from staff where id in ${admin(ids)}`;
  }
  if (shops.length) await admin`delete from shops where id in ${admin(shops)}`;
  if (buyers.length) await admin`delete from buyers where id in ${admin(buyers)}`;
  for (const id of ids) await fetch(`${SB}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: authH });
  const left = await authUsers();
  assert.equal(left.length, 0, "every test Auth user deleted");
  await admin.end({ timeout: 5 });
});

describe("password accounts", () => {
  test("sign up -> shop; account_exists; bad input refused; sign in; wrong password looks like an unknown email", async () => {
    const c = new Client(), em = email("pw");
    const s = await c.post("/api/seller/signup", { email: em.toUpperCase(), password: PW, name: "Meera" });
    ok(s);
    assert.deepEqual(s.body, { needsShop: true, email: em });
    assert.equal((await c.get("/api/seller/me")).body.pendingEmail, em);
    const shop = await newShop(c);
    const me = await c.get("/api/seller/me");
    assert.equal(me.body.me.role, "owner");
    assert.equal(me.body.me.staffId, shop.staffId);

    const again = await new Client().post("/api/seller/signup", { email: em, password: "another password", name: "X" });
    ok(again, 409);
    assert.equal(again.body.error, "account_exists");
    ok(await new Client().post("/api/seller/signup", { email: "a@mailinator.com", password: PW, name: "X" }), 400);
    ok(await new Client().post("/api/seller/signup", { email: "not-an-email", password: PW, name: "X" }), 400);
    ok(await new Client().post("/api/seller/signup", { email: email("short"), password: "1234567", name: "X" }), 400);

    const d = new Client();
    const wrong = await d.post("/api/seller/login", { email: em, password: "wrong password" });
    ok(wrong, 401);
    const nobody = await d.post("/api/seller/login", { email: email("nobody"), password: "wrong password" });
    ok(nobody, 401);
    assert.deepEqual(wrong.body, nobody.body, "same answer whether or not the email has an account");
    assert.equal(d.jar.size, 0, "no cookie on failure");

    const good = await d.post("/api/seller/login", { email: em, password: PW });
    ok(good);
    assert.equal(good.body.needsShop, false);
    assert.equal(good.body.me.shop.id, shop.shopId);

    // set a new password while signed in; the old one stops working
    ok(await d.post("/api/seller/password", { password: "short" }), 400);
    ok(await d.post("/api/seller/password", { password: "brand new password" }));
    ok(await new Client().post("/api/seller/login", { email: em, password: PW }), 401);
    ok(await new Client().post("/api/seller/login", { email: em, password: "brand new password" }));
  });

  test("failed logins are throttled per email (even from a new IP, even with the right password)", async () => {
    const c = new Client(), em = email("throttle");
    ok(await c.post("/api/seller/signup", { email: em, password: PW, name: "T" }));
    for (let i = 0; i < 8; i++) ok(await new Client().post("/api/seller/login", { email: em, password: `wrong ${i}` }), 401);
    const blocked = await new Client().post("/api/seller/login", { email: em, password: PW });
    ok(blocked, 429);
    assert.equal(blocked.body.error, "rate_limited");
  });

  test("failed logins are throttled per IP", async () => {
    const c = new Client();
    for (let i = 0; i < 30; i++) {
      const r = await c.post("/api/seller/login", { email: email("ipthrottle"), password: "wrong password" });
      if (r.status === 429) return; // Supabase Auth's own limit answered first: still throttled, never a 500
      ok(r, 401);
    }
    ok(await c.post("/api/seller/login", { email: email("ipthrottle"), password: "wrong password" }), 429);
  });

  test("sign-ups are limited per IP", async () => {
    const c = new Client(), em = email("signuplimit");
    ok(await c.post("/api/seller/signup", { email: em, password: PW, name: "S" }));
    for (let i = 0; i < 9; i++) ok(await c.post("/api/seller/signup", { email: em, password: PW, name: "S" }), 409);
    ok(await c.post("/api/seller/signup", { email: em, password: PW, name: "S" }), 429);
  });

  test("an emailed code (inbox proof) drops a password set without that proof", async () => {
    const c = new Client(), em = email("squat");
    ok(await c.post("/api/seller/signup", { email: em, password: PW, name: "Squatter" }));
    // what the code path does, without sending an email: an admin link gives the code, Supabase verifies it
    const link = await (await fetch(`${SB}/auth/v1/admin/generate_link`, { method: "POST", headers: authH, body: JSON.stringify({ type: "magiclink", email: em }) })).json() as J;
    const v = await (await fetch(`${SB}/auth/v1/verify`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "email", email: em, token: link.email_otp ?? link.properties?.email_otp }) })).json() as J;
    assert.ok(v.access_token, JSON.stringify(v).slice(0, 200));
    ok(await new Client().post("/api/seller/session", { accessToken: v.access_token }));
    ok(await new Client().post("/api/seller/login", { email: em, password: PW }), 401);
  });
});

describe("staff invite links", () => {
  test("link -> password account for exactly that email -> staff; reuse, tamper, expiry and removal refused", async () => {
    const A = await testOwner();
    const em = email("staff");
    const inv = await A.c.post(`/api/shops/${A.shopId}/staff`, { email: em, name: "Ravi" });
    ok(inv);
    const url = new URL(inv.body.inviteUrl);
    assert.equal(url.pathname, "/seller");
    const token = url.searchParams.get("invite")!;

    // the page shows the shop and the email
    const page = await new Client().get(`/seller?invite=${encodeURIComponent(token)}`);
    ok(page);
    assert.ok(page.text.includes("Invite Shop") && page.text.includes(em));

    // tampered: one character of the signature changed
    const bad = token.slice(0, -2) + (token.at(-2) === "A" ? "B" : "A") + token.at(-1);
    const t1 = await new Client().post("/api/seller/invite", { token: bad, password: PW });
    ok(t1, 400);
    assert.equal(t1.body.error, "bad_invite");
    // expired: right key, expiry in the past
    const key = new TextEncoder().encode(process.env.SESSION_SECRET!);
    const old = await new SignJWT({ kind: "invite", sid: inv.body.member.staffId, email: em }).setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 8 * 86400).setExpirationTime(Math.floor(Date.now() / 1000) - 86400).sign(key);
    const t2 = await new Client().post("/api/seller/invite", { token: old, password: PW });
    ok(t2, 410);
    assert.equal(t2.body.error, "invite_expired");
    // a signed token for another email can't take this row
    const other = await new SignJWT({ kind: "invite", sid: inv.body.member.staffId, email: email("thief") }).setProtectedHeader({ alg: "HS256" })
      .setIssuedAt().setExpirationTime("7d").sign(key);
    ok(await new Client().post("/api/seller/invite", { token: other, password: PW }), 410);

    const s = new Client();
    const join = await s.post("/api/seller/invite", { token, password: PW });
    ok(join);
    assert.equal(join.body.needsShop, false);
    assert.equal(join.body.me.role, "staff");
    assert.equal(join.body.me.shop.id, A.shopId);
    ok(await s.get("/api/desk"));
    // reused
    const again = await new Client().post("/api/seller/invite", { token, password: PW });
    ok(again, 410);
    assert.equal(again.body.error, "invite_used");
    // the new account signs in with its password
    const back = await new Client().post("/api/seller/login", { email: em, password: PW });
    ok(back);
    assert.equal(back.body.me.shop.id, A.shopId);

    // removal revokes a pending link
    const em2 = email("removed");
    const inv2 = await A.c.post(`/api/shops/${A.shopId}/staff`, { email: em2, name: "Gone" });
    ok(inv2);
    const relink = await A.c.post(`/api/shops/${A.shopId}/staff/${inv2.body.member.staffId}/link`);
    ok(relink);
    ok(await A.c.del(`/api/shops/${A.shopId}/staff/${inv2.body.member.staffId}`));
    const t3 = await new Client().post("/api/seller/invite", { token: new URL(relink.body.inviteUrl).searchParams.get("invite"), password: PW });
    ok(t3, 410);
    assert.equal(t3.body.error, "invite_used");
    // only the owner gets links
    ok(await s.post(`/api/shops/${A.shopId}/staff/${inv.body.member.staffId}/link`), 403);
  });

  test("password sign-up with an invited email does not take the invite; the invite link still works", async () => {
    const A = await testOwner();
    const em = email("invited");
    const inv = await A.c.post(`/api/shops/${A.shopId}/staff`, { email: em, name: "Asha" });
    ok(inv);
    const c = new Client();
    const s = await c.post("/api/seller/signup", { email: em, password: PW, name: "Asha" });
    ok(s);
    assert.equal(s.body.needsShop, true, "no shop: the invite is not activated by a password");
    const [row] = await admin`select active from staff where id = ${inv.body.member.staffId}`;
    assert.equal(row.active, false);
    // the link holder must know that account's password
    const token = new URL(inv.body.inviteUrl).searchParams.get("invite");
    const wrong = await new Client().post("/api/seller/invite", { token, password: "not the password" });
    ok(wrong, 401);
    const join = await new Client().post("/api/seller/invite", { token, password: PW });
    ok(join);
    assert.equal(join.body.me.shop.id, A.shopId);
  });
});

describe("sample pieces and the orders CSV", () => {
  test("samples: 3 once, removable in one call", async () => {
    const A = await testOwner();
    const a = await A.c.post("/api/products/samples");
    ok(a);
    assert.equal(a.body.products.length, 3);
    assert.ok(a.body.products.every((p: J) => p.title.startsWith("Sample: ") && p.photos[0].startsWith("/demo/")));
    assert.equal((await A.c.post("/api/products/samples")).body.products.length, 3, "a second tap adds nothing");
    const d = await A.c.del("/api/products/samples");
    ok(d);
    assert.equal(d.body.removed, 3);
    assert.equal(d.body.products.length, 0);
  });

  test("CSV: staff of the shop only; formula cells are neutralised", async () => {
    const A = await testOwner();
    const p = await A.c.post("/api/products", { title: "=HYPERLINK(\"x\")", pricePaise: 145000, variants: [{ key: "one", label: "+One", qty: 1 }] });
    ok(p);
    const d = await A.c.post("/api/drops", { title: "CSV drop", startsAt: new Date().toISOString(), productIds: [p.body.product.id] });
    ok(d);
    const dropId = d.body.dropId;
    ok(await A.c.post(`/api/drops/${dropId}/live`));
    const next = await A.c.post(`/api/drops/${dropId}/next`);
    ok(next);
    const shop = await A.c.get("/api/seller/me");
    const b = new Client();
    const phone = `9${randomInt(1e8, 1e9)}`;
    const j = await b.post("/api/buyer/join", { name: "Priya Sharma", phone, shopSlug: shop.body.me.shop.slug });
    ok(j);
    buyers.push(j.body.buyerId);
    const claim = await b.post("/api/claims", { itemId: next.body.liveItemId, variantKey: "one" });
    ok(claim);
    assert.equal(claim.body.result, "won");
    const orderId = claim.body.orderId;
    ok(await b.post(`/api/orders/${orderId}/paid-claim`, { utr: "123456789012" }));
    ok(await A.c.post(`/api/orders/${orderId}/confirm`, { received: true }));
    ok(await A.c.post(`/api/orders/${orderId}/ship`, { trackingNote: "@SUM(1+1)" }));

    const csv = await A.c.get(`/api/exports/orders.csv?dropId=${dropId}`);
    ok(csv);
    assert.match(csv.headers.get("content-type") ?? "", /^text\/csv/);
    assert.match(csv.headers.get("content-disposition") ?? "", /attachment; filename="dibs-orders-[A-Z0-9]{6}\.csv"/);
    const lines = csv.text.replace(/^﻿/, "").trim().split("\r\n");
    assert.equal(lines[0], "Order no,Piece,Variant,Amount (₹),Buyer,Phone,State,UTR,Paid at,Shipped at,Tracking note,Assigned to");
    assert.equal(lines.length, 2);
    const row = lines[1];
    assert.ok(row.includes(`"'=HYPERLINK(""x"")"`), row);
    assert.ok(row.includes(",'+One,"), row);
    assert.ok(row.includes(",'@SUM(1+1),"), row);
    assert.ok(row.includes(`,1450.00,Priya S.,${phone},shipped,123456789012,`), row);
    assert.match(row, /,\d{4}-\d{2}-\d{2} \d{2}:\d{2},\d{4}-\d{2}-\d{2} \d{2}:\d{2},/);

    ok(await b.get(`/api/exports/orders.csv?dropId=${dropId}`), 401); // a buyer
    ok(await new Client().get(`/api/exports/orders.csv?dropId=${dropId}`), 401);
    const B = await testOwner();
    ok(await B.c.get(`/api/exports/orders.csv?dropId=${dropId}`), 403); // another shop's staff
    ok(await A.c.get(`/api/exports/orders.csv?dropId=nope`), 400);
    ok(await A.c.post(`/api/drops/${dropId}/end`));
  });
});
