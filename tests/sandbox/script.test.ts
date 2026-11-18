// Judge mode end to end against real Postgres (mock transport, no AI): the buyer script with simulated judges,
// a judge who never taps, slot rotation without leaks, and the honesty rules (bots only in sandbox, no sandbox in /impact).
import "./env.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cancelPending, runLoop } from "../../src/lib/server/bots.ts";
import { fn, sql } from "../../src/lib/server/db.ts";
import { startTry } from "../../src/lib/server/sandbox.ts";
import { onDropEvent } from "../../src/lib/server/sandbox-hooks.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON from the engine in tests
type J = Record<string, any>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(what: string, f: () => Promise<T | null | undefined>, ms: number, every = 150): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}
const item = (dropId: string, pos: number) =>
  sql`select id, state, live_at from drop_items where drop_id = ${dropId} and position = ${pos} and state <> 'queued'`.then((r) => r[0]);
async function finish(dropId: string, ownerId: string) {
  await cancelPending(dropId);
  await fn("drop_end", dropId, ownerId);
}

after(async () => { await sql.end({ timeout: 5 }); });

type Run = { startMs: number; liveLagMs: number; promotedAfterStart: number; promotedAfterTap: number; tapAt: number; confirmMs: number; win2AfterStart: number; winMs: number; waitPos: number };

async function judgeRun(i: number): Promise<Run> {
  const t0 = Date.now();
  const s = await startTry("buyer", `Judge${i} Tester`);
  const tJoin = Date.now();                                                   // the room is on screen
  const loop = runLoop(s.dropId, 110_000);
  try {
    const p1 = await waitFor("piece 1 live", () => item(s.dropId, 1), 12_000);
        const [{ lag }] = await sql`select (extract(epoch from (${p1.live_at}::timestamptz - min(created_at))) * 1000)::int as lag from bot_schedule where drop_id = ${s.dropId}`;
    assert.ok(lag >= 4900 && lag < 7500, `piece 1 goes live 5 s after the script starts (${lag} ms)`);
    await sleep(Math.max(0, tJoin + 6000 - Date.now(), 1000));              // the judge taps at +6 s (at least 1 s after seeing it)
    const variant = ["gold", "silver", "rose"][i % 3];
    const c = await fn<J>("claim_dibs", p1.id, variant, s.buyerId, new Date());
    const tapAt = Date.now();
    const diag = await sql`select b.display_name, c.ms_after_live, pv.key from claims c join buyers b on b.id = c.buyer_id join product_variants pv on pv.id = c.variant_id where c.drop_item_id = ${p1.id} order by c.committed_at`;
    assert.equal(c.result, "waitlisted", `judge ${i} lands on the waitlist (${JSON.stringify(c)}) ${JSON.stringify(diag.map((d) => [d.key, d.ms_after_live]))}`);
    const bots = await sql`select count(*)::int as n, min(ms_after_live) as min, max(ms_after_live) as max from claims c join buyers b on b.id = c.buyer_id where c.drop_item_id = ${p1.id} and b.is_bot`;
    assert.equal(bots[0].n, 10, "ten bots tapped piece 1");

    const hold = await waitFor("promotion", async () => {
      const st = await fn<J>("my_status", s.dropId, s.buyerId);
      return st.holds.find((h: J) => h.position === 1 && h.state === "held");
    }, 50_000, 200);
    const promotedAt = Date.now();
    assert.ok(promotedAt - tapAt <= 45_000, `promoted ${promotedAt - tapAt} ms after the tap`);
    const [alert] = await sql`select payload from outbox where drop_id = ${s.dropId} and msg_type = 'DB:Alert' and payload->>'kind' = 'promoted' and channel_id = ${"b_" + s.buyerId}`;
    assert.match(alert.payload.text, /^It's yours! The buyer ahead didn't pay/);

    assert.deepEqual(await fn<J>("order_paid_claim", hold.orderId, s.buyerId, "123456789012"), { ok: true });
    await onDropEvent({ type: "order_paid_claim", dropId: s.dropId, orderId: hold.orderId });
    const paidAt = Date.now();
    await waitFor("demo staff confirms", async () => (await sql`select 1 from orders where id = ${hold.orderId} and state = 'paid'`)[0], 6000);
    const confirmMs = Date.now() - paidAt;
    const [status] = await sql`select payload from outbox where drop_id = ${s.dropId} and msg_type = 'DB:Status' and payload->>'state' = 'paid'`;
    assert.equal(status.payload.note, "Confirmed by Asha (demo staff)");

    const p2 = await waitFor("piece 2 live", () => item(s.dropId, 2), 10_000, 100);
    await sleep(600);                                                         // a quick judge
    const w = await fn<J>("claim_dibs", p2.id, "green", s.buyerId, new Date());
    assert.equal(w.result, "won", `quick tap wins piece 2 (${JSON.stringify(w)})`);
    return { startMs: tJoin - t0, liveLagMs: lag, promotedAfterStart: promotedAt - t0, promotedAfterTap: promotedAt - tapAt, tapAt: tapAt - t0, confirmMs, win2AfterStart: Date.now() - t0, winMs: w.ms, waitPos: c.position };
  } finally {
    await finish(s.dropId, s.ownerId);
    await loop;
  }
}

