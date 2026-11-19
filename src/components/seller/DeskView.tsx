"use client";
// /seller/desk: orders grouped by state with two filters, the selected order room beside the list (or a full-screen
// sheet on phones), and the team desk chat feed. Polls GET /api/desk every 10 s and on any desk card.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { OrderRoom } from "@/components/order/OrderRoom";
import { Badge, BottomSheet, Button, buttonClasses, Card, Countdown, cx, EmptyState, Field, Icon, Input, Price, Select, Skeleton, StatePill, useToast, type PillState } from "@/components/ui";
import { api } from "@/lib/client/api";
import { getLive, type LiveMsg } from "@/lib/client/live";
import { rupees } from "@/lib/codec";
import type { Desk, DeskOrder, DropSummary, OrderState } from "@/lib/types";
import { clock, errMsg, useMe, useWide, waBuyer, when } from "./kit";
import { deskFeedFloor } from "./consoleLogic";
import { WaButton } from "./Ledger";

const GROUPS: { state: OrderState; title: string; pill: PillState }[] = [
  { state: "held", title: "Waiting for payment", pill: "held" },
  { state: "payment_claimed", title: "Says paid — check your bank", pill: "payment_claimed" },
  { state: "paid", title: "Paid — to ship", pill: "paid" },
  { state: "shipped", title: "Shipped", pill: "shipped" },
  { state: "cancelled", title: "Ended", pill: "cancelled" },
];
const EVENT: Record<string, string> = { new: "new order", payment_claimed: "says paid", paid: "paid", shipped: "shipped", cancelled: "ended", assigned: "reassigned" };

