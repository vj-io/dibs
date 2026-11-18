"use client";
// The live layer in the browser: one interface over the Nexconn Web SDK or the mock SSE bus (GET /api/config decides).
// It only carries messages. Cards are facts only from dibs_bot (codec). Open-channel metadata is NOT read here:
// the POC showed any connected client can overwrite it (setMetadata overwrite:true), so state comes from cards + HTTP.
import { api } from "@/lib/client/api";
import { BOT_ID, CARD_TYPES, decodeCard, type Card } from "@/lib/codec";
import type { MockMsg, PublicConfig } from "@/lib/types";

export type LiveMsg = { id: string; channel: string; from: string; fromName?: string; at: number; kind: "text" | "card"; text?: string; card?: Card };
export type LiveStatus = "connecting" | "connected" | "offline";
export type Receipt = { id: string; read: number; total: number };
export interface Live {
  kind: "nexconn" | "mock";
  userId: string;
  onStatus(cb: (s: LiveStatus) => void): () => void;
  joinRoom(channelId: string, cb: (m: LiveMsg) => void): Promise<() => void>;
  watchGroup(channelId: string, cb: (m: LiveMsg) => void): () => void;
  history(channelId: string): Promise<LiveMsg[]>;
  sendText(target: { type: "room" | "group"; id: string }, text: string): Promise<LiveMsg>;
  markRead(groupId: string, ids: string[]): void;
  onReceipts(cb: (r: Receipt[]) => void): () => void;
  onAlert(cb: (card: Card) => void): () => void;
}

/** A refused live action. `code` is the Nexconn code (23408 muted, 23409 banned, 23410 room gone) or ours. */
export class LiveError extends Error {
  code: string;
  constructor(code: string | number, message?: string) { super(message ?? `live ${code}`); this.code = String(code); this.name = "LiveError"; }
}

type Conn = Live & { close(): void };
let cached: { as?: "buyer" | "staff"; p: Promise<Conn> } | null = null;
/**
 * One live connection at a time. `as` picks the identity when both buyer and staff cookies exist (judge mode).
 * Asking for the other identity (client-side navigation from a buyer room to the seller console) closes the old one.
 */
export function getLive(as?: "buyer" | "staff"): Promise<Live> {
  if (cached && (!as || cached.as === as)) return cached.p;
  if (cached) { const old = cached.p; old.then((l) => l.close(), () => {}); }
  const token = api("POST /api/nexconn/token", as ? { as } : undefined);
  token.catch(() => {});
  const entry: { as?: "buyer" | "staff"; p: Promise<Conn> } = { as, p: null as never };
  entry.p = api("GET /api/config")
    .then(async (cfg) => (cfg.mode === "nexconn" && cfg.appKey ? nexconn(cfg, token, as) : mock((await token).userId, as)))
    .catch((e) => { if (cached === entry) cached = null; throw e; });
  cached = entry;
  return entry.p;
}

// ---------------------------------------------------------------- shared helpers

const ALERTS = new Set(["DB:Alert", "DB:Prompt"]);

function hub<T>() {
  const subs = new Set<(v: T) => void>();
  return { emit: (v: T) => subs.forEach((f) => f(v)), on: (f: (v: T) => void) => { subs.add(f); return () => { subs.delete(f); }; }, size: () => subs.size };
}

/** Remembers the last 2000 message ids: join history after a reconnect and SSE replays repeat messages. */
function seenSet() {
  const s = new Set<string>();
  return (id: string) => {
    if (s.has(id)) return true;
    s.add(id);
    if (s.size > 2000) s.delete(s.values().next().value!);
    return false;
  };
}

const browserOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

function statusHub(onOnline: () => void) {
  let cur: LiveStatus = browserOffline() ? "offline" : "connecting";
  const h = hub<LiveStatus>();
  const set = (s: LiveStatus) => {
    if (browserOffline()) s = "offline";
    if (s !== cur) { cur = s; h.emit(s); }
  };
  addEventListener("offline", () => set("offline"));
  addEventListener("online", () => { set("connecting"); onOnline(); });
  return { get: () => cur, set, on: (cb: (s: LiveStatus) => void) => { cb(cur); return h.on(cb); } };
}

