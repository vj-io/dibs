// Synthetic load simulation for Dibs: N buyers, T claim taps inside a short window on one variant, against a deployed API.
// Usage: node --env-file=.env.local scripts/load-sim.ts --base https://tapdibs.vercel.app [--buyers 400] [--taps 300]
//          [--window 500] [--units 2] [--timeout 30] [--keep]      |      node --env-file=.env.local scripts/load-sim.ts --cleanup <slug>
// Setup and verification go straight to Postgres (DATABASE_URL_SESSION); the taps go through the HTTP API with
// session cookies minted here (same jose HS256 cookie as src/lib/server/session.ts), so the target must share
// SESSION_SECRET and the database with this machine's .env.local (production does). Everything is flagged sandbox
// and deleted afterwards (also on failure), unless --keep.
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { SignJWT } from "jose";
import postgres from "postgres";

const { values: a } = parseArgs({
  options: {
    base: { type: "string" }, buyers: { type: "string", default: "400" }, taps: { type: "string", default: "300" },
    window: { type: "string", default: "500" }, units: { type: "string", default: "2" }, keep: { type: "boolean", default: false },
    cleanup: { type: "string" }, timeout: { type: "string", default: "30" },
  },
});
const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set (run with --env-file=.env.local)`); return v; };
const db = postgres(need("DATABASE_URL_SESSION"), { ssl: "require", max: 3, onnotice: () => {} });
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WAITLIST_MAX = 200; // the schema maximum, so 300 taps on 2 units also exercises waitlist_full

/** Deletes one run's rows: the shop (cascades drops, items, claims, orders, outbox ...), its buyers (by run tag), their rate hits. */
async function cleanup(slug: string) {
  if (!/^loadsim-\d+$/.test(slug)) throw new Error("not a load-sim slug: " + slug);
  const pat = `% ${slug}`;
  await db`delete from rate_hits where key in (select 'claim:' || id from buyers where is_sandbox and name like ${pat})`;
  await db`delete from shops where slug = ${slug} and is_sandbox`;
  await db`delete from buyers where is_sandbox and name like ${pat}`;
  const [left] = await db`select (select count(*)::int from shops where slug = ${slug}) as shops,
                                 (select count(*)::int from buyers where name like ${pat}) as buyers`;
  return left as { shops: number; buyers: number };
}

if (a.cleanup) {
  const left = await cleanup(a.cleanup);
  console.log(`cleanup ${a.cleanup}: shops left ${left.shops}, buyers left ${left.buyers}`);
  await db.end();
  process.exit(left.shops + left.buyers ? 1 : 0);
}

if (!a.base) throw new Error("--base <url> is required");
const base = a.base.replace(/\/$/, "");
const nBuyers = Number(a.buyers), nTaps = Number(a.taps), windowMs = Number(a.window), units = Number(a.units);
if (![nBuyers, nTaps, windowMs, units].every(Number.isInteger) || units < 1 || nTaps < 1 || windowMs < 1) throw new Error("bad numbers");
if (nBuyers > 500) throw new Error("--buyers is capped at 500");
if (nTaps > 400) throw new Error("--taps is capped at 400");
if (nTaps > nBuyers) throw new Error("--taps cannot exceed --buyers");
if (nBuyers < 3) throw new Error("need at least 3 buyers (warm-up uses 3)");

const timeoutMs = Number(a.timeout) * 1000; // client timeout per request, seconds via --timeout
const stamp = Date.now();
const slug = `loadsim-${stamp}`;
const code = randomBytes(3).toString("hex").toUpperCase();
const wcode = randomBytes(3).toString("hex").toUpperCase();
const key = new TextEncoder().encode(need("SESSION_SECRET"));
const mint = (buyerId: string) =>
  new SignJWT({ kind: "buyer", buyerId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${60 * 60 * 24 * 30}s`).sign(key);

