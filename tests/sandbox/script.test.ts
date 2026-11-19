// Judge mode end to end against real Postgres (mock transport, no AI): the buyer script with simulated judges,
// a judge who never taps, slot rotation without leaks, and the honesty rules (bots only in sandbox, no sandbox in /impact).
import "./env.ts";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { cancelPending, retryOnce, roomTick, runLoop, slotOf, type Row } from "../../src/lib/server/bots.ts";
import { fn, sql } from "../../src/lib/server/db.ts";
import { measureRtt, startTryRetry as startTry } from "./helpers.ts";
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

// Wall-clock bounds are the script's own delay plus SLACK, 8 measured round trips, at least 2 s.
let rtt = 250, SLACK = 1500;
before(async () => {
  await Promise.all(Array.from({ length: 12 }, () => sql`select 1`)); // open the pool first: a cold TLS connect from a laptop takes ~4 s
  rtt = await measureRtt();
  SLACK = Math.max(2000, 8 * rtt);
  console.log(`engine round trip ${rtt} ms, timing slack ${SLACK} ms`);
});
after(async () => { await sql.end({ timeout: 5 }); });

type Run = { roomToLiveMs: number; startMs: number; liveLagMs: number; promotedAfterStart: number; promotedAfterTap: number; tapAt: number; confirmMs: number; win2AfterStart: number; winMs: number; waitPos: number };

