// Claim engine behaviour, one scenario at a time (real Postgres).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { admin, call, claim, sweep, staffCall, makeFixture, closeAll, forceExpire, stockInvariant, snapshot, type J } from "./helpers.ts";

after(closeAll);

const outbox = (dropId: string, sinceId = 0) =>
  admin`select id, channel_type, channel_id, msg_type, payload, priority, next_attempt_at from outbox where drop_id = ${dropId} and id > ${sinceId} order by id`;
const maxOutbox = async (dropId: string) => Number((await admin`select coalesce(max(id),0) as m from outbox where drop_id = ${dropId}`)[0].m);
const claimRow = async (id: string) => (await admin`select * from claims where id = ${id}`)[0];
const release = (claimId: string, actorType: string, actorId: string, reason = "test") =>
  call("release_claim", [[claimId, "uuid"], [actorType, "text"], [actorId, "uuid"], [reason, "text"]]);

const REQUIRED: Record<string, string[]> = {
  "DB:State": ["v", "status", "liveItemId", "startsAt"],
  "DB:Item": ["v", "itemId", "position", "title", "pricePaise", "note", "photos", "liveAt", "variants"],
  "DB:Sold": ["v", "itemId", "variant", "variantLabel", "buyer", "isBot", "ms", "left"],
  "DB:Back": ["v", "itemId", "variant", "variantLabel", "buyer", "isBot", "reason"],
  "DB:Stock": ["v", "itemId", "state", "variants"],
  "DB:Alert": ["kind", "orderId", "dropCode", "text"],
  "DB:Order": ["orderId", "orderNo", "item", "variantLabel", "pricePaise", "expiresAt", "photo"],
  "DB:Pay": ["orderId", "amountPaise", "upiId", "payee", "upiLink"],
  "DB:Status": ["orderId", "state", "by", "note", "at"],
  "DB:Desk": ["orderId", "orderNo", "buyer", "item", "variantLabel", "amountPaise", "assignedTo", "state", "event"],
  "SYS:EnsureGroup": ["channelId", "name", "memberIds"],
  "SYS:RoomMeta": ["channelId", "key", "value"],
  "SYS:DestroyRoom": ["channelId"],
};
function checkShape(row: J) {
  const keys = REQUIRED[row.msg_type];
  assert.ok(keys, `unknown msg_type ${row.msg_type}`);
  for (const k of keys) assert.ok(k in row.payload, `${row.msg_type} missing ${k}`);
  if (row.msg_type.startsWith("DB:")) assert.equal(row.payload.t, row.msg_type);
  if (row.payload.variants) for (const v of row.payload.variants) for (const k of ["key", "label", "left", "waiting"]) assert.ok(k in v, "VariantLive." + k);
}

test("a win writes order, outbox in order with codec shapes, and no phone numbers", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 1 }, { key: "L", qty: 1 }] }], buyers: 2, staff: 1 });
  const from = await maxOutbox(f.dropId);
  const r = await claim(f.items[0].id, "M", f.buyers[0]);
  assert.equal(r.result, "won");
  assert.ok(r.claimId && r.orderId && r.expiresAt && typeof r.ms === "number");
  const rows = await outbox(f.dropId, from);
  assert.deepEqual(rows.map((x) => x.msg_type), ["SYS:EnsureGroup", "DB:Order", "DB:Pay", "DB:Desk", "DB:Sold", "DB:Stock"]);
  // room cards say which drop they belong to (pooled judge-mode channels); the drain, not the engine, mirrors metadata
  for (const x of rows.filter((r) => r.channel_type === "room")) assert.equal(x.payload.dropId, f.dropId);
  rows.forEach(checkShape);
  const [order] = await admin`select * from orders where id = ${r.orderId}`;
  assert.equal(order.state, "held");
  assert.equal(order.order_no, 1);
  assert.match(order.nexconn_group_id, /^ord_[0-9a-f]{20}$/);
  const group = rows[0].payload;
  assert.equal(group.channelId, order.nexconn_group_id);
  assert.ok(group.memberIds.includes("dibs_bot") && group.memberIds.length === 3);
  assert.equal(rows[1].channel_id, order.nexconn_group_id);
  const [shop] = await admin`select nexconn_desk_id from shops where id = ${f.shopId}`;
  assert.equal(rows[3].channel_id, shop.nexconn_desk_id);
  assert.equal(rows[3].payload.event, "new");
  assert.equal(rows[4].channel_type, "room");
  assert.equal(rows[4].channel_id, "dr_" + f.code);
  assert.equal(rows[4].priority, "high");
  assert.equal(rows[4].payload.buyer, "Buyer0 T.");
  assert.equal(rows[4].payload.left, 0);
  assert.equal(rows[2].payload.upiLink, `upi://pay?pa=test@upi&pn=Test%20%26%20Sons&am=1450.00&cu=INR&tn=Dibs%20order%20${order.order_no}`);
  assert.equal(rows[5].payload.state, "live", "L is still in stock");
  // second variant sells: item becomes sold_out
  const r2 = await claim(f.items[0].id, "L", f.buyers[1]);
  assert.equal(r2.result, "won");
  const [it] = await admin`select state from drop_items where id = ${f.items[0].id}`;
  assert.equal(it.state, "sold_out");
  const [o2] = await admin`select order_no from orders where id = ${r2.orderId}`;
  assert.equal(o2.order_no, 2);
  const phones = await admin`select phone from buyers where id in ${admin(f.buyers)}`;
  const all = JSON.stringify((await outbox(f.dropId)).map((x) => x.payload));
  for (const p of phones) assert.ok(!all.includes(p.phone), "phone leaked into outbox");
  const audits = await admin`select type from audit_events where drop_id = ${f.dropId}`;
  assert.ok(audits.length >= 2);
});

