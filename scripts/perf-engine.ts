// Where does a claim's time go? Measures the engine against the real database on throwaway sandbox drops.
// Usage: node --env-file=.env.local scripts/perf-engine.ts [db|plans|rest|drain|all] [--n 300] [--units 2] [--wl 200] [--staged]
//   db     N sequential claim_dibs on one session, EXPLAIN ANALYZE execution time per call (no network in the number)
//   plans  EXPLAIN (ANALYZE, BUFFERS) of every statement on the claim path, in a rolled-back transaction
//   rest   PostgREST from this machine: N concurrent trivial RPCs, then N concurrent api_claim, then claims + state mixed
//   drain  N concurrent drainOutbox() calls (one instance's pool) over the outbox one burst leaves, fake 0 ms sender
// Room channels are named test_* so production drains leave them alone; everything is deleted at the end.
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import postgres from "postgres";

const { values: o, positionals } = parseArgs({ allowPositionals: true, options: {
  n: { type: "string", default: "300" }, units: { type: "string", default: "2" }, wl: { type: "string", default: "200" }, staged: { type: "boolean", default: false } } });
const what = positionals[0] ?? "all";
const N = Number(o.n), UNITS = Number(o.units), WL = Number(o.wl);
// --staged: run against the functions scripts/perf-stage.ts put in schema perf8 (tables stay in public)
const sessionUrl = process.env.DATABASE_URL_SESSION! + (o.staged ? (process.env.DATABASE_URL_SESSION!.includes("?") ? "&" : "?") + "search_path=perf8,public" : "");
const db = postgres(sessionUrl, { ssl: "require", max: 4, onnotice: () => {} });
const REST = process.env.NEXT_PUBLIC_SUPABASE_URL!, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] : NaN; };
const dist = (xs: number[]) => xs.length ? `n=${xs.length} min ${pct(xs, 0).toFixed(1)} med ${pct(xs, 50).toFixed(1)} p95 ${pct(xs, 95).toFixed(1)} max ${pct(xs, 100).toFixed(1)} sum ${xs.reduce((a, b) => a + b, 0).toFixed(0)}` : "n=0";

const shops: string[] = [], buyerSets: string[][] = [];
type Fx = { dropId: string; itemId: string; variants: Record<string, string>; ownerId: string; buyers: string[]; room: string };
async function fixture(variants: { key: string; qty: number }[], buyers: number, wl = WL): Promise<Fx> {
  const tag = randomBytes(4).toString("hex");
  const [shop] = await db`insert into shops (slug, name, upi_id, payee_name, hold_seconds, max_holds, waitlist_max, is_sandbox, nexconn_desk_id)
    values (${"perf-" + tag}, ${"Perf " + tag}, 'perf@upi', 'Perf', 600, 3, ${wl}, true, ${"test_desk_" + tag}) returning id`;
  shops.push(shop.id);
  const [owner] = await db`insert into staff (shop_id, role, display_name, email) values (${shop.id}, 'owner', 'Owner', ${tag + "@perf.test"}) returning id`;
  const room = "test_dr_" + tag;
  const [d] = await db`insert into drops (shop_id, code, title, starts_at, nexconn_channel_id, is_sandbox) values (${shop.id}, ${tag.slice(0, 6).toUpperCase()}, 'Perf', now(), ${room}, true) returning id`;
  const [p] = await db`insert into products (shop_id, title, price_paise, photos) values (${shop.id}, 'Perf piece', 145000, ${["https://x.test/p.jpg"]}) returning id`;
  const [it] = await db`insert into drop_items (drop_id, product_id, position) values (${d.id}, ${p.id}, 1) returning id`;
  const vs: Record<string, string> = {};
  for (const [j, v] of variants.entries()) {
    const [pv] = await db`insert into product_variants (product_id, key, label, qty, sort) values (${p.id}, ${v.key}, ${"Size " + v.key}, ${v.qty}, ${j}) returning id`;
    await db`insert into item_stock (drop_item_id, variant_id, total, available) values (${it.id}, ${pv.id}, ${v.qty}, ${v.qty})`;
    vs[v.key] = pv.id;
  }
  const rows = Array.from({ length: buyers }, (_, i) => ({ name: `Perf ${i} ${tag}`, display_name: `Perf ${i}`, is_sandbox: true }));
  const ids = (await db`insert into buyers ${db(rows)} returning id`).map((r) => r.id as string);
  buyerSets.push(ids);
  for (const f of ["drop_go_live", "drop_next"]) {
    const [r] = await db.unsafe(`select ${f}($1::uuid, $2::uuid) as r`, [d.id, owner.id]);
    if (!r.r.ok) throw new Error(f + JSON.stringify(r.r));
  }
  return { dropId: d.id, itemId: it.id, variants: vs, ownerId: owner.id, buyers: ids, room };
}
async function cleanupAll() {
  for (const s of shops) await db`delete from shops where id = ${s}`;
  for (const b of buyerSets) {
    await db`delete from rate_hits where key in ${db(b.map((x) => "claim:" + x))}`;
    await db`delete from buyers where id in ${db(b)}`;
  }
}

