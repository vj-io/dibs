// 0008 performance changes stay correct: lock-free waitlist_full, coalesced stock cards, state bounds under a burst.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { admin, call, claim, makeFixture, closeAll, staffCall, stockInvariant, type J } from "./helpers.ts";
import { drainOutbox, type Sender } from "../../src/lib/server/outbox.ts";
import { sql } from "../../src/lib/server/db.ts";
import { dropRecord } from "../../src/lib/server/share.ts";

after(async () => { await closeAll(); await sql.end({ timeout: 5 }); });

const release = (claimId: string, buyer: string) =>
  call("release_claim", [[claimId, "uuid"], ["buyer", "text"], [buyer, "uuid"], ["", "text"]]);

test("waitlist_full fast path: a freed place is taken at once, a waiting buyer gets 'already', not 'waitlist_full'", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 1 }] }], buyers: 5, waitlistMax: 2 });
  const item = f.items[0].id, [b0, b1, b2, b3, b4] = f.buyers;
  const won = await claim(item, "M", b0);
  assert.equal(won.result, "won");
  assert.equal((await claim(item, "M", b1)).result, "waitlisted");
  assert.equal((await claim(item, "M", b2)).result, "waitlisted");
  assert.equal((await claim(item, "M", b3)).result, "waitlist_full");
  assert.equal((await claim(item, "M", b1)).result, "already", "a buyer already waiting hears 'already' while the waitlist is full");
  assert.equal((await release(won.claimId, b0)).ok, true); // b1 promoted, one place free
  const r = await claim(item, "M", b3);
  assert.equal(r.result, "waitlisted");
  assert.equal(r.position, 2);
  assert.equal((await claim(item, "M", b4)).result, "waitlist_full");
  for (const s of await stockInvariant(f.dropId)) assert.equal(s.total, s.available + s.taken);
});

test("0019: a waitlist_full tap writes one claim_waitlist_full event and no claim, on both paths, and is in the record", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 1 }] }], buyers: 6, waitlistMax: 2 });
  const item = f.items[0].id, [b0, b1, b2, b3, b4, b5] = f.buyers;
  const won = await claim(item, "M", b0);
  assert.equal(won.result, "won");
  assert.equal((await claim(item, "M", b1)).result, "waitlisted");
  assert.equal((await claim(item, "M", b2)).result, "waitlisted");
  // lock-free path: the full line is in the committed state this tap reads
  assert.equal((await claim(item, "M", b3)).result, "waitlist_full");
  assert.equal((await release(won.claimId, b0)).ok, true); // b1 promoted: one place free
  // locked path: b4 takes the last place inside a transaction that keeps the drop lock; b5's lock-free check sees the
  // free place, so b5 has to queue for the lock (checked), and after the commit the locked path finds the line full
  let b5tap: Promise<J> | undefined;
  const b4claim = await admin.begin(async (tx) => {
    const [{ r }] = await tx`select claim_dibs(${item}::uuid, 'M', ${b4}::uuid, now()) as r`;
    const [{ pid }] = await tx`select pg_backend_pid() as pid`;
    b5tap = claim(item, "M", b5);
    for (let i = 0; ; i++) {
      const [{ n }] = await admin`select count(*)::int as n from pg_stat_activity where ${pid}::int = any(pg_blocking_pids(pid))`;
      if (n > 0) break;
      assert.ok(i < 100, "b5's tap never waited for the drop lock (answered lock-free?)");
      await new Promise((res) => setTimeout(res, 50));
    }
    return r as J;
  });
  assert.equal(b4claim.result, "waitlisted");
  assert.equal((await b5tap!).result, "waitlist_full");

  const ev = await admin`select actor_id, payload from audit_events where drop_id = ${f.dropId} and type = 'claim_waitlist_full' order by id`;
  assert.deepEqual(ev.map((e) => e.actor_id), [b3, b5], "one event per waitlist_full tap");
  for (const e of ev) {
    assert.equal(e.payload.itemId, item);
    assert.equal(e.payload.variant, "M");
    assert.ok(Number.isInteger(e.payload.ms) && e.payload.ms >= 0, `ms ${e.payload.ms}`);
  }
  const [c4] = await admin`select committed_at from claims where id = ${b4claim.claimId}`;
  assert.ok(new Date(ev[1].payload.at) > c4.committed_at, "the locked-path answer comes after the claim that filled the line");
  const [{ n }] = await admin`select count(*)::int as n from claims where drop_item_id = ${item} and buyer_id in ${admin([b3, b5])}`;
  assert.equal(n, 0, "no claim row for a waitlist_full tap");

  const rec = await dropRecord(f.dropId);
  assert.deepEqual(rec.taps.map((t) => [t.seq, t.buyerId, t.state]), [
    [1, b0, "released"], [2, b1, "held"], [3, b2, "waitlisted"], [4, b3, "waitlist_full"], [5, b4, "waitlisted"], [6, b5, "waitlist_full"],
  ]);
  const t4 = rec.taps[3];
  assert.equal(t4.variantLabel, "Size M");
  assert.equal(t4.ms, ev[0].payload.ms);
  assert.equal(t4.isBot, false);
  assert.equal(t4.buyer, "Buyer3 T.");
});