test("same buyer twice gives one claim and 'already'", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 1 }] }], buyers: 1 });
  const a = await claim(f.items[0].id, "M", f.buyers[0]);
  const b = await claim(f.items[0].id, "M", f.buyers[0]);
  assert.equal(a.result, "won");
  assert.equal(b.result, "already");
  assert.equal(b.claimId, a.claimId);
  const n = await admin`select count(*)::int as n from claims where drop_item_id = ${f.items[0].id}`;
  assert.equal(n[0].n, 1);
});

test("hold limit counts held + payment_claimed across items of a drop", async () => {
  const f = await makeFixture({ items: [1, 2, 3].map(() => ({ variants: [{ key: "M", qty: 2 }] })), buyers: 2, maxHolds: 2 });
  const [b] = f.buyers;
  assert.equal((await claim(f.items[0].id, "M", b)).result, "won");
  const o = await claim(f.items[0].id, "M", f.buyers[1]);
  assert.equal((await staffCall("drop_next", f.dropId, f.ownerId)).ok, true);
  const w2 = await claim(f.items[1].id, "M", b);
  assert.equal(w2.result, "won");
  assert.equal((await call("order_paid_claim", [[w2.orderId, "uuid"], [b, "uuid"], ["UTR1", "text"]])).ok, true);
  assert.equal((await staffCall("drop_next", f.dropId, f.ownerId)).ok, true);
  assert.equal((await claim(f.items[2].id, "M", b)).result, "too_many_holds");
  assert.equal(o.result, "won");
});

test("a buyer promoted past max_holds keeps the promotion but cannot claim more while at or over the limit", async () => {
  const f = await makeFixture({ items: [1, 2, 3].map(() => ({ variants: [{ key: "M", qty: 1 }] })), buyers: 2, maxHolds: 1 });
  const [a, b] = f.buyers;
  const p1 = await claim(f.items[0].id, "M", a);
  assert.equal(p1.result, "won");                                     // a: 1 hold = the limit
  assert.equal((await staffCall("drop_next", f.dropId, f.ownerId)).ok, true);
  const p2 = await claim(f.items[1].id, "M", b);
  assert.equal(p2.result, "won");
  assert.equal((await claim(f.items[1].id, "M", a)).result, "waitlisted", "queueing is not a hold");
  await forceExpire([p2.claimId]);
  assert.equal((await sweep(f.dropId)).promoted, 1, "promoted although at the limit: they queued in good faith");
  const held = await admin`select count(*)::int as n from claims where drop_id = ${f.dropId} and buyer_id = ${a} and state = 'held'`;
  assert.equal(held[0].n, 2);
  assert.equal((await staffCall("drop_next", f.dropId, f.ownerId)).ok, true);
  assert.equal((await claim(f.items[2].id, "M", a)).result, "too_many_holds", "over the limit: no further claims");
  assert.equal((await release(p1.claimId, "buyer", a)).ok, true);
  assert.equal((await claim(f.items[2].id, "M", a)).result, "too_many_holds", "back at the limit: still none");
});

