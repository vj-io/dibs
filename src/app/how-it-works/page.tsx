import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader, Badge, Card, Footer, Highlight, Icon, LinkButton, Squiggle, type IconName } from "@/components/ui";
import { FeatureMap } from "@/components/info/feature-map";
import { TapDiagram } from "@/components/info/tap-diagram";
import { publicConfig } from "@/lib/server/flags";

export const metadata: Metadata = {
  title: "How it works",
  description: "What happens when you tap Dibs, why first means first, and every Nexconn feature Dibs uses with its live status.",
};
// Flags and the transport are read per request so the feature map shows what this deployment is doing right now.
export const dynamic = "force-dynamic";

const REPO = "https://github.com/vj-io/dibs";
const TEST = `${REPO}/blob/main/tests/db/concurrency.test.ts`;

const STEPS = [
  "You tap Dibs! The browser sends one request to our API.",
  "The API route asks the database to claim the piece for you. It decides nothing itself.",
  "Inside one Postgres transaction the stock row is locked. Whoever gets the lock first wins; the rest join the waitlist in order. The claim and an outbox row are written together.",
  "Right after the commit the outbox sends a card. If sending fails it is retried; the sale does not change.",
  "The card goes into the Nexconn open channel for this drop, sent by dibs_bot.",
  "Every browser in the room gets the card and shows SOLD, with the time the claim took.",
];

const MEASURED: { what: string; value: string; note: string }[] = [
  { what: "Server send to browser receive, custom card", value: "median 436 ms", note: "n=20, min 377 ms, max 2093 ms" },
  { what: "Same, as a plain-text envelope", value: "median 441 ms", note: "n=20, min 389 ms, max 991 ms" },
  { what: "Open channel: create, then enter", value: "173 ms, 204-218 ms", note: "single runs, count not recorded" },
  { what: "Reconnect after 40 s offline", value: "about 5.5 s after the network came back", note: "single run; the room was re-entered by itself, no duplicates" },
];

const NOT_VERIFIED = [
  "The pre-message callback is not available on our Nexconn plan (the option is greyed out in the Console), so a message sent around the app is removed after delivery. The app itself refuses a phone number or UPI id before sending.",
  "The Call SDK has not been tested.",
  "Participant joined and banned events never fired in our runs, so the viewer count is read from the server instead.",
  "Latency from phones on 4G, more than two simultaneous clients, and behaviour at the plan's connection limit are not measured.",
  "A connected client can overwrite an open channel's metadata. Dibs treats metadata as a hint only.",
];

function H2({ id, children, hand }: { id: string; children: React.ReactNode; hand?: string }) {
  return (
    <>
      <h2 id={id} className="text-3xl sm:text-4xl">{children}</h2>
      {hand && <p className="mt-2 font-hand text-xl text-muted">{hand}</p>}
    </>
  );
}

const AI_NEVER = ["decide who was first", "create or cancel claims", "confirm payments", "change prices", "speak for the seller beyond the shop's FAQ facts"];
const AI_JOBS: { icon: IconName; title: string; body: string }[] = [
  { icon: "tap", title: "Typed-claim helper", body: "Someone types \"booked\" or \"M wala chahiye\" in the room. Rules look for the claim words, the item number and the variant first; a model is asked only when the rules cannot decide. The buyer gets a private one-tap prompt. It never makes the claim." },
  { icon: "chat", title: "Answer bot", body: "Answers repeat questions (price, size, shipping) from the shop's FAQ lines and the live piece, as a labelled 🤖 assistant. If the answer is not in those facts it stays silent." },
  { icon: "chat", title: "Translate in the order chat", body: "Under a message from the other side, Translate shows it in English or Hindi (Hinglish counts as Hindi), labelled \"Translated by AI\". Only the person who tapped sees it; the message itself never changes." },
  { icon: "shield", title: "Scam shield", body: "Rules first, no model: a phone number, a UPI id or a payment link from anyone but staff is blocked or removed. A model reviews only borderline text after delivery. It can only flag a message for staff or remove it." },
];

