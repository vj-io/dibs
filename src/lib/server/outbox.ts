// Outbox drain: sends what the database decided, in id order per channel. Server only.
// Claim = one autocommit statement that leases each channel's head row (locked_until, FOR UPDATE SKIP LOCKED),
// so two drains at once never send the same row and no transaction is held open across HTTP (transaction pooler).
import { BOT_ID, encodeCard, type Card } from "../codec.ts";
import { sql } from "./db.ts";
import { flags } from "./flags.ts";
import { bus } from "./mockbus.ts";
import * as nx from "./nexconn.ts";

export type OutboxRow = {
  id: string; channel_type: "room" | "group" | "user"; channel_id: string; msg_type: string;
  payload: Record<string, unknown>; priority: "high" | "normal" | "low"; attempts: number;
};

/** What a row is executed against: the Nexconn Server API or the mock bus. */
export interface Sender {
  ensureRoom(id: string): Promise<void>;
  destroyRoom(id: string): Promise<void>;
  setRoomMeta(id: string, kv: Record<string, string>): Promise<void>;
  ensureGroup(id: string, name: string, members: string[]): Promise<void>;
  leaveGroup(id: string, members: string[]): Promise<void>;
  mute(room: string, user: string, minutes: number): Promise<void>;
  ban(room: string, user: string, minutes: number): Promise<void>;
  unban(room: string, user: string): Promise<void>;
  card(type: OutboxRow["channel_type"], channel: string, card: Card, priority: OutboxRow["priority"]): Promise<void>;
}

const ROOM_GONE = "23410";
export const nexconnSender: Sender = {
  ensureRoom: nx.ensureRoom,
  destroyRoom: (id) => nx.destroyRoom(id).catch((e) => { if (!(e instanceof nx.NexconnError && e.code === ROOM_GONE)) throw e; }),
  setRoomMeta: nx.setRoomMeta,
  ensureGroup: nx.ensureGroup,
  leaveGroup: nx.leaveGroup,
  mute: nx.muteInRoom,
  ban: nx.banInRoom,
  unban: async (room, user) => { await nx.unban(room, user); await nx.unmuteInRoom(room, user); }, // both return 0 when not listed (live)
  async card(type, channel, card, priority) {
    if (type === "room") await nx.sendRoom(channel, BOT_ID, { card }, priority);
    else if (type === "group") await nx.sendGroup(channel, { card });
    else await nx.sendUser(channel, { card });
  },
};

export const mockSender: Sender = {
  ensureRoom: async (id) => bus().ensureRoom(id),
  destroyRoom: async (id) => bus().destroyRoom(id),
  setRoomMeta: async (id, kv) => bus().setMeta(id, kv),
  ensureGroup: async (id, _name, members) => bus().ensureGroup(id, [BOT_ID, ...members]),
  leaveGroup: async (id, members) => bus().leaveGroup(id, members),
  mute: async (r, u, m) => bus().mute(r, u, m),
  ban: async (r, u, m) => bus().ban(r, u, m),
  unban: async (r, u) => bus().unban(r, u),
  card: async (type, channel, card) => { bus().publish(type, channel, BOT_ID, encodeCard(card), "Dibs"); },
};

/** Room cards whose JSON is mirrored into open-channel metadata (contract: db_state, db_item). */
const META_KEY: Partial<Record<string, string>> = { "DB:State": "db_state", "DB:Item": "db_item", "DB:Stock": "db_item" };

/** Executes one row. Throws on failure (the caller schedules the retry). */
export async function execute(row: OutboxRow, s: Sender): Promise<void> {
  const p = row.payload as Record<string, never>;
  switch (row.msg_type) {
    case "SYS:EnsureRoom": return s.ensureRoom(p.channelId);
    case "SYS:DestroyRoom": return s.destroyRoom(p.channelId);
    case "SYS:EnsureGroup": return s.ensureGroup(p.channelId, p.name, p.memberIds ?? []);
    case "SYS:LeaveGroup": return s.leaveGroup(p.channelId, p.memberIds ?? []);
    case "SYS:RoomMeta": return s.setRoomMeta(p.channelId, { [p.key]: p.value });
    case "SYS:Mute": return s.mute(p.channelId, p.userId, p.minutes);
    case "SYS:Ban": return s.ban(p.channelId, p.userId, p.minutes);
    case "SYS:Unban": return s.unban(p.channelId, p.userId);
  }
  if (!row.msg_type.startsWith("DB:")) throw new PermanentError(`unknown msg_type ${row.msg_type}`);
  const card = { ...(row.payload as object), t: row.msg_type } as Card;
  await s.card(row.channel_type, row.channel_id, card, row.priority);
  const key = row.channel_type === "room" ? META_KEY[row.msg_type] : undefined;
  // best effort: the card itself went out, so a metadata failure must not resend it
  if (key) await s.setRoomMeta(row.channel_id, { [key]: JSON.stringify(card) }).catch(() => {});
}

export class PermanentError extends Error {}

export const BACKOFF_MS = [1000, 3000, 10_000, 30_000];
/** After a failed attempt number `attempts` (1-based): retry after N ms, or give up. */
export const afterFailure = (attempts: number): { retryInMs: number } | { failed: true } =>
  attempts <= BACKOFF_MS.length ? { retryInMs: BACKOFF_MS[attempts - 1] } : { failed: true };

const LEASE = "30 seconds";
const PER_CHANNEL = 25; // rows leased per channel per pass (a lease must outlive sending them one by one)