test("buyer script: 5 simulated judges reach It's yours, pay, and win piece 2 (in parallel, 5 slots)", { timeout: 150_000 }, async () => {
  const runs = await Promise.all(Array.from({ length: Number(process.env.JUDGES ?? 5) }, (_, i) => judgeRun(i)));
  console.log("judge runs (ms):", JSON.stringify(runs));
  for (const r of runs) {
    assert.equal(r.waitPos, 3, "every variant has 2 bots ahead: You're #3");
    assert.ok(r.promotedAfterTap >= 20_000 && r.promotedAfterTap <= 45_000);
    assert.ok(r.confirmMs <= 4500, `confirm in ${r.confirmMs} ms`);
    assert.ok(r.win2AfterStart <= 90_000, `It's yours twice inside 90 s (${r.win2AfterStart})`);
  }
});

test("a judge who never taps still sees bots promoted", { timeout: 60_000 }, async () => {
  const s = await startTry("buyer");
  const loop = runLoop(s.dropId, 45_000);
  try {
    await sleep(36_000);
    const [r] = await sql`select count(*) filter (where promoted_at is not null)::int as promoted, count(*) filter (where state = 'left')::int as left_
                            from claims where drop_id = ${s.dropId}`;
    assert.ok(r.promoted >= 3, `bot promotions seen: ${r.promoted}`);
    assert.equal(r.left_, 0, "no judge, so no bot leaves");
    const chat = await sql`select count(*)::int as n from bot_schedule where drop_id = ${s.dropId} and action = 'chat' and done_at is not null`;
    assert.ok(chat[0].n >= 7, "bots chat about every 3 s");
    const [mod] = await sql`select rule, action from moderation_events where drop_id = ${s.dropId}`;
    assert.deepEqual({ ...mod }, { rule: "upi", action: "blocked" }, "the fake UPI line is blocked and logged");
  } finally {
    await finish(s.dropId, s.ownerId);
    await loop;
  }
});

