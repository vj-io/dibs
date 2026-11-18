"use client";
/* eslint-disable @next/next/no-img-element -- product thumbnails */
// /seller/drops: the shop's drops and the create-a-drop form (title, start time, ordered pieces) -> share link.
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Card, EmptyState, Field, Icon, Input, LinkButton, Price, Sheet, Skeleton, StatePill, type PillState } from "@/components/ui";
import { api } from "@/lib/client/api";
import type { DropStatus, DropSummary, Product } from "@/lib/types";
import { errMsg, ShareCard, when } from "./kit";

export const DROP_PILL: Record<DropStatus, { state: PillState; label: string }> = {
  scheduled: { state: "waiting", label: "Scheduled" },
  live: { state: "live", label: "LIVE" },
  ended: { state: "ended", label: "Ended" },
};

/** "2026-11-19T20:10" in local time, for <input type="datetime-local">. */
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function DropsPage() {
  const [drops, setDrops] = useState<DropSummary[] | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ dropId: string; title: string; shareUrl: string } | null>(null);

  const load = useCallback(() => Promise.all([api("GET /api/drops"), api("GET /api/products")])
    .then(([d, p]) => { setDrops(d.drops); setProducts(p.products); }, (e) => setErr(errMsg(e))), []);
  useEffect(() => { void load(); }, [load]);

  const start = () => { setCreating(true); setMade(null); setShown(false); setSaveErr(null); setTitle(""); setPicked([]); setStartsAt(localInput(new Date(Date.now() + 10 * 60_000))); };
  const errors = {
    title: !title.trim() || title.trim().length > 80 ? "Name the drop, up to 80 characters." : undefined,
    startsAt: !startsAt || Number.isNaN(new Date(startsAt).getTime()) ? "Pick a date and time." : undefined,
    picked: picked.length ? undefined : "Pick at least one piece.",
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setShown(true);
    if (errors.title || errors.startsAt || errors.picked) return;
    setBusy(true); setSaveErr(null);
    try {
      const r = await api("POST /api/drops", { title: title.trim(), startsAt: new Date(startsAt).toISOString(), productIds: picked });
      setMade({ dropId: r.dropId, title: title.trim(), shareUrl: r.shareUrl });
      setCreating(false);
      await load();
    } catch (x) { setSaveErr(errMsg(x)); } finally { setBusy(false); }
  };

  const move = (i: number, by: -1 | 1) => setPicked((p) => { const a = [...p]; [a[i], a[i + by]] = [a[i + by], a[i]]; return a; });
  const byId = new Map(products?.map((p) => [p.id, p]));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl">Drops</h1>
        {!creating && <Button icon="plus" onClick={start} disabled={!products}>New drop</Button>}
      </div>

      {made && (
        <Sheet tint="lime" title="Your drop is ready to share" className="flex flex-col gap-3">
          <p className="text-lg font-semibold">{made.title}</p>
          <ShareCard title={made.title} url={made.shareUrl} />
          <LinkButton href={`/seller/drops/${made.dropId}`} icon="live" size="lg" className="self-start">Open the live console</LinkButton>
        </Sheet>
      )}

      {creating && (
        <Sheet title="New drop">
          {products && !products.length ? (
            <EmptyState icon="bag" title="Add a piece first." body="A drop is a list of pieces from your catalog." action={<LinkButton href="/seller/products" icon="plus">Add pieces</LinkButton>} />
          ) : (
            <form onSubmit={create} noValidate className="flex flex-col gap-5">
              <Field label="Drop title" error={shown && errors.title}>
                <Input name="dropTitle" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Diwali Edit, 8 pm" />
              </Field>
              <Field label="Starts at" hint="Buyers see a countdown until you press Go live." error={shown && errors.startsAt}>
                <Input name="startsAt" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 font-hand text-xl leading-tight">Your pieces</legend>
                  <ul className="flex flex-col gap-2">
                    {products?.map((p) => {
                      const on = picked.includes(p.id);
                      return (
                        <li key={p.id}>
                          <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-wobble border-2 border-ink bg-card px-3 py-2 has-[:checked]:bg-lime/40 has-[:focus-visible]:outline-3">
                            <input type="checkbox" checked={on} onChange={() => setPicked((x) => (on ? x.filter((y) => y !== p.id) : [...x, p.id]))} className="size-5 accent-[var(--color-ink)]" />
                            {p.photos[0] ? <img src={p.photos[0]} alt="" className="size-10 rounded-md border-2 border-ink object-cover" /> : <Icon name="bag" />}
                            <span className="min-w-0 flex-1 truncate font-semibold">{p.title}</span>
                            <Price paise={p.pricePaise} size="sm" />
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
                <div className="flex flex-col gap-2">
                  <p className="font-hand text-xl leading-tight">Drop order <span className="text-muted">({picked.length})</span></p>
                  {!picked.length ? <p className="rounded-wobble border-2 border-dashed border-ink/40 p-4 text-muted">Tick pieces on the left. They drop in this order.</p> : (
                    <ol className="flex flex-col gap-2" data-testid="drop-order">
                      {picked.map((id, i) => (
                        <li key={id} className="flex min-h-14 items-center gap-2 rounded-wobble border-2 border-ink bg-yellow px-2 py-1">
                          <span className="w-8 text-center font-mono font-bold">#{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate font-semibold">{byId.get(id)?.title}</span>
                          <button type="button" aria-label={`Move ${byId.get(id)?.title} up`} disabled={i === 0} onClick={() => move(i, -1)} className="grid size-12 place-items-center rounded-full disabled:opacity-30"><Icon name="chevronUp" /></button>
                          <button type="button" aria-label={`Move ${byId.get(id)?.title} down`} disabled={i === picked.length - 1} onClick={() => move(i, 1)} className="grid size-12 place-items-center rounded-full disabled:opacity-30"><Icon name="chevronDown" /></button>
                        </li>
                      ))}
                    </ol>
                  )}
                  {shown && errors.picked && <p role="alert" className="font-semibold text-pink-ink">{errors.picked}</p>}
                </div>
              </div>
              {saveErr && <p role="alert" className="rounded-wobble border-2 border-ink bg-pink-soft px-3 py-2 font-semibold">{saveErr}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="lg" icon="sparkle" busy={busy} busyLabel="Creating…">Create drop</Button>
                <Button variant="ghost" size="lg" onClick={() => setCreating(false)}>Cancel</Button>
              </div>
            </form>
          )}
        </Sheet>
      )}

      {err ? <EmptyState icon="warning" title="Couldn't load your drops." body={err} action={<Button onClick={() => { setErr(null); void load(); }}>Try again</Button>} />
        : !drops ? <div className="flex flex-col gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-24" />)}</div>
        : !drops.length ? (!creating && !made && <EmptyState icon="live" title="No drops yet." body="Make a drop, share its link in your WhatsApp group, and press Go live at the time you said." action={<Button icon="plus" onClick={start}>Make your first drop</Button>} />)
        : (
          <ul className="flex flex-col gap-3" data-testid="drop-list">
            {drops.map((d) => (
              <li key={d.dropId}>
                <Card flat className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
                  <div className="min-w-0 flex-1 basis-56">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatePill state={DROP_PILL[d.status].state} label={DROP_PILL[d.status].label} size="sm" />
                      {d.isSandbox && <StatePill state="demo" size="sm" />}
                      <Link href={`/seller/drops/${d.dropId}`} className="min-w-0 truncate text-lg font-extrabold underline decoration-2 underline-offset-4 hover:decoration-lime">{d.title}</Link>
                    </div>
                    <p className="text-muted">{when(d.startsAt)} · {d.itemCount} {d.itemCount === 1 ? "piece" : "pieces"} · code <span className="font-mono">{d.code}</span></p>
                    <p className="truncate font-mono text-sm text-muted">{d.shareUrl}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <CopyButton url={d.shareUrl} />
                    <LinkButton href={`/seller/drops/${d.dropId}`} size="sm" icon={d.status === "ended" ? "eye" : "live"}>{d.status === "ended" ? "Results" : "Console"}</LinkButton>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

function CopyButton({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant="ghost" icon={done ? "check" : "copy"} onClick={() => navigator.clipboard.writeText(url).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }, () => {})}>
      {done ? "Copied" : "Copy link"}
    </Button>
  );
}
