"use client";
/* eslint-disable @next/next/no-img-element -- product thumbnails are SVG drawings or pre-compressed Storage images */
// The sale room: one live piece, one Dibs! button, the room's ticker and chat. The server decides every claim;
// this screen shows the POST /api/claims answer at once and follows the room through dibs_bot cards.
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { getLive, type Live, type LiveMsg, type LiveStatus } from "@/lib/client/live";
import { applyCard, forOtherDrop, mergeState, tickerKey } from "@/lib/client/sale";
import { useNow, useOnline, useSlow, useTryTick, withTimeout } from "@/lib/client/hooks";
import { coachLine } from "@/lib/client/coach";
import { reportTap } from "@/lib/client/tap-metric";
import { BLOCKED_TEXT, hideOnArrival, scamRules } from "@/lib/ai/scam-shield";
import { displayName, tapTime, type Card } from "@/lib/codec";
import type { ClaimResult, DropState, MyStatus, PublicConfig } from "@/lib/types";
import {
  AppHeader, Avatar, Banner, BottomSheet, Burst, Button, Card as Box, Chip, ConnectionBar, Countdown, EmptyState, Icon,
  LinkButton, PhotoCarousel, Price, Skeleton, Stamp, StatePill, buttonClasses, cx, mmss, useToast, type IconName,
} from "@/components/ui";
import type { ChatLine } from "@/components/chat/Chat";
import { ClubJoin } from "@/components/club/ClubJoin";
import { JoinSheet } from "./JoinSheet";
import { StillConnecting } from "./StillConnecting";
import { Remind } from "./Remind";

// the chat (and its emoji row) loads after the piece and the Dibs! button: first paint carries only what claims
const Chat = dynamic(() => import("@/components/chat/Chat").then((m) => m.Chat), {
  ssr: false, loading: () => <Skeleton className="h-40 w-full rounded-wobble-2" />,
});

type Prompt = Extract<Card, { t: "DB:Prompt" }>;
type Result = (ClaimResult | { result: "error"; message: string; position: null; orderId: null; expiresAt: null; ms: null; claimId: null })
  & { itemId: string; variantKey: string; tapAt: number; at: number };
type Me = MyStatus & { startedAt: number; muted: boolean };

declare global {
  interface Window { __dibs?: { lastTapMs: number | null; lastResult: string | null; taps: { ms: number; result: string; serverMs: number | null }[]; cards: string[] } }
}

const dibsDebug = () => (window.__dibs ??= { lastTapMs: null, lastResult: null, taps: [], cards: [] });

