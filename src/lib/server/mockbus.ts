// In-process stand-in for Nexconn (REALTIME_MODE=mock): rooms, groups, personal messages, last-20 replay on join.
// One process only (dev, tests). Refuses to run in production. Cards travel as envelope text, like NEXCONN_TEXT_ENVELOPE=1.
import { randomUUID } from "node:crypto";

export type BusType = "room" | "group" | "user";
/** What the SSE stream sends. `channel` for a personal message is the receiving user's id. */
export type BusMsg = { id: string; type: BusType; channel: string; from: string; fromName?: string; at: number; text: string };
type Sub = { userId: string; rooms: Set<string>; cb: (m: BusMsg) => void };

const REPLAY = 20;

class Bus {
  rooms = new Map<string, { log: BusMsg[]; muted: Map<string, number>; banned: Map<string, number> }>();
  groups = new Map<string, { members: Set<string>; log: BusMsg[] }>();
  meta = new Map<string, Record<string, string>>();
  subs = new Set<Sub>();

  ensureRoom(id: string) { if (!this.rooms.has(id)) this.rooms.set(id, { log: [], muted: new Map(), banned: new Map() }); }
  destroyRoom(id: string) { this.rooms.delete(id); this.meta.delete(id); }
  ensureGroup(id: string, members: string[]) {
    const g = this.groups.get(id) ?? { members: new Set<string>(), log: [] };
    members.forEach((m) => g.members.add(m));
    this.groups.set(id, g);
  }
  setMeta(id: string, kv: Record<string, string>) { this.meta.set(id, { ...this.meta.get(id), ...kv }); }

  mute(room: string, user: string, minutes: number) { this.ensureRoom(room); this.rooms.get(room)!.muted.set(user, Date.now() + minutes * 60_000); }
  ban(room: string, user: string, minutes: number) { this.ensureRoom(room); this.rooms.get(room)!.banned.set(user, Date.now() + minutes * 60_000); }
  unban(room: string, user: string) { const r = this.rooms.get(room); r?.banned.delete(user); r?.muted.delete(user); }

  /** Why `from` may not post here, or null. Codes match what the live service returned in the POC. */
  refusal(type: BusType, channel: string, from: string): string | null {
    if (type === "room") {
      const r = this.rooms.get(channel);
      if (!r) return "23410";
      if ((r.banned.get(from) ?? 0) > Date.now()) return "23409";
      if ((r.muted.get(from) ?? 0) > Date.now()) return "23408";
    }
    if (type === "group" && !this.groups.get(channel)?.members.has(from)) return "not_member";
    return null;
  }

  publish(type: BusType, channel: string, from: string, text: string, fromName?: string): BusMsg {
    const m: BusMsg = { id: `mock_${randomUUID()}`, type, channel, from, fromName, at: Date.now(), text };
    if (type === "room") { this.ensureRoom(channel); push(this.rooms.get(channel)!.log, m); }
    if (type === "group") { this.ensureGroup(channel, []); push(this.groups.get(channel)!.log, m); }
    for (const s of this.subs) if (this.reaches(s, m)) s.cb(m);
    return m;
  }

  reaches(s: Sub, m: BusMsg) {
    if (m.type === "room") return s.rooms.has(m.channel);
    if (m.type === "group") return !!this.groups.get(m.channel)?.members.has(s.userId);
    return m.channel === s.userId;
  }

  /** Subscribes and replays the last 20 messages of each room. Returns unsubscribe. */
  subscribe(userId: string, rooms: string[], cb: (m: BusMsg) => void): () => void {
    const s: Sub = { userId, rooms: new Set(rooms), cb };
    for (const r of rooms) {
      if ((this.rooms.get(r)?.banned.get(userId) ?? 0) > Date.now()) { s.rooms.delete(r); continue; }
      this.rooms.get(r)?.log.slice(-REPLAY).forEach(cb);
    }
    this.subs.add(s);
    return () => { this.subs.delete(s); };
  }

  /** Group history, oldest first; null when the user is not a member. */
  history(channel: string, userId: string): BusMsg[] | null {
    const g = this.groups.get(channel);
    return g?.members.has(userId) ? g.log.slice(-100) : null;
  }
}

function push(log: BusMsg[], m: BusMsg) { log.push(m); if (log.length > 200) log.shift(); }

const g = globalThis as unknown as { __dibsBus?: Bus };
/** The bus. Throws in production: the mock transport must never serve real buyers. */
export function bus(): Bus {
  if (process.env.VERCEL_ENV === "production") throw new Error("REALTIME_MODE=mock is not allowed in production");
  return (g.__dibsBus ??= new Bus());
}
export type { Bus };
