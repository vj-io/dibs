import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AppHeader, Banner, Card, EmptyState, Footer, Highlight, LinkButton } from "@/components/ui";
import { buildRecord, istTime, payLines, recordHeadline, totalsLine } from "@/lib/record";
import { appUrl } from "@/lib/server/queries";
import { dropByCode, dropRecord, shareUrl } from "@/lib/server/share";

// One read per request for the metadata and the page. null = no such drop (404); a thrown error = the database failed.
const load = cache(async (shop: string, code: string) => {
  const d = await dropByCode(shop, code);
  if (!d) return null;
  const r = await dropRecord(d.dropId);
  const rec = buildRecord(r.pieces, r.taps);
  return { d, rec, pay: payLines(r.pay, d.isSandbox), headline: recordHeadline(rec.totals, d.status, d.isSandbox), url: `${shareUrl(d, appUrl())}/record` };
});

type Params = { params: Promise<{ shop: string; drop: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { shop, drop } = await params;
  const r = await load(shop, drop).catch(() => undefined);
  if (!r) return { title: "Fairness record", robots: { index: false } };
  const title = `Fairness record · ${r.d.title} · ${r.d.shop.name} on Dibs`;
  return {
    metadataBase: new URL(appUrl()),
    title: { absolute: title },
    description: r.headline,
    alternates: { canonical: r.url },
    robots: r.d.isSandbox ? { index: false, follow: false } : undefined,
    openGraph: { title, description: r.headline, url: r.url, type: "website", siteName: "Dibs" },
    twitter: { card: "summary_large_image", title, description: r.headline },
  };
}

export default async function RecordPage({ params }: Params) {
  const { shop, drop } = await params;
  const room = `/s/${shop}/d/${drop}`;
  const r = await load(shop, drop).catch(() => undefined);
  if (r === null) notFound();
  return (
    <>
      <AppHeader right={<LinkButton href={room} variant="ghost" size="sm">Sale room</LinkButton>} />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        {!r ? (
          <>
            <h1 className="sr-only">Fairness record</h1>
            <EmptyState icon="warning" title="The record could not be loaded"
              body="Nothing is being hidden: the server could not reach the database just now. Try again in a minute."
              action={<LinkButton href={`${room}/record`} variant="ghost">Try again</LinkButton>} />
          </>
        ) : (
          <>
            <p className="font-hand text-xl text-muted">{r.d.shop.name} · {r.d.title}</p>
            <h1 className="mt-2 text-[2.6rem] leading-[0.98] sm:text-6xl">Fairness <Highlight>record</Highlight></h1>
            {r.d.isSandbox && (
              <Banner className="mt-5 rounded-wobble border-2">This is a demo room. The buyers marked 🤖 are demo bots, and no real money moved.</Banner>
            )}
            <p className="mt-5 text-lg">
              Every tap on this drop, in the order the server committed it, including taps turned away because the waitlist was
              full. Times are the server&apos;s commit times, counted from when the piece went live; the database, not a phone or
              a chat message, decided the order.
            </p>
            <p className="mt-4 font-mono text-lg font-bold" data-testid="record-totals">{totalsLine(r.rec.totals)}</p>
            {r.pay.map((l) => <p key={l} className="mt-1">{l}</p>)}
            {r.d.status !== "ended" && (
              <p className="mt-4 flex flex-wrap items-center gap-3">
                <span>{r.d.status === "live" ? "This drop is still live: this is what has happened so far." : "This drop has not started yet."}</span>
                <LinkButton href={`${room}/record`} variant="ghost" size="sm">Refresh</LinkButton>
              </p>
            )}
            <LinkButton className="mt-5" variant="ghost" icon="share" target="_blank" rel="noopener noreferrer"
              href={`https://wa.me/?text=${encodeURIComponent(`Fairness record for ${r.d.title} (${r.d.shop.name}). ${r.headline}. ${r.url}`)}`}>
              Share on WhatsApp
            </LinkButton>

            <div className="mt-8 flex flex-col gap-5">
              {r.rec.pieces.map((p) => (
                <Card as="section" flat key={p.position} aria-labelledby={`piece-${p.position}`} className="flex flex-col gap-3">
                  <div>
                    <h2 id={`piece-${p.position}`} className="text-2xl">#{p.position} {p.title}</h2>
                    <p className="text-muted">{p.liveAt ? `Went live ${istTime(p.liveAt)}` : r.d.status === "ended" ? "Never went live" : "Not live yet"}</p>
                  </div>
                  {p.taps.length === 0 ? <p>No taps.</p> : (
                    <ol aria-label={`Taps on #${p.position}, in server order`} className="flex flex-col gap-2" data-testid="record-taps">
                      {p.taps.map((t, i) => (
                        <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-wobble border-2 border-ink bg-card px-3 py-2">
                          <span className="font-mono font-bold">{i + 1}.</span>
                          <span className="min-w-0 break-words font-semibold">{t.name}</span>
                          {t.isBot && <span className="shrink-0 rounded-pill border-2 border-violet-ink bg-violet px-1.5 text-sm font-semibold text-violet-ink">🤖 Demo buyer</span>}
                          {t.variant && <span className="text-muted">{t.variant}</span>}
                          {t.time && <span className="ml-auto whitespace-nowrap font-mono">{t.time}<span className="sr-only"> after it went live</span></span>}
                          <span className="basis-full text-[0.95rem]">{t.steps.join(" → ")}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>
              ))}
            </div>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