async function judgeRun(i: number): Promise<Run> {
  const t0 = Date.now();
  const s = await startTry("buyer", `Judge${i} Tester`);
  const loop = runLoop(s.dropId, 170_000);
  await sleep(1500);                                                          // the room takes a moment to appear
  await roomTick(s.dropId);                                                   // the room is on screen: piece 1 in 5 s
  const tJoin = Date.now();
  try {
    const p1 = await waitFor("piece 1 live", () => item(s.dropId, 1), 12_000);
    const [{ lag }] = await sql`select (extract(epoch from (${p1.live_at}::timestamptz - created_at)) * 1000)::int as lag from bot_schedule
                                 where drop_id = ${s.dropId} and payload ? 'firstRoom'`;
    // logic, not speed: piece 1 was dropped by the room-tick row, not by the 12 s fallback; the clock bound is loose
    // because a shared database (production, other suites) sometimes stalls a query for seconds
    const nexts = await sql`select payload ? 'firstRoom' as first, done_at from bot_schedule where drop_id = ${s.dropId} and action = 'next' and payload->>'ifPosition' = '0' order by done_at nulls last`;
    assert.equal(nexts[0].first, true, "the room tick, not the fallback, dropped piece 1");
    assert.ok(lag >= 4900 && lag < 5000 + 3 * SLACK, `piece 1 goes live 5 s after the judge is in the room (${lag} ms)`);
    const [d] = await sql`select starts_at from drops where id = ${s.dropId}`;
    assert.ok(Math.abs(new Date(d.starts_at).getTime() - new Date(p1.live_at).getTime()) < 2000 + SLACK, "the room counted down to it");
    await sleep(Math.max(0, tJoin + 6000 - Date.now(), 1000));              // the judge taps at +6 s (at least 1 s after seeing it)
    const variant = ["gold", "silver", "rose"][i % 3];
    const c = await fn<J>("claim_dibs", p1.id, variant, s.buyerId, new Date());
    const tapAt = Date.now();
    const diag = await sql`select b.display_name, c.ms_after_live, pv.key from claims c join buyers b on b.id = c.buyer_id join product_variants pv on pv.id = c.variant_id where c.drop_item_id = ${p1.id} order by c.committed_at`;
    assert.equal(c.result, "waitlisted", `judge ${i} lands on the waitlist (${JSON.stringify(c)}) ${JSON.stringify(diag.map((d) => [d.key, d.ms_after_live]))}`);
    await waitFor("ten bot taps on piece 1", async () => (await sql`
      select count(*)::int as n from claims c join buyers b on b.id = c.buyer_id where c.drop_item_id = ${p1.id} and b.is_bot`)[0].n === 10, 5000)
      .catch(async (e) => {
        const d = await sql`select s.action, s.due_at, s.done_at, (select count(*)::int from claims c where c.drop_item_id = ${p1.id} and c.buyer_id::text = s.payload->>'buyerId') as claims
                              from bot_schedule s where s.drop_id = ${s.dropId} and s.payload->>'itemId' = ${p1.id} order by s.due_at`;
        throw new Error(`${e.message}: ${JSON.stringify(d)} live ${p1.live_at}`);
      });

    const hold = await waitFor("promotion", async () => {
      const st = await fn<J>("my_status", s.dropId, s.buyerId);
      return st.holds.find((h: J) => h.position === 1 && h.state === "held");
    }, 50_000, 200);
    const promotedAt = Date.now();
    const ext = await waitFor("90 s demo hold", async () => (await sql`
      select (extract(epoch from (expires_at - promoted_at)))::int as s from claims where id = ${hold.claimId} and demo_extended_at is not null`)[0], 3000, 100);
    assert.equal(ext.s, 90, "the judge gets 90 s to pay");
    const [alert] = await sql`select payload from outbox where drop_id = ${s.dropId} and msg_type = 'DB:Alert' and payload->>'kind' = 'promoted' and channel_id = ${"b_" + s.buyerId}`;
    assert.match(alert.payload.text, /^It's yours! The buyer ahead didn't pay/);

    assert.deepEqual(await fn<J>("order_paid_claim", hold.orderId, s.buyerId, "123456789012"), { ok: true });
    await onDropEvent({ type: "order_paid_claim", dropId: s.dropId, orderId: hold.orderId });
    const paidAt = Date.now();
    await waitFor("demo staff confirms", async () => (await sql`select 1 from orders where id = ${hold.orderId} and state = 'paid'`)[0], 3000 + 3 * SLACK)
      .catch(async (e) => {
        const d = await sql`select action, due_at, done_at, clock_timestamp() as now from bot_schedule where drop_id = ${s.dropId} and action in ('confirm','next') order by due_at`;
        const [o] = await sql`select state from orders where id = ${hold.orderId}`;
        const [l] = await sql`select runner_until, runner_token is not null as has from try_slots where drop_id = ${s.dropId}`;
        throw new Error(`${e.message}: order ${o?.state} lease ${JSON.stringify(l)} rows ${JSON.stringify(d)} ${Date.now() - t0} ms after start`);
      });
    const confirmMs = Date.now() - paidAt;
    const [status] = await sql`select payload from outbox where drop_id = ${s.dropId} and msg_type = 'DB:Status' and payload->>'state' = 'paid'`;
    assert.equal(status.payload.note, "Confirmed by Asha (demo staff)");

    await sleep(5000);                                                        // the judge reads the order room
    assert.equal(await item(s.dropId, 2), undefined, "no piece 2 while the judge is away from the sale room");
    await roomTick(s.dropId);                                                 // back in the room
    const backAt = Date.now();
    const p2 = await waitFor("piece 2 live", () => item(s.dropId, 2), 10_000, 100);
    const roomToLiveMs = Date.now() - backAt;
    await sleep(2000);                                                        // looks at it, then taps either variant
    const w = await fn<J>("claim_dibs", p2.id, i % 2 ? "red" : "green", s.buyerId, new Date());
    assert.equal(w.result, "won", `quick tap wins piece 2 (${JSON.stringify(w)})`);
    return { roomToLiveMs, startMs: tJoin - t0, liveLagMs: lag, promotedAfterStart: promotedAt - t0, promotedAfterTap: promotedAt - tapAt, tapAt: tapAt - t0, confirmMs, win2AfterStart: Date.now() - t0, winMs: w.ms, waitPos: c.position };
  } finally {
    await finish(s.dropId, s.ownerId);
    await loop;
  }
}

test("buyer script: 5 simulated judges reach It's yours, pay, and win piece 2", { timeout: 480_000 }, async () => {
  // one after another: from a laptop each query is a ~250 ms round trip to Mumbai, and 5 rooms in one process queue on one pool
  const runs: Run[] = [];
  for (let i = 0; i < Number(process.env.JUDGES ?? 5); i++) runs.push(await judgeRun(i));
  console.log("judge runs (ms):", JSON.stringify(runs));
  for (const r of runs) {
    // #3 when all ten bot taps commit first; from a laptop a slow bot tap can land after the judge (#1 or #2)
    assert.ok(r.waitPos >= 1 && r.waitPos <= 3, `waitlist position ${r.waitPos}`);
    // the planner aims at <= 30 s after the tap; the sweep that promotes runs every second
    assert.ok(r.promotedAfterTap <= 30_000 + SLACK, `promoted ${r.promotedAfterTap} ms after the tap`);
    assert.ok(r.confirmMs <= 3000 + 3 * SLACK, `confirm in ${r.confirmMs} ms`);
    assert.ok(r.roomToLiveMs >= 2500 && r.roomToLiveMs <= 3000 + SLACK, `piece 2 ${r.roomToLiveMs} ms after the room tick`);
    assert.ok(r.win2AfterStart <= 90_000, `It's yours twice inside 90 s (${r.win2AfterStart})`);
  }
});

