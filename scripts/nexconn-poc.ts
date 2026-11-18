// Nexconn proof of concept, server side. Live calls against the app in .env.local.
//   node --env-file=.env.local scripts/nexconn-poc.ts            -> runs the server-only checks, prints PASS/FAIL + ms
//   node --env-file=.env.local scripts/nexconn-poc.ts <cmd> ...  -> one action, JSON on stdout (driven by scripts/poc_browser.py)
// Every id is prefixed dibspoc_ (the app is shared with ClarityLoop). Rooms created here are destroyed at the end.
import {
  NexconnError, addGroupMembers, banInRoom, call, deleteMessage, destroyRoom, ensureBot, ensureGroup, ensureRoom,
  issueToken, muteInRoom, onlineStatus, roomCount, sendGroup, sendRoom, sendUser, setRoomMeta, unban, unmuteInRoom,
  type Priority, type Wire,
} from "../src/lib/server/nexconn.ts";
import type { Card } from "../src/lib/codec.ts";

const BOT = "dibs_bot";
const sold = (extra: Record<string, unknown> = {}): Card => ({
  t: "DB:Sold", v: 1, itemId: "poc_item", variant: "m", variantLabel: "M", buyer: "Priya S.", isBot: false, ms: 412, left: 1, ...extra,
} as Card);

const wire = (kind: string, extra: Record<string, unknown> = {}): Wire =>
  kind === "text" ? { text: String(extra.text ?? "hello from dibs_bot") }
  : kind === "envelope" ? { text: `[[DB:Sold]]${JSON.stringify({ ...sold(extra), t: undefined })}` }
  : kind === "unregistered" ? { type: "DB:Unreg", content: { probe: 1, ...extra } }
  : kind === "alert" ? { card: { t: "DB:Alert", kind: "paid", orderId: null, dropCode: null, text: "Payment confirmed", ...extra } as Card }
  : { card: sold(extra) };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const commands: Record<string, (...a: string[]) => Promise<unknown>> = {
  token: async (userId, name) => ({ token: await issueToken(userId, name ?? userId) }),
  "room-create": async (id) => { await ensureRoom(id); return { ok: true }; },
  "room-destroy": async (id) => { await destroyRoom(id); return { ok: true }; },
  "room-get": async (id) => (await call("poc", "/v4/open-channel/get", { channelId: id })).result,
  "room-count": async (id) => ({ count: await roomCount(id) }),
  "room-participants": async (id) => (await call("poc", "/v4/open-channel/participant/list", { channelId: id, pageSize: 50, order: 2 })).result,
  "room-send": async (id, kind = "custom", priority = "high", persist = "1") =>
    ({ messageId: await sendRoom(id, BOT, wire(kind, { sentAt: Date.now() }), priority as Priority, persist === "1"), sentAt: Date.now() }),
  // n cards, `gap` ms apart; each carries sentAt (taken just before the REST call) so the browser can compute latency
  "room-latency": async (id, n = "20", gap = "400", kind = "custom") => {
    const out: { seq: number; restMs: number }[] = [];
    for (let i = 0; i < Number(n); i++) {
      const t0 = Date.now();
      await sendRoom(id, BOT, wire(kind, { sentAt: t0, seq: i }), "high");
      out.push({ seq: i, restMs: Date.now() - t0 });
      await sleep(Number(gap));
    }
    return out;
  },
  "meta-set": async (id, key, value) => { const t0 = Date.now(); await setRoomMeta(id, { [key]: value }); return { ok: true, sentAt: t0 }; },
  "meta-get": async (id) => (await call("poc", "/v4/open-channel/metadata/batch/get", { channelId: id })).result,
  "group-create": async (id, ...members) => { await ensureGroup(id, "Dibs POC", members); return { ok: true }; },
  "group-add": async (id, ...members) => { await addGroupMembers(id, members); return { ok: true }; },
  "group-send": async (id, kind = "custom") => ({ messageId: await sendGroup(id, wire(kind, { sentAt: Date.now() })), sentAt: Date.now() }),
  "group-dismiss": async (id) => (await call("poc", "/v4/group-channel/dismiss", { channelId: id })),
  "user-send": async (uid, via = "direct", kind = "custom") =>
    ({ messageId: await sendUser(uid, wire(kind, { sentAt: Date.now() }), via as "direct" | "system"), sentAt: Date.now() }),
  mute: async (room, uid, min = "5") => { await muteInRoom(room, uid, Number(min)); return { ok: true }; },
  unmute: async (room, uid) => { await unmuteInRoom(room, uid); return { ok: true }; },
  ban: async (room, uid, min = "5") => { await banInRoom(room, uid, Number(min)); return { ok: true }; },
  unban: async (room, uid) => { await unban(room, uid); return { ok: true }; },
  delete: async (type, channel, messageId, from) => { await deleteMessage({ channelType: type as "room", channelId: channel, messageId, fromUserId: from }); return { ok: true }; },
  online: async (uid) => ({ online: await onlineStatus(uid) }),
  raw: async (path, json = "{}") => call("poc_raw", path, JSON.parse(json)),
};

