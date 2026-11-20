import type { Metadata } from "next";
import { AppHeader, Card, EmptyState, Footer, Highlight, Icon, LinkButton, type IconName, type Tint } from "@/components/ui";
import { rupees } from "@/lib/codec";
import { fn } from "@/lib/server/db";
import type { ImpactTotals } from "@/lib/types";

export const metadata: Metadata = { title: "Impact", description: "Real totals from real Dibs drops. Demo activity is never counted." };
export const dynamic = "force-dynamic";

async function load(): Promise<ImpactTotals | null> {
  try { return await fn<ImpactTotals>("impact_totals"); } catch { return null; }
}

const CARDS: { key: keyof ImpactTotals; label: string; icon: IconName; tint: Tint; show?: (n: number) => string }[] = [
  { key: "drops", label: "Drops run", icon: "live", tint: "lime" },
  { key: "buyers", label: "Buyers who tapped", icon: "users", tint: "sky" },
  { key: "claimsWon", label: "Claims won", icon: "tap", tint: "yellow" },
  { key: "paidOrders", label: "Paid orders", icon: "check", tint: "mint" },
  { key: "paidValuePaise", label: "Paid value", icon: "rupee", tint: "mint", show: rupees },
  { key: "waitlistSaves", label: "Waitlist saves", icon: "queue", tint: "peach" },
];

export default async function Impact() {
  const t = await load();
  const empty = !!t && (Number(t.buyers) === 0 || Object.values(t).every((v) => Number(v) === 0));
  return (
    <>
      <AppHeader right={<LinkButton href="/try" variant="primary" size="sm" icon="tap">Try the demo</LinkButton>} />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <p className="font-hand text-xl text-muted">Real drops only</p>
        <h1 className="mt-2 text-[2.6rem] leading-[0.98] sm:text-6xl">Dibs <Highlight>impact</Highlight></h1>

        {!t && (
          <EmptyState className="mt-8 max-w-xl" icon="warning" title="The numbers could not be loaded" body="Nothing is being hidden: the server could not reach the database just now. Try again in a minute." />
        )}
        {empty && (
          <EmptyState className="mt-8 max-w-xl" icon="sparkle" title="No real drop has run yet."
            body="Numbers appear here after the first real drop. Demo-room activity is never counted." />
        )}
        {t && !empty && (
          <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {CARDS.map((c, i) => (
              <li key={c.key}>
                <Card as="article" draw alt={i % 2 === 1} tint={c.tint} className="flex h-full flex-col gap-1 p-5">
                  <Icon name={c.icon} size={28} stroke={2.4} />
                  <p className="font-mono text-5xl font-bold tabular-nums leading-tight">{(c.show ?? ((n: number) => n.toLocaleString("en-IN")))(Number(t[c.key]))}</p>
                  <p className="text-lg font-extrabold">{c.label}</p>
                </Card>
              </li>
            ))}
          </ul>
        )}

        <section aria-labelledby="excl" className="mt-12 max-w-3xl">
          <h2 id="excl" className="text-2xl sm:text-3xl">What is never counted</h2>
          <ul className="mt-4 flex flex-col gap-3 text-lg">
            {[
              "Sandbox shops and sandbox drops: everything you see on /try.",
              "Demo bots and demo orders. Bots are labelled 🤖; no real money moves, and demo orders never count here.",
              "Drops that are still scheduled and have not gone live.",
            ].map((x) => (
              <li key={x} className="flex items-start gap-3"><Icon name="cross" size={22} stroke={3} className="mt-1 shrink-0 text-pink-ink" /><span>{x}</span></li>
            ))}
          </ul>
          <p className="mt-5 text-muted">
            Paid orders and paid value count orders a seller has confirmed as paid or shipped. A waitlist save is a paid order that went to a buyer promoted off the waitlist after the first winner did not pay.
            The totals are read from the database each time this page loads.
          </p>
          <p className="mt-3 text-muted">
            The first real drop ran on 20 Nov 2026: our own small shop sold three digital pieces (₹1 to ₹10) to three friends, each on their own phone.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <LinkButton href="/try" variant="primary" size="lg" icon="tap">Try the demo</LinkButton>
            <LinkButton href="/how-it-works" variant="ghost" size="lg">How it works</LinkButton>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