/** text -> LiveMsg; a card only when the sender is dibs_bot and it decodes. */
const fromText = (id: string, channel: string, from: string, at: number, text: string, fromName?: string): LiveMsg => {
  const card = decodeCard(from, text);
  return card ? { id, channel, from, fromName, at, kind: "card", card } : { id, channel, from, fromName, at, kind: "text", text };
};

/**
 * Sender display names from our server (GET /api/names), never from the message: senderUserInfo and the SDK profile
 * are both written by the sending client. Batched, cached for the page's life; unknown senders stay unnamed ("Buyer").
 */
function nameBook() {
  const known = new Map<string, Promise<string | undefined>>();
  let batch: Map<string, (n: string | undefined) => void> | null = null;
  const flush = () => {
    const b = batch!; batch = null;
    api("GET /api/names", undefined, { ids: [...b.keys()].join(",") })
      .then((r) => b.forEach((res, id) => res(r.names[id])), () => b.forEach((res, id) => { known.delete(id); res(undefined); }));
  };
  return (id: string): Promise<string | undefined> => {
    if (id === BOT_ID) return Promise.resolve("Dibs");
    let p = known.get(id);
    if (!p) {
      if (!batch) { batch = new Map(); setTimeout(flush, 30); }
      const b = batch;
      p = new Promise((res) => b.set(id, res));
      known.set(id, p);
    }
    return p;
  };
}

// ---------------------------------------------------------------- Nexconn Web SDK

type NC = typeof import("@nexconn/chat");
type NCMessage = InstanceType<NC["Message"]>;
const BACKOFF = [2000, 5000, 15000, 30000];
const RECEIPTS_OFF = new Set([26314, 26315]);
const KICKED = 31010; // signed in elsewhere: reconnecting would kick the other tab back

