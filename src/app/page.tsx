import Link from "next/link";
import { ForSellers } from "@/components/info/ForSellers";
import {
  AppHeader, Arrow, Avatar, Button, Card, Chip, Footer, Highlight, Icon, LinkButton, PhoneFrame,
  PhotoCarousel, Price, Scribble, Squiggle, Stamp, StatePill, Ticker, type IconName, type StampWord, type TickerCard,
} from "@/components/ui";

// Sample content for the phone mock. Fictional, and labelled as an example on the page.
const sold: TickerCard = { t: "DB:Sold", v: 1, itemId: "x", variant: "silver", variantLabel: "Silver", buyer: "Priya Sharma", isBot: false, ms: 412, left: 0 };
const back: TickerCard = { t: "DB:Back", v: 2, itemId: "x", variant: "gold", variantLabel: "Gold", buyer: "Rohan Singh", isBot: false, reason: "expired" };

function SaleRoomMock() {
  return (
    <div aria-hidden="true" inert className="flex flex-col gap-3 px-3 pb-6">
      <div className="flex items-center gap-2">
        <Avatar name="Sample Shop" size={34} />
        <span className="min-w-0 flex-1 truncate font-extrabold">Sample Shop</span>
        <StatePill state="live" size="sm" />
      </div>
      <Card className="flex flex-col gap-3 p-3" flat>
        <PhotoCarousel photos={["/demo/jhumka-earrings.svg", "/demo/jhumka-earrings-2.svg"]} alt="Jhumka earrings" />
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-extrabold leading-tight"><span className="font-mono text-muted">#3</span> Jhumka earrings</p>
          <Price paise={145000} size="md" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip label="Gold" left={2} selected className="min-h-10 px-2.5 text-sm" />
          <Chip label="Silver" left={0} className="min-h-10 px-2.5 text-sm" />
        </div>
        <div className="relative">
          <Button variant="dibs" icon="tap" className="demo-press">Dibs!</Button>
          <span className="demo-finger pointer-events-none absolute right-6 top-3 text-ink">
            <svg width="40" height="44" viewBox="0 0 24 26" fill="var(--color-card)" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.6 13.6V5.2c0-1.1.7-1.8 1.6-1.8s1.6.7 1.6 1.8v6.4l4.6.9c1.4.3 2.2 1.4 2 2.8l-.7 5.6H10l-4-4.4c-.7-.8-.6-1.9.2-2.5.8-.5 1.7-.4 2.4.3l1 1.3Z" />
            </svg>
          </span>
        </div>
      </Card>
      <div className="demo-win relative flex items-center gap-2 rounded-wobble border-[2.5px] border-ink bg-lime px-3 py-2.5 shadow-ink-sm">
        <Icon name="check" size={22} stroke={3} />
        <p className="flex-1 font-extrabold leading-tight">You got it! Pay within <span className="font-mono">10:00</span></p>
        <Stamp word="YOURS" size="sm" tilt={8} className="absolute -top-5 right-3" />
      </div>
      <Ticker lines={[{ id: "a", card: sold }, { id: "b", card: back }]} />
    </div>
  );
}

const STEPS: { icon: IconName; title: string; note: string; stamp?: StampWord }[] = [
  { icon: "bag", title: "Drop", note: "The seller puts one piece live." },
  { icon: "tap", title: "Tap Dibs!", note: "Buyers tap. One button, no typing." },
  { icon: "check", title: "Sold in 0.4 s", note: "The server picks the first tap. Everyone sees it.", stamp: "SOLD" },
  { icon: "queue", title: "Waitlist", note: "Late taps line up in order." },
  { icon: "chat", title: "Order chat", note: "The winner gets a private chat with the team." },
  { icon: "rupee", title: "Paid", note: "UPI from the order card, checked by staff.", stamp: "PAID" },
  { icon: "truck", title: "Shipped", note: "Status updates land in the same chat.", stamp: "SHIPPED" },
];

const BUBBLES: { text: string; cls: string; tint: string }[] = [
  { text: "booked!!", cls: "left-[4%] top-[14%] -rotate-6", tint: "bg-card" },
  { text: "BOOKED 🙏", cls: "right-[6%] top-[11%] rotate-3", tint: "bg-mint" },
  { text: "me first!!", cls: "left-[28%] top-[30%] rotate-2", tint: "bg-card" },
  { text: "is the M still there?", cls: "left-[2%] top-[48%] -rotate-2", tint: "bg-sky" },
  { text: "sent ss, check DM", cls: "right-[3%] top-[42%] rotate-6", tint: "bg-card" },
  { text: "who was first??", cls: "left-[10%] top-[68%] rotate-3", tint: "bg-yellow" },
  { text: "sorry, sold 😕", cls: "right-[6%] top-[82%] -rotate-3", tint: "bg-card" },
];