async function rtt() {
  const t: number[] = [];
  for (let i = 0; i < 20; i++) { const s = performance.now(); await db`select 1`; t.push(performance.now() - s); }
  console.log(`session round trip (this machine -> pooler -> db), select 1: ${dist(t)}`);
}

/** (a) per-call time inside Postgres. EXPLAIN ANALYZE runs the call for real (and commits), reporting execution time only. */
async function engineSequential() {
  const f = await fixture([{ key: "M", qty: UNITS }], N);
  const by: Record<string, number[]> = {}, wall: number[] = [];
  for (const b of f.buyers) {
    const t = performance.now();
    const [r] = await db.unsafe(`explain (analyze, format json) select claim_dibs($1::uuid, 'M', $2::uuid, now())`, [f.itemId, b]);
    wall.push(performance.now() - t);
    const ms = (r["QUERY PLAN"][0] as { "Execution Time": number })["Execution Time"];
    const [{ state }] = await db`select coalesce((select state from claims where drop_item_id = ${f.itemId} and buyer_id = ${b}), 'waitlist_full') as state`;
    (by[state] ??= []).push(ms);
  }
  console.log(`\n[db] ${N} sequential claim_dibs, ${UNITS} units, waitlist ${WL}: execution time per call (ms, inside Postgres)`);
  for (const [k, v] of Object.entries(by)) console.log(`  ${k.padEnd(14)} ${dist(v)}`);
  console.log(`  client wall per call (includes round trip + commit): ${dist(wall)}`);
  // commit cost: a one-row write committed vs the same statement rolled back
  const c: number[] = [], r: number[] = [];
  for (let i = 0; i < 20; i++) {
    let t = performance.now(); await db`update drops set version = version where id = ${f.dropId}`; c.push(performance.now() - t);
    t = performance.now(); await db`select version from drops where id = ${f.dropId}`; r.push(performance.now() - t);
  }
  console.log(`  1-row update + commit: ${dist(c)}  |  1-row select: ${dist(r)}  (difference ~ commit/WAL flush)`);
  const [w] = await db`select (select count(*)::int from outbox where drop_id = ${f.dropId}) as outbox,
                              (select count(*)::int from audit_events where drop_id = ${f.dropId}) as audit,
                              (select version from drops where id = ${f.dropId}) as version`;
  console.log(`  rows written for ${N} taps: outbox ${w.outbox}, audit ${w.audit}, drops.version ${w.version}`);
  return f;
}

