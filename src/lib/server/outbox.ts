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

async function claim(limit: number, channelId?: string): Promise<OutboxRow[]> {
  return sql<OutboxRow[]>`
    with heads as (
      select distinct on (channel_id) id from outbox
       where status = 'pending' ${channelId ? sql`and channel_id = ${channelId}` : sql``}
       order by channel_id, id
    ), pick as (
      select o.id from outbox o join heads h on h.id = o.id
       where o.next_attempt_at <= now() and (o.locked_until is null or o.locked_until < now())
       order by o.id limit ${limit}
       for update of o skip locked
    )
    update outbox o set locked_until = now() + ${LEASE}::interval
      from pick where o.id = pick.id
    returning o.id::text as id, o.channel_type, o.channel_id, o.msg_type, o.payload, o.priority, o.attempts`;
}

async function settle(row: OutboxRow, err: unknown) {
  const attempts = row.attempts + 1;
  if (!err) {
    await sql`update outbox set status = 'sent', sent_at = now(), attempts = ${attempts}, locked_until = null, last_error = null where id = ${row.id}`;
    return "sent";
  }
  const code = err instanceof nx.NexconnError ? err.code : err instanceof Error ? err.message.slice(0, 200) : String(err);
  const next = err instanceof PermanentError ? { failed: true as const } : afterFailure(attempts);
  if ("failed" in next) {
    await sql`update outbox set status = 'failed', attempts = ${attempts}, locked_until = null, last_error = ${code} where id = ${row.id}`;
    return "failed";
  }
  await sql`update outbox set attempts = ${attempts}, locked_until = null, last_error = ${code},
    next_attempt_at = now() + ${next.retryInMs} * interval '1 millisecond' where id = ${row.id}`;
  return "retry";
}

/**
 * Sends pending rows, oldest first per channel; channels run in parallel, rows of one channel never do.
 * A failing head row holds back only its own channel (1 s, 3 s, 10 s, 30 s, then `failed` and the channel moves on).
 * Never throws. `pending` = rows still pending afterwards (-1 if the count itself failed).
 */
export async function drainOutbox(opts: { max?: number; channelId?: string; sender?: Sender; budgetMs?: number } = {}):
  Promise<{ sent: number; failed: number; pending: number }> {
  const max = opts.max ?? 100, t0 = Date.now(), budget = opts.budgetMs ?? 8000;
  const s = opts.sender ?? (flags.mode === "mock" ? mockSender : nexconnSender);
  let sent = 0, failed = 0;
  try {
    while (sent + failed < max && Date.now() - t0 < budget) {
      const rows = await claim(max - sent - failed, opts.channelId);
      if (!rows.length) break;
      const results = await Promise.all(rows.map(async (r) => {
        let err: unknown = null;
        try { await execute(r, s); } catch (e) { err = e ?? new Error("failed"); }
        return settle(r, err);
      }));
      sent += results.filter((x) => x === "sent").length;
      failed += results.filter((x) => x === "failed").length;
      if (results.every((x) => x === "retry")) break; // every head is backing off; the next drain picks them up
    }
  } catch (e) {
    console.error("[outbox] drain", e instanceof Error ? e.message : e);
  }
  let pending = -1;
  try {
    const [r] = await sql<{ n: number }[]>`select count(*)::int as n from outbox where status = 'pending' ${opts.channelId ? sql`and channel_id = ${opts.channelId}` : sql``}`;
    pending = r.n;
  } catch { /* reported as -1 */ }
  return { sent, failed, pending };
}
