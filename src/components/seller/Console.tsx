"use client";
/* eslint-disable @next/next/no-img-element -- product thumbnails */
// /seller/drops/[id]: the live console. Data = heartbeat every 5 s (it runs the sweep) + a refetch
// at once (stale replies dropped) whenever the room carries DB:Sold / DB:Back / DB:Stock / DB:State / DB:Item.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OrderRoom } from "@/components/order/OrderRoom";
import { SaleRoom } from "@/components/sale/SaleRoom";
import {
  BottomSheet, Button, buttonClasses, Card, cx, EmptyState, Field, Icon, LinkButton, PhoneFrame, Select, Skeleton, StatePill, Textarea,
  useToast, type PillState,
} from "@/components/ui";
import { api } from "@/lib/client/api";
import { getLive, type LiveMsg, type LiveStatus } from "@/lib/client/live";
import { rupees } from "@/lib/codec";
import type { ConsoleLedgerEntry, Heartbeat, ItemState } from "@/lib/types";
import { DROP_PILL } from "./DropsPage";
import { clock, errMsg, ShareCard, since, useMe, useNow } from "./kit";
import { ACTIVE, Ledger } from "./Ledger";
import { RoomChat } from "./RoomChat";
import { ShareKit } from "./ShareKit";
import { DEMO_BUYERS, sellerCoach } from "./consoleLogic";

const REFETCH = new Set(["DB:Sold", "DB:Back", "DB:Stock", "DB:State", "DB:Item"]);
const ITEM_PILL: Record<ItemState, { state: PillState; label: string }> = {
  queued: { state: "waiting", label: "Queued" },
  live: { state: "live", label: "LIVE" },
  sold_out: { state: "sold_out", label: "Sold out" },
  closed: { state: "closed", label: "Closed" },
};
const REASONS = ["Buyer asked to cancel", "Buyer can't be reached", "Duplicate order", "Payment never arrived"];

