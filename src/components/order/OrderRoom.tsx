"use client";
/* eslint-disable @next/next/no-img-element -- product photos are SVG drawings or pre-compressed Storage images */
// The order room: one won piece, how to pay for it, its status, and a chat with the seller's team (Nexconn group).
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { getLive, type Live, type LiveMsg, type LiveStatus } from "@/lib/client/live";
import { useIsPhone, useTryTick } from "@/lib/client/hooks";
import { BOT_ID, rupees, type Card } from "@/lib/codec";
import type { Desk, OrderView, PublicConfig } from "@/lib/types";
import {
  AppHeader, Banner, BottomSheet, Button, Card as Box, ConnectionBar, Countdown, EmptyState, Field, Icon, Input, LinkButton,
  Price, QR, Select, Skeleton, Stamp, StatePill, Textarea, Timeline, cx, useToast,
} from "@/components/ui";
import { Chat, type ChatLine } from "@/components/chat/Chat";

type StatusCard = Extract<Card, { t: "DB:Status" }>;
type StaffAction = "received" | "not_received" | "ship" | "cancel" | "assign";

const ENDED: Record<string, { word: string; why: (v: OrderView, note: string | null) => string }> = {
  hold_expired: { word: "Expired", why: (v) => `Your hold on #${v.item.position} ran out. It went to the next buyer.` },
  hold_released: { word: "Released", why: () => "This hold was released, so the piece went to the next buyer in line." },
  hold_cancelled: { word: "Cancelled", why: (_, n) => `The shop cancelled this hold${n ? `: ${n}` : "."}` },
};