test("starts rotate slots and reuse one without leaking rows", { timeout: 60_000 }, async () => {
  const a = await startTry("seller", "Rot A");
  const b = await startTry("buyer", "Rot B");
  assert.notEqual(a.slot, b.slot, "two starts in a row get different slots");
  // give slot A an order, a chat block and a ban, then make it the idlest so the next start reuses it
  await fn("sandbox_next", a.dropId, a.ownerId, 0, null, null);
  const p1 = await item(a.dropId, 1);
  const won = await fn<J>("claim_dibs", p1.id, "gold", a.buyerId, new Date());
  assert.equal(won.result, "won");
  const [bot] = await sql`select id from buyers where is_bot limit 1`;
  await sql`insert into bans (shop_id, buyer_id, kind) values (${a.shopId}, ${bot.id}, 'mute')`;
  await sql`update try_slots set last_active_at = '2000-01-01' where slot = ${a.slot}`;
  const c = await startTry("buyer", "Rot C");
  assert.equal(c.slot, a.slot, "the idlest slot is reused");
  assert.equal((await sql`select count(*)::int as n from drops where id = ${a.dropId}`)[0].n, 0);
  assert.equal((await sql`select count(*)::int as n from orders where id = ${won.orderId}`)[0].n, 0);
  assert.equal((await sql`select count(*)::int as n from buyers where id = ${a.buyerId}`)[0].n, 0, "the previous visitor is deleted");
  assert.equal((await sql`select count(*)::int as n from bans where shop_id = ${a.shopId}`)[0].n, 0);
  assert.ok((await sql`select 1 from outbox where drop_id = ${c.dropId} and msg_type = 'SYS:Unban'`).length, "the room mute is lifted");
  const [leak] = await sql`
    select (select count(*)::int from drops d join shops s on s.id = d.shop_id where s.slug like 'demo-jewels-%') as drops,
           (select count(*)::int from buyers where is_sandbox and not is_bot and phone is null
               and id not in (select judge_id from try_slots where judge_id is not null)) as stray`;
  assert.ok(leak.drops <= 8, "at most one drop per slot");
  assert.equal(leak.stray, 0, "no visitor buyer outlives its slot");
  for (const x of [b, c]) await finish(x.dropId, x.ownerId);
});

test("bots cannot claim in a real drop (banned)", async () => {
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "X");
  const [shop] = await sql`insert into shops (slug, name) values (${"real-" + tag.toLowerCase()}, 'Real shop') returning id`;
  try {
    const [owner] = await sql`insert into staff (shop_id, role, display_name) values (${shop.id}, 'owner', 'O') returning id`;
    const [p] = await sql`insert into products (shop_id, title, price_paise) values (${shop.id}, 'Real piece', 10000) returning id`;
    const [v] = await sql`insert into product_variants (product_id, key, label, qty) values (${p.id}, 'one', 'One', 1) returning id`;
    const [d] = await sql`insert into drops (shop_id, code, title, starts_at) values (${shop.id}, ${tag}, 'Real', now()) returning id`;
    const [i] = await sql`insert into drop_items (drop_id, product_id, position) values (${d.id}, ${p.id}, 1) returning id`;
    await sql`insert into item_stock values (${i.id}, ${v.id}, 1, 1)`;
    await fn("drop_go_live", d.id, owner.id);
    await fn("drop_next", d.id, owner.id);
    const [bot] = await sql`select id from buyers where is_bot limit 1`;
    assert.equal((await fn<J>("claim_dibs", i.id, "one", bot.id, new Date())).result, "banned");
    await onDropEvent({ type: "item_live", dropId: d.id, itemId: i.id }); // real drop: the hook does nothing
    assert.equal((await sql`select count(*)::int as n from bot_schedule where drop_id = ${d.id}`)[0].n, 0);
  } finally {
    await sql`delete from shops where id = ${shop.id}`;
  }
});

test("sandbox orders never count in impact_totals()", async () => {
  const before = await fn<J>("impact_totals");
  const s = await startTry("buyer", "Impact Check");
  try {
    await fn("sandbox_next", s.dropId, s.ownerId, 0, null, null);
    const p1 = await item(s.dropId, 1);
    const w = await fn<J>("claim_dibs", p1.id, "rose", s.buyerId, new Date());
    assert.equal(w.result, "won");
    const [staff] = await sql`select id from staff where shop_id = ${s.shopId} and role = 'staff'`;
    assert.deepEqual(await fn<J>("order_confirm", w.orderId, staff.id, true, null), { ok: true });
    assert.deepEqual(await fn<J>("impact_totals"), before);
  } finally {
    await finish(s.dropId, s.ownerId);
  }
});