/**
 * Leases, per channel whose head row is due and free, the run of due rows from the head (up to PER_CHANNEL).
 * A channel is leased whole or not at all: a second drain sees its head locked and skips the channel, so rows of
 * one channel are never sent by two drains. The lease is re-checked on the row itself (FOR UPDATE re-evaluation).
 */
async function claim(channels: number, only?: string[]): Promise<OutboxRow[]> {
  return sql<OutboxRow[]>`
    with heads as (
      select distinct on (channel_id) channel_id, id, next_attempt_at, locked_until from outbox
       where status = 'pending'
         -- test_* channels belong to tests that drain them by name (the shared dev database must not take them)
         ${only ? sql`and channel_id in ${sql(only)}` : sql`and channel_id not like 'test\_%'`}
       order by channel_id, id
    ), ready as (
      select channel_id from heads where next_attempt_at <= now() and (locked_until is null or locked_until < now())
       order by id limit ${channels}
    ), run as (
      select o.id, row_number() over w as rn,
             bool_and(o.next_attempt_at <= now() and (o.locked_until is null or o.locked_until < now())) over w as due
        from outbox o join ready r on r.channel_id = o.channel_id
       where o.status = 'pending'
      window w as (partition by o.channel_id order by o.id)
    ), pick as (
      select o.id from outbox o join run on run.id = o.id
       where run.due and run.rn <= ${PER_CHANNEL}
         and o.status = 'pending' and (o.locked_until is null or o.locked_until < now())
       for update of o skip locked
    )
    update outbox o set locked_until = now() + ${LEASE}::interval
      from pick where o.id = pick.id
    returning o.id::text as id, o.channel_type, o.channel_id, o.msg_type, o.payload, o.priority, o.attempts`;
}

type Settled = { id: string; status: "sent" | "failed" | "pending"; attempts: number; err: string | null; delayMs: number | null };

/** What one row's outcome writes back. `null` error = sent. */
function outcome(row: OutboxRow, err: unknown): Settled {
  const attempts = row.attempts + 1;
  if (!err) return { id: row.id, status: "sent", attempts, err: null, delayMs: null };
  const code = err instanceof nx.NexconnError ? err.code : err instanceof Error ? err.message.slice(0, 200) : String(err);
  const next = err instanceof PermanentError ? { failed: true as const } : afterFailure(attempts);
  return "failed" in next ? { id: row.id, status: "failed", attempts, err: code, delayMs: null }
    : { id: row.id, status: "pending", attempts, err: code, delayMs: next.retryInMs };
}

/** One statement for a whole pass: sent, failed, backing off, and leased-but-unsent rows (lease released, untouched). */
async function settleAll(xs: Settled[]) {
  if (!xs.length) return;
  await sql`
    update outbox o set status = x.status, attempts = x.attempts, locked_until = null,
           last_error = case when x.status = 'sent' then null else coalesce(x.err, o.last_error) end,
           sent_at = case when x.status = 'sent' then now() else o.sent_at end,
           next_attempt_at = case when x."delayMs" is null then o.next_attempt_at else now() + x."delayMs" * interval '1 millisecond' end
      from jsonb_to_recordset(${sql.json(xs as never)}) as x(id bigint, status text, attempts int, err text, "delayMs" int)
     where o.id = x.id`;
}

/** Sends one channel's leased rows in id order. A row that must be retried stops the channel; the rest are released. */
async function sendChannel(rows: OutboxRow[], s: Sender): Promise<Settled[]> {
  const out: Settled[] = [];
  for (const [i, r] of rows.entries()) {
    let err: unknown = null;
    try { await execute(r, s); } catch (e) { err = e ?? new Error("failed"); }
    const o = outcome(r, err);
    out.push(o);
    if (o.status === "pending") {
      for (const rest of rows.slice(i + 1)) out.push({ id: rest.id, status: "pending", attempts: rest.attempts, err: null, delayMs: null });
      break;
    }
  }
  return out;
}

/**
 * Sends pending rows, oldest first per channel; channels run in parallel, rows of one channel never do.
 * Each pass leases a run of rows per channel and settles the pass in one statement (2 round trips + the sends).
 * A failing head row holds back only its own channel (1 s, 3 s, 10 s, 30 s, then `failed` and the channel moves on).
 * Never throws. `more` = it stopped on the budget or `max` with sendable rows possibly left (the caller continues later).
 */
export async function drainOutbox(opts: { max?: number; channels?: string[]; sender?: Sender; budgetMs?: number } = {}):
  Promise<{ sent: number; failed: number; more: boolean }> {
  const max = opts.max ?? 500, t0 = Date.now(), budget = opts.budgetMs ?? 8000;
  const s = opts.sender ?? (flags.mode === "mock" ? mockSender : nexconnSender);
  let sent = 0, failed = 0, more = false;
  try {
    for (;;) {
      if (sent + failed >= max || Date.now() - t0 >= budget) { more = true; break; }
      const rows = await claim(50, opts.channels);
      if (!rows.length) break;
      const by = new Map<string, OutboxRow[]>();
      for (const r of rows) by.set(r.channel_id, [...(by.get(r.channel_id) ?? []), r]);
      for (const xs of by.values()) xs.sort((a, b) => Number(a.id) - Number(b.id));
      const done = (await Promise.all([...by.values()].map((xs) => sendChannel(xs, s)))).flat();
      await settleAll(done);
      const n = done.filter((x) => x.status === "sent").length, f = done.filter((x) => x.status === "failed").length;
      sent += n; failed += f;
      if (!n && !f) break; // every channel is backing off; the next drain picks them up
    }
  } catch (e) {
    console.error("[outbox] drain", e instanceof Error ? e.message : e);
  }
  return { sent, failed, more };
}
