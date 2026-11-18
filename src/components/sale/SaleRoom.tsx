"use client";
/* eslint-disable @next/next/no-img-element -- product thumbnails are SVG drawings or pre-compressed Storage images */
// The sale room: one live piece, one Dibs! button, the room's ticker and chat. The server decides every claim;
// this screen shows the POST /api/claims answer at once and follows the room through dibs_bot cards.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { getLive, type Live, type LiveMsg, type LiveStatus } from "@/lib/client/live";
import { applyCard, mergeState, tickerKey } from "@/lib/client/sale";
import { useNow, useOnline, useTryTick } from "@/lib/client/hooks";
import { tapTime, type Card } from "@/lib/codec";
import type { ClaimResult, DropState, MyStatus } from "@/lib/types";
import {
  AppHeader, Avatar, Banner, BottomSheet, Burst, Button, Card as Box, Chip, ConnectionBar, Countdown, EmptyState, Icon,
  LinkButton, PhotoCarousel, Price, Skeleton, Stamp, StatePill, Ticker, cx, mmss, useToast,
} from "@/components/ui";
import { Chat, type ChatLine } from "@/components/chat/Chat";
import { JoinSheet } from "./JoinSheet";

type Prompt = Extract<Card, { t: "DB:Prompt" }>;
type Result = (ClaimResult | { result: "error"; message: string; position: null; orderId: null; expiresAt: null; ms: null; claimId: null })
  & { itemId: string; variantKey: string; tapAt: number; at: number };
type Me = MyStatus & { startedAt: number; muted: boolean };

declare global {
  interface Window { __dibs?: { lastTapMs: number | null; lastResult: string | null; taps: { ms: number; result: string; serverMs: number | null }[] } }
}

