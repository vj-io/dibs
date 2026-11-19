"use client";
/* eslint-disable @next/next/no-img-element -- product photos are SVG drawings or pre-compressed Storage images */
// /me: the buyer's holds, waitlists and orders across shops, and deleting their data.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useSlow, withTimeout } from "@/lib/client/hooks";
import { StillConnecting } from "@/components/sale/StillConnecting";
import type { MeOrder, MyAccount } from "@/lib/types";
import {
  AppHeader, BottomSheet, Button, Countdown, EmptyState, Footer, Icon, LinkButton, Price, Skeleton, StatePill, useToast,
} from "@/components/ui";

export function MyStuff() {
  const toast = useToast();
  const [acc, setAcc] = useState<MyAccount | "none" | "error" | null>(null);
  const [del, setDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const slow = useSlow(6000);
  const [deleted, setDeleted] = useState<{ released: number; left: number; kept: number } | null>(null);

  const load = useCallback(() => {
    // ask who we are first: a visitor who never joined gets the empty state without a 401 in the console
    withTimeout(api("GET /api/buyer/me"), 12_000)
      .then((r) => (r.buyer ? withTimeout(api("GET /api/me"), 12_000).then(setAcc) : setAcc("none")))
      .catch((e) => setAcc(e instanceof ApiError && e.status === 401 ? "none" : "error"));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function remove() {
    setBusy(true);
    try {
      const r = await api("DELETE /api/me");
      setDeleted(r); setDel(false); setAcc("none");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't delete. Try again.", { tone: "warn" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader title="My stuff" />
      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 px-4 pb-10 pt-6">
        <h1 className="text-4xl">My stuff</h1>
        {deleted && (
          <p role="status" className="flex items-start gap-2 rounded-wobble border-2 border-ink bg-mint px-3 py-2 font-semibold">
            <Icon name="check" size={20} className="mt-0.5 text-mint-ink" />
            Your data is deleted. Released {deleted.released} hold{deleted.released === 1 ? "" : "s"}, left {deleted.left} waitlist{deleted.left === 1 ? "" : "s"}
            {deleted.kept ? `; ${deleted.kept} order${deleted.kept === 1 ? "" : "s"} you marked paid stay with the seller to settle` : ""}.
          </p>
        )}
        {acc === null && <div aria-busy="true" className="flex flex-col gap-3">{slow && <StillConnecting what="your account" onRetry={load} />}<Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>}
        {acc === "error" && <EmptyState icon="warning" title="Couldn't load your stuff" body="Check your connection." action={<Button variant="ghost" onClick={load}>Try again</Button>} />}
        {acc === "none" && (
          <EmptyState icon="bag" title="Nothing here yet"
            body="When you call dibs in a seller's sale room, your holds, waitlist places and orders show up here."
            action={<LinkButton href="/try" icon="tap">Try a demo drop</LinkButton>} />
        )}
        {acc && typeof acc === "object" && (
          <>
            <p className="text-muted">Signed in as <strong className="text-ink">{acc.buyer.displayName}</strong>{acc.buyer.phone ? ` · +91 ${acc.buyer.phone}` : ""}</p>
            {!acc.holds.length && !acc.waits.length && !acc.orders.length && (
              <EmptyState icon="bag" title="Nothing here yet" body="Tap Dibs! in a sale room and your pieces show up here." />
            )}
            {acc.holds.length > 0 && (
              <Section title="Held for you" note="Pay before the timer runs out, or the piece goes to the next buyer.">
                {acc.holds.map((o) => <OrderRow key={o.orderId} o={o} />)}
              </Section>
            )}
            {acc.waits.length > 0 && (
              <Section title="Waitlists">
                {acc.waits.map((w) => (
                  <li key={w.claimId}>
                    <Link href={`/s/${w.shop.slug}/d/${w.dropCode}`} className="flex min-h-14 items-center gap-3 rounded-wobble border-2 border-ink bg-yellow px-3 py-2 no-underline">
                      <StatePill state="waitlisted" size="sm" label={`#${w.waitPosition} in line`} />
                      <span className="min-w-0 flex-1"><span className="block truncate font-semibold">#{w.position} {w.title} · {w.variantLabel}</span><span className="text-sm text-muted">{w.shop.name}</span></span>
                      <Icon name="chevronRight" />
                    </Link>
                  </li>
                ))}
              </Section>
            )}
            {acc.orders.length > 0 && (
              <Section title="Orders">
                {acc.orders.map((o) => <OrderRow key={o.orderId} o={o} />)}
              </Section>
            )}
            <section className="mt-6 flex flex-col gap-2 rounded-wobble border-2 border-dashed border-ink/50 p-4">
              <h2 className="text-xl">Your data</h2>
              <p className="text-muted">Your name and phone number are seen only by you and the shops you buy from.</p>
              <Button variant="ghost" icon="trash" className="self-start" onClick={() => setDel(true)}>Delete my data</Button>
            </section>
          </>
        )}
      </main>
      <Footer />
      <BottomSheet open={del} onClose={() => setDel(false)} title="Delete my data?">
        <div className="flex flex-col gap-3">
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>Your name and phone number are wiped.</li>
            <li>Pieces you&apos;re holding are released to the next buyer, and you leave every waitlist.</li>
            <li>Orders you&apos;ve paid for, or said you paid for, are kept with just the piece, price and order number, so the seller can settle and ship them.</li>
          </ul>
          <p className="font-semibold">This can&apos;t be undone.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" busy={busy} busyLabel="Deleting…" onClick={() => void remove()}>Delete my data</Button>
            <Button variant="ghost" onClick={() => setDel(false)}>Keep it</Button>
          </div>
        </div>
      </BottomSheet>
    </>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-hand text-2xl font-normal tracking-normal">{title}</h2>
      {note && <p className="text-muted">{note}</p>}
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function OrderRow({ o }: { o: MeOrder }) {
  return (
    <li>
      <Link href={`/o/${o.orderId}`} className="flex min-h-14 items-center gap-3 rounded-wobble border-2 border-ink bg-card px-3 py-2 no-underline shadow-ink-sm">
        {o.photo ? <img src={o.photo} alt="" className="size-14 shrink-0 rounded-md border-2 border-ink object-cover" /> : <span className="grid size-14 shrink-0 place-items-center rounded-md border-2 border-ink bg-grey"><Icon name="bag" /></span>}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-semibold">{o.title} · {o.variantLabel}</span>
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <StatePill state={o.state} size="sm" />
            {o.state === "held" && o.expiresAt && <Countdown expiresAt={o.expiresAt} size="sm" announce={false} />}
          </span>
          <span className="text-sm text-muted">{o.shop.name} · Order #{o.orderNo} · <Price paise={o.amountPaise} size="sm" className="text-sm" /></span>
        </span>
        <Icon name="chevronRight" />
      </Link>
    </li>
  );
}