/** EXPLAIN (ANALYZE, BUFFERS) of each statement claim_dibs runs, at the state a burst leaves (2 held, WL waiting). */
async function plans(f: Fx) {
  const b = f.buyers[f.buyers.length - 1], v = f.variants.M, item = f.itemId, d = f.dropId;
  const L = (s: string) => `'${s}'`;
  const stmts: [string, string][] = [
    ["item -> drop", `select drop_id from drop_items where id = ${L(item)}`],
    ["drop lock", `select * from drops where id = ${L(d)} for no key update`],
    ["variant", `select pv.* from product_variants pv join drop_items i on i.product_id = pv.product_id where i.id = ${L(item)} and pv.key = 'M'`],
    ["stock lock", `select * from item_stock where drop_item_id = ${L(item)} and variant_id = ${L(v)} for update`],
    ["buyer", `select * from buyers where id = ${L(b)}`],
    ["bans", `select exists (select 1 from bans where shop_id = (select shop_id from drops where id = ${L(d)}) and buyer_id = ${L(b)} and kind = 'ban' and (until is null or until > now()))`],
    ["existing claim", `select * from claims where drop_item_id = ${L(item)} and buyer_id = ${L(b)} and state in ('held','payment_claimed','waitlisted')`],
    ["buyer holds in drop", `select count(*) from claims where drop_id = ${L(d)} and buyer_id = ${L(b)} and state in ('held','payment_claimed')`],
    ["waitlist count", `select count(*) from claims where drop_item_id = ${L(item)} and variant_id = ${L(v)} and state = 'waitlisted'`],
    ["_hold_secs/_is_try", `select _hold_secs(${L(d)}, ${L(b)})`],
    ["insert claim", `insert into claims (drop_id, drop_item_id, variant_id, buyer_id, state, received_at, committed_at, ms_after_live) values (${L(d)}, ${L(item)}, ${L(v)}, ${L(f.buyers[0])}, 'left', now(), now(), 1)`],
    ["_bump", `select _bump(${L(d)})`],
    ["_stock_card", `select _stock_card(${L(item)}, 1)`],
    ["_out (stock card)", `select _room_stock(${L(d)}, ${L(item)}, 1)`],
    ["_audit", `select _audit(${L(d)}, 'buyer', ${L(b)}, 'claim_waitlisted', '{}')`],
    ["drop_state", `select drop_state(${L(d)})`],
    ["sweep_drop (nothing due)", `select sweep_drop(${L(d)})`],
    ["my_status", `select my_status(${L(d)}, ${L(f.buyers[5])})`],
  ];
  console.log(`\n[plans] EXPLAIN (ANALYZE, BUFFERS) at burst end state, 3 runs each (ms); rolled back`);
  await db.begin(async (tx) => {
    for (const [name, s] of stmts) {
      const times: string[] = [];
      let text: string[] = [];
      for (let k = 0; k < 3; k++) { // first call plans the SQL helpers; later calls show the steady state
        text = (await tx.unsafe(`explain (analyze, buffers) ${s}`)).map((r) => r["QUERY PLAN"] as string);
        times.push(text.find((l) => l.startsWith("Execution Time"))?.replace("Execution Time: ", "").replace(" ms", "") ?? "?");
      }
      const exec = times.join(" / ") + " ms";
      const scans = text.filter((l) => /Seq Scan|Index Scan|Index Only Scan|Bitmap/.test(l)).map((l) => l.trim().replace(/\s+\(cost.*$/, "")).slice(0, 3);
      console.log(`  ${name.padEnd(26)} ${exec.padEnd(26)} ${scans.join(" | ")}`);
    }
    throw Object.assign(new Error("rollback"), { rollback: true });
  }).catch((e) => { if (!e.rollback) throw e; });
}

async function rpc(name: string, body: unknown) {
  const t = performance.now();
  const r = await fetch(`${REST}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  return { ms: performance.now() - t, status: r.status, j };
}

/** Samples PostgREST backends while a burst runs: how many are busy and how many wait on a lock. */
function sampler() {
  let stop = false; const busy: number[] = [], lockWait: number[] = [];
  const run = (async () => {
    while (!stop) {
      const [r] = await db`select count(*) filter (where state = 'active')::int as busy, count(*) filter (where wait_event_type = 'Lock')::int as lw
                             from pg_stat_activity where usename = 'authenticator' and pid <> pg_backend_pid()`;
      busy.push(r.busy); lockWait.push(r.lw);
    }
  })();
  return async () => { stop = true; await run; return { maxBusy: Math.max(0, ...busy), maxLockWait: Math.max(0, ...lockWait), samples: busy.length }; };
}

async function rest() {
  console.log(`\n[rest] PostgREST from this machine (fetch keep-alive)`);
  const one: number[] = [];
  for (let i = 0; i < 10; i++) one.push((await rpc("_mmss", { p_sec: 5 })).ms);
  console.log(`  sequential trivial RPC (_mmss): ${dist(one)}`);
  let s = sampler();
  let rs = await Promise.all(Array.from({ length: N }, () => rpc("_mmss", { p_sec: 5 })));
  console.log(`  ${N} concurrent trivial RPCs: ${dist(rs.map((r) => r.ms))} statuses ${JSON.stringify(count(rs.map((r) => r.status)))} pg ${JSON.stringify(await s())}`);

  const f = await fixture([{ key: "M", qty: UNITS }], N);
  await Promise.all(f.buyers.slice(0, 10).map(() => rpc("_mmss", { p_sec: 1 }))); // warm connections
  s = sampler();
  const t0 = performance.now();
  rs = await Promise.all(f.buyers.map((b) => rpc("api_claim", { p_item: f.itemId, p_variant_key: "M", p_buyer: b, p_received: new Date().toISOString() })));
  const wall = performance.now() - t0;
  const res = rs.map((r) => r.j?.claim?.result ?? `http_${r.status}`);
  console.log(`  ${N} concurrent api_claim (one variant, ${UNITS} units): wall ${wall.toFixed(0)} ms, ${dist(rs.map((r) => r.ms))} results ${JSON.stringify(count(res))} pg ${JSON.stringify(await s())}`);
  for (const k of ["won", "waitlisted", "waitlist_full"]) console.log(`    ${k.padEnd(13)} ${dist(rs.filter((_, i) => res[i] === k).map((r) => r.ms))}`);

  const g = await fixture([{ key: "M", qty: UNITS }], N);
  s = sampler();
  const views: Promise<{ ms: number }>[] = [];
  const claims = g.buyers.map((b, i) => {
    if (i % 3 === 0) views.push(rpc("api_call", { p_fn: "drop_state", p_args: [g.dropId] }));
    return rpc("api_claim", { p_item: g.itemId, p_variant_key: "M", p_buyer: b, p_received: new Date().toISOString() });
  });
  const [cr, vr] = await Promise.all([Promise.all(claims), Promise.all(views)]);
  console.log(`  mixed: ${N} api_claim + ${views.length} drop_state at once: claims ${dist(cr.map((r) => r.ms))}; state ${dist(vr.map((r) => r.ms))} pg ${JSON.stringify(await s())}`);
  return f;
}

/** (e) N afterWrite-style drains at once over the outbox a burst left, in one process (one instance's pool of 3). */
async function drain(f: Fx) {
  const { drainOutbox } = await import("../src/lib/server/outbox.ts");
  const sent: string[] = [];
  const fake = { ensureRoom: async () => {}, destroyRoom: async () => {}, setRoomMeta: async () => { sent.push("meta"); }, ensureGroup: async () => {},
    leaveGroup: async () => {}, mute: async () => {}, ban: async () => {}, unban: async () => {}, card: async () => { sent.push("card"); } };
  const chans = (await db`select distinct channel_id from outbox where drop_id = ${f.dropId} and status = 'pending'`).map((r) => r.channel_id as string);
  const [{ pending }] = await db`select count(*)::int as pending from outbox where drop_id = ${f.dropId} and status = 'pending'`;
  const t0 = performance.now();
  const rs = await Promise.all(Array.from({ length: N }, () => drainOutbox({ channels: chans, sender: fake, budgetMs: 25_000 })));
  console.log(`\n[drain] ${N} concurrent drainOutbox over ${pending} pending rows (${chans.length} channels): wall ${(performance.now() - t0).toFixed(0)} ms, ` +
    `rows settled ${rs.reduce((a, r) => a + r.sent, 0)}, sender calls ${JSON.stringify(count(sent))}, drains that sent nothing ${rs.filter((r) => !r.sent).length}`);
  const { sql } = await import("../src/lib/server/db.ts");
  await sql.end({ timeout: 2 });
}

const count = (xs: (string | number)[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});

try {
  await rtt();
  if (what === "db" || what === "plans" || what === "all") { const f = await engineSequential(); if (what !== "db") await plans(f); }
  if (what === "rest" || what === "drain" || what === "all") { const f = await rest(); if (what !== "rest") await drain(f); }
} finally {
  await cleanupAll();
  await db.end();
}