test("status cards name the staff member who confirmed and shipped", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 1 }] }], buyers: 1, staff: 1 });
  const w = await claim(f.items[0].id, "M", f.buyers[0]);
  const from = await maxOutbox(f.dropId);
  const staff = f.staffIds[1];
  assert.equal((await call("order_confirm", [[w.orderId, "uuid"], [staff, "uuid"], [true, "boolean"], [null, "text"]])).ok, true);
  assert.equal((await call("order_ship", [[w.orderId, "uuid"], [staff, "uuid"], [null, "text"]])).ok, true);
  const by = (await outbox(f.dropId, from)).filter((x) => x.msg_type === "DB:Status").map((x) => [x.payload.state, x.payload.by]);
  assert.deepEqual(by, [["paid", "Staff 0"], ["shipped", "Staff 0"]]);
});

test("a banned or deleted buyer at the head of the waitlist is skipped, not promoted; a ban ends waitlist places", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 1 }] }], buyers: 4 });
  const [holder, banned, gone, next] = f.buyers;
  const h = await claim(f.items[0].id, "M", holder);
  for (const b of [banned, gone, next]) assert.equal((await claim(f.items[0].id, "M", b)).result, "waitlisted");
  await admin`insert into bans (shop_id, buyer_id, kind) values (${f.shopId}, ${banned}, 'ban')`;
  await admin`update buyers set deleted_at = now() where id = ${gone}`;
  await forceExpire([h.claimId]);
  assert.equal((await sweep(f.dropId)).promoted, 1);
  const st = await admin`select buyer_id, state, ended_reason from claims where drop_item_id = ${f.items[0].id} order by committed_at`;
  assert.deepEqual(st.map((x) => [x.buyer_id, x.state, x.ended_reason]),
    [[holder, "expired", "expired"], [banned, "left", "banned"], [gone, "left", "banned"], [next, "held", null]]);
  // ban_leave_waitlists: a newly banned buyer leaves every waitlist of the shop's open drops
  const other = f.buyers[0];
  assert.equal((await claim(f.items[0].id, "M", other)).result, "waitlisted");
  assert.equal(await call("ban_leave_waitlists", [[f.shopId, "uuid"], [other, "uuid"]]), 1);
  assert.equal((await admin`select state from claims where buyer_id = ${other} and drop_item_id = ${f.items[0].id} order by committed_at desc limit 1`)[0].state, "left");
});

test("a /try visitor (sandbox buyer) cannot claim in a real drop; phones are not unique", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 2 }] }], buyers: 2 });
  await admin`update drops set is_sandbox = false where id = ${f.dropId}`;
  assert.equal((await claim(f.items[0].id, "M", f.buyers[0])).result, "banned", "fixture buyers are sandbox buyers");
  await admin`update buyers set is_sandbox = false where id = ${f.buyers[1]}`;
  assert.equal((await claim(f.items[0].id, "M", f.buyers[1])).result, "won");
  const [{ phone }] = await admin`select phone from buyers where id = ${f.buyers[1]}`;
  const [dup] = await admin`insert into buyers (name, display_name, phone) values ('Same Phone', 'Same P.', ${phone}) returning id`;
  await admin`delete from buyers where id = ${dup.id}`;
});

test("claims on queued, closed, scheduled and ended items are refused; unknown variant", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 1 }] }, { variants: [{ key: "M", qty: 1 }] }], buyers: 2, goLive: false });
  assert.equal((await claim(f.items[0].id, "M", f.buyers[0])).result, "not_live");
  await staffCall("drop_go_live", f.dropId, f.ownerId);
  assert.equal((await claim(f.items[0].id, "M", f.buyers[0])).result, "not_live");
  await staffCall("drop_next", f.dropId, f.ownerId);
  assert.equal((await claim(f.items[1].id, "M", f.buyers[0])).result, "not_live");
  assert.equal((await claim(f.items[0].id, "XL", f.buyers[0])).result, "no_variant");
  assert.equal((await staffCall("item_close", f.items[0].id, f.ownerId)).ok, true);
  assert.equal((await claim(f.items[0].id, "M", f.buyers[0])).result, "closed");
  const re = await staffCall("item_reopen", f.items[0].id, f.ownerId);
  assert.equal(re.ok, true);
  assert.equal(re.liveItemId, f.items[0].id);
  assert.equal((await claim(f.items[0].id, "M", f.buyers[0])).result, "won");
  await staffCall("drop_end", f.dropId, f.ownerId);
  assert.equal((await claim(f.items[0].id, "M", f.buyers[1])).result, "closed");
});