test("waitlist_full fast path racing a release: at most the freed place is filled, never more", async () => {
  const WL = 3, ROUNDS = 8, PER = 8;
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 1 }] }], buyers: 2 + WL + ROUNDS * (PER + 1), waitlistMax: WL });
  const item = f.items[0].id;
  let next = 0;
  const fresh = () => f.buyers[next++];
  const first = fresh();
  assert.equal((await claim(item, "M", first)).result, "won");
  for (;;) { const r = await claim(item, "M", fresh()); if (r.result === "waitlist_full") break; }
  for (let round = 0; round < ROUNDS; round++) {
    const [holder] = await admin`select id, buyer_id from claims where drop_item_id = ${item} and state = 'held'`;
    const [{ n: before }] = await admin`select count(*)::int as n from claims where drop_item_id = ${item} and state = 'waitlisted'`;
    assert.equal(before, WL);
    const buyers = Array.from({ length: PER }, fresh);
    const jobs: Promise<J>[] = buyers.map((b) => claim(item, "M", b));
    jobs.splice(round % PER, 0, release(holder.id, holder.buyer_id));
    const rs = await Promise.all(jobs);
    const joined = rs.filter((r) => r.result === "waitlisted").length;
    for (const r of rs) if ("result" in r) assert.ok(["waitlisted", "waitlist_full"].includes(r.result), r.result);
    assert.ok(joined <= 1, `round ${round}: ${joined} joined one free place`);
    const [{ n: after }] = await admin`select count(*)::int as n from claims where drop_item_id = ${item} and state = 'waitlisted'`;
    assert.equal(after, WL - 1 + joined, `round ${round}`);
    // a place still free after the race must be taken by the next tap (the fast path never answers from a stale view)
    if (after < WL) assert.equal((await claim(item, "M", fresh())).result, "waitlisted");
    const held = await admin`select count(*)::int as n from claims where drop_item_id = ${item} and state = 'held'`;
    assert.equal(held[0].n, 1);
  }
  for (const s of await stockInvariant(f.dropId)) assert.equal(s.total, s.available + s.taken);
  const waits = await admin`select c.id, (select count(*)::int from claims w where w.drop_item_id = c.drop_item_id and w.state = 'waitlisted' and (w.committed_at, w.id) <= (c.committed_at, c.id)) as pos
                              from claims c where c.drop_item_id = ${item} and c.state = 'waitlisted' order by c.committed_at, c.id`;
  assert.deepEqual(waits.map((w) => w.pos), Array.from({ length: waits.length }, (_, i) => i + 1));
});