async function timed(name: string, f: () => Promise<unknown>) {
  const t0 = Date.now();
  try {
    const r = await f();
    console.log(`PASS ${name} ${Date.now() - t0}ms ${JSON.stringify(r ?? null).slice(0, 220)}`);
    return r;
  } catch (e) {
    const code = e instanceof NexconnError ? e.code : "throw";
    console.log(`FAIL ${name} ${Date.now() - t0}ms code=${code} ${e instanceof Error ? e.message : e}`);
    return undefined;
  }
}

async function serverChecks() {
  const room = `dibspoc_r${Date.now().toString(36)}`, grp = `dibspoc_g${Date.now().toString(36)}`, club = `dibspoc_c${Date.now().toString(36)}`;
  const A = "dibspoc_b_a", S = "dibspoc_s_a";
  await timed("token A", () => issueToken(A, "Poc Buyer"));
  await timed("token S", () => issueToken(S, "Poc Staff"));
  await timed("token bot", () => ensureBot());
  await timed("room create", () => ensureRoom(room));
  await timed("room create again (idempotent)", () => ensureRoom(room));
  await timed("room get", () => commands["room-get"](room));
  await timed("room send text normal", () => sendRoom(room, BOT, wire("text"), "normal"));
  await timed("room send custom high", () => sendRoom(room, BOT, wire("custom"), "high"));
  await timed("room send raw priority 2 (no fallback)", () => call("poc", "/v4/open-channel/message/send", {
    fromUserId: BOT, toChannelIds: [room], messageType: "DB:Sold", content: JSON.stringify({ v: 1 }), shouldPersist: 1, priority: 2,
  }));
  await timed("room meta set", () => setRoomMeta(room, { db_state: JSON.stringify({ v: 1, status: "live" }) }));
  await timed("room meta get", () => commands["meta-get"](room));
  await timed("room participant count", () => roomCount(room));
  await timed("room participant list", () => commands["room-participants"](room));
  await timed("room mute A", () => muteInRoom(room, A, 5));
  await timed("room unmute A", () => unmuteInRoom(room, A));
  await timed("room ban A", () => banInRoom(room, A, 5));
  await timed("room unban A", () => unban(room, A));
  const mid = await timed("room send for delete", () => sendRoom(room, BOT, wire("text", { text: "delete me" }), "normal")) as string | null;
  if (mid) await timed("message delete (room)", () => deleteMessage({ channelType: "room", channelId: room, messageId: mid, fromUserId: BOT }));
  await timed("group create", () => ensureGroup(grp, "Dibs POC", [A, S]));
  await timed("group create again (exists -> join)", () => ensureGroup(grp, "Dibs POC", [A, S]));
  await timed("group send card", () => sendGroup(grp, wire("custom")));
  await timed("direct send", () => sendUser(A, wire("custom"), "direct"));
  await timed("system send", () => sendUser(A, wire("custom"), "system"));
  await timed("online status A", () => onlineStatus(A));
  await timed("community create", () => call("poc", "/v4/community-channel/create", { userId: S, channelId: club, name: "Dibs POC club" }));
  await timed("community subchannel create", () => call("poc", "/v4/community-channel/subchannel/create", { channelId: club, subchannelId: "drops", channelVisibility: 0 }));
  await timed("community join", () => call("poc", "/v4/community-channel/join", { userId: A, channelId: club }));
  await timed("community send", () => call("poc", "/v4/community-channel/message/send", {
    fromUserId: S, toChannelIds: [club], subchannelId: "drops", messageType: "RC:TxtMsg", content: JSON.stringify({ content: "club hello" }), shouldPersist: 1,
  }));
  await timed("group dismiss", () => call("poc", "/v4/group-channel/dismiss", { channelId: grp }));
  await timed("room destroy", () => destroyRoom(room));
  await timed("room get after destroy (expect 23410)", () => commands["room-get"](room));
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) await serverChecks();
else if (!commands[cmd]) { console.error(`unknown command ${cmd}; one of ${Object.keys(commands).join(", ")}`); process.exit(2); }
else {
  try { console.log(JSON.stringify(await commands[cmd](...args))); }
  catch (e) { console.log(JSON.stringify({ error: e instanceof NexconnError ? e.code : "throw", message: e instanceof Error ? e.message : String(e) })); process.exitCode = 1; }
}
process.exit();