test("drop_next / item_reopen: one live item, another_live refused", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 1 }] }, { variants: [{ key: "M", qty: 1 }] }], buyers: 1 });
  const n = await staffCall("drop_next", f.dropId, f.ownerId);
  assert.equal(n.liveItemId, f.items[1].id);
  const states = await admin`select id, state, live_at from drop_items where drop_id = ${f.dropId} order by position`;
  assert.deepEqual(states.map((s) => s.state), ["closed", "live"]);
  assert.equal((await staffCall("item_reopen", f.items[0].id, f.ownerId)).error, "another_live");
  const from = await maxOutbox(f.dropId);
  await staffCall("drop_end", f.dropId, f.ownerId);
  const rows = await outbox(f.dropId, from);
  rows.forEach(checkShape);
  const destroy = rows.find((r) => r.msg_type === "SYS:DestroyRoom")!;
  assert.ok(destroy && new Date(destroy.next_attempt_at).getTime() > Date.now() + 9 * 60_000);
  assert.equal(rows.find((r) => r.msg_type === "DB:State")!.payload.status, "ended");
});

test("staff from another shop is forbidden", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 2 }] }], buyers: 1 });
  const g = await makeFixture({ items: [{ variants: [{ key: "M", qty: 1 }] }], buyers: 0 });
  const w = await claim(f.items[0].id, "M", f.buyers[0]);
  for (const r of [
    await staffCall("drop_next", f.dropId, g.ownerId),
    await staffCall("item_close", f.items[0].id, g.ownerId),
    await staffCall("drop_end", f.dropId, g.ownerId),
    await call("order_confirm", [[w.orderId, "uuid"], [g.ownerId, "uuid"], [true, "boolean"], [null, "text"]]),
    await call("order_ship", [[w.orderId, "uuid"], [g.ownerId, "uuid"], [null, "text"]]),
    await call("order_assign", [[w.orderId, "uuid"], [g.ownerId, "uuid"], [g.ownerId, "uuid"]]),
    await release(w.claimId, "staff", g.ownerId),
  ]) assert.deepEqual([r.ok, r.error], [false, "forbidden"]);
  assert.equal((await call("console_state", [[f.dropId, "uuid"], [g.ownerId, "uuid"]])).error, "forbidden");
  assert.equal((await release(w.claimId, "buyer", g.ownerId)).error, "forbidden");
});

