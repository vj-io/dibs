// Judge-mode bots, sandbox drops only. Scripted actions live in bot_schedule; runDue() claims due rows with
// FOR UPDATE SKIP LOCKED and runs each once. Bot taps call claim_dibs like anyone's: they win or lose honestly.
// runLoop() is the precise runner (started with after()); tick() is the idempotent fallback the client calls. Server only.
import { randomInt, randomUUID } from "node:crypto";
import { fn, sql } from "./db.ts";
import { flags } from "./flags.ts";
import { bus } from "./mockbus.ts";
import * as nx from "./nexconn.ts";
import { drainOutbox } from "./outbox.ts";
import { handleRoomText } from "./webhook.ts";

export type Action = "tap" | "chat" | "leave" | "paid_claim" | "confirm" | "next" | "end" | "go_live";
export type Planned = { ms: number; action: Action; payload: Record<string, unknown> };
export type Slot = { slot: number; dropId: string; role: "buyer" | "seller"; judgeId: string; shopId: string; channelId: string; ownerId: string; staffId: string };
type Bot = { id: string; uid: string; name: string };
type Item = { id: string; position: number; variants: { key: string; qty: number }[]; has_more: boolean };

/** The buyer script's clock (ms after /try/start unless noted). Sandbox holds last 20 s. */
export const SCRIPT = {
  holdMs: 20_000, firstLiveMs: 5000, fallbackNextMs: 85_000, endMs: 180_000, pieceGapMs: 25_000,
  confirmMs: 3000, afterPaidNextMs: 7000, scamMs: 30_000, chatEveryMs: 3000, promoteWithinMs: 43_000,
} as const;

const LINES = [
  "Wow 😍", "price?", "M size hai?", "booked!", "So pretty", "next please", "😍😍", "COD hai?", "mine!", "Love the colour",
  "silver hai kya?", "waiting for the choker", "Beautiful work", "done ✅", "first time here, nice", "fast hai sab 😅",
];
export const SCAM_LINE = "cheaper here: pay 500 advance to rahul.k@okaxis";

