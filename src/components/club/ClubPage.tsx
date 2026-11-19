"use client";
// Buyer club page /s/[shop]/club: header with Join / Joined, tabs Drops (announcements), Chat (members), Reviews.
// Drops and Reviews read without joining; live updates arrive through the Nexconn community channel for members.
import { useCallback, useEffect, useState } from "react";
import { Chat, type ChatLine } from "@/components/chat/Chat";
import { JoinSheet } from "@/components/sale/JoinSheet";
import {
  AppHeader, Avatar, Badge, Banner, Button, Card, ConnectionBar, EmptyState, Field, Icon, LinkButton, Select, Skeleton, StatePill, Textarea, cx, useToast,
} from "@/components/ui";
import { api, ApiError } from "@/lib/client/api";
import { getLive, type LiveStatus } from "@/lib/client/live";
import type { ClubPostView, ClubSummary } from "@/lib/types";

type Tab = "drops" | "chat" | "reviews";
const TABS: { id: Tab; label: string }[] = [{ id: "drops", label: "Drops" }, { id: "chat", label: "Chat" }, { id: "reviews", label: "Reviews" }];

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Try again.");
const toLine = (p: ClubPostView): ChatLine => ({ id: p.msgId ?? `p${p.id}`, from: p.from ?? "", fromName: p.name ?? undefined, at: Date.parse(p.at), text: p.text });

export function Stars({ n, className }: { n: number; className?: string }) {
  return <span className={cx("font-mono tracking-wider text-yellow-ink", className)} role="img" aria-label={`${n} of 5 stars`}>{"★".repeat(n)}{"☆".repeat(5 - n)}</span>;
}