test("sweep expires, promotes in order, returns stock when nobody waits; second run changes nothing", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 1 }] }], buyers: 3, holdSeconds: 20 });
  const item = f.items[0].id;
  const [a, b, c] = [await claim(item, "M", f.buyers[0]), await claim(item, "M", f.buyers[1]), await claim(item, "M", f.buyers[2])];
  assert.deepEqual([a.result, b.result, c.result, b.position, c.position], ["won", "waitlisted", "waitlisted", 1, 2]);
  assert.equal((await admin`select state from drop_items where id = ${item}`)[0].state, "sold_out");

  await forceExpire([a.claimId]);
  const from = await maxOutbox(f.dropId);
  assert.deepEqual(await sweep(f.dropId), { expired: 1, promoted: 1, returned: 0, warned: 0, missed: 0 });
  assert.equal((await claimRow(a.claimId)).state, "expired");
  const pb = await claimRow(b.claimId);
  assert.equal(pb.state, "held");
  assert.ok(pb.order_id && new Date(pb.expires_at).getTime() > Date.now() + 10_000);
  assert.equal((await admin`select state from orders where id = ${a.orderId}`)[0].state, "cancelled");
  const rows = await outbox(f.dropId, from);
  rows.forEach(checkShape);
  const alerts = rows.filter((r) => r.msg_type === "DB:Alert");
  assert.deepEqual(alerts.map((x) => x.payload.kind).sort(), ["expired", "promoted"]);
  assert.equal(alerts.find((x) => x.payload.kind === "promoted")!.payload.text, "It's yours! The buyer ahead didn't pay. Pay within 00:20");
  assert.equal(alerts.find((x) => x.payload.kind === "expired")!.payload.text, "Your hold on #1 ran out. It went to the next buyer.");
  const back = rows.find((r) => r.msg_type === "DB:Back")!;
  assert.equal(back.payload.buyer, "Buyer1 T.");
  assert.equal(back.payload.reason, "expired");
  const me = await call("my_status", [[f.dropId, "uuid"], [f.buyers[2], "uuid"]]);
  assert.equal(me.waits[0].waitPosition, 1);

  const s1 = await snapshot(f.dropId);
  assert.deepEqual(await sweep(f.dropId), { expired: 0, promoted: 0, returned: 0, warned: 0, missed: 0 });
  assert.deepEqual(await snapshot(f.dropId), s1);

  await forceExpire([b.claimId]);
  assert.equal((await sweep(f.dropId)).promoted, 1);
  assert.equal((await claimRow(c.claimId)).state, "held");
  await forceExpire([c.claimId]);
  const from2 = await maxOutbox(f.dropId);
  assert.deepEqual(await sweep(f.dropId), { expired: 1, promoted: 0, returned: 1, warned: 0, missed: 0 });
  const [st] = await admin`select available from item_stock where drop_item_id = ${item}`;
  assert.equal(st.available, 1);
  assert.equal((await admin`select state from drop_items where id = ${item}`)[0].state, "live");
  const rows2 = await outbox(f.dropId, from2);
  const back2 = rows2.find((r) => r.msg_type === "DB:Back")!;
  assert.equal(back2.payload.buyer, null);
  assert.ok(rows2.some((r) => r.msg_type === "DB:Stock" && r.payload.state === "live"));
  const s2 = await snapshot(f.dropId);
  await sweep(f.dropId);
  assert.deepEqual(await snapshot(f.dropId), s2);
  for (const r of await stockInvariant(f.dropId)) assert.equal(r.total, r.available + r.taken);
});

test("expiring-in-2-min alert is sent once, only when hold time >= 5 min", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 1 }] }], buyers: 1, holdSeconds: 600 });
  const a = await claim(f.items[0].id, "M", f.buyers[0]);
  await admin`update claims set expires_at = clock_timestamp() + interval '90 seconds' where id = ${a.claimId}`;
  assert.equal((await sweep(f.dropId)).warned, 1);
  assert.equal((await sweep(f.dropId)).warned, 0);
});

test("payment_claimed pauses expiry; not received gives 5 minutes; then paid and shipped", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 1 }] }], buyers: 2, holdSeconds: 20 });
  const a = await claim(f.items[0].id, "M", f.buyers[0]);
  await claim(f.items[0].id, "M", f.buyers[1]);
  assert.equal((await call("order_paid_claim", [[a.orderId, "uuid"], [f.buyers[1], "uuid"], [null, "text"]])).error, "forbidden");
  assert.equal((await call("order_paid_claim", [[a.orderId, "uuid"], [f.buyers[0], "uuid"], ["UTR123", "text"]])).ok, true);
  await forceExpire([a.claimId]);
  assert.equal((await sweep(f.dropId)).expired, 0);
  assert.equal((await claimRow(a.claimId)).state, "payment_claimed");
  const nr = await call("order_confirm", [[a.orderId, "uuid"], [f.ownerId, "uuid"], [false, "boolean"], ["not seen", "text"]]);
  assert.equal(nr.ok, true);
  const c = await claimRow(a.claimId);
  assert.equal(c.state, "held");
  const left = new Date(c.expires_at).getTime() - Date.now();
  assert.ok(left > 280_000 && left < 320_000, "about 5 minutes: " + left);
  assert.equal((await admin`select state from orders where id = ${a.orderId}`)[0].state, "held");
  assert.equal((await call("order_paid_claim", [[a.orderId, "uuid"], [f.buyers[0], "uuid"], [null, "text"]])).ok, true);
  assert.equal((await call("order_confirm", [[a.orderId, "uuid"], [f.ownerId, "uuid"], [true, "boolean"], [null, "text"]])).ok, true);
  assert.equal((await call("order_ship", [[a.orderId, "uuid"], [f.ownerId, "uuid"], ["DTDC 123", "text"]])).ok, true);
  const [o] = await admin`select state, paid_at, shipped_at, tracking_note from orders where id = ${a.orderId}`;
  assert.deepEqual([o.state, !!o.paid_at, !!o.shipped_at, o.tracking_note], ["shipped", true, true, "DTDC 123"]);
  assert.equal((await claimRow(a.claimId)).state, "shipped");
  for (const r of await outbox(f.dropId)) checkShape(r);
});