const dibsDebug = () => (window.__dibs ??= { lastTapMs: null, lastResult: null, taps: [] });

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
  const [autoOpen, setAutoOpen] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [liveTry, setLiveTry] = useState(0);
  const [meId, setMeId] = useState<string | null>(null);

  const liveRef = useRef<Live | null>(null);
  const dibsRef = useRef<HTMLDivElement>(null);
  const focusDibs = () => dibsRef.current?.querySelector("button")?.focus({ preventScroll: true });
  const latencyRef = useRef<HTMLSpanElement>(null);
  const meTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const joined = !!buyer;

  // ------------------------------------------------------------ data
  const loadState = useCallback(async () => {
    try {
      const s = await api("GET /api/drops/:id/state", undefined, { id: dropId });
      setState((cur) => mergeState(cur, s));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 400)) setMissing(true);
    }
  }, [dropId]);

  const loadMe = useCallback(async () => {
    const startedAt = performance.now();
    try {
      const m = await api("GET /api/drops/:id/me", undefined, { id: dropId });
      const muted = !!m.mutedUntil && (m.mutedUntil === "infinity" || Date.parse(m.mutedUntil) > Date.now());
      setMe((cur) => (cur && cur.startedAt > startedAt ? cur : { ...m, startedAt, muted }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setBuyer(null);
    }
  }, [dropId]);

  /** Debounced (300 ms) refetch of my holds and waitlist places, per the realtime spec. */
  const refreshMe = useCallback((ms = 300) => {
    if (meTimer.current) clearTimeout(meTimer.current);
    meTimer.current = setTimeout(() => { void loadMe(); }, ms);
  }, [loadMe]);
  const refreshState = useCallback(() => {
    if (stateTimer.current) clearTimeout(stateTimer.current);
    stateTimer.current = setTimeout(() => { void loadState(); }, 400);
  }, [loadState]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch: state is set after the response arrives
  useEffect(() => { if (!initial) void loadState(); }, [initial, loadState]);

  // who am I (a sandbox visitor already has a session from /try)
  useEffect(() => {
    if (preview) return;
    api("GET /api/buyer/me").then((r) => setBuyer(r.buyer?.displayName ?? null), () => setBuyer(null));
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
      if (m.kind === "card" && m.card) {
        const c = m.card;
        if (c.t === "DB:Hide") { setChat((xs) => xs.filter((x) => x.id !== c.messageId)); return; }
        setState((s) => (s ? applyCard(s, c) : s));
        if (c.t === "DB:Sold" || c.t === "DB:Back" || c.t === "DB:Stock") refreshMe();
        if (c.t === "DB:State" || c.t === "DB:Item") { refreshState(); refreshMe(); }
        return;
      }
      if (!m.text) return;
      const line: ChatLine = { id: m.id, from: m.from, fromName: m.fromName, at: m.at, text: m.text };
      setChat((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, line].slice(-150)));
    };
    const onAlert = (c: Card) => {
      if (preview) return;
      if (c.t === "DB:Prompt") { setPrompt(c); return; }
      if (c.t !== "DB:Alert") return;
      refreshMe(0);
      if (c.kind === "promoted") { setPromo({ orderId: c.orderId, text: c.text, at: performance.now() }); setAnnounce(c.text); if (c.orderId) setAutoOpen(c.orderId); }
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
  }, [canLive, channelId, preview, refreshMe, refreshState, toast, liveTry]);

  // HTTP fallback: every 2 s while the live connection is not up (and always for a visitor who hasn't joined)
  const connected = canLive && status === "connected";
  useEffect(() => {
    if (connected || missing) return;
    const t = setInterval(() => { if (!navigator.onLine) return; void loadState(); if (joined) void loadMe(); }, 2000);
    return () => clearInterval(t);
  }, [connected, missing, joined, loadState, loadMe]);
  // back from a drop: catch up once
  const wasConnected = useRef(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch: state is set after the response arrives
    if (connected && !wasConnected.current) { void loadState(); if (joined) void loadMe(); }
    wasConnected.current = connected;
  }, [connected, joined, loadState, loadMe]);

  useTryTick(state?.isSandbox && !preview ? dropId : null);

  // the winner's order chat opens by itself after a moment (they can stay)
  useEffect(() => {
    if (!autoOpen || preview) return;
    const t = setTimeout(() => router.push(`/o/${autoOpen}`), 3500);
    return () => clearTimeout(t);
  }, [autoOpen, preview, router]);

  // tap -> result on screen, measured after the result is in the DOM
  useLayoutEffect(() => {
    if (!result || result.result === "error") return;
    const ms = Math.round(performance.now() - result.tapAt);
    const d = dibsDebug();
    if (d.taps.some((t) => t.ms === ms && t.result === result.result)) return;
    d.lastTapMs = ms; d.lastResult = result.result;
    d.taps.push({ ms, result: result.result, serverMs: result.ms });
    if (latencyRef.current) latencyRef.current.textContent = `answer in ${ms} ms`;
  }, [result]);

  // ------------------------------------------------------------ derived
  const live = state?.live ?? null;
  const variants = live?.variants ?? [];
  const chosen = variants.length === 1 ? variants[0].key
    : pick && pick.itemId === live?.itemId && variants.some((v) => v.key === pick.key) ? pick.key : null;
  const chosenV = variants.find((v) => v.key === chosen);
  const settled = (r: Result) => !!me && me.startedAt > r.at; // my status fetched after this result: it is the truth
  const hold = live ? me?.holds.find((h) => h.itemId === live.itemId) : undefined;
  const wait = live ? me?.waits.find((w) => w.itemId === live.itemId) : undefined;
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
      if (r.result === "won" && r.orderId) setAutoOpen(r.orderId);
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
      if (autoOpen === release.orderId) setAutoOpen(null);
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

  // ------------------------------------------------------------ render
  if (missing) return <RoomMissing preview={preview} />;
  if (!state) return <RoomSkeleton preview={preview} />;

  const sandbox = state.isSandbox;
  const sold = live?.state === "sold_out";
  const chatLocked = !joined ? "Join the room to chat." : me?.banned ? "You can't chat in this sale room." : me?.muted ? "You're muted for a few minutes" : null;
  const upcoming = [...state.items].sort((a, b) => a.position - b.position);
  const startsIn = Math.max(0, Date.parse(state.startsAt) - now);

  return (
    <div className={cx("flex flex-col", !preview && "min-h-dvh")}>
      {!preview && (
        <AppHeader
          title={<span className="flex min-w-0 items-center gap-2">
            {state.shop.logoUrl
              ? <img src={state.shop.logoUrl} alt="" className="size-9 shrink-0 rounded-blob border-2 border-ink object-cover" />
              : <Avatar name={state.shop.name} size={34} />}
            <span className="truncate">{state.shop.name}</span>
          </span>}
          live={state.status === "live"}
          right={<Link href="/me" className="inline-flex min-h-12 items-center gap-1 rounded-md px-2 font-semibold underline decoration-2"><Icon name="bag" size={18} />My stuff</Link>}
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
      <p className="sr-only" aria-live="polite" role="status">{announce}</p>

      <main id={preview ? undefined : "main"} className={cx("mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 pb-10", preview ? "px-3" : "px-4 pt-4")}>
        {sandbox && !preview && <Coach state={state} me={me} promoted={promoHere} waitPos={waitPos} wonHere={!!wonHere} startsIn={startsIn} />}

        {!preview && buyer === null && (
          <Box tint="yellow" flat className="flex flex-col gap-2">
            <p className="font-extrabold">Join to call dibs</p>
            <p className="leading-snug">Add your name and number once. Then one tap claims a piece.</p>
            <Button icon="arrowRight" onClick={() => setJoinOpen(true)}>Join the room</Button>
          </Box>
        )}

        {promoLive && !promoHere && promo && (
          <Box tint="lime" className="pop-in relative flex flex-col gap-2 overflow-hidden" role="alert">
            <Burst className="absolute -right-6 -top-8 size-28" />
            <p className="flex items-center gap-2 text-xl font-extrabold leading-tight"><Icon name="sparkle" size={24} />{promo.text}</p>
            {promoHold?.expiresAt && <p className="flex flex-wrap items-center gap-2">Time left <Countdown expiresAt={promoHold.expiresAt} /></p>}
            {promo.orderId && (
              <div className="flex flex-wrap gap-2">
                <LinkButton href={`/o/${promo.orderId}`} icon="rupee">Pay now</LinkButton>
                {autoOpen === promo.orderId && <Button variant="ghost" onClick={() => setAutoOpen(null)}>Stay here</Button>}
              </div>
            )}
            {autoOpen === promo.orderId && <p className="font-hand text-lg">Opening your order chat…</p>}
          </Box>
        )}

        {prompt && live && prompt.itemId === live.itemId && (
          <button type="button" onClick={() => applyPrompt(prompt)}
            className="pop-in flex min-h-14 items-center gap-3 rounded-wobble border-[2.5px] border-ink bg-sky px-4 py-2 text-left font-extrabold shadow-ink-sm">
            <Icon name="tap" size={26} />
            <span className="flex-1">{prompt.text}</span>
            <Icon name="arrowRight" size={20} />
          </button>
        )}

        {state.status === "scheduled" && (
          <Box tint="yellow" className="flex flex-col items-start gap-2">
            <StatePill state="waiting" label="Waiting room" />
            <h1 className="text-3xl">{state.title}</h1>
            <p className="flex flex-wrap items-center gap-2 text-lg">
              {startsIn > 0 ? <>Starts in <Countdown expiresAt={state.startsAt} urgentBelow={0} size="lg" /></> : <>Starting any moment now…</>}
            </p>
            <p className="font-hand text-lg leading-snug">Pieces drop one at a time. Pick your size, then tap <strong>Dibs!</strong> — first tap wins.</p>
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
            <p className="text-xl font-extrabold">Next piece coming up…</p>
            <p className="text-muted">Stay here. It drops for everyone at the same moment.</p>
          </Box>
        )}

        {live && state.status !== "ended" && (
          <Box as="article" className="flex flex-col gap-3 p-3" aria-label={`Piece ${live.position}: ${live.title}`}>
            <PhotoCarousel key={live.itemId} photos={photos} alt={live.title} onFirstLoad={() => setReadyFor(live.itemId)}>
              {sold && <Stamp word="SOLD" size="lg" className="absolute left-4 top-4" />}
              {live.state === "closed" && <span className="absolute left-3 top-3"><StatePill state="closed" /></span>}
              {wonHere && <Stamp word="YOURS" size="lg" tilt={8} className="absolute right-4 top-4" />}
            </PhotoCarousel>
            <div className="flex items-start justify-between gap-3">
              <h1 className="min-w-0 text-2xl leading-tight"><span className="font-mono text-muted">#{live.position}</span> {live.title}</h1>
              <Price paise={live.pricePaise} size="lg" className="shrink-0" />
            </div>
            {live.note && <p className="font-hand text-lg leading-snug">{live.note}</p>}
            {variants.length > 0 && (
              <div role="group" aria-label="Pick an option" className="flex flex-wrap gap-2">
                {variants.map((v) => (
                  <Chip key={v.key} label={v.label} left={v.left} waiting={v.waiting}
                    selected={chosen === v.key} disabled={preview}
                    onSelect={() => setPick({ itemId: live.itemId, key: v.key })} />
                ))}
              </div>
            )}
            {chosenV && chosenV.left === 0 && !wonHere && !waitPos && (
              <p className="flex items-center gap-1.5 font-semibold"><Icon name="queue" size={18} />Sold out · tap to join the waitlist{chosenV.waiting ? ` (${chosenV.waiting} waiting)` : ""}</p>
            )}
            <div ref={dibsRef}>
              <Button variant="dibs" icon="tap" busy={busy} disabledReason={block ?? undefined}
                onClick={() => void dibs()} aria-describedby="dibs-result">Dibs!</Button>
            </div>
            <div id="dibs-result">
              <ResultPanel wonHere={wonHere} waitPos={waitPos} result={freshResult} live={live} latencyRef={latencyRef}
                promoText={promoHere ? promo!.text.replace(/\s*Pay within.*$/, "") : null}
                autoOpen={autoOpen} onStay={() => setAutoOpen(null)} />
            </div>
          </Box>
        )}

        {joined && me && (me.holds.length > 0 || me.waits.length > 0) && (
          <section aria-labelledby="my-status" className="flex flex-col gap-2">
            <h2 id="my-status" className="font-hand text-2xl font-normal tracking-normal">My status</h2>
            {me.holds.map((h) => (
              <div key={h.claimId} className="flex flex-wrap items-center gap-2 rounded-wobble border-2 border-ink bg-card px-3 py-2 shadow-ink-sm">
                <StatePill state={h.state} size="sm" />
                <span className="min-w-0 flex-1 font-semibold">#{h.position} {h.title} · {h.variantLabel}</span>
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
                <StatePill state="waitlisted" size="sm" label={`#${w.waitPosition} in line`} />
                <span className="min-w-0 flex-1 font-semibold">#{w.position} {w.title} · {w.variantLabel}</span>
                <Button size="sm" variant="ghost" onClick={() => void leave(w.claimId)}>Leave</Button>
              </div>
            ))}
          </section>
        )}

        <section aria-labelledby="ticker-h" className="flex flex-col gap-2">
          <h2 id="ticker-h" className="font-hand text-2xl font-normal tracking-normal">Sold to…</h2>
          {/* fixed height: new lines never push the page around */}
          <div className="h-[9.5rem] overflow-hidden">
            {state.recent.length
              ? <Ticker lines={state.recent.map((c) => ({ id: tickerKey(c), card: c }))} max={3} />
              : <p className="grid h-full place-items-center text-center font-hand text-lg text-muted">Every win shows up here, for everyone, the moment it happens.</p>}
          </div>
        </section>

        <Chat title="Room chat" lines={chat} meId={meId}
          collapsible defaultOpen readOnly={preview} onSend={preview ? undefined : sendChat} disabledReason={chatLocked} note={chatNote}
          empty={canLive ? undefined : "Join the room to see the chat."} />

        {upcoming.length > 0 && (
          <section aria-labelledby="up-h" className="flex flex-col gap-2">
            <h2 id="up-h" className="font-hand text-2xl font-normal tracking-normal">In this drop</h2>
            <ol className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:thin]">
              {upcoming.map((it) => (
                <li key={it.itemId} className={cx("flex w-28 shrink-0 flex-col gap-1 rounded-wobble border-2 border-ink bg-card p-1.5",
                  it.state === "live" && "bg-lime", (it.state === "sold_out" || it.state === "closed") && "opacity-75")}>
                  {it.photo
                    ? <img src={it.photo} alt="" loading="lazy" className="aspect-square w-full rounded-md border-2 border-ink object-cover" />
                    : <span className="grid aspect-square w-full place-items-center rounded-md border-2 border-ink bg-grey"><Icon name="bag" /></span>}
                  <span className="truncate text-sm font-semibold"><span className="font-mono">#{it.position}</span> {it.title}</span>
                  <span className="flex items-center justify-between gap-1">
                    <Price paise={it.pricePaise} size="sm" className="text-sm" />
                    <ItemWord state={it.state} />
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}
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
  return <span className="inline-flex items-center gap-0.5 text-xs font-semibold"><Icon name={icon} size={12} />{word}</span>;
}

function ResultPanel({ wonHere, waitPos, result, live, latencyRef, autoOpen, onStay, promoText }: {
  promoText: string | null;
  wonHere: { orderId: string; expiresAt: string | null; state: MyStatus["holds"][number]["state"] } | null | undefined;
  waitPos: number | null; result: Result | null; live: NonNullable<DropState["live"]>;
  latencyRef: React.RefObject<HTMLSpanElement | null>; autoOpen: string | null; onStay: () => void;
}) {
  if (wonHere) {
    const fresh = result?.result === "won" || !!promoText;
    return (
      <div role="status" className={cx("relative flex flex-col gap-2 overflow-hidden rounded-wobble border-[2.5px] border-ink bg-lime px-3 py-3 shadow-ink-sm", fresh && "pop-in")}>
        {fresh && <Burst className="absolute -right-8 -top-12 size-28" />}
        {wonHere.state === "held" ? (
          <p className="flex flex-wrap items-center gap-2 text-xl font-extrabold leading-tight">
            <Icon name="check" size={24} stroke={3} />{promoText ? `${promoText} Pay within` : "You got it! Pay within"}
            {wonHere.expiresAt ? <Countdown expiresAt={wonHere.expiresAt} /> : <span className="font-mono">{mmss(0)}</span>}
          </p>
        ) : wonHere.state === "payment_claimed" ? (
          <p className="flex items-center gap-2 text-lg font-extrabold"><Icon name="rupee" size={22} />Payment sent · waiting for the shop to confirm</p>
        ) : (
          <p className="flex items-center gap-2 text-lg font-extrabold"><Icon name="check" size={22} />Paid · it&apos;s yours</p>
        )}
        {result?.result === "won" && result.ms != null && (
          <p className="text-sm text-ink/80">You tapped {tapTime(result.ms)} after it dropped · <span ref={latencyRef} /></p>
        )}
        <div className="flex flex-wrap gap-2">
          <LinkButton href={`/o/${wonHere.orderId}`} icon={wonHere.state === "held" ? "rupee" : "chat"} variant="ghost">
            {wonHere.state === "held" ? "Open order chat to pay" : "Open order chat"}
          </LinkButton>
          {autoOpen === wonHere.orderId && <Button variant="ghost" size="sm" onClick={onStay}>Stay here</Button>}
        </div>
        {autoOpen === wonHere.orderId && <p className="font-hand text-lg leading-tight">Opening your order chat…</p>}
      </div>
    );
  }
  if (waitPos) {
    return (
      <div role="status" className="pop-in flex items-start gap-2 rounded-wobble border-[2.5px] border-ink bg-yellow px-3 py-3">
        <Icon name="queue" size={24} className="mt-0.5 text-yellow-ink" />
        <div>
          <p className="text-lg font-extrabold leading-tight">You&apos;re #{waitPos} on the waitlist. We&apos;ll tell you the moment it&apos;s yours.</p>
          <span ref={latencyRef} className="text-sm text-muted" />
        </div>
      </div>
    );
  }
  if (result && result.result !== "won" && result.result !== "waitlisted" && result.itemId === live.itemId) {
    return (
      <div role="alert" className="pop-in flex items-start gap-2 rounded-wobble border-[2.5px] border-ink bg-peach px-3 py-3 font-semibold">
        <Icon name="warning" size={22} className="mt-0.5 text-peach-ink" />
        <p>{result.message}</p>
      </div>
    );
  }
  return null;
}

/** Judge-mode coach: one line for the beat that is happening now, read from real state (never a timer script). */
function Coach({ state, me, promoted, waitPos, wonHere, startsIn }: {
  state: DropState; me: Me | null; promoted: boolean; waitPos: number | null; wonHere: boolean; startsIn: number;
}) {
  const live = state.live;
  const piece1Paid = me?.holds.some((h) => h.position === 1 && (h.state === "paid" || h.state === "shipped"));
  let line: React.ReactNode = null;
  if (state.status === "ended") line = "That's Dibs. Thanks for trying it!";
  else if (state.status === "scheduled" || (state.status === "live" && !live && !me?.holds.length)) {
    const s = Math.ceil(startsIn / 1000);
    line = s > 0 ? <>Piece 1 drops in {s}… tap Dibs!</> : "Piece 1 is about to drop… get your thumb ready.";
  } else if (live && wonHere) {
    const h = me?.holds.find((x) => x.itemId === live.itemId);
    line = h?.state === "paid" || h?.state === "shipped" ? "Paid and confirmed. That's the whole loop!"
      : promoted ? "It's yours! The bot ahead didn't pay. Open the order chat and tap I've paid."
      : live.position === 1 ? "It's yours! Open the order chat and tap I've paid." : "Clean win! You beat the bots this time.";
  } else if (live && waitPos) {
    const moved = state.recent.some((c) => c.t === "DB:Back" && c.itemId === live.itemId);
    line = moved ? <>Bot holds run out after 20 s — watch the queue move. You&apos;re #{waitPos} now.</> : <>Bots tap fast. You&apos;re #{waitPos} on the waitlist.</>;
  } else if (live && live.position > 1 && piece1Paid) line = "Tap fast, this one is winnable.";
  else if (live) line = live.position === 1 ? "It's live! Tap Dibs! now — 🤖 bots are tapping too." : "Next piece is live. Tap Dibs!";
  else if (piece1Paid) line = "Piece 2 drops in a few seconds. Tap fast, this one is winnable.";
  else line = "Stay here: the next beat is on its way.";
  return (
    <p role="status" aria-live="polite" className="flex items-center gap-2 rounded-wobble border-2 border-dashed border-violet-ink bg-violet px-3 py-2 font-hand text-lg leading-tight">
      <Icon name="sparkle" size={20} className="shrink-0 text-violet-ink" />
      <span><span className="sr-only">Demo guide: </span>{line}</span>
    </p>
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

function RoomSkeleton({ preview }: { preview?: boolean }) {
  return (
    <div className={cx("mx-auto flex w-full max-w-xl flex-col gap-4", preview ? "px-3" : "px-4 pt-20")} aria-busy="true" aria-label="Loading the sale room">
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
      <EmptyState icon="bag" title="This sale room doesn't exist"
        body="The link may be mistyped, or the seller removed this drop. Ask the seller for a fresh link."
        action={preview ? undefined : <LinkButton href="/" variant="ghost">Go home</LinkButton>} />
    </div>
  );
}