export function Console({ dropId }: { dropId: string }) {
  const me = useMe();
  const toast = useToast();
  const now = useNow(1000);
  const [hb, setHb] = useState<Heartbeat | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [msgs, setMsgs] = useState<LiveMsg[]>([]);
  const [ownerIds, setOwnerIds] = useState<Set<string>>(new Set(me.role === "owner" ? [`s_${me.staffId}`] : []));
  const [scope, setScope] = useState<"piece" | "all">("piece");
  const [order, setOrder] = useState<ConsoleLedgerEntry | null>(null);
  const [cancel, setCancel] = useState<ConsoleLedgerEntry | null>(null);
  const [reason, setReason] = useState(REASONS[0]);
  const [other, setOther] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const live = useRef<Awaited<ReturnType<typeof getLive>> | null>(null);
  const hidden = useRef(new Set<string>());
  const sent = useRef(0), applied = useRef(0), lastAt = useRef(0);

  // Heartbeats may overlap (each takes a database round trip); a response is applied only if no newer one was,
  // so a slow reply never overwrites fresher state. A card asks for a fresh call at once unless one just started.
  const refresh = useCallback((): Promise<void> => {
    const n = ++sent.current;
    lastAt.current = Date.now();
    return api("POST /api/drops/:id/heartbeat", undefined, { id: dropId })
      .then((r) => { if (n > applied.current) { applied.current = n; setHb(r); setLoadErr(null); } }, (e) => setLoadErr(errMsg(e)));
  }, [dropId]);
  const onCard = useCallback(() => { if (Date.now() - lastAt.current > 150) void refresh(); }, [refresh]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    api("GET /api/shops/:id", undefined, { id: me.shop.id })
      .then((s) => setOwnerIds(new Set(s.staff.filter((m) => m.role === "owner").map((m) => `s_${m.staffId}`))), () => {});
  }, [me.shop.id]);

  // Join the sale room as staff: cards trigger a refetch, texts feed the chat, DB:Hide removes a blocked message.
  const channelId = hb?.state.channelId;
  useEffect(() => {
    if (!channelId) return;
    let off: (() => void) | undefined, offStatus: (() => void) | undefined, gone = false;
    getLive("staff").then(async (l) => {
      if (gone) return;
      live.current = l;
      offStatus = l.onStatus(setStatus);
      const leave = await l.joinRoom(channelId, (m) => {
        if (m.kind === "card" && m.card) {
          if (m.card.t === "DB:Hide") { const id = m.card.messageId; hidden.current.add(id); setMsgs((xs) => xs.filter((x) => x.id !== id)); }
          else if (REFETCH.has(m.card.t)) onCard();
          return;
        }
        if (hidden.current.has(m.id)) return; // its hide card arrived first
        setMsgs((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m].sort((a, b) => a.at - b.at).slice(-150)));
      });
      if (gone) leave(); else off = leave;
    }).catch(() => setStatus("offline"));
    return () => { gone = true; off?.(); offStatus?.(); };
  }, [channelId, onCard]);

  const act = async (key: string, call: () => Promise<unknown>, done?: string) => {
    setBusy(key); setActErr(null);
    try { await call(); if (done) toast(done, { tone: "good" }); await refresh(); return true; }
    catch (e) { setActErr(errMsg(e)); toast(errMsg(e), { tone: "warn" }); return false; }
    finally { setBusy(null); }
  };

  const view = useMemo(() => {
    if (!hb) return null;
    const { state, console: c } = hb;
    const liveItem = state.live && (state.live.state === "live" || state.live.state === "sold_out") ? state.live : null;
    const next = state.items.filter((i) => i.state === "queued").sort((a, b) => a.position - b.position)[0] ?? null;
    const pieceRows = liveItem ? c.ledger.filter((r) => r.itemId === liveItem.itemId) : [];
    const names = new Map<string, string>();
    for (const r of c.ledger) names.set(r.buyer, r.buyerId);
    for (const m of c.moderation) if (m.buyer && m.buyerId) names.set(m.buyer, m.buyerId);
    for (const b of c.bans) names.set(b.buyer, b.buyerId);
    const soldBy = new Map<string, number>();
    for (const r of c.ledger) if (ACTIVE.has(r.state)) soldBy.set(r.itemId, (soldBy.get(r.itemId) ?? 0) + 1);
    const leftBy = new Map(c.stock.map((s) => [s.itemId, s.variants.reduce((a, v) => a + v.left, 0)]));
    return { state, c, liveItem, next, pieceRows, names, soldBy, leftBy };
  }, [hb]);

  if (!view) {
    return loadErr
      ? <EmptyState icon="warning" title="Couldn't load the console." body={loadErr} action={<Button onClick={() => void refresh()}>Try again</Button>} />
      : <div className="flex flex-col gap-4"><Skeleton className="h-10 w-72" /><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  }
  const { state, c, liveItem, next, pieceRows, names, soldBy, leftBy } = view;
  const shareUrl = typeof location === "undefined" ? `/s/${state.shop.slug}/d/${state.code}` : `${location.origin}/s/${state.shop.slug}/d/${state.code}`;
  const ended = state.status === "ended";
  const holds = pieceRows.filter((r) => r.state === "held" || r.state === "payment_claimed").length;
  const ledgerRows = scope === "piece" && liveItem ? pieceRows : c.ledger;
  const id = { id: dropId };

  const controls = (
    <div className={cx(
      "fixed inset-x-0 bottom-0 z-30 border-t-[2.5px] border-ink bg-paper px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2",
      "lg:static lg:rounded-wobble lg:border-[2.5px] lg:bg-card lg:p-4 lg:shadow-ink",
    )} data-testid="controls">
      {state.status !== "ended" && (
        <p className="mb-2 flex min-w-0 items-center gap-2 text-[0.95rem] lg:text-base">
          {next ? (
            <>
              <span className="shrink-0 text-muted">Next up:</span>
              {next.photo ? <img src={next.photo} alt="" className="size-8 shrink-0 rounded-md border-2 border-ink object-cover lg:size-10" /> : <Icon name="bag" />}
              <span className="min-w-0 truncate font-semibold" data-testid="next-up">#{next.position} {next.title}</span>
              <span className="shrink-0 font-mono text-sm">{rupees(next.pricePaise)}</span>
            </>
          ) : <span className="text-muted">No pieces left in the queue.</span>}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-wrap">
        {state.status === "scheduled" && (
          <Button icon="live" className="col-span-2" busy={busy === "live"} busyLabel="Going live…"
            onClick={() => act("live", () => api("POST /api/drops/:id/live", undefined, id), "You're live. Buyers can chat now.")}>Go live</Button>
        )}
        {state.status === "live" && (
          <Button icon="arrowRight" className="col-span-2" busy={busy === "next"} busyLabel="Dropping…" disabledReason={next ? undefined : "Queue empty"}
            onClick={() => act("next", () => api("POST /api/drops/:id/next", undefined, id))}>Drop next</Button>
        )}
        {state.status === "live" && (
          <Button variant="ghost" icon="lock" busy={busy === "close"} busyLabel="Closing…" disabled={!liveItem}
            onClick={() => liveItem && act("close", () => api("POST /api/drops/:id/items/:itemId/close", undefined, { ...id, itemId: liveItem.itemId }), "Piece closed")}>Close item</Button>
        )}
        {!ended && (
          <Button variant="danger" icon="cross" onClick={() => setConfirmEnd(true)}>End drop</Button>
        )}
      </div>
      {actErr && <p role="alert" className="mt-2 flex items-start gap-1.5 font-semibold text-pink-ink"><Icon name="warning" size={18} className="mt-0.5" />{actErr}</p>}
    </div>
  );

  return (
    <div className="flex flex-col gap-4 pb-44 lg:pb-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="min-w-0 text-3xl">{state.title}</h1>
        <StatePill state={DROP_PILL[state.status].state} label={DROP_PILL[state.status].label} />
        {state.isSandbox && <StatePill state="demo" />}
        <span className="font-mono text-sm text-muted">code {state.code}</span>
        <span className="font-mono text-sm text-muted" data-testid="viewers">{hb!.viewers == null ? "viewers: not measured" : `${hb!.viewers} watching`}</span>
        {state.isSandbox && <span className="text-sm font-semibold text-violet-ink" data-testid="demo-buyers">🤖 {DEMO_BUYERS} demo buyers in the room</span>}
      </div>
      <LiveBar status={status} />
      {state.isSandbox && (
        <p className="flex items-center gap-2 rounded-wobble border-2 border-dashed border-violet-ink bg-violet px-3 py-2 font-hand text-lg leading-tight" data-testid="seller-coach">
          <Icon name="sparkle" size={20} className="shrink-0 text-violet-ink" />
          <span><span className="sr-only">Demo guide: </span>{sellerCoach(state, c)}</span>
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {controls}

          {ended && (
            <Card tint="mint" className="flex flex-col gap-2" data-testid="ended-summary">
              <h2 className="text-2xl">Drop ended</h2>
              <p>{c.ledger.filter((r) => ACTIVE.has(r.state)).length} pieces won · {c.ledger.filter((r) => r.state === "paid" || r.state === "shipped").length} paid · {c.ledger.filter((r) => r.state === "held" || r.state === "payment_claimed").length} holds still running until paid or expired.</p>
              <div className="flex flex-wrap gap-2">
                <LinkButton href={`/seller/dashboard?drop=${dropId}`} icon="sparkle">See the results</LinkButton>
                <a href={`/api/exports/orders.csv?dropId=${dropId}`} download className={buttonClasses("ghost")}><Icon name="arrowRight" size={20} className="rotate-90" />Download orders (CSV)</a>
              </div>
            </Card>
          )}

          {state.status === "scheduled" && (
            <Card tint="yellow" className="flex flex-col gap-1">
              <h2 className="text-xl">Waiting room is open</h2>
              <p>Buyers who open the link see a countdown to {clock(state.startsAt)} and can chat. Press <b>Go live</b> when you start, then <b>Drop next</b> for the first piece.</p>
            </Card>
          )}
          {state.status === "scheduled" && !state.isSandbox && (
            <details className="group rounded-wobble border-2 border-ink bg-card p-3" open>
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 text-xl font-extrabold">
                <Icon name="share" />Share kit and checklist<Icon name="chevronDown" className="ml-auto group-open:rotate-180" />
              </summary>
              <div className="mt-3"><ShareKit shopName={me.shop.name} title={state.title} startsAt={state.startsAt} url={shareUrl} /></div>
            </details>
          )}

          {liveItem ? (
            <Card className="flex flex-col gap-3" data-testid="current-piece">
              <div className="flex items-start gap-3">
                {liveItem.photos[0] ? <img src={liveItem.photos[0]} alt="" className="size-16 shrink-0 rounded-wobble border-2 border-ink object-cover" /> : null}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-muted">Now live · #{liveItem.position}</p>
                  <h2 className="truncate text-2xl">{liveItem.title}</h2>
                  <p className="font-mono">{rupees(liveItem.pricePaise)} · live for {now ? since(liveItem.liveAt, now) : "…"}</p>
                </div>
                <StatePill state={ITEM_PILL[liveItem.state].state} label={ITEM_PILL[liveItem.state].label} size="sm" />
              </div>
              <dl className="grid grid-cols-3 gap-2 text-center">
                <Stat label="Taps" value={pieceRows.length} testid="stat-taps" />
                <Stat label="Holds" value={holds} testid="stat-holds" />
                <Stat label="Waiting" value={liveItem.variants.reduce((a, v) => a + v.waiting, 0)} testid="stat-waiting" />
              </dl>
              <ul className="flex flex-wrap gap-2" aria-label="Stock per size">
                {liveItem.variants.map((v) => (
                  <li key={v.key} className={cx("rounded-wobble border-2 border-ink px-3 py-1.5", v.left ? "bg-card" : "bg-pink-soft")}>
                    <span className="font-semibold">{v.label}</span> · <span className="font-mono">{v.left} left</span>
                    {v.waiting > 0 && <> · <span className="font-mono">{v.waiting} waiting</span></>}
                  </li>
                ))}
              </ul>
            </Card>
          ) : state.status === "live" && (
            <Card tint="paper" className="text-center"><p className="font-semibold">Nothing is live right now.</p><p className="text-muted">{next ? "Press Drop next to put the next piece live." : "Every piece has dropped. End the drop when holds are paid."}</p></Card>
          )}

          <section className="flex flex-col gap-2" aria-labelledby="ledger-h">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="ledger-h" className="text-2xl">Claims</h2>
              {liveItem && (
                <div className="ml-auto flex gap-1" role="group" aria-label="Show claims for">
                  {(["piece", "all"] as const).map((s) => (
                    <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}
                      className={cx("min-h-12 rounded-wobble-2 border-2 border-ink px-3 font-semibold", scope === s ? "bg-lime" : "bg-card")}>
                      {s === "piece" ? "This piece" : "All pieces"}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {ledgerRows.length
              ? <Ledger rows={ledgerRows} showPiece={!(scope === "piece" && liveItem)} onOpen={setOrder} onCancel={(r) => { setReason(REASONS[0]); setOther(""); setCancel(r); }} />
              : <p className="rounded-wobble border-2 border-dashed border-ink/40 p-4 text-center text-muted">No taps yet. They show up here the moment buyers tap Dibs.</p>}
          </section>

          <section className="flex flex-col gap-2" aria-labelledby="run-h">
            <h2 id="run-h" className="text-2xl">Run list</h2>
            <ol className="flex flex-col gap-2" data-testid="run-list">
              {state.items.map((i) => {
                const left = leftBy.get(i.itemId) ?? 0;
                return (
                  <li key={i.itemId} className={cx("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-wobble border-2 border-ink px-3 py-2", i.state === "live" ? "bg-lime/40" : "bg-card")}>
                    <span className="w-8 font-mono font-bold">#{i.position}</span>
                    {i.photo ? <img src={i.photo} alt="" className="size-10 rounded-md border-2 border-ink object-cover" /> : null}
                    <span className="min-w-0 flex-1 basis-32 truncate font-semibold">{i.title}</span>
                    <span className="font-mono text-sm">{soldBy.get(i.itemId) ?? 0} won · {left} left</span>
                    <StatePill size="sm" state={ITEM_PILL[i.state].state} label={i.state === "closed" && left > 0 ? "Unsold" : ITEM_PILL[i.state].label} />
                    {i.state === "closed" && left > 0 && state.status === "live" && (
                      <Button size="sm" variant="ghost" icon="live" busy={busy === `reopen:${i.itemId}`} busyLabel="Reopening…"
                        onClick={() => act(`reopen:${i.itemId}`, () => api("POST /api/drops/:id/items/:itemId/reopen", undefined, { ...id, itemId: i.itemId }), "Piece is live again")}>Reopen</Button>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Buyer view and sharing">
          <PhoneFrame label="What buyers see right now" height={600}>
            <SaleRoom dropId={dropId} preview />
          </PhoneFrame>
          <ShareCard title={state.title} url={shareUrl} />
        </aside>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <RoomChat dropId={dropId} msgs={msgs} ownerIds={ownerIds} bans={c.bans} names={names} onChanged={() => void refresh()}
          disabled={ended ? "The drop has ended" : status === "offline" ? "Reconnecting…" : undefined}
          send={async (text) => {
            const l = live.current ?? await getLive("staff");
            const m = await l.sendText({ type: "room", id: state.channelId }, text);
            if (hidden.current.has(m.id)) return; // its hide card arrived first
        setMsgs((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m]));
          }} />
        <Card flat className="flex flex-col gap-3" data-testid="moderation">
          <h2 className="flex items-center gap-2 text-xl"><Icon name="shield" />Moderation</h2>
          {c.bans.length > 0 && (
            <ul className="flex flex-col gap-2" aria-label="Muted and banned">
              {c.bans.map((b) => (
                <li key={`${b.buyerId}:${b.kind}`} className="flex flex-wrap items-center gap-2 rounded-wobble border-2 border-ink bg-peach/60 px-3 py-1.5">
                  <span className="min-w-0 flex-1 basis-full truncate font-semibold sm:basis-auto">{b.buyer}</span>
                  <span className="text-[0.95rem]">{b.kind === "ban" ? "Banned" : `Muted until ${b.until ? clock(b.until) : "further notice"}`}</span>
                  <Button size="sm" variant="ghost" busy={busy === `unban:${b.buyerId}`} busyLabel="Lifting…"
                    onClick={() => act(`unban:${b.buyerId}`, () => api("POST /api/drops/:id/moderate", { buyerId: b.buyerId, action: "unban" }, id), `${b.buyer} can chat again`)}>Unban</Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[0.95rem] text-muted">The scam shield blocks phone numbers, UPI IDs and payment requests from buyers. Blocked messages are removed from the room within seconds; only the rule shows here, never the text.</p>
          {c.moderation.length ? (
            <ol className="flex max-h-80 flex-col gap-1.5 overflow-y-auto" aria-label="Moderation log">
              {c.moderation.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b-2 border-dashed border-ink/15 pb-1.5">
                  <span className="font-mono text-sm text-muted">{clock(m.at)}</span>
                  <span className="font-semibold">{m.buyer ?? "Someone"}</span>
                  <span className="text-[0.95rem]">{m.rule === "staff" ? "staff" : `rule: ${m.rule.replace(/_/g, " ")}`} → {m.action}</span>
                  {m.buyerId && m.rule !== "staff" && !c.bans.some((b) => b.buyerId === m.buyerId) && (
                    <Button size="sm" variant="ghost" icon="pause" className="ml-auto" busy={busy === `mute:${m.id}`} busyLabel="Muting…"
                      onClick={() => act(`mute:${m.id}`, () => api("POST /api/drops/:id/moderate", { buyerId: m.buyerId!, action: "mute", minutes: 10 }, id), `${m.buyer ?? "Buyer"} muted for 10 minutes`)}>Mute 10 min</Button>
                  )}
                </li>
              ))}
            </ol>
          ) : <p className="text-muted">Nothing blocked or moderated yet.</p>}
        </Card>
      </div>

      <BottomSheet open={!!order} onClose={() => setOrder(null)} title={order ? `Order #${order.orderNo ?? ""} · ${order.buyer}` : ""} className="sm:max-w-2xl">
        {order?.orderId && <div className="max-h-[78dvh] overflow-y-auto"><OrderRoom orderId={order.orderId} viewer="staff" embedded /></div>}
      </BottomSheet>

      <BottomSheet open={!!cancel} onClose={() => setCancel(null)} title={`Cancel ${cancel?.buyer ?? ""}'s hold?`}>
        {cancel && (
          <form className="flex flex-col gap-4" onSubmit={async (e) => {
            e.preventDefault();
            const why = reason === "Other" ? other.trim() : reason;
            if (!why) return;
            if (await act("cancel", () => api("POST /api/orders/:id/cancel", { reason: why }, { id: cancel.orderId! }), "Hold cancelled. The next buyer in line gets it.")) setCancel(null);
          }}>
            <p><b>{cancel.buyer}</b>{cancel.orderNo != null && <> · order #{cancel.orderNo}</>} · {cancel.title} · {cancel.variantLabel}. If someone is on the waitlist, they get it straight away; if not, it goes back in stock.</p>
            <Field label="Reason (the buyer sees it)">
              <Select value={reason} onChange={(e) => setReason(e.target.value)} name="reason">
                {[...REASONS, "Other"].map((r) => <option key={r}>{r}</option>)}
              </Select>
            </Field>
            {reason === "Other" && <Field label="Your reason"><Textarea name="otherReason" value={other} maxLength={200} onChange={(e) => setOther(e.target.value)} rows={2} /></Field>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" icon="cross" busy={busy === "cancel"} busyLabel="Cancelling…" disabled={reason === "Other" && !other.trim()}>Cancel {cancel.buyer}&apos;s hold</Button>
              <Button variant="ghost" onClick={() => setCancel(null)}>Keep it</Button>
            </div>
          </form>
        )}
      </BottomSheet>

      <BottomSheet open={confirmEnd} onClose={() => setConfirmEnd(false)} title="End this drop?">
        <p>No new taps after this. Unsold pieces are marked unsold and waitlists with nobody ahead are told they missed it. Open holds keep running until they&apos;re paid or run out.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="danger" icon="cross" busy={busy === "end"} busyLabel="Ending…"
            onClick={async () => { if (await act("end", () => api("POST /api/drops/:id/end", undefined, id), "Drop ended")) setConfirmEnd(false); }}>End drop</Button>
          <Button variant="ghost" onClick={() => setConfirmEnd(false)}>Keep going</Button>
        </div>
      </BottomSheet>
    </div>
  );
}

function Stat({ label, value, testid }: { label: string; value: number; testid: string }) {
  return (
    <div className="rounded-wobble border-2 border-ink bg-paper px-2 py-2">
      <dt className="text-sm font-semibold text-muted">{label}</dt>
      <dd className="font-mono text-3xl font-bold tabular-nums" data-testid={testid}>{value}</dd>
    </div>
  );
}

/**
 * Live-feed status. The heartbeat keeps the console current every 5 s without it, so this never says the sale is
 * paused, and a normal connect (under ~3 s) never shows the bar at all.
 */
function LiveBar({ status }: { status: LiveStatus }) {
  const [grace, setGrace] = useState(true);
  useEffect(() => { const t = setTimeout(() => setGrace(false), 3000); return () => clearTimeout(t); }, []);
  if (status === "connected" || (grace && status === "connecting")) return null;
  return (
    <div role="status" className="-mx-4 flex items-center gap-2 border-y-2 border-ink bg-sky px-4 py-2 font-semibold lg:mx-0 lg:rounded-wobble lg:border-2" data-testid="live-bar">
      <Icon name="clock" size={20} className="shrink-0 text-sky-ink" />
      <span>{status === "offline" ? "Live updates reconnecting…" : "Live updates connecting…"} <span className="font-normal">the ledger refreshes every 5 s</span></span>
    </div>
  );
}