export function ClubPage({ slug }: { slug: string }) {
  const toast = useToast();
  const [d, setD] = useState<ClubSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("drops");
  const [joinSheet, setJoinSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [status, setStatus] = useState<LiveStatus>("connecting");

  const addLines = useCallback((xs: ChatLine[]) => setLines((cur) => {
    const have = new Set(cur.map((x) => x.id));
    return [...cur, ...xs.filter((x) => !have.has(x.id))].sort((a, b) => a.at - b.at).slice(-200);
  }), []);
  const load = useCallback(() => api("GET /api/club/:shopSlug", undefined, { shopSlug: slug })
    .then((x) => { setD(x); setErr(null); addLines(x.chat.map(toLine)); },
      (e) => setErr(e instanceof ApiError && e.status === 404 ? "not_found" : msg(e))), [slug, addLines]);
  useEffect(() => { void load(); }, [load]);
  const since = d?.since ? Date.parse(d.since) : 0; // a demo club restarts with its slot

  const member = !!d?.me?.member, clubId = d?.clubId ?? null;
  useEffect(() => {
    if (!member || !clubId) return;
    let gone = false;
    const offs: (() => void)[] = [];
    getLive("buyer").then((live) => {
      if (gone) return;
      offs.push(live.onStatus(setStatus));
      offs.push(live.watchClub(`${clubId}.drops`, () => void load()));
      offs.push(live.watchClub(`${clubId}.reviews`, () => void load()));
      offs.push(live.watchClub(`${clubId}.chat`, (m) => { if (m.kind === "text") addLines([{ id: m.id, from: m.from, fromName: m.fromName, at: m.at, text: m.text ?? "" }]); }));
    }, () => setStatus("offline"));
    return () => { gone = true; offs.forEach((f) => f()); };
  }, [member, clubId, load, addLines]);

  async function join() {
    if (!d) return;
    if (!d.me) { setJoinSheet(true); return; }
    setBusy(true);
    try { await api("POST /api/club/join", { shopSlug: slug }); await load(); toast("You're in the club. You'll hear about the next drop here.", { tone: "good" }); }
    catch (e) { toast(msg(e), { tone: "warn" }); }
    finally { setBusy(false); }
  }
  async function leave() {
    setBusy(true);
    try { await api("POST /api/club/leave", { shopSlug: slug }); setLines([]); await load(); }
    catch (e) { toast(msg(e), { tone: "warn" }); }
    finally { setBusy(false); }
  }

  if (err === "not_found") {
    return (<><AppHeader title="Shop club" /><main id="main" className="mx-auto w-full max-w-xl px-4 pt-12"><EmptyState title="No club here" body="This shop doesn't have a club, or the link is wrong." icon="users" /></main></>);
  }
  if (!d) {
    return (
      <><AppHeader title="Shop club" />
        <main id="main" className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pt-4">
          {err ? <EmptyState title="Couldn't load the club" body={err} icon="warning" action={<Button onClick={() => void load()}>Try again</Button>} />
            : <><Skeleton className="h-28" /><Skeleton className="h-64" /></>}
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader title={`${d.shop.name} club`} />
      {d.shop.isSandbox && <Banner />}
      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 pb-10 pt-4">
        <Card className="flex flex-col gap-3 p-4" data-testid="club-header">
          <div className="flex items-center gap-3">
            {d.shop.logoUrl
              // eslint-disable-next-line @next/next/no-img-element -- shop logos are Storage URLs of any size
              ? <img src={d.shop.logoUrl} alt="" className="size-14 rounded-blob border-[2.5px] border-ink object-cover" />
              : <Avatar name={d.shop.name} size={56} />}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-2xl font-extrabold">{d.shop.name}</h1>
              <p className="flex items-center gap-1 text-muted" data-testid="club-members"><Icon name="users" size={18} />{d.memberCount} {d.memberCount === 1 ? "member" : "members"}</p>
            </div>
          </div>
          {member ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tint="lime" icon="check">Joined</Badge>
              <Button size="sm" variant="ghost" busy={busy} busyLabel="Leaving…" onClick={() => void leave()}>Leave club</Button>
            </div>
          ) : d.me?.banned ? (
            <p className="flex items-center gap-2 font-semibold"><Icon name="lock" size={18} />You can&apos;t join this club.</p>
          ) : (
            <>
              <Button variant="primary" icon="bell" busy={busy} busyLabel="Joining…" onClick={() => void join()}>Join the club</Button>
              <p className="text-muted">Members hear about the next drop first and can chat with other buyers.</p>
            </>
          )}
        </Card>

        <div role="tablist" aria-label="Club" className="grid grid-cols-3 gap-1 rounded-wobble-2 border-[2.5px] border-ink bg-card p-1">
          {TABS.map((t) => (
            <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} onClick={() => setTab(t.id)}
              className={cx("min-h-12 rounded-wobble font-semibold", tab === t.id ? "border-2 border-ink bg-lime" : "border-2 border-transparent")}>
              {t.label}{t.id === "reviews" && d.reviews.length ? ` (${d.reviews.length})` : ""}
            </button>
          ))}
        </div>

        <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="flex flex-col gap-3">
          {tab === "drops" && <DropsTab d={d} />}
          {tab === "chat" && (member ? (
            <>
              {status !== "connected" && <ConnectionBar status={status} />}
              <Chat title="Club chat" lines={lines.filter((l) => l.at >= since)} meId={d.me?.userId ?? null} maxHeight="max-h-[55vh]"
                empty="No messages yet. Say hi to other buyers 👋"
                note="Phone numbers and UPI IDs are blocked here. Use your order chat."
                onSend={async (text) => { const { message } = await api("POST /api/club/send", { shopSlug: slug, text }); addLines([message]); }} />
            </>
          ) : (
            <EmptyState icon="lock" title="Chat is for members" body="Join the club to chat with other buyers of this shop."
              action={!d.me?.banned && <Button icon="bell" busy={busy} onClick={() => void join()}>Join the club</Button>} />
          ))}
          {tab === "reviews" && <ReviewsTab d={d} onDone={load} />}
        </section>
      </main>
      <JoinSheet open={joinSheet} onClose={() => setJoinSheet(false)} shopSlug={slug} shopName={d.shop.name}
        onJoined={async () => { setJoinSheet(false); await load(); setBusy(true); try { await api("POST /api/club/join", { shopSlug: slug }); await load(); } catch (e) { toast(msg(e), { tone: "warn" }); } finally { setBusy(false); } }} />
    </>
  );
}