export default function HowItWorks() {
  const cfg = publicConfig();
  const live = cfg.mode === "nexconn";
  return (
    <>
      <AppHeader right={<LinkButton href="/try" variant="primary" size="sm" icon="tap">Try the demo</LinkButton>} />
      <main id="main" className="flex-1">
        <section className="mx-auto max-w-6xl px-4 pb-6 pt-8">
          <p className="font-hand text-xl text-muted">For the judges and the curious</p>
          <h1 className="mt-2 text-[2.6rem] leading-[0.98] sm:text-6xl">How <Highlight>Dibs</Highlight> works</h1>
          <p className="mt-4 max-w-2xl text-xl">
            The database decides who was first. Nexconn tells the room. Below: the path of one tap, why it is fair, and every Nexconn feature we use,
            with its status on this deployment right now.
          </p>
          <Card flat tint="lime" className="mt-5 max-w-3xl p-4">
            <p className="font-extrabold">Nexconn in one look</p>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              <li><strong>Open channel:</strong> the live sale room.</li>
              <li><strong>Group channels:</strong> private order chats, plus the team desk.</li>
              <li><strong>System channel:</strong> personal alerts (promoted, paid, shipped).</li>
              <li><strong>Community channel:</strong> the shop club.</li>
              <li><strong>Webhook and message delete:</strong> typed-claim helper, scam shield.</li>
              <li><strong>Custom <code>DB:*</code> cards from <code>dibs_bot</code>:</strong> sold, stock, pay, status.</li>
            </ul>
            <a href="#features" className="mt-2 inline-flex min-h-12 items-center gap-1.5 font-bold underline decoration-2 hover:decoration-pink">
              Jump to the full feature map with live status <Icon name="arrowRight" size={18} />
            </a>
          </Card>
          <nav aria-label="On this page" className="mt-4 flex flex-wrap gap-x-1">
            {[["tap", "One tap"], ["fair", "Why it's fair"], ["features", "Nexconn features"], ["transport", "Transport now"], ["bots", "Demo bots"], ["ai", "AI"]].map(([id, t]) => (
              <a key={id} href={`#${id}`} className="inline-flex min-h-12 items-center px-2 font-semibold underline decoration-2 hover:decoration-lime">{t}</a>
            ))}
          </nav>
        </section>

        {/* 1: the tap */}
        <section aria-labelledby="tap" className="border-y-[2.5px] border-ink bg-card/70">
          <div className="mx-auto grid max-w-6xl items-start gap-8 px-4 py-12 lg:grid-cols-[minmax(0,380px)_1fr]">
            <TapDiagram />
            <div>
              <H2 id="tap" hand="Six steps, top to bottom.">What happens when you tap Dibs</H2>
              <ol className="mt-5 flex flex-col gap-3">
                {STEPS.map((t, i) => (
                  <li key={t} className="flex items-start gap-3">
                    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full border-2 border-ink bg-lime font-mono text-sm font-bold">{i + 1}</span>
                    <span className="pt-0.5">{t}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <Card flat tint="mint" className="font-extrabold"><Icon name="lock" size={22} stroke={2.4} className="mb-1 text-mint-ink" />The database decides.</Card>
                <Card flat alt tint="sky" className="font-extrabold"><Icon name="live" size={22} stroke={2.4} className="mb-1 text-sky-ink" />Nexconn delivers.</Card>
                <Card flat tint="peach" className="font-extrabold"><Icon name="shield" size={22} stroke={2.4} className="mb-1 text-peach-ink" />A failed message never undoes a sale.</Card>
              </div>
            </div>
          </div>
        </section>

        {/* 2: fair */}
        <section aria-labelledby="fair" className="mx-auto max-w-6xl px-4 py-12">
          <H2 id="fair" hand="First means first committed.">Why it&apos;s fair</H2>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <ul className="flex flex-col gap-4 text-lg">
              <li className="flex items-start gap-3"><Icon name="lock" size={26} stroke={2.4} className="mt-0.5 shrink-0" /><span><strong>One transaction.</strong> Every tap runs the same database function. It locks the drop and the piece&apos;s stock row, so taps are handled one at a time in the order they got the lock.</span></li>
              <li className="flex items-start gap-3"><Icon name="clock" size={26} stroke={2.4} className="mt-0.5 shrink-0" /><span><strong>The time you see is the database&apos;s.</strong> It is the moment the database accepted the claim minus the moment the piece went live. Your phone&apos;s clock and network speed are not in it.</span></li>
              <li className="flex items-start gap-3"><Icon name="queue" size={26} stroke={2.4} className="mt-0.5 shrink-0" /><span><strong>Late taps wait in order.</strong> If a winner does not pay in time, the next in line is promoted and told.</span></li>
              <li className="flex items-start gap-3"><Icon name="robot" size={26} stroke={2.4} className="mt-0.5 shrink-0" /><span><strong>No AI in the decision.</strong> Models never choose who was first.</span></li>
              <li className="flex items-start gap-3"><Icon name="eye" size={26} stroke={2.4} className="mt-0.5 shrink-0" /><span><strong>Every drop publishes its record.</strong> A public fairness record lists every tap in the order the database committed it: time after the piece went live, who won, who waited, whose hold lapsed and who got the piece next. Names only, never phone numbers. <Link href="/s/kundnvi/d/HL89WL/record" className="font-semibold underline decoration-2">See the first real drop&apos;s record</Link>.</span></li>
            </ul>
            <Card draw tint="yellow" className="p-5">
              <Badge tint="card" icon="warning" size="sm">Test result on synthetic taps</Badge>
              <h3 className="mt-3 text-xl">The concurrency test</h3>
              <p className="mt-2">
                The test fires 300 simultaneous taps at a piece with 2 units, against a real Postgres. It checks for exactly 2 winners, 20 people waitlisted in the order their taps committed,
                the other 278 told the waitlist is full, and the stock adding up with no unit sold twice. Other tests in the same file race taps against closing a piece, run many sweeps at once, and stress random claims and releases.
              </p>
              <p className="mt-2 text-[0.95rem]">These are synthetic taps, not real buyers. The page does not claim a run date or a speed.</p>
              <a href={TEST} className="mt-3 inline-flex min-h-12 items-center gap-1.5 font-bold underline decoration-2 hover:decoration-pink">
                Read tests/db/concurrency.test.ts on GitHub <Icon name="arrowRight" size={18} />
              </a>
            </Card>
          </div>
        </section>

        {/* 3: feature map */}
        <section aria-labelledby="features" className="border-y-[2.5px] border-ink bg-card/70">
          <div className="mx-auto max-w-6xl px-4 py-12">
            <H2 id="features" hand="Each one has a job you can see in the demo.">The Nexconn feature map</H2>
            <p className="mt-3 max-w-3xl">
              Status is read from this server when the page loads. <strong>On</strong>: Dibs is using the real Nexconn feature on this deployment. <strong>Fallback in use</strong>: a substitute is running instead. <strong>Off</strong>: the feature is switched off.
              A status says what the code is doing, not that Nexconn Console settings are in place; the Evidence line says what we have actually seen working.
            </p>
            <FeatureMap mode={cfg.mode} features={cfg.features} />

            <h3 className="mt-12 text-2xl">Measured in our proof of concept</h3>
            <p className="mt-1 text-muted">19 Nov 2026, Nexconn Singapore data centre, from a Mac in India, Nexconn SDK 26.2.1. A proof of concept, not a load test.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {MEASURED.map((m) => (
                <Card key={m.what} flat tint="paper">
                  <p className="font-semibold">{m.what}</p>
                  <p className="mt-1 font-mono text-xl font-bold">{m.value}</p>
                  <p className="text-[0.95rem] text-muted">{m.note}</p>
                </Card>
              ))}
            </div>

            <h3 className="mt-12 text-2xl">Not verified yet</h3>
            <ul className="mt-3 flex max-w-3xl flex-col gap-2">
              {NOT_VERIFIED.map((t) => (
                <li key={t} className="flex items-start gap-2"><Icon name="warning" size={20} stroke={2.4} className="mt-1 shrink-0 text-peach-ink" /><span>{t}</span></li>
              ))}
            </ul>
          </div>
        </section>

        {/* transport */}
        <section aria-labelledby="transport" className="mx-auto max-w-6xl px-4 py-12">
          <H2 id="transport">Realtime transport right now</H2>
          <Card flat tint={live ? "mint" : "yellow"} className="mt-5 max-w-3xl">
            <p className="flex flex-wrap items-center gap-2 text-xl font-extrabold">
              <Icon name={live ? "check" : "warning"} size={24} stroke={2.6} className={live ? "text-mint-ink" : "text-yellow-ink"} />
              <span>This deployment is using: <span className="font-mono">{cfg.mode}</span></span>
            </p>
            <p className="mt-2">
              {live
                ? "Sale rooms, order chats and alerts are live Nexconn channels."
                : "Mock mode: an in-process bus stands in for Nexconn, so no Nexconn channel is involved. This is for local development; the feature map above shows Fallback in use for that reason."}
            </p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[0.95rem]">
              <dt className="font-semibold">Nexconn App Key</dt>
              <dd className="break-all font-mono">{cfg.appKey || "none in mock mode"}</dd>
              <dt className="font-semibold">Data centre</dt><dd className="font-mono">{cfg.area}</dd>
              <dt className="font-semibold">Card format</dt><dd>{cfg.textEnvelope ? "plain-text envelope" : "custom message types"}</dd>
            </dl>
            <p className="mt-2 text-[0.95rem] text-muted">The App Key is public by design: it is how a browser says which app it belongs to. Access to a user still needs a token our server issues.</p>
          </Card>
        </section>

        {/* bots */}
        <section aria-labelledby="bots" className="border-y-[2.5px] border-ink bg-violet/40">
          <div className="mx-auto max-w-6xl px-4 py-12">
            <H2 id="bots" hand="They fill the demo room. They are not real buyers.">Demo bots</H2>
            <ul className="mt-5 grid max-w-4xl gap-3 sm:grid-cols-2">
              {[
                "Bots exist only in the demo room, never in a real shop's drop.",
                "Every bot is labelled 🤖 wherever it appears.",
                "Their taps are scripted: Demo bots tap at set delays; the claim logic is the same as a real drop. They call the same claim function and queue like anyone else.",
                "In the buyer demo, bots never pay. A bot's hold runs out after 6 s, which is how you see a waitlist promotion; you get 90 s to pay. In the seller demo, a few bots tap I've paid with a demo UTR so you have orders to confirm.",
                "Bots are excluded from every real number, including the impact page.",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2"><Icon name="robot" size={22} stroke={2.4} className="mt-0.5 shrink-0 text-violet-ink" /><span>{t}</span></li>
              ))}
            </ul>
          </div>
        </section>

        {/* AI */}
        <section aria-labelledby="ai" className="mx-auto max-w-6xl px-4 py-12">
          <H2 id="ai" hand="Four small helpers. None can touch a sale.">What AI does and never does</H2>
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {AI_JOBS.map((j, i) => (
              <Card key={j.title} as="article" flat alt={i === 1}>
                <Icon name={j.icon} size={26} stroke={2.4} />
                <h3 className="mt-2 text-lg">{j.title}</h3>
                <p className="mt-1">{j.body}</p>
              </Card>
            ))}
          </div>
          <Card tint="pink" flat className="mt-4 max-w-3xl">
            <h3 className="flex items-center gap-2 text-lg"><Icon name="cross" size={22} stroke={3} className="text-pink-ink" /> AI never will</h3>
            <ul className="mt-2 list-disc pl-6">{AI_NEVER.map((t) => <li key={t}>{t}</li>)}</ul>
            <p className="mt-2 text-[0.95rem]">If a model fails, the app carries on without it. Names and phone numbers are never sent to a model.</p>
          </Card>
        </section>

        {/* links */}
        <section aria-label="Next" className="mx-auto max-w-6xl px-4 pb-8">
          <Squiggle className="mb-5 w-40 text-pink" />
          <div className="flex flex-col gap-3 sm:flex-row">
            <LinkButton href="/try" variant="primary" size="lg" icon="tap">Try the demo</LinkButton>
            <LinkButton href="/impact" variant="ghost" size="lg">Impact</LinkButton>
            <LinkButton href={REPO} variant="ghost" size="lg">GitHub repo</LinkButton>
          </div>
          <p className="mt-4 text-muted"><Link href="/" className="underline decoration-2">Back to the start</Link></p>
        </section>
      </main>
      <Footer />
    </>
  );
}
