// Claim engine under real concurrency: many calls in flight at once through the transaction pooler.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { admin, pool, call, claim, sweep, staffCall, makeFixture, closeAll, forceExpire, stockInvariant, type J } from "./helpers.ts";

after(closeAll);

/** Runs a call and also reports which server backend served it (to measure real parallelism). */
async function claimWithPid(item: string, key: string, buyer: string) {
  const [row] = await pool`select claim_dibs(${item}::uuid, ${key}, ${buyer}::uuid, ${new Date().toISOString()}::timestamptz) as r, pg_backend_pid() as pid`;
  return { ...(row.r as J), pid: row.pid as number } as J;
}

test("300 concurrent claims on 2 units: 2 won, 20 waitlisted in commit order, rest waitlist_full", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 2 }, { key: "L", qty: 5 }] }], buyers: 300 });
  const item = f.items[0].id;
  await Promise.all(Array.from({ length: 40 }, () => pool`select 1`)); // warm the pool
  const t0 = performance.now();
  const results = await Promise.all(f.buyers.map((b) => claimWithPid(item, "M", b)));
  const ms = performance.now() - t0;
  const count = (r: string) => results.filter((x) => x.result === r).length;
  const pids = new Set(results.map((r) => r.pid)).size;
  console.log(`# 300 claims: ${ms.toFixed(0)} ms wall, ${pids} distinct server backends, won=${count("won")} waitlisted=${count("waitlisted")} full=${count("waitlist_full")}`);
  assert.equal(count("won"), 2);
  assert.equal(count("waitlisted"), 20);
  assert.equal(count("waitlist_full"), 278);
  const waits = await admin`select id, committed_at from claims where drop_item_id = ${item} and state = 'waitlisted' order by committed_at, id`;
  const posById = new Map(results.filter((r) => r.result === "waitlisted").map((r) => [r.claimId, r.position]));
  assert.deepEqual(waits.map((w) => posById.get(w.id)), Array.from({ length: 20 }, (_, i) => i + 1));
  const [st] = await admin`select available from item_stock where drop_item_id = ${item} and variant_id = ${f.items[0].variants.M}`;
  assert.equal(st.available, 0);
  const orders = await admin`select count(*)::int as n from orders where drop_id = ${f.dropId}`;
  assert.equal(orders[0].n, 2);
  const winners = await admin`select committed_at from claims where drop_item_id = ${item} and state = 'held'`;
  for (const w of winners) assert.ok(w.committed_at <= waits[0].committed_at, "winners committed before the first waitlister");
  for (const r of await stockInvariant(f.dropId)) assert.equal(r.total, r.available + r.taken);
});

test("same buyer fired concurrently: one claim, the rest 'already'", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 3 }] }], buyers: 1 });
  const rs = await Promise.all(Array.from({ length: 12 }, () => claim(f.items[0].id, "M", f.buyers[0])));
  assert.equal(rs.filter((r) => r.result === "won").length, 1);
  assert.equal(rs.filter((r) => r.result === "already").length, 11);
  const n = await admin`select count(*)::int as n from claims where drop_item_id = ${f.items[0].id}`;
  assert.equal(n[0].n, 1);
});

test("claims racing item_close are fully accepted or refused, never half-written (many iterations)", async () => {
  const N = 25;
  const f = await makeFixture({ items: Array.from({ length: N }, () => ({ variants: [{ key: "M", qty: 2 }] })), buyers: 6, maxHolds: 5 });
  for (let i = 0; i < N; i++) {
    const item = f.items[i].id;
    if (i > 0) assert.equal((await staffCall("drop_next", f.dropId, f.ownerId)).liveItemId, item);
    const jobs: Promise<J>[] = f.buyers.map((b) => claim(item, "M", b));
    jobs.splice(i % 6, 0, staffCall("item_close", item, f.ownerId));
    const rs = await Promise.all(jobs);
    const claimResults = rs.filter((r) => "result" in r);
    for (const r of claimResults) assert.ok(["won", "waitlisted", "closed"].includes(r.result), r.result);
    const accepted = claimResults.filter((r) => r.result !== "closed");
    const rows = await admin`select c.id, c.state, c.order_id, c.committed_at, i.closed_at from claims c join drop_items i on i.id = c.drop_item_id where c.drop_item_id = ${item}`;
    assert.equal(rows.length, accepted.length, "every accepted claim has a row, no refused claim does");
    for (const r of rows) {
      assert.ok(r.committed_at < r.closed_at, "claim committed before the close");
      if (r.state === "held") assert.ok(r.order_id);
    }
    const won = claimResults.filter((r) => r.result === "won").length;
    const orders = await admin`select count(*)::int as n from orders where claim_id in (select id from claims where drop_item_id = ${item})`;
    assert.equal(orders[0].n, won);
    const [st] = await admin`select available from item_stock where drop_item_id = ${item}`;
    assert.equal(st.available, 2 - won);
    // free the buyers' holds for the next round
    for (;;) {
      const held = await admin`select id from claims where drop_item_id = ${item} and state = 'held' limit 1`;
      if (!held.length) break;
      assert.equal((await call("release_claim", [[held[0].id, "uuid"], ["staff", "text"], [f.ownerId, "uuid"], ["round over", "text"]])).ok, true);
    }
  }
  for (const r of await stockInvariant(f.dropId)) assert.equal(r.total, r.available + r.taken);
});