test("a judge who never taps still sees bots promoted", { timeout: 120_000 }, async () => {
  const s = await startTry("buyer");
  const loop = runLoop(s.dropId, 40_000);
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

test("starts rotate slots and reuse one without leaking rows", { timeout: 240_000 }, async () => {
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
  // make slot A the idlest used slot (never used slots still sort first), and start until it is the one reused:
  // other suites and production share the pool, so the next start may first take another idle slot
  await sql`update try_slots set last_active_at = '2000-01-01' where slot = ${a.slot}`;
  let c = await startTry("buyer", "Rot C");
  for (let i = 0; c.slot !== a.slot && i < 20; i++) {
    await finish(c.dropId, c.ownerId);
    await sql`update try_slots set last_active_at = now() where slot = ${c.slot}`;
    c = await startTry("buyer", "Rot C");
  }
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
  assert.ok(leak.drops <= 16, "at most one drop per slot");
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
  const s = await startTry("buyer", "Impact Check");
  try {
    // one repeatable-read snapshot: real drops elsewhere (production shares this database) cannot move the totals
    // between the two readings; only this transaction's own sandbox sale could, and it must not. Rolled back.
    const ROLLBACK = new Error("rollback");
    await sql.begin("isolation level repeatable read", async (tx) => {
      const [{ r: before }] = await tx`select impact_totals() as r`;
      await tx`select sandbox_next(${s.dropId}, ${s.ownerId}, 0, null, null)`;
      const [p1] = await tx`select id from drop_items where drop_id = ${s.dropId} and position = 1`;
      const [{ r: w }] = await tx`select claim_dibs(${p1.id}, 'rose', ${s.buyerId}, now()) as r`;
      assert.equal(w.result, "won");
      const [staff] = await tx`select id from staff where shop_id = ${s.shopId} and role = 'staff'`;
      const [{ r: ok }] = await tx`select order_confirm(${w.orderId}, ${staff.id}, true, null) as r`;
      assert.equal(ok.ok, true);
      const [{ r: after }] = await tx`select impact_totals() as r`;
      assert.deepEqual(after, before);
      throw ROLLBACK;
    }).catch((e) => { if (e !== ROLLBACK) throw e; });
  } finally {
    await finish(s.dropId, s.ownerId);
  }
});

test("a human's sandbox hold is 90 s from the start; walking away still hands it on", { timeout: 60_000 }, async () => {
  const s = await startTry("buyer", "Walk Away");
  try {
    await cancelPending(s.dropId);
    await fn("sandbox_next", s.dropId, s.ownerId, 0, null, null);
    const p1 = await item(s.dropId, 1);
    const [b1, b2] = await sql`select id from buyers where is_bot order by nexconn_user_id limit 2`;
    assert.equal((await fn<J>("claim_dibs", p1.id, "gold", b1.id, new Date())).result, "won");
    assert.equal((await fn<J>("claim_dibs", p1.id, "gold", s.buyerId, new Date())).result, "waitlisted");
    assert.equal((await fn<J>("claim_dibs", p1.id, "gold", b2.id, new Date())).result, "waitlisted");
    const [botHold] = await sql`select (extract(epoch from (expires_at - committed_at)))::int as s from claims where drop_item_id = ${p1.id} and buyer_id = ${b1.id}`;
    assert.equal(botHold.s, 12, "a bot's demo hold is 12 s");
    await sql`update claims set expires_at = clock_timestamp() - interval '1 second' where drop_item_id = ${p1.id} and buyer_id = ${b1.id}`;
    await fn("sweep_drop", s.dropId);
    // the promotion itself gives the human 90 s (no 20 s card or alert first); the extender has nothing left to do
    assert.equal(await fn("sandbox_extend_holds", s.dropId), 0, "already 90 s at promotion");
    const [c] = await sql`select id, order_id, (extract(epoch from (expires_at - promoted_at)))::int as s, expires_at from claims
                           where drop_item_id = ${p1.id} and buyer_id = ${s.buyerId} and state = 'held'`;
    assert.equal(c.s, 90);
    const [alert] = await sql`select payload from outbox where drop_id = ${s.dropId} and msg_type = 'DB:Alert' and payload->>'kind' = 'promoted'
                                and payload->>'orderId' = ${c.order_id}`;
    assert.equal(alert.payload.text, "It's yours! The buyer ahead didn't pay. Pay within 01:30");
    const [pay] = await sql`select o.payload from outbox o join orders r on r.nexconn_group_id = o.channel_id where r.id = ${c.order_id} and o.msg_type = 'DB:Pay'`;
    assert.equal(pay.payload.upiLink, "Dibs demo: no real payment", "a demo payment card is never a payable upi:// link");
    assert.equal(pay.payload.demo, true);
    const [card] = await sql`select o.channel_id, o.payload from outbox o join orders r on r.nexconn_group_id = o.channel_id
                              where r.id = ${c.order_id} and o.msg_type = 'DB:Order' order by o.id desc limit 1`;
    assert.equal(new Date(card.payload.expiresAt).getTime(), new Date(c.expires_at).getTime(), "order rooms get the new timer");
    // the judge walks away: 90 s later the hold expires and the next buyer is promoted
    await sql`update claims set expires_at = clock_timestamp() - interval '1 second' where id = ${c.id}`;
    const sw = await fn<J>("sweep_drop", s.dropId);
    assert.equal(sw.promoted, 1);
    assert.equal((await sql`select state from claims where id = ${c.id}`)[0].state, "expired");
    assert.equal((await sql`select state from claims where drop_item_id = ${p1.id} and buyer_id = ${b2.id}`)[0].state, "held");
    const [b2Hold] = await sql`select (extract(epoch from (expires_at - promoted_at)))::int as s from claims where drop_item_id = ${p1.id} and buyer_id = ${b2.id}`;
    assert.equal(b2Hold.s, 12, "the promoted bot gets 12 s");
  } finally {
    await finish(s.dropId, s.ownerId);
  }
});

test("piece 2 fallback: 30 s after the confirm when the judge never comes back to the room", { timeout: 90_000 }, async () => {
  const s = await startTry("buyer", "Away Judge");
  await cancelPending(s.dropId);
  await sql`select sandbox_next(${s.dropId}, ${s.ownerId}, 0, null, null)`;
  const loop = runLoop(s.dropId, 60_000);
  try {
    const p1 = await item(s.dropId, 1);
    const w = await fn<J>("claim_dibs", p1.id, "rose", s.buyerId, new Date());
    assert.equal(w.result, "won");
    await fn("order_paid_claim", w.orderId, s.buyerId, "123456789012");
    await onDropEvent({ type: "order_paid_claim", dropId: s.dropId, orderId: w.orderId });
    await waitFor("confirm", async () => (await sql`select 1 from orders where id = ${w.orderId} and state = 'paid'`)[0], 8000);
    const confirmedAt = Date.now();
    await sleep(20_000);
    assert.equal(await item(s.dropId, 2), undefined, "still waiting for the judge");
    await waitFor("fallback piece 2", () => item(s.dropId, 2), 20_000, 250);
    const ms = Date.now() - confirmedAt;
    assert.ok(ms >= 29_000 - SLACK && ms <= 30_000 + SLACK, `fallback after ${ms} ms`);
    await roomTick(s.dropId);
    assert.equal((await sql`select count(*)::int as n from bot_schedule where drop_id = ${s.dropId} and payload ? 'afterRoom'`)[0].n, 0, "a late room tick adds nothing");
  } finally {
    await finish(s.dropId, s.ownerId);
    await loop;
  }
});

test("a claimed action that throws is tried once more; next and chat are not repeated", async () => {
  const s = await startTry("buyer", "Retry Tester");
  try {
    await cancelPending(s.dropId);
    const slot = (await slotOf(s.dropId))!;
    const row = (action: Row["action"], payload: Row["payload"] = { orderId: "00000000-0000-4000-8000-000000000000" }): Row => ({ id: "x", action, payload });
    const queued = () => sql`select action, payload from bot_schedule where drop_id = ${s.dropId} and done_at is null`;
    assert.equal(await retryOnce(slot, row("confirm")), true);
    const [q] = await queued();
    assert.equal(q.action, "confirm");
    assert.equal(q.payload.retried, true);
    assert.equal(await retryOnce(slot, row("confirm", { ...q.payload })), false, "a retried row is not queued again");
    assert.equal(await retryOnce(slot, row("next", { ifPosition: 1 })), false);
    assert.equal(await retryOnce(slot, row("chat", { text: "hi" })), false);
    assert.equal((await queued()).length, 1);
  } finally {
    await finish(s.dropId, s.ownerId);
  }
});