export function OrderRoom({ orderId, viewer, embedded }: { orderId: string; viewer: "buyer" | "staff"; embedded?: boolean }) {
  const toast = useToast();
  const phone = useIsPhone();
  const [view, setView] = useState<OrderView | null>(null);
  const [problem, setProblem] = useState<"missing" | "auth" | "error" | null>(null);
  const [cfg, setCfg] = useState<PublicConfig | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [receipts, setReceipts] = useState<Record<string, number>>({});
  const [lastStatus, setLastStatus] = useState<StatusCard | null>(null);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [utr, setUtr] = useState("");
  const [utrErr, setUtrErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const [action, setAction] = useState<StaffAction | null>(null);
  const liveRef = useRef<Live | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api("GET /api/orders/:id", undefined, { id: orderId }));
      setProblem(null);
    } catch (e) {
      const s = e instanceof ApiError ? e.status : 0;
      if (s === 0) return; // offline: keep what we show, the next poll tries again
      setProblem(s === 404 || s === 403 || s === 400 ? "missing" : s === 401 ? "auth" : "error");
    }
  }, [orderId]);
  const reload = useCallback((ms = 250) => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    loadTimer.current = setTimeout(() => { void load(); }, ms);
  }, [load]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch: state is set after the response arrives
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { api("GET /api/config").then(setCfg, () => {}); }, []);

  // heartbeat every 10 s: runs the expiry sweep for this drop and tells us when the timer or state moved
  const vState = view?.state, vExp = view?.expiresAt;
  useEffect(() => {
    if (!vState) return;
    const t = setInterval(() => {
      if (!navigator.onLine) return;
      api("POST /api/orders/:id/heartbeat", undefined, { id: orderId })
        .then((h) => { if (h.state !== vState || h.expiresAt !== vExp) reload(0); }, () => {});
    }, 10_000);
    return () => clearInterval(t);
  }, [orderId, vState, vExp, reload]);

  // the order group: history (cards + chat), live messages, read receipts
  const groupId = view?.nexconnGroupId;
  useEffect(() => {
    if (!groupId) return;
    let gone = false;
    const offs: (() => void)[] = [];
    const add = (live: Live, ms: LiveMsg[]) => {
      const text: ChatLine[] = [];
      const unread: string[] = [];
      for (const m of ms) {
        if (m.kind === "card" && m.card?.t === "DB:Status") setLastStatus(m.card);
        if (m.kind !== "text" || !m.text) continue;
        text.push({ id: m.id, from: m.from, fromName: m.fromName, at: m.at, text: m.text });
        if (m.from !== live.userId) unread.push(m.id);
      }
      if (text.length) setLines((xs) => {
        const seen = new Set(xs.map((x) => x.id));
        return [...xs, ...text.filter((x) => !seen.has(x.id))].sort((a, b) => a.at - b.at).slice(-200);
      });
      if (unread.length && document.visibilityState === "visible") live.markRead(groupId, unread);
    };
    getLive(viewer).then((live) => {
      if (gone) return;
      liveRef.current = live;
      setMeId(live.userId);
      offs.push(live.onStatus(setStatus));
      offs.push(live.watchGroup(groupId, (m) => {
        add(live, [m]);
        if (m.kind === "card" && m.from === BOT_ID) reload();
      }));
      offs.push(live.onReceipts((rs) => setReceipts((cur) => {
        const next = { ...cur };
        for (const r of rs) if (r.read > 0 && !next[r.id]) next[r.id] = Date.now();
        return next;
      })));
      offs.push(live.onAlert((c) => { if (c.t === "DB:Alert" && c.orderId === orderId) reload(0); }));
      live.history(groupId).then((h) => { if (!gone) add(live, h); }, () => {});
    }, () => setStatus("offline"));
    return () => { gone = true; offs.forEach((f) => f()); liveRef.current = null; };
  }, [groupId, viewer, orderId, reload]);

  // while the live connection is down, poll the order every 3 s
  const connected = status === "connected";
  useEffect(() => {
    if (connected || !view) return;
    const t = setInterval(() => { if (navigator.onLine) void load(); }, 3000);
    return () => clearInterval(t);
  }, [connected, view, load]);

  useTryTick(view?.drop.isSandbox ? view.drop.id : null);

  // ------------------------------------------------------------ actions
  async function run(key: string, f: () => Promise<unknown>, done?: string) {
    setBusy(key);
    try { await f(); if (done) toast(done, { tone: "good" }); await load(); return true; }
    catch (e) { toast(e instanceof ApiError ? e.message : "That didn't work. Try again.", { tone: "warn" }); return false; }
    finally { setBusy(null); }
  }

  async function paid() {
    const u = utr.replace(/\s/g, "");
    if (u && !/^[A-Za-z0-9]{6,22}$/.test(u)) { setUtrErr("A UTR is 12 digits (6–22 letters or digits). Or leave it empty."); return; }
    setUtrErr(null);
    await run("paid", () => api("POST /api/orders/:id/paid-claim", { utr: u || undefined }, { id: orderId }), "Thanks! The shop will confirm your payment.");
  }

  async function sendChat(text: string) {
    const lv = liveRef.current;
    if (!lv || !groupId) throw new Error("Reconnecting… try again in a moment.");
    try {
      const m = await lv.sendText({ type: "group", id: groupId }, text);
      setLines((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, { id: m.id, from: m.from, fromName: m.fromName, at: m.at, text }]));
    } catch {
      throw new Error("Couldn't send. Try again.");
    }
  }

  // ------------------------------------------------------------ render
  const chrome = { embedded, viewer, orderNo: view?.orderNo };

  if (problem === "missing" || problem === "auth") {
    return (
      <Chrome {...chrome}>
        <main id={embedded ? undefined : "main"} className="mx-auto w-full max-w-xl px-4 pt-12">
          {problem === "missing"
            ? <EmptyState icon="bag" title="We can't find this order" body="It may belong to another account, or the link is mistyped. Your orders are listed under My stuff." action={<LinkButton href="/me" variant="ghost">My stuff</LinkButton>} />
            : <EmptyState icon="lock" title="Open this order on the phone you claimed it with" body="Orders are private to the buyer and the shop's team." action={<LinkButton href="/me" variant="ghost">My stuff</LinkButton>} />}
        </main>
      </Chrome>
    );
  }
  if (!view) {
    return (
      <Chrome {...chrome}>
        <OrderSkeleton />
        {problem === "error" && <p role="alert" className="px-4 text-center font-semibold text-pink-ink">Couldn&apos;t load the order. Retrying…</p>}
      </Chrome>
    );
  }

  const v = view;
  const ended = [...v.history].reverse().find((e) => e.type in ENDED);
  const notReceived = v.state === "held" && v.history.at(-1)?.type === "payment_not_received";
  const notReceivedNote = notReceived ? v.history.at(-1)?.note : null;
  const confirmedBy = lastStatus && (lastStatus.state === "paid" || lastStatus.state === "shipped") ? lastStatus.by : null;
  const payLine = v.payment.upiId
    ? `Pay ${rupees(v.payment.amountPaise)} to ${v.payment.payee} (${v.payment.upiId}). Pay only here, never to a number in chat.`
    : `The shop hasn't added a UPI ID yet. Ask the team here; pay only through details on this card.`;
  const wa = v.shop.supportWhatsapp?.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  const roomHref = `/s/${v.shop.slug}/d/${v.drop.code}`;
  const sandbox = v.drop.isSandbox;

  return (
    <Chrome {...chrome}>
      {sandbox && <Banner />}
      {status === "offline" && <ConnectionBar status="offline" />}
      <main id={embedded ? undefined : "main"} className={cx("mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 pb-10", embedded ? "px-1" : "px-4 pt-4")}>
        {sandbox && viewer === "buyer" && <OrderCoach v={v} roomHref={roomHref} />}

        {/* order card */}
        <Box as="article" className="flex gap-3 p-3" aria-label={`Order #${v.orderNo}`}>
          <div className="relative w-24 shrink-0 self-start">
            {v.item.photos[0]
              ? <img src={v.item.photos[0]} alt={v.item.title} className="aspect-[4/5] w-full rounded-wobble border-2 border-ink object-cover" />
              : <span className="grid aspect-[4/5] w-full place-items-center rounded-wobble border-2 border-ink bg-grey"><Icon name="bag" /></span>}
            {(v.state === "paid" || v.state === "shipped") && <Stamp word={v.state === "paid" ? "PAID" : "SHIPPED"} size="sm" className="absolute -bottom-2 -right-3" />}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="font-mono text-sm text-muted">Order #{v.orderNo} · {v.shop.name}</p>
            <h1 className="text-xl leading-tight"><span className="font-mono text-muted">#{v.item.position}</span> {v.item.title}</h1>
            <p className="flex flex-wrap items-center gap-2"><span className="rounded-pill border-2 border-ink px-2 text-sm font-semibold">{v.variant.label}</span><Price paise={v.amountPaise} /></p>
            <div className="flex flex-wrap items-center gap-2">
              {v.state === "cancelled"
                ? <StatePill state={ended?.type === "hold_expired" ? "expired" : ended?.type === "hold_released" ? "released" : "cancelled"} size="sm" />
                : <StatePill state={v.state} size="sm" />}
              {v.state === "held" && v.expiresAt && <Countdown expiresAt={v.expiresAt} label="Pay within" size="sm" onDone={() => reload(800)} />}
              {v.state === "payment_claimed" && (
                <span className="inline-flex items-center gap-1 rounded-pill border-2 border-ink bg-grey px-2 py-1 text-sm font-semibold"><Icon name="pause" size={14} />Timer paused</span>
              )}
            </div>
          </div>
        </Box>

        {/* why it ended / what happened */}
        {v.state === "cancelled" && (
          <Box tint="grey" flat className="flex items-start gap-2" role="status">
            <Icon name="cross" size={22} className="mt-0.5" />
            <div>
              <p className="font-extrabold">{ended ? ENDED[ended.type].word : "Cancelled"}</p>
              <p>{ended ? ENDED[ended.type].why(v, ended.note) : "This hold has ended."}</p>
              {viewer === "buyer" && <Link href={roomHref} className="mt-1 inline-flex min-h-12 items-center font-semibold underline">Back to the sale room</Link>}
            </div>
          </Box>
        )}
        {notReceived && (
          <Box tint="peach" flat className="flex items-start gap-2" role="alert">
            <Icon name="warning" size={22} className="mt-0.5 text-peach-ink" />
            <div>
              <p className="font-extrabold">The shop hasn&apos;t received your payment yet</p>
              <p>{notReceivedNote ? `“${notReceivedNote}” · ` : ""}Your hold timer restarted with 5 minutes. Check your UPI app, then tap I&apos;ve paid again.</p>
            </div>
          </Box>
        )}
        {(v.state === "paid" || v.state === "shipped") && (
          <Box tint="mint" flat className="flex items-start gap-2" role="status">
            <Icon name={v.state === "paid" ? "check" : "truck"} size={24} className="mt-0.5 text-mint-ink" />
            <div>
              <p className="text-lg font-extrabold">{v.state === "paid" ? `Paid · confirmed by ${confirmedBy ?? v.assignedTo?.displayName ?? "the shop"}` : "Shipped"}</p>
              {v.state === "shipped" && <p>{v.trackingNote ? `Tracking: ${v.trackingNote}` : "On its way to you."}</p>}
              {v.state === "paid" && <p>It&apos;s yours. The shop will ship it and post updates here.</p>}
            </div>
          </Box>
        )}

        {/* payment card */}
        {(v.state === "held" || v.state === "payment_claimed") && (
          <Box tint="card" className="flex flex-col gap-3" aria-labelledby="pay-h">
            <h2 id="pay-h" className="flex items-center gap-2 text-xl"><Icon name="rupee" size={22} />Payment</h2>
            <p className="text-lg font-semibold leading-snug">{payLine}</p>
            {sandbox && <p className="flex items-center gap-2 rounded-wobble border-2 border-violet-ink bg-violet px-3 py-1.5 font-semibold text-violet-ink"><Icon name="robot" size={18} />Demo: tap I&apos;ve paid</p>}
            {v.payment.upiId && v.payment.upiLink && v.state === "held" && viewer === "buyer" && (
              phone ? (
                <a href={v.payment.upiLink} className={cx("relative inline-flex min-h-14 items-center justify-center gap-2 rounded-wobble-2 border-[2.5px] border-ink bg-lime px-5 text-xl font-extrabold shadow-ink no-underline active:translate-x-[3px] active:translate-y-[3px] active:shadow-none")}>
                  <Icon name="rupee" size={22} />Pay {rupees(v.payment.amountPaise)} with UPI
                </a>
              ) : (
                <div className="flex flex-wrap items-center gap-4">
                  <QR value={v.payment.upiLink} size={168} label={`UPI QR code: pay ${rupees(v.payment.amountPaise)} to ${v.payment.payee}`} />
                  <p className="max-w-[14rem] font-hand text-lg leading-snug">Scan with any UPI app on your phone, or copy the UPI ID below.</p>
                </div>
              )
            )}
            {v.payment.upiId && (
              <button type="button" onClick={() => { void navigator.clipboard?.writeText(v.payment.upiId!).then(() => toast("UPI ID copied", { tone: "good" }), () => {}); }}
                className="flex min-h-12 items-center gap-2 self-start rounded-wobble border-2 border-ink bg-paper px-3 font-mono font-semibold">
                <Icon name="copy" size={18} />{v.payment.upiId}<span className="sr-only">Copy UPI ID</span>
              </button>
            )}
            {viewer === "buyer" && v.state === "held" && (
              <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void paid(); }} noValidate>
                <Field label="UTR number (optional)" hint="The 12-digit reference in your UPI app" error={utrErr}>
                  <Input value={utr} onChange={(e) => setUtr(e.target.value)} inputMode="numeric" autoComplete="off" maxLength={26} placeholder="12 digits" />
                </Field>
                <Button type="submit" size="lg" icon="check" busy={busy === "paid"} busyLabel="Sending…">I&apos;ve paid</Button>
              </form>
            )}
            {v.state === "payment_claimed" && (
              <p role="status" className="flex items-center gap-2 rounded-wobble border-2 border-ink bg-sky px-3 py-2 font-semibold">
                <Icon name="clock" size={20} className="text-sky-ink" />
                {viewer === "buyer" ? "Payment sent. Your timer is paused while the shop checks it." : "Buyer says they paid. Check your bank app."}
                {v.utr ? ` UTR ${v.utr}` : ""}
              </p>
            )}
          </Box>
        )}

        {viewer === "staff" && (
          <StaffBar v={v} busy={busy} onAction={setAction} />
        )}

        <Box flat className="flex flex-col gap-2" aria-labelledby="tl-h">
          <h2 id="tl-h" className="font-hand text-2xl font-normal tracking-normal">Status</h2>
          <Timeline state={v.state} failed={notReceived} failedLabel={notReceived ? "Payment not received · timer restarted" : ended ? ENDED[ended.type].word : undefined} />
        </Box>

        <Chat title={viewer === "buyer" ? `Chat with ${v.shop.name}` : `Chat with ${v.buyer.displayName}`} lines={lines}
          meId={meId} onSend={sendChat} receipts={receipts}
          disabledReason={v.state === "cancelled" ? "This order has ended." : null}
          empty={viewer === "buyer" ? "Questions about the piece? Ask the team here." : "No messages yet."} maxHeight="max-h-96" />

        {viewer === "buyer" && (v.state === "held" || v.state === "payment_claimed") && (
          cfg?.features.calls ? (
            <Button variant="ghost" icon="video" disabledReason="Video calls are coming soon">See it on video</Button>
          ) : wa ? (
            <a href={`https://wa.me/91${wa}?text=${encodeURIComponent(`Hi! Can I see #${v.item.position} ${v.item.title} (order #${v.orderNo}) on video?`)}`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-wobble-2 border-[2.5px] border-ink bg-card px-5 text-lg font-extrabold shadow-ink-sm no-underline">
              <Icon name="video" size={20} />See it on video · WhatsApp +91 {wa}
            </a>
          ) : null
        )}

        {viewer === "buyer" && v.state === "held" && (
          <Button variant="ghost" onClick={() => setConfirmRelease(true)}>Release hold</Button>
        )}
        {viewer === "buyer" && !embedded && <Link href={roomHref} className="inline-flex min-h-12 items-center gap-1 self-center font-semibold underline"><Icon name="chevronLeft" size={18} />Back to the sale room</Link>}
      </main>

      <BottomSheet open={confirmRelease} onClose={() => setConfirmRelease(false)} title="Release this hold?">
        <div className="flex flex-col gap-4">
          <p>#{v.item.position} {v.item.title} · {v.variant.label} goes to the next buyer in line. You can&apos;t undo this.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" busy={busy === "release"} onClick={async () => {
              const ok = await run("release", () => api("POST /api/claims/:id/release", undefined, { id: v.claimId }), "Released. The next buyer gets it.");
              if (ok) setConfirmRelease(false);
            }}>Release it</Button>
            <Button variant="ghost" onClick={() => setConfirmRelease(false)}>Keep it</Button>
          </div>
        </div>
      </BottomSheet>
      {viewer === "staff" && (
        <StaffSheet v={v} action={action} onClose={() => setAction(null)} busy={busy}
          run={async (k, f, msg) => { const ok = await run(k, f, msg); if (ok) setAction(null); }} />
      )}
    </Chrome>
  );
}