export function SaleRoom({ dropId, preview, initial }: { dropId: string; preview?: boolean; initial?: DropState }) {
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();
  const now = useNow();

  const [state, setState] = useState<DropState | null>(initial ?? null);
  const [missing, setMissing] = useState(false);
  const [buyer, setBuyer] = useState<string | null | undefined>(preview ? null : undefined); // display name; null = not joined
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [pick, setPick] = useState<{ itemId: string; key: string } | null>(null);
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [promo, setPromo] = useState<{ orderId: string | null; text: string; at: number } | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [chatNote, setChatNote] = useState<string | null>(null);
  const [release, setRelease] = useState<MyStatus["holds"][number] | null>(null);
  // the order room opens by itself after the celebration has been seen (promotion 1.6 s, win 3 s)
  const [autoOpen, setAutoOpen] = useState<{ orderId: string; ms: number; from: "won" | "promoted"; itemId?: string } | null>(null);
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [announce, setAnnounce] = useState("");
  const [liveTry, setLiveTry] = useState(0);
  const [meId, setMeId] = useState<string | null>(null);

  const liveRef = useRef<Live | null>(null);
  const dibsRef = useRef<HTMLButtonElement>(null);
  const focusDibs = () => dibsRef.current?.focus({ preventScroll: true });
  const latencyRef = useRef<HTMLSpanElement>(null);
  const meTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const joined = !!buyer;
  const joinedRef = useRef(false);
  const verRef = useRef(0);
  // Judge-mode rooms reuse a pool of channels: the join replay can carry the previous visitor's cards and chat, whose
  // versions belong to another drop. Room cards say their drop (dropped below when it isn't this one); as a second
  // line, anything sent before this sandbox drop started is not ours (that also covers the previous visitor's chat).
  const floorRef = useRef(0);
  const hiddenRef = useRef(new Set<string>());
  const waitsRef = useRef<Set<string>>(new Set());
  const previewRef = useRef(!!preview);
  useEffect(() => {
    joinedRef.current = joined; verRef.current = state?.version ?? 0;
    floorRef.current = state?.isSandbox ? Date.parse(state.startsAt) - 2000 : 0;
  }, [joined, state?.version, state?.isSandbox, state?.startsAt]);

  // ------------------------------------------------------------ data
  const loadMe = useCallback(async () => {
    if (previewRef.current || !navigator.onLine) return; // preview (seller console) is staff: no buyer routes; offline: the online event catches up
    const startedAt = performance.now();
    try {
      const m = await api("GET /api/drops/:id/me", undefined, { id: dropId });
      const muted = !!m.mutedUntil && (m.mutedUntil === "infinity" || Date.parse(m.mutedUntil) > Date.now());
      setMe((cur) => (cur && cur.startedAt > startedAt ? cur : { ...m, startedAt, muted }));
      // promoted while the personal alert is still on its way: a waitlist place turned into a hold
      const was = waitsRef.current;
      waitsRef.current = new Set(m.waits.map((w) => w.itemId));
      const promoted = m.holds.find((h) => h.state === "held" && was.has(h.itemId));
      if (promoted && !previewRef.current) {
        setPromo((p) => p?.orderId === promoted.orderId ? p
          : { orderId: promoted.orderId, text: "It's yours! The buyer ahead didn't pay.", at: performance.now() });
        setAnnounce((a) => a.startsWith("It's yours") ? a : `It's yours! The buyer ahead didn't pay. #${promoted.position} ${promoted.title} is held for you.`);
        setAutoOpen((o) => o ?? { orderId: promoted.orderId, ms: 1600, from: "promoted" });
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setBuyer(null);
    }
  }, [dropId]);

  /** Debounced (300 ms) refetch of my holds and waitlist places, per the realtime spec. */
  const refreshMe = useCallback((ms = 300) => {
    if (meTimer.current) clearTimeout(meTimer.current);
    meTimer.current = setTimeout(() => { void loadMe(); }, ms);
  }, [loadMe]);
  const loadState = useCallback(async () => {
    if (!navigator.onLine) return; // the online event brings a catch-up fetch
    try {
      const s = await withTimeout(api("GET /api/drops/:id/state", undefined, { id: dropId }), 12_000);
      if (joinedRef.current && s.version > verRef.current) refreshMe(); // the room moved without a card reaching us
      setState((cur) => mergeState(cur, s));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 400)) setMissing(true);
    }
  }, [dropId, refreshMe]);

  const refreshState = useCallback(() => {
    if (stateTimer.current) clearTimeout(stateTimer.current);
    stateTimer.current = setTimeout(() => { void loadState(); }, 400);
  }, [loadState]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch: state is set after the response arrives
  useEffect(() => { if (!initial) void loadState(); }, [initial, loadState]);

  useEffect(() => { if (!preview) api("GET /api/config").then(setCfg, () => {}); }, [preview]);

  // who am I (a sandbox visitor already has a session from /try)
  useEffect(() => {
    if (preview) return;
    withTimeout(api("GET /api/buyer/me"), 12_000).then((r) => setBuyer(r.buyer?.displayName ?? null), () => setBuyer(null));
  }, [preview]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch: state is set after the response arrives
  useEffect(() => { if (joined) void loadMe(); }, [joined, loadMe]);

  // live room: cards + chat + personal alerts
  const channelId = state?.channelId;
  const canLive = !!channelId && (preview || joined);
  useEffect(() => {
    if (!canLive || !channelId) return;
    let gone = false;
    const offs: (() => void)[] = [];
    const onMsg = (m: LiveMsg) => {
      if (m.at < floorRef.current) return;
      if (m.kind === "card" && m.card) {
        const c = m.card;
        if (forOtherDrop(c, dropId)) return;
        const log = dibsDebug().cards; // last cards seen, for tests and debugging
        log.push(`${c.t}${"v" in c ? ` v${c.v}` : ""}${"liveItemId" in c ? ` ${String(c.liveItemId).slice(0, 8)}` : "itemId" in c ? ` ${c.itemId.slice(0, 8)}` : ""}`);
        if (log.length > 60) log.shift();
        // the hide card can arrive before the message it hides (server-sent bot lines): remember the id
        if (c.t === "DB:Hide") { hiddenRef.current.add(c.messageId); setChat((xs) => xs.filter((x) => x.id !== c.messageId)); return; }
        setState((s) => (s ? applyCard(s, c) : s));
        if (c.t === "DB:Sold" || c.t === "DB:Back" || c.t === "DB:Stock") refreshMe();
        if (c.t === "DB:State" || c.t === "DB:Item") { refreshState(); refreshMe(); }
        return;
      }
      if (!m.text || hiddenRef.current.has(m.id) || hideOnArrival(m.from, m.text)) return;
      const line: ChatLine = { id: m.id, from: m.from, fromName: m.fromName, at: m.at, text: m.text };
      setChat((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, line].slice(-150)));
    };
    const onAlert = (c: Card) => {
      if (preview) return;
      if (c.t === "DB:Prompt") { setPrompt(c); return; }
      if (c.t !== "DB:Alert") return;
      refreshMe(0);
      if (c.kind === "promoted") { setPromo({ orderId: c.orderId, text: c.text, at: performance.now() }); setAnnounce(c.text); if (c.orderId) setAutoOpen((o) => o?.orderId === c.orderId ? o : { orderId: c.orderId!, ms: 1600, from: "promoted" }); }
      else if (c.kind === "blocked") { setChatNote(c.text); toast(c.text, { tone: "warn", ms: 7000 }); }
      else toast(c.text, { tone: c.kind === "paid" || c.kind === "shipped" ? "good" : c.kind === "expiring" ? "urgent" : "warn", ms: 6000 });
    };
    getLive(preview ? "staff" : "buyer").then(async (live) => {
      if (gone) return;
      liveRef.current = live;
      setMeId(live.userId);
      offs.push(live.onStatus((s) => setStatus(s)));
      offs.push(live.onAlert(onAlert));
      const leave = await live.joinRoom(channelId, onMsg);
      if (gone) leave(); else offs.push(leave);
    }).catch(() => {
      if (gone) return;
      setStatus("offline");
      setTimeout(() => setLiveTry((n) => n + 1), 5000); // getLive forgets a failed attempt; try again
    });
    return () => { gone = true; offs.forEach((f) => f()); liveRef.current = null; };
  }, [canLive, channelId, dropId, preview, refreshMe, refreshState, toast, liveTry]);

  // HTTP fallback: every 2 s while the live connection is not up (and always for a visitor who hasn't joined)
  const connected = canLive && status === "connected";
  useEffect(() => {
    if (connected || missing) return;
    const t = setInterval(() => { if (!navigator.onLine) return; void loadState(); if (joined) void loadMe(); }, 2000);
    return () => clearInterval(t);
  }, [connected, missing, joined, loadState, loadMe]);
  // safety net while connected: a lost card must not freeze the room for long (state only, every 30 s)
  useEffect(() => {
    if (!connected || missing || state?.status === "ended") return;
    const t = setInterval(() => { if (navigator.onLine && document.visibilityState === "visible") void loadState(); }, 30_000);
    return () => clearInterval(t);
  }, [connected, missing, state?.status, loadState]);
  // back from a drop: catch up once
  const wasConnected = useRef(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch: state is set after the response arrives
    if (connected && !wasConnected.current) { void loadState(); if (joined) void loadMe(); }
    wasConnected.current = connected;
  }, [connected, joined, loadState, loadMe]);

  const slowServer = useTryTick(state?.isSandbox && !preview ? dropId : null, "room");

  // The order chat opens by itself after the celebration, but only when no other piece is live: a buyer is never
  // pulled out of a piece they could still tap. Otherwise the pay row in the action bar stays, with its timer.
  const autoItem = autoOpen ? (me?.holds.find((h) => h.orderId === autoOpen.orderId)?.itemId ?? autoOpen.itemId ?? null) : null;
  const liveItemId = state?.live?.itemId ?? null;
  const autoOk = !!autoOpen && !preview && (state?.status === "ended" || !liveItemId || (!!autoItem && autoItem === liveItemId));
  useEffect(() => {
    if (!autoOpen || !autoOk) return;
    const href = `/o/${autoOpen.orderId}?from=${autoOpen.from}`;
    router.prefetch(href);
    const t = setTimeout(() => router.push(href), autoOpen.ms);
    return () => clearTimeout(t);
  }, [autoOpen, autoOk, router]);
  const openingSlow = useSlow(autoOpen ? autoOpen.ms + 6000 : 1e9, autoOpen?.orderId);

  // tap -> result on screen, measured after the result is in the DOM
  useLayoutEffect(() => {
    if (!result || result.result === "error") return;
    const ms = Math.round(performance.now() - result.tapAt);
    const d = dibsDebug();
    if (d.taps.some((t) => t.ms === ms && t.result === result.result)) return;
    d.lastTapMs = ms; d.lastResult = result.result;
    d.taps.push({ ms, result: result.result, serverMs: result.ms });
    reportTap({ dropId, result: result.result, clientMs: ms, serverMs: result.ms });
    if (latencyRef.current) latencyRef.current.textContent = `answer in ${ms} ms`;
  }, [result, dropId]);

  // ------------------------------------------------------------ derived
  const live = state?.live ?? null;
  const variants = live?.variants ?? [];
  const inStock = variants.filter((v) => v.left > 0);
  // my own claim on this piece pins the chip (a sold-out piece must not hop to the shortest waitlist after I joined one)
  const holdHere = live ? me?.holds.find((h) => h.itemId === live.itemId) : undefined;
  const waitHere = live ? me?.waits.find((w) => w.itemId === live.itemId) : undefined;
  const lastTap = result && live && result.itemId === live.itemId && (result.result === "won" || result.result === "waitlisted" || result.result === "already") ? result.variantKey : null;
  const mine = waitHere?.variantKey ?? (holdHere ? variants.find((v) => v.label === holdHere.variantLabel)?.key : undefined) ?? lastTap;
  const chosen = mine && variants.some((v) => v.key === mine) ? mine
    : pick && pick.itemId === live?.itemId && variants.some((v) => v.key === pick.key) ? pick.key
    : variants.length === 1 ? variants[0].key : inStock.length === 1 ? inStock[0].key // one choice left: preselected
    // everything sold out: preselect the shortest waitlist, so one tap on Dibs! still joins a line (bots can sell a piece out in a second)
    : inStock.length === 0 && variants.length ? [...variants].sort((a, b) => a.waiting - b.waiting)[0].key
    : null;
  const chosenV = variants.find((v) => v.key === chosen);
  const settled = (r: Result) => !!me && me.startedAt > r.at; // my status fetched after this result: it is the truth
  const hold = holdHere;
  const wait = waitHere;
  const freshResult = result && live && result.itemId === live.itemId ? result : null;
  const wonHere = hold ?? (freshResult?.result === "won" && !settled(freshResult) && freshResult.orderId
    ? { orderId: freshResult.orderId, expiresAt: freshResult.expiresAt, state: "held" as const, position: live!.position, variantLabel: chosenV?.label ?? "" }
    : null);
  const waitPos = wait?.waitPosition ?? (freshResult?.result === "waitlisted" && !settled(freshResult) ? freshResult.position : null);
  const photos = live?.photos ?? [];
  const photoReady = !live || photos.length === 0 || readyFor === live.itemId;
  const offline = !online || (canLive && status === "offline");
  const promoHold = promo?.orderId ? me?.holds.find((h) => h.orderId === promo.orderId) : undefined;
  // a promotion stays on screen while that hold waits for payment (or until my status, fetched after it, says otherwise)
  const promoLive = !!promo && (promoHold ? promoHold.state === "held" : !(me && me.startedAt > promo.at));
  const promoHere = promoLive && !!wonHere && promo!.orderId === wonHere.orderId;

  function dibsBlock(): string | null {
    if (!state || buyer === undefined) return "Loading…";
    if (offline) return "Reconnecting…";
    if (state.status === "scheduled") return "Not live yet";
    if (state.status === "ended") return "Drop ended";
    if (!live) return "Next piece coming up…";
    if (live.state === "closed") return "Closed";
    if (me?.banned) return "You can't claim in this sale room.";
    if (wonHere) return "It's yours · pay to keep it";
    if (waitPos) return `You're #${waitPos} in line`;
    if (freshResult?.result === "waitlist_full" && freshResult.variantKey === chosen) return "Sold out · waitlist full";
    if (!photoReady) return "Loading photo…";
    if (joined && !chosen) return "Pick an option first";
    return null;
  }
  const block = preview ? (dibsBlock() ?? "Buyers tap here") : dibsBlock();

  async function dibs() {
    if (!joined) { setJoinOpen(true); return; }
    if (!live || !chosen || busy) return;
    const tapAt = performance.now();
    setBusy(true); setPrompt(null); setAnnounce("");
    try {
      const r = await api("POST /api/claims", { itemId: live.itemId, variantKey: chosen });
      setResult({ ...r, itemId: live.itemId, variantKey: chosen, tapAt, at: performance.now() });
      setAnnounce(r.message);
      if (r.result === "won" && r.orderId) setAutoOpen({ orderId: r.orderId, ms: 3000, from: "won", itemId: live.itemId });
      refreshMe(0);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Something went wrong. Try again.";
      setResult({ result: "error", message, position: null, orderId: null, expiresAt: null, ms: null, claimId: null, itemId: live.itemId, variantKey: chosen, tapAt, at: performance.now() });
      setAnnounce(message);
      if (e instanceof ApiError && e.status === 401) setBuyer(null);
    } finally {
      setBusy(false);
    }
  }

  async function sendChat(text: string) {
    const lv = liveRef.current;
    if (!lv || !state) throw new Error("Reconnecting… try again in a moment.");
    // Same rules as the server's scam shield, checked before sending, so a refused message never reaches the room even
    // if the Nexconn webhook is late (one production check on 19 Nov 2026 saw no removal within 30 s). The webhook still
    // screens anything sent around this app. The attempt is reported so the seller's moderation log shows it.
    if (scamRules(text).blocked) {
      void api("POST /api/drops/:id/blocked", { text }, { id: state.dropId }).catch(() => {});
      throw new Error(BLOCKED_TEXT);
    }
    try {
      const m = await lv.sendText({ type: "room", id: state.channelId }, text);
      setChat((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, { id: m.id, from: m.from, fromName: m.fromName, at: m.at, text }]));
    } catch (e) {
      const code = String((e as { code?: string }).code ?? "");
      if (code.endsWith("23408")) { refreshMe(0); throw new Error("You're muted for a few minutes"); }
      if (code.endsWith("23409")) throw new Error("You can't chat in this sale room.");
      if (code.endsWith("23410")) throw new Error("The room's chat isn't open yet. Try again in a moment.");
      throw new Error("Couldn't send. Try again.");
    }
  }

  async function doRelease() {
    if (!release) return;
    try {
      await api("POST /api/claims/:id/release", undefined, { id: release.claimId });
      toast(`Released #${release.position}. The next buyer in line gets it.`, { tone: "info" });
      if (promo?.orderId === release.orderId) setPromo(null);
      if (autoOpen?.orderId === release.orderId) setAutoOpen(null);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't release. Try again.", { tone: "warn" });
    }
    setRelease(null);
    refreshMe(0);
  }

  async function leave(claimId: string) {
    try { await api("POST /api/claims/:id/leave", undefined, { id: claimId }); toast("You left the waitlist.", { tone: "info" }); }
    catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't leave. Try again.", { tone: "warn" }); }
    refreshMe(0);
  }

  function applyPrompt(p: Prompt) {
    if (live && p.variant) setPick({ itemId: live.itemId, key: p.variant });
    setPrompt(null);
    dibsRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    focusDibs();
  }

  /** One or two lines under Dibs!: the result, my place in line, or why Dibs is off. */
  function statusLine(): { tone: "lime" | "yellow" | "peach" | "plain"; icon: IconName; text: React.ReactNode } {
    if (promoLive && promo) {
      const head = promo.text.replace(/\s*Pay within.*$/, "");
      return { tone: "lime", icon: "sparkle", text: <>{head}{promoHold?.expiresAt && <> Pay within <Countdown expiresAt={promoHold.expiresAt} size="sm" /></>}
        {promo.orderId && <> <Link href={`/o/${promo.orderId}?from=promoted`} className="whitespace-nowrap underline decoration-2">Open order</Link></>}</> };
    }
    if (wonHere) {
      if (wonHere.state === "held") return { tone: "lime", icon: "check", text: <>You got it! Pay within {wonHere.expiresAt ? <Countdown expiresAt={wonHere.expiresAt} size="sm" /> : mmss(0)}</> };
      return { tone: "lime", icon: "check", text: wonHere.state === "payment_claimed" ? "Payment sent · waiting for the shop to confirm" : "Paid · it's yours" };
    }
    if (waitPos) return { tone: "yellow", icon: "queue", text: `You're #${waitPos} on the waitlist. We'll tell you the moment it's yours.` };
    if (freshResult && freshResult.result !== "won" && freshResult.result !== "waitlisted") return { tone: "peach", icon: "warning", text: freshResult.message };
    if (block) return { tone: "plain", icon: block === "Reconnecting…" ? "warning" : "clock", text: block };
    if (!joined) return { tone: "plain", icon: "tap", text: "Tap Dibs! to join and claim. First tap wins." };
    if (chosenV && chosenV.left === 0) return { tone: "plain", icon: "queue", text: `Sold out · tap to join the waitlist${chosenV.waiting ? ` (${chosenV.waiting} waiting)` : ""}` };
    return { tone: "plain", icon: "tap", text: "First tap wins. The server decides, everyone sees it." };
  }

  // ------------------------------------------------------------ render
  if (missing) return <RoomMissing preview={preview} />;
  if (!state) return <RoomSkeleton preview={preview} onRetry={() => void loadState()} />;

  const sandbox = state.isSandbox;
  const sold = live?.state === "sold_out";
  const chatLocked = !joined ? "Join the room to chat." : me?.banned ? "You can't chat in this sale room." : me?.muted ? "You're muted for a few minutes" : null;
  const upcoming = [...state.items].sort((a, b) => a.position - b.position);
  const startsIn = Math.max(0, Date.parse(state.startsAt) - now);
  const wide = !preview; // the two-column desktop layout (never inside the seller's phone preview)
  const showBar = !!live && state.status !== "ended";
  // the hold to pay for that is not the piece on screen (promotions on earlier pieces, unpaid wins)
  const payHold = me?.holds.find((h) => h.state === "held" && h.itemId !== live?.itemId)
    ?? me?.holds.find((h) => h.state === "payment_claimed" && h.itemId !== live?.itemId);
  const coachHold = me?.holds.find((h) => h.state === "held") ?? me?.holds.find((h) => h.state === "payment_claimed");
  const coach = sandbox && !preview ? coachLine({
    status: state.status, startsInMs: startsIn,
    live: live ? { position: live.position, soldOut: live.state === "sold_out" || live.variants.every((v) => v.left === 0) } : null,
    hold: coachHold ? { position: coachHold.position, state: coachHold.state as "held" | "payment_claimed", promoted: !!promo && promo.orderId === coachHold.orderId }
      : promoLive && promo ? { position: live?.position ?? 1, state: "held", promoted: true }
      : wonHere && wonHere.state !== "paid" && wonHere.state !== "shipped" && live ? { position: live.position, state: wonHere.state, promoted: false } : null,
    wonLive: !!wonHere, waitPos: waitPos ?? null,
    queueMoved: !!live && state.recent.some((c) => c.t === "DB:Back" && c.itemId === live.itemId),
    paidBefore: !!me?.holds.some((h) => h.state === "paid" || h.state === "shipped"),
    slowServer,
  }) : null;
  const shareUrl = typeof window === "undefined" ? "" : `${window.location.origin}/s/${state.shop.slug}/d/${state.code}`;
  const smallPhoto = sandbox && !preview;

  const left = (
    <div className="flex min-w-0 flex-col gap-4">
      {coach && (
        <p className="flex items-center gap-2 rounded-wobble border-2 border-dashed border-violet-ink bg-violet px-3 py-2 font-hand text-lg leading-tight" data-testid="coach">
          <Icon name={slowServer ? "clock" : "sparkle"} size={20} className="shrink-0 text-violet-ink" />
          <span><span className="sr-only">Demo guide: </span>{coach}</span>
        </p>
      )}

      {!preview && buyer === null && (
        <Box tint="yellow" flat className="flex flex-col gap-2">
          <p className="font-extrabold">Join to call dibs</p>
          <p className="leading-snug">Add your name and number once. Then one tap claims a piece.</p>
          <Button icon="arrowRight" onClick={() => setJoinOpen(true)}>Join the room</Button>
        </Box>
      )}

      {!showBar && payHold && <PayRow hold={payHold} promoted={!!promo && promo.orderId === payHold.orderId} big />}

      {prompt && live && prompt.itemId === live.itemId && (
        <button type="button" onClick={() => applyPrompt(prompt)}
          className="pop-in flex min-h-14 items-center gap-3 rounded-wobble border-[2.5px] border-ink bg-sky px-4 py-2 text-left font-extrabold shadow-ink-sm">
          <Icon name="tap" size={26} />
          <span className="flex-1">{prompt.text}</span>
          <Icon name="arrowRight" size={20} />
        </button>
      )}

      {state.status === "scheduled" && (
        <Box tint="yellow" className="flex flex-col items-start gap-3">
          <StatePill state="waiting" label="Waiting room" />
          <h1 className="text-3xl">{state.title}</h1>
          <p className="flex flex-wrap items-center gap-2 text-lg">
            {startsIn > 0 ? <>Starts in <Countdown expiresAt={state.startsAt} urgentBelow={0} size="lg" /></> : <>Starting any moment now…</>}
          </p>
          <p className="font-hand text-lg leading-snug">Pieces drop one at a time. Pick your size, then tap <strong>Dibs!</strong> First tap wins.</p>
          {!sandbox && !preview && startsIn > 0 && <Remind dropId={dropId} title={state.title} startsAt={state.startsAt} shareUrl={shareUrl} />}
        </Box>
      )}

      {state.status === "ended" && (
        sandbox ? <EndCard /> : (
          <Box tint="grey" className="flex flex-col gap-2">
            <StatePill state="ended" />
            <h1 className="text-3xl">That&apos;s a wrap</h1>
            <p>{me && (me.holds.length > 0) ? "Here's what you got. Pay for any held piece before its timer runs out." : "This drop has ended. Thanks for coming!"}</p>
          </Box>
        )
      )}

      {state.status === "live" && !live && (
        <Box className="flex flex-col items-center gap-2 py-8 text-center">
          <Icon name="clock" size={36} draw />
          <h1 className="text-xl font-extrabold">Next piece coming up…</h1>
          <p className="text-muted">Stay here. It drops for everyone at the same moment.</p>
        </Box>
      )}

      {live && state.status !== "ended" && (
        <Box as="article" className="flex flex-col gap-3 p-3" aria-label={`Piece ${live.position}: ${live.title}`}>
          {/* photo height capped so title and price sit above the action bar at 360x640, smaller on short screens and
              under the demo banner and coach */}
          <div className={cx("mx-auto w-full",
            smallPhoto ? "max-w-[min(100%,20vh)] [@media(max-height:700px)]:max-w-[min(100%,15vh)]"
              : "max-w-[min(100%,30vh)] [@media(max-height:700px)]:max-w-[min(100%,22vh)]",
            wide && "lg:max-w-[min(100%,34vh)]")}>
            <PhotoCarousel key={live.itemId} photos={photos} alt={live.title} onFirstLoad={() => setReadyFor(live.itemId)}>
              {sold && <Stamp word="SOLD" size="sm" className="absolute left-2 top-2" />}
              {live.state === "closed" && <span className="absolute left-2 top-2"><StatePill state="closed" size="sm" /></span>}
              {wonHere && <Stamp word="YOURS" size="sm" tilt={8} className="absolute right-2 top-2" />}
            </PhotoCarousel>
          </div>
          <div className="flex items-start justify-between gap-3">
            <h1 className="min-w-0 text-xl leading-tight [overflow-wrap:anywhere] sm:text-2xl"><span className="font-mono text-muted">#{live.position}</span> {live.title}</h1>
            <Price paise={live.pricePaise} size="md" className="shrink-0 text-2xl sm:text-3xl" />
          </div>
          {live.note && <p className="font-hand text-lg leading-snug">{live.note}</p>}
          <div id="dibs-result">
            <ResultPanel wonHere={wonHere} result={freshResult} latencyRef={latencyRef}
              promoText={promoHere ? promo!.text.replace(/\s*Pay within.*$/, "") : null}
              opening={autoOk && autoOpen?.orderId === wonHere?.orderId} openingSlow={openingSlow} onStay={() => setAutoOpen(null)} />
          </div>
        </Box>
      )}

      {showBar && live && (
        // The claim controls are always on screen: fixed to the bottom on phones (a spacer at the end of the page keeps
        // the chat clear of it), in the flow of the left column on desktop, sticky inside the seller's phone preview.
        // Fixed heights (chips row, 56 px button, two-line status) so nothing jumps when the state changes.
        <div className={cx("z-20 border-t-[2.5px] border-ink bg-paper/95 pt-2 backdrop-blur-sm pb-[max(0.6rem,env(safe-area-inset-bottom))]",
          preview ? "sticky bottom-0 -mx-3 px-3" : "fixed inset-x-0 bottom-0 px-4",
          wide && "lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none")} data-testid="action-bar">
          <div className="mx-auto flex w-full max-w-xl flex-col gap-2 lg:max-w-none">
            {payHold && <PayRow hold={payHold} promoted={!!promo && promo.orderId === payHold.orderId} />}
            <div role="group" aria-label="Pick an option"
              className={cx("-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]", wide && "lg:flex-wrap lg:overflow-visible")}>
              {variants.map((v) => (
                <Chip key={v.key} label={v.label} left={v.left} waiting={v.waiting} className="shrink-0 whitespace-nowrap"
                  selected={chosen === v.key} disabled={preview}
                  onSelect={() => { if (!mine && variants.length > 1) setPick({ itemId: live.itemId, key: v.key }); }} />
              ))}
            </div>
            {/* aria-disabled, not disabled: Dibs! stays focusable, keeps focus after a tap, and a tap on it while it
                cannot claim says why (in the status line and to screen readers) */}
            <button ref={dibsRef} type="button" disabled={preview} aria-disabled={!!block || undefined} aria-busy={busy || undefined}
              aria-describedby="dibs-status"
              onPointerDown={() => { if (!block && !busy) navigator.vibrate?.(12); }}
              onClick={() => {
                if (busy) return;
                if (block) { setAnnounce((a) => (a === block ? `${block}​` : block)); return; }
                void dibs();
              }}
              className={buttonClasses("dibs", "md", cx("h-14",
                "aria-disabled:cursor-not-allowed aria-disabled:bg-grey aria-disabled:text-grey-ink aria-disabled:shadow-none aria-disabled:active:translate-x-0 aria-disabled:active:translate-y-0"))}>
              <Icon name={busy ? "clock" : "tap"} size={28} stroke={2.6} className={busy ? "motion-safe:animate-spin motion-safe:[animation-duration:1.6s]" : undefined} />
              <span>{busy ? "Checking…" : "Dibs!"}</span>
            </button>
            <StatusLine id="dibs-status" {...statusLine()} />
          </div>
        </div>
      )}
    </div>
  );

  const right = (
    <div className="flex min-w-0 flex-col gap-4">
      {joined && me && (me.holds.length > 0 || me.waits.length > 0) && (
        <section aria-labelledby="my-status" className="flex flex-col gap-2">
          <h2 id="my-status" className="font-hand text-2xl font-normal tracking-normal">My status</h2>
          {me.holds.map((h) => (
            <div key={h.claimId} className="flex flex-wrap items-center gap-2 rounded-wobble border-2 border-ink bg-card px-3 py-2 shadow-ink-sm">
              <span className="w-full font-semibold">#{h.position} {h.title} · {h.variantLabel}</span>
              <StatePill state={h.state} size="sm" />
              {h.state === "held" && h.expiresAt && <Countdown expiresAt={h.expiresAt} size="sm" onDone={() => refreshMe(500)} />}
              {h.state === "payment_claimed" && h.expiresAt && <Countdown expiresAt={h.expiresAt} size="sm" paused />}
              <div className="flex w-full gap-2">
                <LinkButton href={`/o/${h.orderId}`} size="sm" icon={h.state === "held" ? "rupee" : "chat"}>{h.state === "held" ? "Pay now" : "Order chat"}</LinkButton>
                {h.state === "held" && <Button size="sm" variant="ghost" onClick={() => setRelease(h)}>Release</Button>}
              </div>
            </div>
          ))}
          {me.waits.map((w) => (
            <div key={w.claimId} className="flex flex-wrap items-center gap-2 rounded-wobble border-2 border-ink bg-yellow px-3 py-2">
              <span className="w-full font-semibold">#{w.position} {w.title} · {w.variantLabel}</span>
              <StatePill state="waitlisted" size="sm" label={`#${w.waitPosition} in line`} />
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => void leave(w.claimId)}>Leave</Button>
            </div>
          ))}
        </section>
      )}

      <section aria-labelledby="ticker-h" className="flex flex-col gap-2">
        <h2 id="ticker-h" className="font-hand text-2xl font-normal tracking-normal">Sold to…</h2>
        {state.recent.length ? <RoomTicker recent={state.recent} /> : <p className="font-hand text-lg text-muted">Nothing sold yet.</p>}
      </section>

      {!preview && cfg?.features.community && <ClubJoin shopId={state.shop.id} shopSlug={state.shop.slug} />}

      {/* the seller console has its own room chat beside the phone preview: no second copy inside it */}
      {!preview && (
        <Chat title="Room chat" lines={chat} meId={meId}
          collapsible defaultOpen onSend={sendChat} disabledReason={chatLocked} note={chatNote}
          empty={canLive ? undefined : "Join the room to see the chat."} />
      )}

      {upcoming.length > 0 && (
        <section aria-labelledby="up-h" className="flex flex-col gap-2">
          <h2 id="up-h" className="font-hand text-2xl font-normal tracking-normal">In this drop</h2>
          <ol className={cx("flex gap-2 overflow-x-auto pb-2 [scrollbar-width:thin]", wide && "lg:flex-wrap lg:overflow-visible")}>
            {upcoming.map((it) => (
              <li key={it.itemId} className={cx("flex w-28 shrink-0 flex-col gap-1 rounded-wobble border-2 border-ink bg-card p-1.5",
                it.state === "live" && "bg-lime", (it.state === "sold_out" || it.state === "closed") && "opacity-75")}>
                {it.photo
                  ? <img src={it.photo} alt="" loading="lazy" className="aspect-square w-full rounded-md border-2 border-ink object-cover" />
                  : <span className="grid aspect-square w-full place-items-center rounded-md border-2 border-ink bg-grey"><Icon name="bag" /></span>}
                <span className="truncate text-sm font-semibold"><span className="font-mono">#{it.position}</span> {it.title}</span>
                <span className="flex flex-col gap-0.5">
                  <Price paise={it.pricePaise} size="sm" className="text-sm" />
                  <ItemWord state={it.state} />
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );

  return (
    <div className={cx("flex flex-col", !preview && "min-h-dvh")}>
      {!preview && (
        <AppHeader
          title={<span className="flex min-w-0 flex-1 items-center gap-2">
            {state.shop.logoUrl
              ? <img src={state.shop.logoUrl} alt="" className="size-9 shrink-0 rounded-blob border-2 border-ink object-cover" />
              : <Avatar name={state.shop.name} size={34} />}
            <span className="truncate">{state.shop.name}</span>
          </span>}
          live={state.status === "live"}
          right={<Link href="/me" aria-label="My stuff" className="inline-flex min-h-12 min-w-12 items-center justify-center gap-1 rounded-md px-1 font-semibold underline decoration-2 sm:px-2">
            <Icon name="bag" size={20} /><span className="hidden sm:inline">My stuff</span>
          </Link>}
        />
      )}
      {preview && (
        <div className="flex items-center gap-2 px-3 pb-2">
          <Avatar name={state.shop.name} size={30} />
          <span className="min-w-0 flex-1 truncate font-extrabold">{state.shop.name}</span>
          {state.status === "live" ? <StatePill state="live" size="sm" /> : <StatePill state={state.status === "ended" ? "ended" : "waiting"} size="sm" />}
        </div>
      )}
      {sandbox && <Banner />}
      {offline && <ConnectionBar status="offline" />}
      {!preview && state.viewers != null && (
        <p className="mx-auto flex w-full max-w-xl items-center gap-1.5 px-4 pt-2 text-sm text-muted lg:max-w-[1100px]" data-testid="room-viewers">
          <Icon name="users" size={16} /><span className="font-mono">{state.viewers}</span> watching
        </p>
      )}
      {/* the one announcement region: my own result, a promotion, or why Dibs! can't claim right now */}
      <p className="sr-only" aria-live="polite" role="status">{announce}</p>

      <main id={preview ? undefined : "main"} className={cx("mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 pb-10", preview ? "px-3" : "px-4 pt-4",
        wide && "lg:grid lg:max-w-[1100px] lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-8")}>
        {left}
        {right}
        {/* room for the fixed action bar, so the end of the page can scroll clear of it */}
        {showBar && !preview && <div aria-hidden="true" className={cx("shrink-0 lg:hidden", payHold ? "h-[17rem]" : "h-[13rem]")} />}
      </main>

      {!preview && state && (
        <JoinSheet open={joinOpen} onClose={() => setJoinOpen(false)} shopSlug={state.shop.slug} shopName={state.shop.name}
          onJoined={(name) => { setBuyer(name); setJoinOpen(false); toast(`You're in, ${name}!`, { tone: "good" }); setTimeout(focusDibs, 50); }} />
      )}
      <BottomSheet open={!!release} onClose={() => setRelease(null)} title="Release this piece?">
        {release && (
          <div className="flex flex-col gap-4">
            <p>#{release.position} {release.title} · {release.variantLabel} goes to the next buyer in line. You can&apos;t undo this.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" onClick={() => void doRelease()}>Release it</Button>
              <Button variant="ghost" onClick={() => setRelease(null)}>Keep it</Button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

function ItemWord({ state }: { state: DropState["items"][number]["state"] }) {
  const w = { queued: ["clock", "Next"], live: ["live", "Live"], sold_out: ["bag", "Sold"], closed: ["lock", "Closed"] } as const;
  const [icon, word] = w[state];
  return <span className="inline-flex items-center gap-1 text-sm font-semibold"><Icon name={icon} size={14} />{word}</span>;
}

/** "It's yours! Pay within 01:20 · Open order", for a hold that is not the piece on screen. Persistent until paid. */
function PayRow({ hold, promoted, big }: { hold: MyStatus["holds"][number]; promoted: boolean; big?: boolean }) {
  const paying = hold.state === "payment_claimed";
  return (
    <div className={cx("flex items-center gap-2 rounded-wobble border-2 border-ink bg-lime px-2.5 py-1.5", big && "py-3 shadow-ink-sm")} data-testid="pay-row">
      <Icon name={paying ? "clock" : "sparkle"} size={20} className="shrink-0" />
      <p className="min-w-0 flex-1 text-[0.95rem] font-extrabold leading-tight">
        {paying ? <>Payment sent for #{hold.position}. Waiting for the shop.</>
          : <>{promoted ? "It's yours! " : "Yours: "}#{hold.position} {hold.title}. Pay within{" "}
            {hold.expiresAt ? <Countdown expiresAt={hold.expiresAt} size="sm" /> : mmss(0)}</>}
      </p>
      <LinkButton href={`/o/${hold.orderId}`} size="sm" className="shrink-0">Open order</LinkButton>
    </div>
  );
}

/** "Sold to Priya S. · 0.4 s" lines, newest first. Not a live region: bot sales are not read out (my own result is). */
function RoomTicker({ recent }: { recent: DropState["recent"] }) {
  return (
    <div className="h-[11.5rem] overflow-hidden [mask-image:linear-gradient(to_bottom,black_82%,transparent)]">
      <ol aria-live="off" aria-label="Sold and back in play" className="flex flex-col gap-1.5">
        {recent.slice(0, 3).map((c) => {
          const sold = c.t === "DB:Sold";
          return (
            <li key={tickerKey(c)} className={cx("pop-in flex min-h-10 items-center gap-2 rounded-wobble border-2 border-ink px-3 py-1.5 font-hand text-lg leading-tight", sold ? "bg-card" : "bg-yellow")}>
              <span className={cx("grid size-6 shrink-0 place-items-center rounded-full border-2 border-ink", sold ? "bg-pink" : "bg-lime")}>
                <Icon name={sold ? "bag" : "arrowRight"} size={14} stroke={2.6} />
              </span>
              <span className="min-w-0 flex-1">
                {c.t === "DB:Sold"
                  ? <>Sold to {displayName(c.buyer)} · <span className="whitespace-nowrap">{tapTime(c.ms)}</span>{c.variantLabel && <span className="text-muted"> · {c.variantLabel}</span>}</>
                  : c.buyer ? <>Back in play → {displayName(c.buyer)} from the waitlist</>
                  : <>Back in play → the {c.variantLabel} is free again</>}
              </span>
              {c.isBot && <span className="shrink-0 rounded-pill border-2 border-violet-ink bg-violet px-1.5 font-sans text-sm font-semibold text-violet-ink">🤖 Demo buyer</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StatusLine({ id, tone, icon, text }: { id: string; tone: "lime" | "yellow" | "peach" | "plain"; icon: IconName; text: React.ReactNode }) {
  const bg = { lime: "bg-lime border-ink", yellow: "bg-yellow border-ink", peach: "bg-peach border-ink", plain: "border-transparent" }[tone];
  return (
    <p id={id} className={cx("flex min-h-[3.4rem] items-center gap-2 rounded-wobble border-2 px-2.5 py-1 text-[0.95rem] font-semibold leading-snug", bg)}>
      <Icon name={icon} size={20} className="shrink-0" />
      <span className="line-clamp-2 min-w-0">{text}</span>
    </p>
  );
}

/** The win (or promotion) moment inside the piece card: celebration, tap time and the way to the order chat. */
function ResultPanel({ wonHere, result, latencyRef, opening, openingSlow, onStay, promoText }: {
  promoText: string | null;
  wonHere: { orderId: string; expiresAt: string | null; state: MyStatus["holds"][number]["state"] } | null | undefined;
  result: Result | null;
  latencyRef: React.RefObject<HTMLSpanElement | null>; opening: boolean; openingSlow: boolean; onStay: () => void;
}) {
  if (!wonHere) return <span ref={latencyRef} className="sr-only" />;
  const fresh = result?.result === "won" || !!promoText;
  return (
    <div className={cx("relative flex flex-col gap-2 overflow-hidden rounded-wobble border-[2.5px] border-ink bg-lime px-3 py-3 shadow-ink-sm", fresh && "pop-in")}>
      {fresh && <Burst className="absolute -right-12 -top-14 size-28" />}
      <p className="flex flex-wrap items-center gap-2 text-xl font-extrabold leading-tight">
        <Icon name={promoText ? "sparkle" : "check"} size={24} stroke={3} />
        {wonHere.state === "held" ? (promoText ?? "You got it!") : wonHere.state === "payment_claimed" ? "Payment sent" : "Paid · it's yours"}
      </p>
      {result?.result === "won" && result.ms != null && (
        <p className="text-sm text-ink/80">You tapped {tapTime(result.ms)} after it dropped · <span ref={latencyRef} /></p>
      )}
      <div className="flex flex-wrap gap-2">
        <LinkButton href={`/o/${wonHere.orderId}`} icon={wonHere.state === "held" ? "rupee" : "chat"} variant="ghost">
          {wonHere.state === "held" ? "Open order chat to pay" : "Open order chat"}
        </LinkButton>
        {opening && <Button variant="ghost" size="sm" onClick={onStay}>Stay here</Button>}
      </div>
      {opening && <p className="font-hand text-lg leading-tight">{openingSlow ? "Still connecting… tap Open order chat to go now." : "Opening your order chat…"}</p>}
    </div>
  );
}

function EndCard() {
  return (
    <Box tint="lime" className="flex flex-col gap-3 overflow-hidden">
      <Burst className="absolute -right-4 -top-8 size-24" />
      <h1 className="text-4xl">That&apos;s Dibs</h1>
      <p className="leading-snug">A fair first tap, a waitlist that moves by itself, and an order chat for every winner. All on Nexconn channels.</p>
      <div className="flex flex-wrap gap-2">
        <LinkButton href="/try?role=seller" icon="users">Be the seller</LinkButton>
        <LinkButton href="/how-it-works" variant="ghost">How it works</LinkButton>
        <LinkButton href="/impact" variant="ghost">Impact</LinkButton>
      </div>
    </Box>
  );
}

function RoomSkeleton({ preview, onRetry }: { preview?: boolean; onRetry: () => void }) {
  const slow = useSlow(6000);
  return (
    <div className={cx("mx-auto flex w-full max-w-xl flex-col gap-4", preview ? "px-3" : "px-4 pt-20")} aria-busy="true" aria-label="Loading the sale room">
      {slow && <StillConnecting onRetry={onRetry} />}
      <Skeleton className="aspect-[4/5] w-full rounded-wobble" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-14 w-full rounded-wobble-2" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function RoomMissing({ preview }: { preview?: boolean }) {
  return (
    <div className={cx("mx-auto w-full max-w-xl", preview ? "px-3" : "px-4 pt-16")}>
      <h1 className="sr-only">This sale room doesn&apos;t exist</h1>
      <EmptyState icon="bag" title="This sale room doesn't exist"
        body="The link may be mistyped, or the seller removed this drop. Ask the seller for a fresh link."
        action={preview ? undefined : <LinkButton href="/" variant="ghost">Go home</LinkButton>} />
    </div>
  );
}