test("release and staff cancel promote the next buyer; leave_waitlist renumbers", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 1 }] }], buyers: 5, staff: 1 });
  const item = f.items[0].id;
  const cs: J[] = [];
  for (const b of f.buyers) cs.push(await claim(item, "M", b));
  assert.deepEqual(cs.map((c) => c.position ?? null), [null, 1, 2, 3, 4]);
  assert.equal((await release(cs[0].claimId, "buyer", f.buyers[1])).error, "forbidden");
  assert.equal((await release(cs[0].claimId, "buyer", f.buyers[0])).ok, true);
  assert.equal((await claimRow(cs[0].claimId)).state, "released");
  assert.equal((await claimRow(cs[1].claimId)).state, "held");
  assert.equal((await release(cs[1].claimId, "staff", f.staffIds[1], "no reply")).ok, true);
  const c1 = await claimRow(cs[1].claimId);
  assert.deepEqual([c1.state, c1.ended_reason], ["cancelled", "no reply"]);
  assert.equal((await claimRow(cs[2].claimId)).state, "held");
  assert.equal((await call("leave_waitlist", [[cs[3].claimId, "uuid"], [f.buyers[3], "uuid"]])).ok, true);
  const me = await call("my_status", [[f.dropId, "uuid"], [f.buyers[4], "uuid"]]);
  assert.equal(me.waits[0].waitPosition, 1);
  const me2 = await call("my_status", [[f.dropId, "uuid"], [f.buyers[2], "uuid"]]);
  assert.equal(me2.holds[0].state, "held");
  assert.equal((await release(cs[0].claimId, "buyer", f.buyers[0])).error, "bad_state");
  for (const r of await stockInvariant(f.dropId)) assert.equal(r.total, r.available + r.taken);
});

test("assignment: high value goes to owner; otherwise fewest open orders", async () => {
  const f = await makeFixture({ items: [{ price: 500000, variants: [{ key: "M", qty: 1 }] }, { price: 1000, variants: [{ key: "M", qty: 3 }] }], buyers: 4, staff: 2, highValue: 400000 });
  const hv = await claim(f.items[0].id, "M", f.buyers[0]);
  assert.equal((await admin`select assigned_staff_id from orders where id = ${hv.orderId}`)[0].assigned_staff_id, f.ownerId);
  await staffCall("drop_next", f.dropId, f.ownerId);
  const got: string[] = [];
  for (const b of f.buyers.slice(1)) {
    const r = await claim(f.items[1].id, "M", b);
    got.push((await admin`select assigned_staff_id from orders where id = ${r.orderId}`)[0].assigned_staff_id);
  }
  assert.deepEqual(new Set(got.slice(0, 2)), new Set(f.staffIds.slice(1)), "the two staff with no open orders get the first two");
  assert.equal(got[2], f.ownerId, "all tied at one open order: oldest last_assigned_at (the owner) is next");
  const as = await call("order_assign", [[hv.orderId, "uuid"], [f.ownerId, "uuid"], [f.staffIds[1], "uuid"]]);
  assert.equal(as.ok, true);
});