const rnd = (a: number, b: number) => Math.round(a + Math.random() * (b - a));
const shuffle = <T>(xs: readonly T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ pure planning (unit-tested)

/** Bot taps for a piece that just went live, in ms after live_at. */
export function planTaps(role: Slot["role"], position: number, variants: Item["variants"]): { ms: number; variant: string }[] {
  const t: { ms: number; variant: string }[] = [];
  const add = (variant: string, n: number, a: number, b: number) => { for (let i = 0; i < n; i++) t.push({ ms: rnd(a, b), variant }); };
  if (!variants.length) return t;
  if (role === "seller") {
    for (let i = 0; i < 3; i++) add(variants[randomInt(variants.length)].key, 1, 80, 400);
    for (let i = 0; i < 5; i++) add(variants[randomInt(variants.length)].key, 1, 1000, 6000);
  } else if (position === 1) {
    for (const v of variants) add(v.key, v.qty + 2, 80, 400);        // every variant: sold, then 2 bots waiting (judge is #3)
  } else if (position === 2) {
    for (const v of variants) { add(v.key, Math.min(1, v.qty - 1), 1500, 3000); add(v.key, v.qty, 6000, 9000); } // a quick tap wins
  } else {
    for (const v of variants) add(v.key, v.qty + 1, 300, 5000);
  }
  return t.sort((a, b) => a.ms - b.ms);
}

/** When the k-th next hold-end serves the queue (holds end at `ends`; every promoted hold lasts holdMs). */
export function servedAt(ends: number[], k: number, holdMs: number = SCRIPT.holdMs): number {
  const h = [...ends].sort((a, b) => a - b);
  for (let i = 0; h.length; i++) {
    const e = h.shift()!;
    if (i === k) return e;
    h.push(e + holdMs);
    h.sort((a, b) => a - b);
  }
  return Infinity;
}

/** How many of the bots ahead of the judge may stay so the judge is still promoted within `limitMs` of their tap. */
export function chooseKeep(ends: number[], ahead: number, tapMs: number, limitMs: number = SCRIPT.promoteWithinMs, holdMs: number = SCRIPT.holdMs): number {
  for (let k = ahead; k > 0; k--) if (servedAt(ends, k, holdMs) - tapMs <= limitMs) return k;
  return 0;
}

/** Leave times for n bots, spread out but all done before the first hold ends (msToFirstEnd may be Infinity). */
export function leaveOffsets(n: number, msToFirstEnd: number): number[] {
  const span = Math.max(0, Math.min(2500 * n, msToFirstEnd - 1200));
  return Array.from({ length: n }, (_, i) => Math.round((span * (i + 1)) / (n + 1)));
}

function chatPlan(bots: Bot[], fromMs: number, toMs: number): Planned[] {
  const rows: Planned[] = [];
  for (let ms = fromMs; ms <= toMs; ms += SCRIPT.chatEveryMs + rnd(-800, 800)) {
    const b = bots[randomInt(bots.length)];
    rows.push({ ms, action: "chat", payload: { buyerId: b.id, uid: b.uid, name: b.name, text: LINES[randomInt(LINES.length)] } });
  }
  return rows;
}
const scamChat = (bots: Bot[], ms: number): Planned => {
  const b = bots[12 % bots.length];
  return { ms, action: "chat", payload: { buyerId: b.id, uid: b.uid, name: b.name, text: SCAM_LINE, scam: true } };
};

function itemPlan(slot: Slot, it: Item, bots: Bot[]): Planned[] {
  const who = shuffle(bots);
  const rows: Planned[] = planTaps(slot.role, it.position, it.variants)
    .map((t, i) => ({ ms: t.ms, action: "tap", payload: { buyerId: who[i % who.length].id, itemId: it.id, variant: t.variant } }));
  if (slot.role === "buyer" && it.position >= 2 && it.has_more) rows.push({ ms: SCRIPT.pieceGapMs, action: "next", payload: { ifPosition: it.position } });
  return rows;
}

// ------------------------------------------------------------------ data

let botCache: Promise<Bot[]> | undefined;
export const bots = () =>
  (botCache ??= sql<Bot[]>`select id, nexconn_user_id as uid, display_name as name from buyers where is_bot order by nexconn_user_id`
    .then((r) => { if (!r.length) throw new Error("no demo bots: run scripts/seed-demo.ts"); return [...r]; })
    .catch((e) => { botCache = undefined; throw e; }));

const slots = new Map<string, Slot>(); // a drop id belongs to one slot for its whole life
export async function slotOf(dropId: string): Promise<Slot | null> {
  const hit = slots.get(dropId);
  if (hit) return hit;
  const [r] = await sql`
    select t.slot, t.role, t.judge_id, t.shop_id, t.channel_id,
           (select id from staff where shop_id = t.shop_id and role = 'owner' and active order by created_at desc limit 1) as owner_id,
           (select id from staff where shop_id = t.shop_id and role = 'staff' and active order by created_at desc limit 1) as staff_id
      from try_slots t where t.drop_id = ${dropId}`;
  if (!r) return null;
  const s: Slot = { slot: r.slot, dropId, role: r.role, judgeId: r.judge_id, shopId: r.shop_id, channelId: r.channel_id, ownerId: r.owner_id, staffId: r.staff_id };
  if (slots.size > 200) slots.clear();
  slots.set(dropId, s);
  return s;
}

async function schedule(dropId: string, rows: Planned[], base: Date | null = null) {
  if (!rows.length) return;
  await sql`
    insert into bot_schedule (drop_id, due_at, action, payload)
    select ${dropId}, coalesce(${base}::timestamptz, clock_timestamp()) + make_interval(secs => (x->>'ms')::float8 / 1000), x->>'action', x->'payload'
      from jsonb_array_elements(${sql.json(rows as never)}) x`;
}

const itemCols = () => sql`
  i.id, i.position,
  (select jsonb_agg(jsonb_build_object('key', pv.key, 'qty', s.total) order by pv.sort, pv.key)
     from item_stock s join product_variants pv on pv.id = s.variant_id where s.drop_item_id = i.id) as variants,
  exists (select 1 from drop_items j where j.drop_id = i.drop_id and j.position > i.position) as has_more`;

// ------------------------------------------------------------------ script entry points

/** Right after try_start: the opening of the buyer or seller script. */
export async function scheduleStart(slot: Slot) {
  const b = await bots();
  const rows: Planned[] = slot.role === "buyer"
    ? [
        { ms: SCRIPT.firstLiveMs, action: "next", payload: { ifPosition: 0 } },
        { ms: SCRIPT.fallbackNextMs, action: "next", payload: { ifPosition: 1 } }, // piece 2 even if the judge never pays
        { ms: SCRIPT.endMs, action: "end", payload: {} },
        scamChat(b, SCRIPT.scamMs),
        ...chatPlan(b, 2000, SCRIPT.endMs - 2000),
      ]
    : chatPlan(b, 2000, 120_000);
  await schedule(slot.dropId, rows);
}

/** Seller script: the judge pressed Drop next (or Reopen). Buyer-script pieces are planned by the scripted "next". */
export async function onItemLive(slot: Slot, itemId: string) {
  if (slot.role !== "seller") return;
  const [it] = await sql<(Item & { live_at: Date })[]>`select ${itemCols()}, i.live_at from drop_items i where i.id = ${itemId} and i.drop_id = ${slot.dropId}`;
  if (!it?.live_at) return;
  const b = await bots();
  const rows = itemPlan(slot, it, b);
  const [s] = await sql`
    select exists (select 1 from bot_schedule where drop_id = ${slot.dropId} and action = 'chat' and payload ? 'scam') as scam,
           (select extract(epoch from (max(due_at) - ${it.live_at}::timestamptz)) * 1000 from bot_schedule
             where drop_id = ${slot.dropId} and action = 'chat')::float8 as chat_ms`;
  if (!s.scam) rows.push(scamChat(b, 4000));
  rows.push(...chatPlan(b, Math.max(1500, (s.chat_ms ?? 0) + SCRIPT.chatEveryMs), 90_000)); // keep the room talking 90 s past each drop
  await schedule(slot.dropId, rows, it.live_at);
}

/** Buyer script: the judge tapped "I've paid" -> demo staff confirms 3 s later, piece 2 a few seconds after. */
export async function onPaidClaim(slot: Slot, orderId: string) {
  if (slot.role !== "buyer") return;
  const [o] = await sql`select buyer_id from orders where id = ${orderId} and drop_id = ${slot.dropId}`;
  if (o?.buyer_id !== slot.judgeId) return;
  await schedule(slot.dropId, [
    { ms: SCRIPT.confirmMs, action: "confirm", payload: { orderId } },
    { ms: SCRIPT.afterPaidNextMs, action: "next", payload: { ifPosition: 1 } },
  ]);
}

export async function cancelPending(dropId: string) {
  await sql`update bot_schedule set done_at = clock_timestamp() where drop_id = ${dropId} and done_at is null`;
}

// ------------------------------------------------------------------ execution

const pending = new Set<Promise<unknown>>();
/** Chat moderation / AI runs beside the runner, never in front of a scheduled tap. */
function background(p: Promise<unknown>) {
  const q: Promise<unknown> = p.catch((e) => console.error("[bots] bg", e instanceof Error ? e.message : e)).finally(() => pending.delete(q));
  pending.add(q);
}
export const settleBackground = () => Promise.allSettled([...pending]);

const registered = new Set<string>();
async function ensureRegistered(b: { buyerId: string; uid: string; name: string }) {
  if (registered.has(b.uid)) return;
  const [r] = await sql`select nexconn_registered_at from buyers where id = ${b.buyerId}`;
  if (!r?.nexconn_registered_at) {
    await nx.issueToken(b.uid, b.name);
    await sql`update buyers set nexconn_registered_at = now() where id = ${b.buyerId}`;
  }
  registered.add(b.uid);
}

type Row = { id: string; action: Action; payload: Record<string, string | number | boolean | null> };

async function botChat(slot: Slot, r: Row) {
  const p = r.payload as { buyerId: string; uid: string; name: string; text: string };
  const muted = await sql`select 1 from bans where shop_id = ${slot.shopId} and buyer_id = ${p.buyerId} and (until is null or until > now())`;
  if (muted.length) return;
  let id: string | null;
  if (flags.mode === "mock") id = bus().publish("room", slot.channelId, p.uid, p.text, p.name).id;
  else { await ensureRegistered(p); id = await nx.sendRoom(slot.channelId, p.uid, { text: p.text }, "low"); }
  background(handleRoomText({ channelId: slot.channelId, fromUserId: p.uid, messageId: id ?? `bot_${r.id}`, text: p.text }));
}

async function next(slot: Slot, ifPosition: number | null) {
  const [it] = await sql<Item[]>`select ${itemCols()} from drop_items i where i.drop_id = ${slot.dropId} and i.state = 'queued' order by i.position limit 1`;
  const plan = it ? itemPlan(slot, it, await bots()) : [];
  await sql`select sandbox_next(${slot.dropId}, ${slot.ownerId}, ${ifPosition}, ${it?.id ?? null}, ${sql.json(plan as never)})`;
}

async function exec(slot: Slot, r: Row) {
  const p = r.payload;
  switch (r.action) {
    case "tap": {
      const res = await fn<{ result: string; orderId: string | null }>("claim_dibs", String(p.itemId), String(p.variant), String(p.buyerId), new Date());
      if (slot.role === "seller" && res.result === "won" && res.orderId) {
        // seller script: the first two bot winners say they paid, so the judge has orders to confirm and ship
        await sql`
          insert into bot_schedule (drop_id, due_at, action, payload)
          select ${slot.dropId}, clock_timestamp() + make_interval(secs => ${rnd(5000, 8000) / 1000}), 'paid_claim',
                 ${sql.json({ orderId: res.orderId, buyerId: p.buyerId, utr: "4" + String(randomInt(1e10, 1e11)) })}
           where (select count(*) from bot_schedule where drop_id = ${slot.dropId} and action = 'paid_claim') < 2`;
      }
      return;
    }
    case "chat": return botChat(slot, r);
    case "leave": await fn("leave_waitlist", String(p.claimId), String(p.buyerId)); return;
    case "paid_claim": await fn("order_paid_claim", String(p.orderId), String(p.buyerId), String(p.utr)); return;
    case "confirm": await fn("order_confirm", String(p.orderId), slot.staffId, true, "Confirmed by Asha (demo staff)"); return;
    case "next": return next(slot, typeof p.ifPosition === "number" ? p.ifPosition : null);
    case "go_live": await fn("drop_go_live", slot.dropId, slot.ownerId); return;
    case "end": await fn("drop_end", slot.dropId, slot.ownerId); await cancelPending(slot.dropId); return;
  }
}

export type DueResult = { executed: number; nextDueMs: number | null; status: string | null };

/** Claims every due row of this drop (each runs once, whoever claims it) and runs them in parallel. */
export async function runDue(slot: Slot): Promise<DueResult> {
  const rows = await sql`
    with due as (
      select id from bot_schedule where drop_id = ${slot.dropId} and done_at is null and due_at <= clock_timestamp()
       order by due_at, id for update skip locked
    ), c as (
      update bot_schedule b set done_at = clock_timestamp() from due where b.id = due.id returning b.id, b.action, b.payload
    )
    select 'row' as k, c.id::text as id, c.action, c.payload, null::float8 as ms, null::text as status from c
    union all
    select 'meta', null, null, null,
      (select extract(epoch from (min(due_at) - clock_timestamp())) * 1000 from bot_schedule
        where drop_id = ${slot.dropId} and done_at is null and id not in (select id from due))::float8,
      (select status from drops where id = ${slot.dropId})`;
  const due = rows.filter((r) => r.k === "row") as unknown as Row[];
  const meta = rows.find((r) => r.k === "meta")!;
  await Promise.all(due.map((r) => exec(slot, r).catch((e) => console.error("[bots]", r.action, e instanceof Error ? e.message : e))));
  return { executed: due.length, nextDueMs: meta.ms === null ? null : Math.max(0, Number(meta.ms)), status: meta.status };
}

/**
 * Buyer script guarantee: once the judge is on a waitlist, bots ahead of them leave (leave_waitlist, like any buyer
 * may) so that the judge is promoted within ~43 s of their tap, keeping as many bots ahead as that allows (so the
 * judge sees bots promoted first). Recomputed every second; idempotent (a planned leave is not planned twice).
 */
export async function planJudge(slot: Slot) {
  if (slot.role !== "buyer") return;
  const waits = await sql`
    select (extract(epoch from c.committed_at) * 1000)::float8 as tap, (extract(epoch from clock_timestamp()) * 1000)::float8 as now,
           (select coalesce(array_agg((extract(epoch from h.expires_at) * 1000)::float8 order by h.expires_at), '{}') from claims h
             where h.drop_item_id = c.drop_item_id and h.variant_id = c.variant_id and h.state = 'held') as ends,
           (select coalesce(jsonb_agg(jsonb_build_object('claimId', w.id, 'buyerId', w.buyer_id) order by w.committed_at, w.id), '[]')
              from claims w join buyers b on b.id = w.buyer_id
             where w.drop_item_id = c.drop_item_id and w.variant_id = c.variant_id and w.state = 'waitlisted' and b.is_bot
               and (w.committed_at, w.id) < (c.committed_at, c.id)
               and not exists (select 1 from bot_schedule s where s.drop_id = c.drop_id and s.action = 'leave' and s.payload->>'claimId' = w.id::text)) as ahead
      from claims c where c.drop_id = ${slot.dropId} and c.buyer_id = ${slot.judgeId} and c.state = 'waitlisted'`;
  for (const w of waits) {
    const ends = (w.ends as (number | string)[]).map(Number);
    const ahead = w.ahead as { claimId: string; buyerId: string }[];
    const keep = chooseKeep(ends, ahead.length, Number(w.tap));
    const leavers = ahead.slice(keep);
    if (!leavers.length) continue;
    const offs = leaveOffsets(leavers.length, ends.length ? ends[0] - Number(w.now) : Infinity);
    await schedule(slot.dropId, leavers.map((l, i) => ({ ms: offs[i], action: "leave", payload: l })));
  }
}

let draining: Promise<unknown> | null = null, again = false;
/** Drains in the background so a slow Server API call never delays a scheduled tap. */
function kickDrain() {
  if (draining) { again = true; return; }
  draining = (async () => { do { again = false; await drainOutbox({ budgetMs: 5000 }); } while (again); })().finally(() => { draining = null; });
}

/** One pass: due actions, sweep, judge plan, drain. The client's 1 s safety net (POST /api/try/tick). */
export async function tick(dropId: string): Promise<DueResult | null> {
  const slot = await slotOf(dropId);
  if (!slot) return null;
  const r = await runDue(slot);
  await fn("sweep_drop", dropId);
  await fn("sandbox_extend_holds", dropId); // demo: humans get 90 s to pay, bots 20
  await planJudge(slot);
  await drainOutbox({ budgetMs: 3000 });
  return r;
}

/**
 * The precise runner: sleeps until the next due action, sweeps every second, for up to `budgetMs`.
 * A lease on try_slots.runner_until (renewed every 5 s, 15 s long) keeps it to one loop per drop.
 */
export async function runLoop(dropId: string, budgetMs = 120_000): Promise<boolean> {
  const slot = await slotOf(dropId);
  if (!slot) return false;
  const token = randomUUID();
  const got = await sql`
    update try_slots set runner_until = clock_timestamp() + interval '15 seconds', runner_token = ${token}
     where drop_id = ${dropId} and (runner_until is null or runner_until < clock_timestamp()) returning slot`;
  if (!got.length) return false;
  const end = Date.now() + budgetMs;
  let lastFull = 0, lastRenew = Date.now();
  try {
    while (Date.now() < end) {
      const r = await runDue(slot);
      if (r.status === null || (r.status === "ended" && r.nextDueMs === null)) break;
      if (r.executed) kickDrain();
      // what just ran may have scheduled more (a "next" plans its taps): re-read at once, the sweep can wait a moment
      if (r.executed && Date.now() - lastFull < 3000) continue;
      if (Date.now() - lastFull >= 1000) {
        lastFull = Date.now();
        await fn("sweep_drop", dropId);
        await fn("sandbox_extend_holds", dropId); // demo: humans get 90 s to pay, bots 20
        await planJudge(slot);
        kickDrain();
      }
      if (Date.now() - lastRenew >= 5000) {
        lastRenew = Date.now();
        const ok = await sql`update try_slots set runner_until = clock_timestamp() + interval '15 seconds' where drop_id = ${dropId} and runner_token = ${token} returning 1`;
        if (!ok.length) break;
      }
      if (r.executed) continue;
      const wait = Math.min(r.nextDueMs ?? 1000, 1000 - (Date.now() - lastFull));
      if (wait > 0) await sleep(wait);
    }
  } catch (e) {
    console.error("[bots] loop", e instanceof Error ? e.message : e);
  } finally {
    await sql`update try_slots set runner_until = null, runner_token = null where runner_token = ${token}`.catch(() => {});
    await Promise.allSettled([draining, settleBackground()]);
  }
  return true;
}

/** Keeps a runner going after the response (Vercel functions here may run 300 s). Outside a request it does nothing. */
export async function startRunner(dropId: string) {
  try {
    const { after } = await import("next/server");
    after(() => runLoop(dropId));
  } catch { /* not inside a request (tests, scripts): the caller drives runLoop/tick itself */ }
}