function DropsTab({ d }: { d: ClubSummary }) {
  const n = d.nextDrop;
  return (
    <>
      {n && (
        <Card tint={n.status === "live" ? "lime" : "yellow"} className="flex flex-col gap-2 p-4" data-testid="club-next-drop">
          <p className="flex items-center gap-2">
            {n.status === "live" ? <StatePill state="live" size="sm" /> : <Badge tint="card" icon="clock" size="sm">Next drop</Badge>}
          </p>
          <h2 className="text-xl font-extrabold">{n.title}</h2>
          {n.status === "scheduled" && <p className="font-semibold">Starts {when(n.startsAt)}</p>}
          <LinkButton href={new URL(n.shareUrl).pathname} variant={n.status === "live" ? "dibs" : "primary"} icon="arrowRight">Open the sale room</LinkButton>
        </Card>
      )}
      {d.announcements.length === 0 ? (
        <EmptyState icon="bell" title="No announcements yet" body="The seller posts here when a drop is coming." />
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Announcements">
          {[...d.announcements].reverse().map((a) => (
            <li key={a.id}>
              <Card flat className="flex flex-col gap-2 p-3">
                <p className="flex items-center gap-2 text-sm text-muted"><Icon name="bell" size={16} />{when(a.at)}</p>
                <p className="whitespace-pre-line text-lg leading-snug">{a.text}</p>
                {a.drop && (
                  <div className="flex flex-wrap items-center gap-2">
                    {a.drop.status === "scheduled" && <span className="font-semibold">Starts {when(a.drop.startsAt)}</span>}
                    {a.drop.status === "ended"
                      ? <Badge tint="grey" icon="check" size="sm">Ended</Badge>
                      : <LinkButton size="sm" href={new URL(a.drop.shareUrl).pathname} icon="arrowRight">Open the sale room</LinkButton>}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function ReviewsTab({ d, onDone }: { d: ClubSummary; onDone: () => Promise<void> }) {
  const toast = useToast();
  const can = d.me?.reviewable ?? [];
  const [open, setOpen] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [stars, setStars] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!stars) { setErr("Pick 1 to 5 stars."); return; }
    setBusy(true); setErr(null);
    try {
      await api("POST /api/club/review", { orderId: orderId || can[0].orderId, stars, text });
      setOpen(false); setStars(0); setText(""); setOrderId("");
      toast("Thanks! Your review is up.", { tone: "good" });
      await onDone();
    } catch (e) { setErr(msg(e)); }
    finally { setBusy(false); }
  }

  return (
    <>
      {can.length > 0 && !open && <Button icon="plus" onClick={() => setOpen(true)}>Write a review</Button>}
      {open && (
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-lg font-extrabold">Your review</h2>
          {can.length > 1 && (
            <Field label="Order">
              <Select value={orderId || can[0].orderId} onChange={(e) => setOrderId(e.target.value)}>
                {can.map((o) => <option key={o.orderId} value={o.orderId}>#{o.orderNo} · {o.title}</option>)}
              </Select>
            </Field>
          )}
          {can.length === 1 && <p className="text-muted">Order #{can[0].orderNo} · {can[0].title}</p>}
          <fieldset>
            <legend className="mb-1 font-semibold">Stars</legend>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" aria-pressed={stars === n} aria-label={`${n} ${n === 1 ? "star" : "stars"}`} onClick={() => setStars(n)}
                  className={cx("grid size-12 place-items-center rounded-wobble border-2 text-2xl", n <= stars ? "border-ink bg-yellow" : "border-ink/30")}>
                  {n <= stars ? "★" : "☆"}
                </button>
              ))}
            </div>
          </fieldset>
          <Field label="What was it like? (optional)" hint={`${text.length}/280`}>
            <Textarea value={text} maxLength={280} onChange={(e) => setText(e.target.value)} placeholder="Lovely finish, arrived in 3 days." />
          </Field>
          {err && <p role="alert" className="flex items-center gap-1.5 font-semibold text-pink-ink"><Icon name="warning" size={18} />{err}</p>}
          <div className="flex gap-2">
            <Button busy={busy} busyLabel="Posting…" icon="check" onClick={() => void submit()}>Post review</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </Card>
      )}
      {d.reviews.length === 0 ? (
        <EmptyState icon="sparkle" title="No reviews yet" body="Buyers with a paid order can review it here." />
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Reviews">
          {[...d.reviews].reverse().map((r) => (
            <li key={r.id}>
              <Card flat className="flex flex-col gap-1 p-3">
                <p className="flex flex-wrap items-center gap-2"><Stars n={r.stars ?? 0} /><span className="font-semibold">{r.name ?? "Buyer"}</span><span className="text-sm text-muted">{when(r.at)}</span></p>
                {r.text && <p className="leading-snug [overflow-wrap:anywhere]">{r.text}</p>}
              </Card>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