async function nexconn(cfg: PublicConfig, firstToken: Promise<{ userId: string; name: string; token: string | null }>, as?: "buyer" | "staff"): Promise<Conn> {
  const nc = await import("@nexconn/chat");
  const me = await firstToken;
  const seen = seenSet();
  const rooms = new Map<string, ReturnType<typeof hub<LiveMsg>>>();
  const groups = new Map<string, ReturnType<typeof hub<LiveMsg>>>();
  const alerts = hub<Card>(), receipts = hub<Receipt[]>();
  let receiptsOff = false, attempt = 0, everConnected = false, kicked = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let connecting: Promise<void> | null = null;

  const st = statusHub(() => {
    const s = nc.NCEngine.getConnectionStatus();
    if (s === nc.ConnectionStatus.CONNECTED) st.set("connected");
    else if (s === nc.ConnectionStatus.DISCONNECTED && !kicked) { connecting = null; void connect().catch(() => {}); }
  });

  const names = nameBook();
  const toLive = (m: NCMessage): LiveMsg | null => {
    const channel = m.channelIdentifier.channelId, from = m.senderUserId;
    const c = (m.content ?? {}) as { text?: string } & Record<string, unknown>;
    const fromName = undefined; // filled from our server by `named` (never the client-supplied senderUserInfo)
    if (m.messageType === nc.MessageType.TEXT) return fromText(m.messageId, channel, from, m.sentTime, String(c.text ?? ""), fromName);
    const card = m.messageType.startsWith("DB:") ? decodeCard(from, { type: m.messageType, content: m.content }) : null;
    return card ? { id: m.messageId, channel, from, fromName, at: m.sentTime, kind: "card", card } : null; // other types: not ours
  };

  // initialize -> register custom types -> handlers -> connect (order matters; registration is a no-op before init)
  nc.NCEngine.initialize({ appKey: cfg.appKey, areaCode: nc.AreaCode[cfg.area], logLevel: nc.LogLevel.ERROR });
  // Unregistered custom types are dropped silently by the SDK (POC check 3), so every DB:* type is registered.
  nc.NCEngine.registerCustomMessages(CARD_TYPES.map((messageType) => ({ messageType, isPersisted: true, isCounted: false })));
  nc.NCEngine.addConnectionStatusHandler("dibs", new nc.ConnectionStatusHandler({
    onConnectionStatusChanged({ status, code }) {
      if (status === nc.ConnectionStatus.CONNECTED) {
        attempt = 0; st.set("connected");
        if (everConnected) reenter(); // after a drop: make sure we are back in our rooms (missed messages come as join history)
        everConnected = true;
      } else if (status === nc.ConnectionStatus.CONNECTING) st.set("connecting");
      else {
        st.set("offline");
        if (status === nc.ConnectionStatus.DISCONNECTED && code === KICKED) kicked = true;
        else if (status === nc.ConnectionStatus.DISCONNECTED && code) scheduleRetry(); // token expired etc.: fresh token
      }
    },
  }));
  nc.NCEngine.addMessageHandler("dibs", new nc.MessageHandler({
    onMessageReceived({ messages }) {
      for (const m of messages) {
        if (seen(m.messageId)) continue;
        const msg = toLive(m);
        if (!msg) continue;
        const t = m.channelIdentifier.channelType;
        if ((t === nc.ChannelType.DIRECT || t === nc.ChannelType.SYSTEM) && msg.from === BOT_ID && msg.card && ALERTS.has(msg.card.t)) { alerts.emit(msg.card); continue; }
        const emit = (x: LiveMsg) => {
          if (t === nc.ChannelType.OPEN) rooms.get(x.channel)?.emit(x);
          else if (t === nc.ChannelType.GROUP) groups.get(x.channel)?.emit(x);
        };
        if (msg.kind === "card") emit(msg); // cards first, without waiting on a name
        else void named(msg).then(emit);
      }
    },
    onMessageReceiptResponse({ responses }) {
      receipts.emit(responses.map((r) => ({ id: r.messageId, read: r.readCount, total: r.totalCount })));
    },
  }));

  const named = async (x: LiveMsg): Promise<LiveMsg> => ({ ...x, fromName: await names(x.from) });

  const enter = async (id: string) => {
    const r = await new nc.OpenChannel(id).enterChannel({ messageCount: 20 });
    if (!r.isOk) throw new LiveError(r.code, `enter ${r.code}`);
  };
  const reenter = () => rooms.forEach((_, id) => { enter(id).catch(() => {}); });

  const scheduleRetry = () => {
    clearTimeout(retry);
    retry = setTimeout(() => { connecting = null; void connect().catch(() => {}); }, BACKOFF[Math.min(attempt++, BACKOFF.length - 1)]);
  };

  let token: string | null = me.token;
  function connect(): Promise<void> {
    connecting ??= (async () => {
      st.set("connecting");
      try {
        const t = token ?? (await api("POST /api/nexconn/token", as ? { as } : undefined)).token;
        token = null; // a token is used once; a reconnect asks for a fresh one
        if (!t) throw new LiveError("no_token");
        const r = await nc.NCEngine.connect({ token: t });
        if (!r.isOk) throw new LiveError(r.code, `connect ${r.code}`);
      } catch (e) {
        st.set("offline");
        scheduleRetry();
        throw e;
      }
    })();
    return connecting;
  }
  void connect().catch(() => {});

  const ready = async () => { if (nc.NCEngine.getConnectionStatus() !== nc.ConnectionStatus.CONNECTED) await connect(); };

  return {
    kind: "nexconn",
    userId: me.userId,
    onStatus: st.on,
    async joinRoom(id, cb) {
      let h = rooms.get(id);
      const first = !h;
      if (!h) rooms.set(id, (h = hub<LiveMsg>()));
      const off = h.on(cb);
      if (first) {
        try { await ready(); await enter(id); }
        catch (e) { off(); rooms.delete(id); throw e; }
      }
      return () => {
        off();
        if (rooms.get(id)?.size() === 0) { rooms.delete(id); void new nc.OpenChannel(id).exitChannel().catch(() => {}); }
      };
    },
    watchGroup(id, cb) {
      let h = groups.get(id);
      if (!h) groups.set(id, (h = hub<LiveMsg>()));
      const off = h.on(cb);
      return () => { off(); if (groups.get(id)?.size() === 0) groups.delete(id); };
    },
    async history(id) {
      await ready();
      const r = await nc.BaseChannel.createMessagesQuery({ channelIdentifier: new nc.GroupChannelIdentifier(id), pageSize: 50, isAscending: false }).loadNextPage();
      if (!r.isOk || !r.data) throw new LiveError(r.code, `history ${r.code}`);
      // the page with isAscending:false (latest page) came back already oldest-first in the POC; sort to be sure
      const ms = r.data.data.map(toLive).filter((m): m is LiveMsg => !!m);
      return (await Promise.all(ms.map((m) => (m.kind === "text" ? named(m) : m)))).sort((a, b) => a.at - b.at);
    },
    async sendText(target, text) {
      await ready();
      const p = new nc.SendTextMessageParams({ text, senderUserInfo: { userId: me.userId, name: me.name } });
      if (target.type === "group") p.needReceipt = true;
      const ch = target.type === "room" ? new nc.OpenChannel(target.id) : new nc.GroupChannel(target.id);
      const r = await ch.sendMessage(p);
      if (!r.isOk || !r.data) throw new LiveError(r.code, `send ${r.code}`);
      seen(r.data.messageId);
      return { id: r.data.messageId, channel: target.id, from: me.userId, fromName: me.name, at: r.data.sentTime, kind: "text", text };
    },
    markRead(groupId, ids) {
      if (receiptsOff || !ids.length) return;
      new nc.GroupChannel(groupId).sendReadReceiptResponse(ids)
        .then((r) => { if (RECEIPTS_OFF.has(r.code)) receiptsOff = true; }).catch(() => {});
    },
    onReceipts: receipts.on,
    onAlert: alerts.on,
    close() { kicked = true; clearTimeout(retry); void nc.NCEngine.disconnect().catch(() => {}); },
  };
}