function Chrome({ embedded, viewer, orderNo, children }: { embedded?: boolean; viewer: "buyer" | "staff"; orderNo?: number; children: React.ReactNode }) {
  if (embedded) return <>{children}</>;
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader title={orderNo ? `Order #${orderNo}` : "Order"}
        right={viewer === "buyer" ? <Link href="/me" className="inline-flex min-h-12 items-center gap-1 rounded-md px-2 font-semibold underline decoration-2"><Icon name="bag" size={18} />My stuff</Link> : undefined} />
      {children}
    </div>
  );
}

function OrderCoach({ v, roomHref }: { v: OrderView; roomHref: string }) {
  const line = v.state === "held" ? "Demo: tap I've paid. No real money moves."
    : v.state === "payment_claimed" ? "Demo staff confirms in 3 s…"
    : v.state === "paid" || v.state === "shipped" ? <>Paid! <Link href={roomHref} className="font-semibold underline">Back to the room for piece 2</Link></>
    : <>This hold ended. <Link href={roomHref} className="font-semibold underline">Back to the room</Link></>;
  return (
    <p role="status" aria-live="polite" className="flex items-center gap-2 rounded-wobble border-2 border-dashed border-violet-ink bg-violet px-3 py-2 font-hand text-lg leading-tight">
      <Icon name="sparkle" size={20} className="shrink-0 text-violet-ink" />
      <span><span className="sr-only">Demo guide: </span>{line}</span>
    </p>
  );
}