test("drop_end marks waitlisters with no hold ahead as missed", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 1 }] }], buyers: 3 });
  const item = f.items[0].id;
  const [a, b, c] = [await claim(item, "M", f.buyers[0]), await claim(item, "M", f.buyers[1]), await claim(item, "M", f.buyers[2])];
  assert.equal((await staffCall("drop_end", f.dropId, f.ownerId)).ok, true);
  assert.equal((await claimRow(a.claimId)).state, "held");
  assert.equal((await claimRow(b.claimId)).state, "waitlisted", "one hold ahead of #1");
  assert.equal((await claimRow(c.claimId)).state, "missed");
  const missed = await admin`select payload from outbox where drop_id = ${f.dropId} and msg_type = 'DB:Alert' and payload->>'kind' = 'missed'`;
  assert.equal(missed.length, 1);
  assert.equal(missed[0].payload.text, "Missed it this time");
  // the delayed room teardown has its own channel key, so it never holds back room cards
  const [destroy] = await admin`select channel_id, payload from outbox where drop_id = ${f.dropId} and msg_type = 'SYS:DestroyRoom'`;
  assert.equal(destroy.channel_id, "destroy:dr_" + f.code);
  assert.equal(destroy.payload.channelId, "dr_" + f.code);
  await forceExpire([a.claimId]);
  assert.equal((await sweep(f.dropId)).promoted, 1);
  assert.equal((await claimRow(b.claimId)).state, "held");
});

test("read functions: drop_state, my_status, console_state, drop_dashboard, impact_totals, rate_add", async () => {
  const f = await makeFixture({ items: [{ variants: [{ key: "M", qty: 1 }] }, { variants: [{ key: "S", qty: 1 }] }], buyers: 2 });
  const w = await claim(f.items[0].id, "M", f.buyers[0]);
  await claim(f.items[0].id, "M", f.buyers[1]);
  const s = await call("drop_state", [[f.dropId, "uuid"]]);
  for (const k of ["dropId", "code", "title", "status", "startsAt", "version", "isSandbox", "channelId", "shop", "live", "items", "recent"]) assert.ok(k in s, "drop_state." + k);
  assert.equal(s.live.itemId, f.items[0].id);
  assert.equal(s.live.state, "sold_out");
  assert.equal(s.live.variants[0].waiting, 1);
  assert.equal(s.items.length, 2);
  assert.equal(s.recent[0].t, "DB:Sold");
  const me = await call("my_status", [[f.dropId, "uuid"], [f.buyers[0], "uuid"]]);
  assert.equal(me.holds[0].orderId, w.orderId);
  assert.equal(me.banned, false);
  const cs = await call("console_state", [[f.dropId, "uuid"], [f.ownerId, "uuid"]]);
  assert.equal(cs.ledger.length, 2);
  assert.ok(cs.ledger[0].phone, "staff sees phone");
  assert.ok(Array.isArray(cs.stock) && Array.isArray(cs.moderation));
  const dd = await call("drop_dashboard", [[f.dropId, "uuid"]]);
  assert.deepEqual([dd.viewers, dd.taps, dd.holds, dd.paidOrders], [null, 2, 1, 0]);
  const before = await call("impact_totals", []);
  assert.ok("paidValuePaise" in before && "waitlistSaves" in before);
  // sandbox rows never count
  await call("order_paid_claim", [[w.orderId, "uuid"], [f.buyers[0], "uuid"], [null, "text"]]);
  await call("order_confirm", [[w.orderId, "uuid"], [f.ownerId, "uuid"], [true, "boolean"], [null, "text"]]);
  assert.deepEqual(await call("impact_totals", []), before);
  const key = "test:" + f.code;
  const r1 = (await admin`select rate_add(${key}, 60) as n`)[0].n;
  const r2 = (await admin`select rate_add(${key}, 60) as n`)[0].n;
  assert.deepEqual([r1, r2], [1, 2]);
  await admin`delete from rate_hits where key = ${key}`;
  // a ban refuses claims
  await admin`insert into bans (shop_id, buyer_id, kind, until) values (${f.shopId}, ${f.buyers[1]}, 'ban', null)`;
  await staffCall("drop_next", f.dropId, f.ownerId);
  assert.equal((await claim(f.items[1].id, "S", f.buyers[1])).result, "banned");
  assert.equal((await call("my_status", [[f.dropId, "uuid"], [f.buyers[1], "uuid"]])).banned, true);
});

test("the anon role can read and call nothing", async () => {
  const r = await admin`select has_table_privilege('anon', 'claims', 'select') as t, has_function_privilege('anon', 'claim_dibs(uuid,text,uuid,timestamptz)', 'execute') as f,
    (select bool_and(relrowsecurity) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') as rls`;
  assert.deepEqual(r[0], { t: false, f: false, rls: true });
});