test("10 concurrent sweeps promote each unit exactly once", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 3 }] }], buyers: 7, holdSeconds: 20 });
  const item = f.items[0].id;
  const rs: J[] = [];
  for (const b of f.buyers) rs.push(await claim(item, "M", b));
  const winners = rs.filter((r) => r.result === "won").map((r) => r.claimId);
  assert.equal(winners.length, 3);
  await forceExpire(winners);
  const sweeps = await Promise.all(Array.from({ length: 10 }, () => sweep(f.dropId)));
  const sum = (k: string) => sweeps.reduce((a, s) => a + s[k], 0);
  assert.deepEqual([sum("expired"), sum("promoted"), sum("returned")], [3, 3, 0]);
  const states = await admin`select state, count(*)::int as n from claims where drop_item_id = ${item} group by state order by state`;
  assert.deepEqual(Object.fromEntries(states.map((s) => [s.state, s.n])), { expired: 3, held: 3, waitlisted: 1 });
  const promotedAlerts = await admin`select count(*)::int as n from outbox where drop_id = ${f.dropId} and payload->>'kind' = 'promoted'`;
  assert.equal(promotedAlerts[0].n, 3);
  const orders = await admin`select count(*)::int as n from orders where drop_id = ${f.dropId} and state = 'held'`;
  assert.equal(orders[0].n, 3);
  for (const r of await stockInvariant(f.dropId)) assert.equal(r.total, r.available + r.taken);
});

test("stress: random claim / release / expire+sweep / close+reopen across concurrent workers keeps stock exact", async () => {
  const f = await makeFixture({
    items: [{ variants: [{ key: "S", qty: 2 }, { key: "M", qty: 2 }, { key: "L", qty: 1 }] }],
    buyers: 30, maxHolds: 3, waitlistMax: 4, holdSeconds: 20,
  });
  const item = f.items[0].id;
  const keys = ["S", "M", "L"];
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  const tally: Record<string, number> = {};
  let ops = 0;
  const TOTAL = 320;
  async function worker() {
    while (ops < TOTAL) {
      ops++;
      const roll = Math.random();
      let tag: string;
      if (roll < 0.55) {
        tag = "claim:" + (await claim(item, pick(keys), pick(f.buyers))).result;
      } else if (roll < 0.72) {
        const held = await admin`select id, buyer_id from claims where drop_item_id = ${item} and state = 'held' order by random() limit 1`;
        tag = held.length ? "release:" + ((await call("release_claim", [[held[0].id, "uuid"], ["buyer", "text"], [held[0].buyer_id, "uuid"], ["", "text"]])).ok ? "ok" : "refused") : "release:none";
      } else if (roll < 0.9) {
        const held = await admin`select id from claims where drop_item_id = ${item} and state = 'held' order by random() limit 1`;
        if (held.length) await forceExpire([held[0].id]);
        const s = await sweep(f.dropId);
        tag = `sweep:${s.expired}`;
      } else {
        const c = await staffCall("item_close", item, f.ownerId);
        const r = await staffCall("item_reopen", item, f.ownerId);
        tag = `close:${c.ok ? "ok" : c.error}/reopen:${r.ok ? "ok" : r.error}`;
      }
      tally[tag] = (tally[tag] ?? 0) + 1;
    }
  }
  const t0 = performance.now();
  await Promise.all(Array.from({ length: 12 }, worker));
  console.log(`# stress: ${ops} ops in ${(performance.now() - t0).toFixed(0)} ms`, JSON.stringify(tally));
  await sweep(f.dropId);
  for (const r of await stockInvariant(f.dropId)) {
    assert.equal(r.total, r.available + r.taken, `stock row ${r.variant_id}`);
    assert.ok(r.available >= 0 && r.taken <= r.total);
  }
  const dupes = await admin`select buyer_id, count(*)::int as n from claims where drop_item_id = ${item} and state in ('held','payment_claimed','waitlisted') group by buyer_id having count(*) > 1`;
  assert.equal(dupes.length, 0, "one active claim per buyer per item");
  const orphan = await admin`
    select c.id from claims c left join orders o on o.id = c.order_id
     where c.drop_item_id = ${item} and c.state in ('held','payment_claimed','paid','shipped') and (o.id is null or o.state = 'cancelled' or o.claim_id <> c.id)`;
  assert.equal(orphan.length, 0, "every active claim has its own live order");
  const deadOrders = await admin`
    select o.id from orders o join claims c on c.id = o.claim_id
     where o.drop_id = ${f.dropId} and o.state <> 'cancelled' and c.state not in ('held','payment_claimed','paid','shipped')`;
  assert.equal(deadOrders.length, 0, "every ended claim's order is cancelled");
  const waitWithStock = await admin`
    select s.variant_id from item_stock s where s.drop_item_id = ${item} and s.available > 0
       and exists (select 1 from claims c where c.drop_item_id = s.drop_item_id and c.variant_id = s.variant_id and c.state = 'waitlisted')`;
  assert.equal(waitWithStock.length, 0, "nobody waits while a unit sits in stock");
});