function StaffBar({ v, busy, onAction }: { v: OrderView; busy: string | null; onAction: (a: StaffAction) => void }) {
  const open = v.state === "held" || v.state === "payment_claimed";
  return (
    <Box tint="sky" flat className="flex flex-col gap-3" aria-label="Staff actions">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-extrabold">{v.buyer.displayName}</span>
        {v.buyer.phone && <a href={`tel:+91${v.buyer.phone}`} className="inline-flex min-h-12 items-center gap-1 font-mono underline">+91 {v.buyer.phone}</a>}
        <span className="text-sm text-muted">Assigned: {v.assignedTo?.displayName ?? "nobody"}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {open && <Button size="sm" icon="check" busy={busy === "received"} onClick={() => onAction("received")}>Payment received</Button>}
        {v.state === "payment_claimed" && <Button size="sm" variant="ghost" icon="cross" onClick={() => onAction("not_received")}>Not received</Button>}
        {v.state === "paid" && <Button size="sm" icon="truck" onClick={() => onAction("ship")}>Mark shipped</Button>}
        {open && <Button size="sm" variant="ghost" icon="trash" onClick={() => onAction("cancel")}>Cancel hold</Button>}
        {v.state !== "cancelled" && v.state !== "shipped" && <Button size="sm" variant="ghost" icon="users" onClick={() => onAction("assign")}>Reassign</Button>}
      </div>
    </Box>
  );
}