export function DeskView() {
  const me = useMe();
  const wide = useWide();
  const toast = useToast();
  const [desk, setDesk] = useState<Desk | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [sel, setSel] = useState<DeskOrder | null>(null);
  const [feed, setFeed] = useState<LiveMsg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [drops, setDrops] = useState<DropSummary[] | null>(null);
  const loadRef = useRef<() => void>(() => {});

  const load = useCallback(() => api("GET /api/desk", undefined, { assigned: mine ? "me" : "all", state: waiting ? "held" : undefined })
    .then((d) => { setDesk(d); setErr(null); }, (e) => setErr(errMsg(e))), [mine, waiting]);
  useEffect(() => { loadRef.current = () => void load(); }, [load]);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 10_000); return () => clearInterval(t); }, [load]);
  useEffect(() => { api("GET /api/drops").then((r) => setDrops(r.drops), () => setDrops([])); }, []);

  const deskId = desk?.deskGroupId ?? me.shop.deskGroupId;
  useEffect(() => {
    if (!deskId) return;
    let off: (() => void) | undefined, gone = false;
    const add = (m: LiveMsg) => setFeed((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m].sort((a, b) => a.at - b.at).slice(-200)));
    getLive("staff").then(async (l) => {
      if (gone) return;
      off = l.watchGroup(deskId, (m) => { add(m); if (m.card?.t === "DB:Desk") loadRef.current(); });
      const h = await l.history(deskId).catch(() => [] as LiveMsg[]);
      if (!gone) setFeed((xs) => [...h, ...xs.filter((x) => !h.some((y) => y.id === x.id))].sort((a, b) => a.at - b.at));
    }).catch(() => {});
    return () => { gone = true; off?.(); };
  }, [deskId]);

  const say = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || !deskId) return;
    setSending(true);
    try {
      const l = await getLive("staff");
      const m = await l.sendText({ type: "group", id: deskId }, t);
      setFeed((xs) => (xs.some((x) => x.id === m.id) ? xs : [...xs, m]));
      setText("");
    } catch (x) { toast(errMsg(x), { tone: "warn" }); } finally { setSending(false); }
  };

  const floor = deskFeedFloor(me.shop.isSandbox, drops); // a demo slot's desk channel still carries earlier visitors' lines
  const shown = floor ? feed.filter((m) => m.at >= floor) : feed;
  const total = desk ? Object.values(desk.orders).reduce((a, l) => a + l.length, 0) : 0;
  const wa = sel && !me.shop.isSandbox ? waBuyer(sel.phone, { shop: me.shop.name, buyer: sel.buyer, orderNo: sel.orderNo, item: sel.item, variant: sel.variantLabel, amount: rupees(sel.amountPaise), orderId: sel.orderId }) : null;
  const room = sel && <>{wa && <div className="mb-2"><WaButton href={wa} who={sel.buyer} /></div>}<OrderRoom key={sel.orderId} orderId={sel.orderId} viewer="staff" embedded /></>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl">Team desk</h1>
        <div className="ml-auto flex flex-wrap gap-2" role="group" aria-label="Filters">
          <Toggle on={mine} onClick={() => setMine(!mine)} icon="users">Assigned to me</Toggle>
          <Toggle on={waiting} onClick={() => setWaiting(!waiting)} icon="clock">Waiting for payment</Toggle>
        </div>
      </div>

      <CsvPicker drops={drops} />

      <div className={cx("grid gap-5", sel && wide ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" : "lg:grid-cols-[minmax(0,1fr)_380px]")}>
        <div className="flex min-w-0 flex-col gap-5">
          {err && !desk ? <EmptyState icon="warning" title="Couldn't load the desk." body={err} action={<Button onClick={() => void load()}>Try again</Button>} />
            : !desk ? <><Skeleton className="h-24" /><Skeleton className="h-24" /></>
            : !total ? <EmptyState icon="bag" title={mine || waiting ? "Nothing matches these filters." : "No orders yet."} body={mine || waiting ? "Turn a filter off to see more." : "Every piece someone wins shows up here with its own order chat."} />
            : GROUPS.filter((g) => desk.orders[g.state].length).map((g) => (
              <section key={g.state} aria-labelledby={`g-${g.state}`} className="flex flex-col gap-2" data-testid={`group-${g.state}`}>
                <h2 id={`g-${g.state}`} className="flex items-center gap-2 text-xl">
                  <StatePill state={g.pill} label={g.title} />
                  <span className="font-mono text-base text-muted">{desk.orders[g.state].length}</span>
                </h2>
                <ul className="flex flex-col gap-2">
                  {desk.orders[g.state].map((o) => (
                    <li key={o.orderId}>
                      <button type="button" onClick={() => setSel(o)} aria-pressed={sel?.orderId === o.orderId} data-testid="desk-order"
                        className={cx("flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-wobble border-2 border-ink px-3 py-2 text-left",
                          sel?.orderId === o.orderId ? "bg-lime/50 shadow-ink-sm" : "bg-card hover:bg-paper")}>
                        <span className="font-mono font-bold">#{o.orderNo}</span>
                        <span className="min-w-0 flex-1 basis-40">
                          <span className="block truncate font-semibold">{o.buyer} · {o.item}</span>
                          <span className="block truncate text-[0.95rem] text-muted">{o.variantLabel} · drop {o.dropCode}{o.assignedTo ? ` · ${o.assignedTo.staffId === me.staffId ? "you" : o.assignedTo.displayName}` : " · unassigned"}{o.utr ? ` · UTR ${o.utr}` : ""}{o.utr?.startsWith("DEMO-UTR-") ? " · 🤖 demo payment" : ""}</span>
                        </span>
                        <Price paise={o.amountPaise} size="sm" />
                        {o.state === "held" && o.expiresAt && <Countdown size="sm" announce={false} expiresAt={o.expiresAt} onDone={() => setTimeout(() => loadRef.current(), 800)} />}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {sel && wide && (
            <Card flat className="flex flex-col gap-2 p-3" data-testid="order-pane">
              <div className="flex items-center gap-2">
                <p className="font-extrabold">Order #{sel.orderNo} · {sel.buyer}</p>
                <button type="button" onClick={() => setSel(null)} aria-label="Close order" className="ml-auto grid size-12 place-items-center rounded-full"><Icon name="cross" /></button>
              </div>
              {room}
            </Card>
          )}
          <Card flat className="flex flex-col gap-3" data-testid="desk-feed">
            <h2 className="flex items-center gap-2 text-xl"><Icon name="chat" />Team chat</h2>
            {!deskId ? <p className="text-muted">The team desk is being set up.</p> : (
              <>
                <ol className="flex max-h-[28rem] flex-col gap-1.5 overflow-y-auto pr-1" aria-label="Team desk feed" aria-live="polite">
                  {!shown.length && <li className="text-muted">New orders and team messages show up here.</li>}
                  {shown.map((m) => m.card?.t === "DB:Desk" ? (
                    <li key={m.id} className="flex flex-wrap items-center gap-x-2 rounded-md bg-paper px-2 py-1 text-[0.95rem]">
                      <span className="font-mono text-sm text-muted">{clock(m.at)}</span>
                      <Badge size="sm" tint={m.card.event === "new" ? "lime" : m.card.event === "paid" ? "mint" : m.card.event === "cancelled" ? "grey" : "sky"}>{EVENT[m.card.event] ?? m.card.event}</Badge>
                      <span className="min-w-0">#{m.card.orderNo} {m.card.buyer} · {m.card.item} {m.card.variantLabel} · {rupees(m.card.amountPaise)}{m.card.assignedTo ? ` → ${m.card.assignedTo}` : ""}</span>
                    </li>
                  ) : m.kind === "text" ? (
                    <li key={m.id} className="rounded-wobble border-2 border-ink/20 bg-card px-2.5 py-1.5">
                      <span className="font-semibold">{m.from === `s_${me.staffId}` ? "You" : m.fromName ?? "Team"}</span>
                      <span className="ml-2 font-mono text-sm text-muted">{clock(m.at)}</span>
                      <p className="break-words">{m.text}</p>
                    </li>
                  ) : null)}
                </ol>
                <form onSubmit={say} className="flex gap-2">
                  <label htmlFor="desk-say" className="sr-only">Message the team</label>
                  <Input id="desk-say" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Message the team" className="flex-1" />
                  <Button type="submit" icon="arrowRight" busy={sending} busyLabel="…" disabled={!text.trim()} className="shrink-0">Send</Button>
                </form>
              </>
            )}
          </Card>
        </div>
      </div>

      <BottomSheet open={!!sel && !wide} onClose={() => setSel(null)} title={sel ? `Order #${sel.orderNo} · ${sel.buyer}` : ""} className="h-dvh max-h-dvh">
        {!wide && <div className="max-h-[80dvh] overflow-y-auto">{room}</div>}
      </BottomSheet>
    </div>
  );
}

function Toggle({ on, onClick, icon, children }: { on: boolean; onClick: () => void; icon: "users" | "clock"; children: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cx("inline-flex min-h-12 items-center gap-1.5 rounded-wobble-2 border-2 border-ink px-3 font-semibold", on ? "bg-lime shadow-ink-sm" : "bg-card")}>
      <Icon name={on ? "check" : icon} size={18} />{children}
    </button>
  );
}

/** Pick a drop, download its orders as CSV (GET /api/exports/orders.csv). */
function CsvPicker({ drops }: { drops: DropSummary[] | null }) {
  const [pick, setPick] = useState("");
  const id = pick || drops?.[0]?.dropId || "";
  if (!drops?.length) return null;
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="csv-picker">
      <Field label="Orders sheet" className="min-w-0 flex-1 basis-56">
        <Select name="csvDrop" value={id} onChange={(e) => setPick(e.target.value)}>
          {drops.map((d) => <option key={d.dropId} value={d.dropId}>{d.title} · {when(d.startsAt)}</option>)}
        </Select>
      </Field>
      <a href={`/api/exports/orders.csv?dropId=${id}`} download className={buttonClasses("ghost")}><Icon name="arrowRight" size={20} className="rotate-90" />Download CSV</a>
    </div>
  );
}