// ---------------------------------------------------------------- mock (SSE)

function mock(userId: string, as?: "buyer" | "staff"): Conn {
  const seen = seenSet();
  const rooms = new Map<string, ReturnType<typeof hub<LiveMsg>>>();
  const groups = new Map<string, ReturnType<typeof hub<LiveMsg>>>();
  const alerts = hub<Card>();
  let es: EventSource | null = null, closed = false;
  const st = statusHub(() => { if (!closed) open(); });

  const toLive = (m: MockMsg) => fromText(m.id, m.channel, m.from, m.at, m.text, m.fromName);
  function open() {
    es?.close();
    if (closed) return;
    const q = new URLSearchParams({ rooms: [...rooms.keys()].join(",") });
    if (as) q.set("as", as);
    es = new EventSource(`/api/mock/stream?${q}`);
    es.onopen = () => st.set("connected");
    es.onerror = () => st.set(es?.readyState === EventSource.CLOSED ? "offline" : "connecting");
    es.onmessage = (e) => {
      const m = JSON.parse(e.data) as MockMsg;
      if (seen(m.id)) return;
      const msg = toLive(m);
      if (m.type === "room") rooms.get(m.channel)?.emit(msg);
      else if (m.type === "group") groups.get(m.channel)?.emit(msg);
      else if (msg.card && ALERTS.has(msg.card.t)) alerts.emit(msg.card);
    };
  }
  open();

  return {
    kind: "mock",
    userId,
    onStatus: st.on,
    async joinRoom(id, cb) {
      let h = rooms.get(id);
      if (!h) { rooms.set(id, (h = hub<LiveMsg>())); open(); } // reopen with the new room: replays its last 20
      const off = h.on(cb);
      return () => { off(); if (rooms.get(id)?.size() === 0) { rooms.delete(id); open(); } };
    },
    watchGroup(id, cb) {
      let h = groups.get(id);
      if (!h) groups.set(id, (h = hub<LiveMsg>()));
      const off = h.on(cb);
      return () => { off(); if (groups.get(id)?.size() === 0) groups.delete(id); };
    },
    async history(id) {
      const r = await api("GET /api/mock/send", undefined, { history: id, as });
      r.messages.forEach((m) => seen(m.id));
      return r.messages.map(toLive);
    },
    async sendText(target, text) {
      const { message } = await api("POST /api/mock/send", { target, text, ...(as ? { as } : {}) });
      seen(message.id);
      return toLive(message);
    },
    markRead() {},
    onReceipts: () => () => {},
    onAlert: alerts.on,
    close() { closed = true; es?.close(); },
  };
}