function StaffSheet({ v, action, onClose, busy, run }: {
  v: OrderView; action: StaffAction | null; onClose: () => void; busy: string | null;
  run: (key: string, f: () => Promise<unknown>, done: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [to, setTo] = useState("");
  const [team, setTeam] = useState<Desk["staff"] | null>(null);
  useEffect(() => {
    if (action === "assign" && !team) api("GET /api/desk", undefined, { state: "held" }).then((d) => setTeam(d.staff), () => setTeam([]));
  }, [action, team]);

  const id = v.orderId;
  const spec: Record<StaffAction, { title: string; field?: string; hint?: string; required?: boolean; go: string; f: () => Promise<unknown>; done: string }> = {
    received: { title: "Payment received?", field: "Note (optional)", go: "Yes, mark paid", f: () => api("POST /api/orders/:id/confirm", { received: true, note: text.trim() || undefined }, { id }), done: "Marked paid" },
    not_received: { title: "Payment not received", field: "Tell the buyer why", hint: "They get 5 more minutes.", go: "Send back to buyer", f: () => api("POST /api/orders/:id/confirm", { received: false, note: text.trim() || undefined }, { id }), done: "Buyer told: not received" },
    ship: { title: "Mark shipped", field: "Tracking note (optional)", hint: "e.g. DTDC 7712 3456", go: "Mark shipped", f: () => api("POST /api/orders/:id/ship", { trackingNote: text.trim() || undefined }, { id }), done: "Marked shipped" },
    cancel: { title: "Cancel this hold", field: "Reason (the buyer sees it)", required: true, go: "Cancel hold", f: () => api("POST /api/orders/:id/cancel", { reason: text.trim() }, { id }), done: "Hold cancelled; next buyer promoted" },
    assign: { title: "Reassign order", go: "Reassign", f: () => api("POST /api/orders/:id/assign", { staffId: to }, { id }), done: "Reassigned" },
  };
  const s = action ? spec[action] : null;
  const blocked = !s || (s.required && !text.trim()) || (action === "assign" && !to);
  return (
    <BottomSheet open={!!action} onClose={() => { setText(""); onClose(); }} title={s?.title ?? ""}>
      {s && action && (
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (!blocked) void run(action, s.f, s.done).then(() => setText("")); }}>
          {s.field && (
            <Field label={s.field} hint={s.hint}>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={200} rows={2} />
            </Field>
          )}
          {action === "assign" && (
            <Field label="Team member">
              <Select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">{team ? "Pick someone" : "Loading the team…"}</option>
                {team?.map((m) => <option key={m.staffId} value={m.staffId}>{m.displayName}{m.role === "owner" ? " (owner)" : ""}</option>)}
              </Select>
            </Field>
          )}
          <Button type="submit" disabled={blocked} busy={busy === action} variant={action === "cancel" ? "danger" : "primary"}>{s.go}</Button>
        </form>
      )}
    </BottomSheet>
  );
}

function OrderSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pt-4" aria-busy="true" aria-label="Loading your order">
      <Skeleton className="h-36 w-full rounded-wobble" />
      <Skeleton className="h-48 w-full rounded-wobble" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