type Rec = { kind: "claim" | "view"; sendMs: number; status: number; ms: number; result: string; serverMs: number | null; claimId: string | null; position: number | null; buyer: number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function req(method: "GET" | "POST", path: string, cookie: string, body?: unknown) {
  const t = performance.now();
  try {
    const res = await fetch(base + path, {
      method, headers: { cookie: `dibs_buyer=${cookie}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let j: Record<string, unknown> = {};
    try { j = JSON.parse(text); } catch { /* non-JSON error page */ }
    return { status: res.status, ms: performance.now() - t, j, err: null as string | null };
  } catch (e) {
    return { status: 0, ms: performance.now() - t, j: {}, err: (e as Error).name === "TimeoutError" ? "timeout" : "network_error" };
  }
}
const resultOf = (r: Awaited<ReturnType<typeof req>>) => r.err ?? (r.status === 429 ? "rate_limited" : r.status !== 200 ? `http_${r.status}` : String(r.j.result ?? "no_result"));

const pct = (s: number[], p: number) => (s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] : NaN);
const stats = (xs: number[]) => { const s = [...xs].sort((x, y) => x - y); return { n: s.length, min: s[0], median: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: s[s.length - 1] }; };
const f = (n: number) => (Number.isFinite(n) ? n.toFixed(0) : "-");
const row = (name: string, s: ReturnType<typeof stats>) => `| ${name} | ${s.n} | ${f(s.min)} | ${f(s.median)} | ${f(s.p95)} | ${f(s.p99)} | ${f(s.max)} |`;

let shopId: string | null = null;
const t0 = Date.now();
let out = "", ok = false;
try {
  if ((await db`select 1 from shops where slug = ${slug}`).length) throw new Error("shop slug already exists, refusing: " + slug);
  // ---------------------------------------------------------------- setup
  const [shop] = await db`
    insert into shops (slug, name, upi_id, payee_name, hold_seconds, max_holds, waitlist_max, is_sandbox, nexconn_desk_id)
    values (${slug}, ${"Load sim " + stamp}, 'loadsim@upi', 'Load Sim', 600, 3, ${WAITLIST_MAX}, true, ${"desk_" + slug}) returning id`;
  shopId = shop.id;
  const [owner] = await db`insert into staff (shop_id, role, display_name, email) values (${shop.id}, 'owner', 'Owner', ${slug + "@o.test"}) returning id`;
  const mk = async (c: string, qty: number, title: string) => {
    const [d] = await db`insert into drops (shop_id, code, title, starts_at, nexconn_channel_id, is_sandbox) values (${shop.id}, ${c}, ${title}, now(), ${"dr_" + c}, true) returning id`;
    const [p] = await db`insert into products (shop_id, title, price_paise, photos) values (${shop.id}, ${title}, 145000, ${["https://x.test/p.jpg"]}) returning id`;
    const [it] = await db`insert into drop_items (drop_id, product_id, position) values (${d.id}, ${p.id}, 1) returning id`;
    const [pv] = await db`insert into product_variants (product_id, key, label, qty, sort) values (${p.id}, 'M', 'Size M', ${qty}, 0) returning id`;
    await db`insert into item_stock (drop_item_id, variant_id, total, available) values (${it.id}, ${pv.id}, ${qty}, ${qty})`;
    for (const fnName of ["drop_go_live", "drop_next"]) {
      const [r] = await db.unsafe(`select ${fnName}($1::uuid, $2::uuid) as r`, [d.id, owner.id]);
      if (!r.r.ok) throw new Error(`${fnName}: ${JSON.stringify(r.r)}`);
    }
    return { dropId: d.id as string, itemId: it.id as string, variantId: pv.id as string };
  };
  const main = await mk(code, units, "Load sim drop");
  const warm = await mk(wcode, 1, "Load sim warm-up");
  const rows = Array.from({ length: nBuyers }, (_, i) => ({ name: `Load ${String(i + 1).padStart(3, "0")} ${slug}`, display_name: `Load ${String(i + 1).padStart(3, "0")}`, is_sandbox: true }));
  const ids: string[] = (await db`insert into buyers ${db(rows)} returning id, name`).sort((x, y) => (x.name < y.name ? -1 : 1)).map((r) => r.id);
  const cookies = await Promise.all(ids.map(mint));
  console.log(`setup: ${slug}, ${nBuyers} buyers, item ${main.itemId} (${units} units), target ${base}`);

  // ---------------------------------------------------------------- warm-up (separate drop)
  const w: { name: string; ms: number; res: string }[] = [];
  for (const [name, i] of [["state cold", 0], ["state warm", 0]] as const) {
    const r = await req("GET", `/api/drops/${warm.dropId}/state`, cookies[i]); w.push({ name, ms: r.ms, res: String(r.status) });
  }
  for (const [name, i] of [["claim cold", nBuyers - 1], ["claim warm 1", nBuyers - 2], ["claim warm 2", nBuyers - 3]] as const) {
    const r = await req("POST", "/api/claims", cookies[i], { itemId: warm.itemId, variantKey: "M" }); w.push({ name, ms: r.ms, res: resultOf(r) });
  }
  console.log("warm-up: " + w.map((x) => `${x.name} ${f(x.ms)} ms (${x.res})`).join(", "));
  await sleep(1500); // let the warm-up's background outbox drain finish before the burst

  // ---------------------------------------------------------------- burst
  const recs: Rec[] = [];
  const base0 = performance.now() + 200;
  const jobs: Promise<void>[] = [];
  const fire = (i: number, kind: Rec["kind"]) => {
    const offset = Math.random() * windowMs;
    jobs.push(new Promise<void>((done) => setTimeout(async () => {
      const sendMs = performance.now() - base0;
      const r = kind === "claim"
        ? await req("POST", "/api/claims", cookies[i], { itemId: main.itemId, variantKey: "M" })
        : await req("GET", `/api/drops/${main.dropId}/state`, cookies[i]);
      recs.push({ kind, sendMs, status: r.status, ms: r.ms, result: kind === "claim" ? resultOf(r) : r.err ?? String(r.status),
        serverMs: typeof r.j.ms === "number" ? r.j.ms : null, claimId: (r.j.claimId as string) ?? null, position: (r.j.position as number) ?? null, buyer: i });
      done();
    }, base0 - performance.now() + offset)));
  };
  for (let i = 0; i < nTaps; i++) fire(i, "claim");
  for (let i = nTaps; i < nBuyers; i++) fire(i, "view");
  await Promise.all(jobs);
  const claims = recs.filter((r) => r.kind === "claim"), views = recs.filter((r) => r.kind === "view");
  const sends = claims.map((r) => r.sendMs);
  const spread = Math.max(...sends) - Math.min(...sends);

  // ---------------------------------------------------------------- verify from the database
  // a timed-out request may still be running on the server: wait until the item's claim count stops moving (max 2 min)
  let last = -1, still = 0;
  for (let i = 0; i < 120 && still < 4; i++) {
    const [{ n }] = await db`select count(*)::int as n from claims where drop_item_id = ${main.itemId}`;
    still = n === last ? still + 1 : 0; last = n; await sleep(1000);
  }
  const dbRows = await db`select c.id, c.state, c.buyer_id from claims c where c.drop_item_id = ${main.itemId} order by c.committed_at, c.id`;
  const count = (s: string[]) => dbRows.filter((r) => s.includes(r.state)).length;
  const [stock] = await db`select total, available from item_stock where drop_item_id = ${main.itemId}`;
  const [{ orders }] = await db`select count(*)::int as orders from orders o join claims c on c.id = o.claim_id where c.drop_item_id = ${main.itemId}`;
  const [{ dupes }] = await db`select count(*)::int as dupes from (select buyer_id from claims where drop_item_id = ${main.itemId}
                                 and state in ('held','payment_claimed','waitlisted') group by buyer_id having count(*) > 1) x`;
  const tally: Record<string, number> = {};
  for (const r of claims) tally[r.result] = (tally[r.result] ?? 0) + 1;
  const bad = (r: Rec) => r.status === 0 || r.status >= 500;
  const errs: Record<string, number> = {};
  for (const r of recs.filter(bad)) { const k = r.status ? `HTTP ${r.status}` : r.result; errs[k] = (errs[k] ?? 0) + 1; }
  const rl = recs.filter((r) => r.status === 429).length;
  const definite = claims.filter((r) => r.status === 200 && r.result !== "no_result").length;
  const wantWait = Math.min(WAITLIST_MAX, nTaps - units);
  const waitRows = dbRows.filter((r) => r.state === "waitlisted");
  const posById = new Map(claims.filter((r) => r.result === "waitlisted").map((r) => [r.claimId, r.position]));
  const posOk = waitRows.length === posById.size && waitRows.every((r, i) => posById.get(r.id) === i + 1);
  const held = count(["held"]);
  const checks: [string, boolean, string][] = [
    ["Zero double sells: held claims on the variant = units", held === units && count(["held", "payment_claimed", "paid", "shipped"]) === units, `${held} held / ${units} units`],
    ["Winners reported by the API = units", (tally.won ?? 0) === units, `${tally.won ?? 0} won responses`],
    ["Stock available = 0, never negative (total ${units})".replace("${units}", String(units)), stock.available === 0 && stock.total === units, `available ${stock.available}, total ${stock.total}`],
    ["Waitlisted = min(waitlist_max, taps - units), positions 1..n unique and in committed_at order", waitRows.length === wantWait && posOk, `${waitRows.length} waitlisted, expected ${wantWait}, positions ${posOk ? "ok" : "MISMATCH"}`],
    ["No buyer has two active claims on the item", dupes === 0, `${dupes} buyers`],
    ["Orders = units", orders === units, `${orders} orders`],
    ["Every tap got a definite result (no 5xx, no timeouts)", definite + rl === nTaps && !Object.keys(errs).length, `${definite}/${nTaps} definite, errors ${JSON.stringify(errs)}`],
    ["No rate-limited (429) responses", rl === 0, `${rl} responses`],
  ];
  const winners = claims.filter((r) => r.result === "won").map((r) => r.serverMs).filter((x): x is number => x !== null);
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(base).hostname);
  const lines = [
    `## ${new Date().toISOString()} · ${local ? "local dev server, not production" : "deployed target"}`,
    "",
    `- Target: ${base}${local ? " (local dev server talking to the remote database; latencies are not meaningful for the product)" : ""}`,
    `- Git commit: ${(() => { try { return execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim(); } catch { return "unknown"; } })()}`,
    `- Shape: ${nBuyers} buyers, ${nTaps} claim taps at uniformly random offsets inside ${windowMs} ms on one variant with ${units} units, ${nBuyers - nTaps} viewers each fetching drop state once. Waitlist cap ${WAITLIST_MAX}.`,
    `- Burst spread achieved: first to last claim send ${f(spread)} ms (window ${windowMs} ms)`,
    `- Run time: ${((Date.now() - t0) / 1000).toFixed(1)} s including setup, warm-up and verification (before cleanup)`,
    `- The target must share SESSION_SECRET and the database with the machine running this script (production does); sessions are minted locally, so there are no join calls.`,
    `- Latencies are client-observed from one laptop, not from the buyers' network, and include TLS and connection set-up for each simulated buyer.`,
    "",
    "| Request | n | min ms | median ms | p95 ms | p99 ms | max ms |", "|---|---|---|---|---|---|---|",
    row("POST /api/claims (all taps)", stats(claims.map((r) => r.ms))),
    ...(winners.length ? [row("winning taps only", stats(claims.filter((r) => r.result === "won").map((r) => r.ms)))] : []),
    ...(views.length ? [row("GET /api/drops/:id/state (viewers)", stats(views.map((r) => r.ms)))] : []),
    "",
    `Server-side \`ms\` (milliseconds after the item went live, server clock) for the ${winners.length} winners: ${winners.map(f).join(", ") || "-"}`,
    "",
    `Warm-up (separate drop, before the burst): ${w.map((x) => `${x.name} ${f(x.ms)} ms (${x.res})`).join("; ")}`,
    "",
    `Claim results: ${Object.entries(tally).sort().map(([k, v]) => `${k} ${v}`).join(", ")}. Rate-limited (429): ${rl}. Errors (5xx, timeouts, network): ${Object.keys(errs).length ? JSON.stringify(errs) : "none"}.`,
    "",
    "| Invariant (checked in the database) | Result | Detail |", "|---|---|---|",
    ...checks.map(([n, p, d]) => `| ${n} | ${p ? "PASS" : "FAIL"} | ${d} |`),
    "",
  ];
  out = lines.join("\n");
  ok = checks.every((c) => c[1]);
} finally {
  if (out) {
    console.log("\n" + out);
    const file = resolve(root, "docs/load-sim-results.md");
    mkdirSync(dirname(file), { recursive: true });
    if (!existsSync(file)) writeFileSync(file, "# Load simulation results\n\nSynthetic load from one laptop against the target named in each section. These are simulated taps, not real buyers.\n\n");
    appendFileSync(file, "\n" + out);
  }
  if (a.keep) console.log(`--keep: left ${slug} in place; remove with --cleanup ${slug}`);
  else if (shopId) {
    await sleep(2000); // let background outbox drains from the server finish before the cascade delete
    const left = await cleanup(slug).catch((e) => ({ shops: -1, buyers: -1, e }));
    console.log(`cleanup: shops left ${left.shops}, buyers left ${left.buyers}`);
  }
  await db.end();
}
process.exit(ok ? 0 : 1);