const FEATURES: { icon: IconName; title: string; body: string; tint: string }[] = [
  { icon: "tap", tint: "bg-lime", title: "Fair first tap, decided by the server", body: "Every tap goes to one database transaction. The first one wins the piece, and the whole room sees who got it at the same moment." },
  { icon: "queue", tint: "bg-yellow", title: "Automatic waitlist promotion", body: "Late taps join a waitlist in order. If the winner doesn't pay in time, the piece moves to the next buyer, who is told straight away." },
  { icon: "chat", tint: "bg-sky", title: "One order chat per winner", body: "Each winner gets a private order room with the seller's team: the piece, a UPI pay card, read receipts and status from Held to Shipped." },
];

export default function Home() {
  return (
    <>
      <AppHeader right={<LinkButton href="/seller" variant="ghost" size="sm">I&apos;m a seller</LinkButton>} />
      <main id="main" className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-12 pt-8 lg:grid-cols-[1.1fr_1fr] lg:pt-12">
          <div className="lg:pt-20">
            <p className="font-hand text-xl leading-snug text-muted">For sellers who drop jewellery and fashion on WhatsApp and Instagram</p>
            <h1 className="mt-3 text-[2.9rem] leading-[0.95] sm:text-7xl">
              <Highlight>First tap</Highlight> wins.
            </h1>
            <p className="mt-4 max-w-md text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
              Everyone sees it. Nobody gets lost in the DMs.
            </p>
            <Squiggle className="mt-4 w-40 text-pink" />
            <p className="mt-5 max-w-lg text-lg">
              Dibs is a live sale room. You drop one piece at a time, buyers tap <strong>Dibs!</strong>, the server decides who was first,
              and late buyers join a waitlist instead of your DMs.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <LinkButton href="/try" variant="primary" size="lg" icon="tap">Try the live demo</LinkButton>
              <LinkButton href="/seller" variant="ghost" size="lg">I&apos;m a seller</LinkButton>
            </div>
            <p className="mt-4 max-w-lg text-[0.95rem]">
              <strong>Runs live on <span className="rounded bg-lime px-1">Nexconn</span>:</strong> open-channel sale room, private group-channel order chats, system-channel alerts.{" "}
              <Link href="/how-it-works" className="whitespace-nowrap font-bold underline decoration-2 hover:decoration-lime">How it works →</Link>
            </p>
            <p className="mt-2 flex items-center gap-2 text-[0.95rem] text-muted">
              <Icon name="robot" size={18} className="text-violet-ink" />
              The demo fills a sandbox room with labelled 🤖 demo buyers. No real money.
            </p>
          </div>
          <div className="relative">
            <Arrow className="absolute -left-16 top-[42%] hidden rotate-6 text-ink lg:block" />
            <PhoneFrame label="Example: a sample shop, not a real sale" height={780}>
              <SaleRoomMock />
            </PhoneFrame>
          </div>
        </section>

        {/* How a drop works */}
        <section aria-labelledby="how" className="border-y-[2.5px] border-ink bg-card/70">
          <div className="mx-auto max-w-6xl px-4 py-12">
            <h2 id="how" className="text-3xl sm:text-4xl">How a drop works</h2>
            <p className="mt-2 font-hand text-xl text-muted">One piece at a time, start to finish in the same room.</p>
            <ol className="play-on-view mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-7 lg:gap-2">
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative">
                  <Card flat alt={i % 2 === 1} className="flex h-full items-start gap-3 p-3 lg:flex-col lg:items-center lg:gap-2 lg:px-2 lg:py-4 lg:text-center">
                    <span className="relative grid size-12 shrink-0 place-items-center rounded-blob border-[2.5px] border-ink bg-paper">
                      <Icon name={s.icon} size={26} stroke={2.4} draw />
                      <span className="absolute -left-2 -top-2 grid size-6 place-items-center rounded-full border-2 border-ink bg-lime font-mono text-xs font-bold">{i + 1}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block font-extrabold leading-tight">{s.title}</span>
                      <span className="mt-0.5 block text-[0.95rem] leading-snug text-muted">{s.note}</span>
                    </span>
                    {s.stamp && <Stamp word={s.stamp} size="sm" tilt={i % 2 ? 7 : -7} className="absolute -top-3 right-2 lg:static lg:mt-1" />}
                  </Card>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* The problem */}
        <section aria-labelledby="problem" className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 lg:grid-cols-2">
          <div className="relative h-96 overflow-hidden rounded-wobble-2 border-[2.5px] border-ink bg-mint/40 shadow-ink" aria-hidden="true">
            <span className="absolute left-3 top-2 font-hand text-lg text-muted">Shop group · today</span>
            {BUBBLES.map((b) => (
              <span key={b.text} className={`absolute max-w-[60%] rounded-wobble border-2 border-ink px-3 py-1.5 font-hand text-xl leading-tight shadow-ink-sm ${b.cls} ${b.tint}`}>{b.text}</span>
            ))}
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
              <path d="M18 18 C40 30, 60 20, 80 58 M80 14 C60 36, 30 50, 24 80 M50 30 C52 50, 70 70, 60 88" fill="none" stroke="var(--color-pink)" strokeWidth={3} strokeLinecap="round" vectorEffect="non-scaling-stroke" strokeDasharray="6 5" />
            </svg>
          </div>
          <div>
            <h2 id="problem" className="text-3xl sm:text-4xl">Selling in a group chat is a <span className="relative inline-block">scramble<Scribble className="absolute -bottom-2 left-0 h-3 w-full text-pink" /></span>.</h2>
            <ul className="mt-6 flex flex-col gap-4 text-lg">
              {[
                "A crowd types “booked!!” at once, and the seller scrolls up to guess who was first.",
                "Payment screenshots and addresses get buried in a pile of DMs.",
                "When a winner drops out, the next buyer never hears about it, and the piece sits unsold.",
              ].map((t) => (
                <li key={t} className="flex items-start gap-3">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-blob border-2 border-ink bg-pink-soft text-pink-ink"><Icon name="cross" size={16} stroke={3} /></span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 font-hand text-2xl">Dibs gives every drop one fair room instead.</p>
          </div>
        </section>

        {/* Features */}
        <section aria-labelledby="features" className="mx-auto max-w-6xl px-4 pb-8">
          <h2 id="features" className="text-3xl sm:text-4xl">What makes it <Highlight>fair</Highlight></h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Card key={f.title} as="article" draw alt={i === 1} className="p-5">
                <span className={`grid size-14 place-items-center rounded-blob border-[2.5px] border-ink ${f.tint}`}><Icon name={f.icon} size={28} stroke={2.4} draw /></span>
                <h3 className="mt-4 text-xl">{f.title}</h3>
                <p className="mt-2 text-muted">{f.body}</p>
              </Card>
            ))}
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Card flat tint="peach" className="flex items-start gap-3">
              <Icon name="shield" size={30} stroke={2.4} className="mt-0.5 text-peach-ink" />
              <div>
                <h3 className="text-lg">Scam shield</h3>
                <p className="mt-1">Phone numbers and UPI IDs can&apos;t be posted in the sale room. Buyers pay only from their order card.</p>
              </div>
            </Card>
            <Card flat alt tint="sky" className="flex items-start gap-3">
              <Icon name="users" size={30} stroke={2.4} className="mt-0.5 text-sky-ink" />
              <div>
                <h3 className="text-lg">Team desk</h3>
                <p className="mt-1">Orders are shared across the seller&apos;s staff, big ones go to the owner, and everyone works from one feed.</p>
              </div>
            </Card>
          </div>
        </section>

        {/* For sellers */}
        <section aria-labelledby="sellers" className="mx-auto max-w-6xl px-4 pt-10">
          <ForSellers />
        </section>

        {/* Built on Nexconn */}
        <section className="mx-auto max-w-6xl px-4 pt-10">
          <Link href="/how-it-works" className="group flex flex-col gap-4 rounded-wobble border-[2.5px] border-ink bg-ink p-6 text-paper no-underline shadow-ink sm:flex-row sm:items-center">
            <span className="grid size-14 shrink-0 place-items-center rounded-blob border-[2.5px] border-lime text-lime"><Icon name="live" size={30} stroke={2.4} /></span>
            <span className="flex-1">
              <span className="block text-2xl font-extrabold tracking-tight">Built on <span className="text-lime">Nexconn</span></span>
              <span className="mt-1 block text-paper/85">Every live part of Dibs runs on Nexconn: the open sale room, private order chats with read receipts, personal alerts and the team desk.</span>
            </span>
            <span className="inline-flex min-h-12 items-center gap-2 font-hand text-xl text-lime group-hover:underline">How it works <Icon name="arrowRight" size={22} /></span>
          </Link>
        </section>
      </main>
      <Footer />
    </>
  );
}