test("viewers' state during a burst: left stays within 0..total, waiting within the cap", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "S", qty: 2 }, { key: "M", qty: 2 }] }], buyers: 150, waitlistMax: 30 });
  const item = f.items[0].id, seen: J[] = [];
  let done = false;
  const viewers = Array.from({ length: 4 }, async () => {
    while (!done) seen.push((await call("api_state", [[f.dropId, "uuid"]])).state);
  });
  const rs = await Promise.all(f.buyers.map((b, i) => claim(item, i % 2 ? "S" : "M", b)));
  done = true;
  await Promise.all(viewers);
  assert.ok(seen.length > 4, "viewers polled during the burst");
  for (const s of seen) for (const v of s.live.variants) {
    assert.ok(v.left >= 0 && v.left <= 2, `left ${v.left}`);
    assert.ok(v.waiting >= 0 && v.waiting <= 30, `waiting ${v.waiting}`);
  }
  for (const k of ["S", "M"]) {
    const mine = rs.filter((_, i) => (i % 2 ? "S" : "M") === k);
    assert.equal(mine.filter((r) => r.result === "won").length, 2);
    assert.equal(mine.filter((r) => r.result === "waitlisted").length, 30);
    assert.equal(mine.filter((r) => r.result === "waitlist_full").length, 75 - 32);
  }
});

test("coalesced stock cards: every path ends on the database's stock", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 2 }, { key: "L", qty: 1 }] }], buyers: 60, waitlistMax: 40, goLive: false });
  const room = "test_dr_" + f.code; // test_* channels: only a drain that names them takes their rows
  await admin`update drops set nexconn_channel_id = ${room} where id = ${f.dropId}`;
  assert.equal((await staffCall("drop_go_live", f.dropId, f.ownerId)).ok, true);
  assert.equal((await staffCall("drop_next", f.dropId, f.ownerId)).ok, true);
  const item = f.items[0].id;
  const rs = await Promise.all(f.buyers.map((b, i) => claim(item, i % 3 ? "M" : "L", b)));
  const winner = rs.find((r) => r.result === "won")!;
  const wb = f.buyers[rs.indexOf(winner)];
  assert.equal((await release(winner.claimId, wb)).ok, true); // a hand-on in the middle: DB:Back + DB:Stock

  const cards: J[] = [], meta: string[] = [];
  const s: Sender = {
    ensureRoom: async () => {}, destroyRoom: async () => {}, ensureGroup: async () => {}, leaveGroup: async () => {},
    mute: async () => {}, ban: async () => {}, unban: async () => {},
    setRoomMeta: async (_id, kv) => { if (kv.db_item) meta.push(kv.db_item); },
    card: async (_type, channel, card) => { if (channel === room) cards.push(card as J); },
  };
  const [{ rows }] = await admin`select count(*)::int as rows from outbox where channel_id = ${room} and msg_type = 'DB:Stock' and status = 'pending'`;
  for (let i = 0; i < 20; i++) if (!(await drainOutbox({ channels: [room], sender: s, budgetMs: 10_000 })).more) break;
  const [{ left }] = await admin`select count(*)::int as left from outbox where channel_id = ${room} and status = 'pending'`;
  assert.equal(left, 0, "every room row settled");
  const stock = cards.filter((c) => c.t === "DB:Stock");
  console.log(`# ${rows} DB:Stock rows -> ${stock.length} cards sent`);
  assert.ok(stock.length < rows / 4, `${stock.length} stock cards for ${rows} rows`);
  for (let i = 1; i < cards.length; i++) assert.ok(cards[i].v >= cards[i - 1].v, "cards go out in version order");
  const [{ fresh }] = await admin`select _stock_card(${item}, 0) as fresh`;
  const last = stock[stock.length - 1];
  assert.deepEqual(last.variants, fresh.variants, "last room card = database stock");
  assert.deepEqual(JSON.parse(meta[meta.length - 1]).variants, fresh.variants, "room metadata = database stock");
  const st = await call("api_state", [[f.dropId, "uuid"]]);
  assert.deepEqual(st.state.live.variants, fresh.variants, "public state = database stock");
  assert.equal(cards.filter((c) => c.t === "DB:Sold").length, 3, "no sold card is coalesced away");
  assert.equal(cards.filter((c) => c.t === "DB:Back").length, 1, "the hand-on card goes out");
});
