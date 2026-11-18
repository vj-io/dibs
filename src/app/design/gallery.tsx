"use client";
// Kit gallery for review: every component in every state on one page. Sample data only.
import { useState, type ReactNode } from "react";
import {
  AppHeader, Arrow, Avatar, Badge, Banner, BottomSheet, Burst, Button, Card, Chip, ConnectionBar, Countdown, EmptyState,
  Field, Footer, Highlight, Icon, ICON_NAMES, Input, LinkButton, Logo, PhoneFrame, PhotoCarousel, PILL, Price, QR,
  Scribble, Select, Sheet, Skeleton, Squiggle, Stamp, StatePill, Textarea, Ticker, Timeline, useToast,
  type PillState, type TickerCard, type Tint,
} from "@/components/ui";

const SWATCHES: { name: string; hex: string; ink?: [string, string] }[] = [
  { name: "paper", hex: "#f0ede8" }, { name: "card", hex: "#fbfaf7" }, { name: "ink", hex: "#0a0a0a" },
  { name: "muted", hex: "#5f5b55", ink: ["5.77", "6.46"] },
  { name: "lime", hex: "#c8ff00", ink: ["7.44", "8.32"] }, { name: "pink", hex: "#ff3d8b", ink: ["5.14", "5.75"] },
  { name: "yellow", hex: "#fff0a0", ink: ["5.47", "6.12"] }, { name: "sky", hex: "#cfe6fb", ink: ["5.97", "6.68"] },
  { name: "mint", hex: "#c8eed6", ink: ["5.66", "6.33"] }, { name: "peach", hex: "#ffd7bd", ink: ["5.75", "6.43"] },
  { name: "grey", hex: "#e2dfd8", ink: ["6.36", "7.12"] }, { name: "violet", hex: "#e6e0ff", ink: ["5.95", "6.66"] },
];
const TINTS: Tint[] = ["card", "paper", "lime", "pink", "yellow", "sky", "mint", "peach", "grey", "violet"];

const sold = (buyer: string, ms: number, isBot = false, label = "M"): TickerCard =>
  ({ t: "DB:Sold", v: 1, itemId: "i", variant: label, variantLabel: label, buyer, isBot, ms, left: 1 });
const back = (buyer: string | null): TickerCard =>
  ({ t: "DB:Back", v: 2, itemId: "i", variant: "M", variantLabel: "M", buyer, isBot: false, reason: "expired" });

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t-2 border-dashed border-ink/30 py-8">
      <h2 className="mb-5 font-hand text-3xl font-normal tracking-normal">{title}</h2>
      {children}
    </section>
  );
}
const Row = ({ children, className = "" }: { children: ReactNode; className?: string }) => <div className={`flex flex-wrap items-center gap-3 ${className}`}>{children}</div>;

export function Gallery() {
  const toast = useToast();
  const [base] = useState(() => Date.now());
  const iso = (sec: number) => new Date(base + sec * 1000).toISOString();
  const [chip, setChip] = useState("M");
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState([
    { id: "3", card: back("Rohan Singh") }, { id: "2", card: sold("Priya Sharma", 412) },
    { id: "1", card: sold("demo_bot_07", 388, true, "L") }, { id: "0", card: back(null) },
  ]);
  const names = ["Asha K.", "Meera P.", "Kabir J.", "Zoya R."];

  return (
    <>
      <AppHeader title="Design kit" live viewers="👀 sample" right={<Button size="sm" variant="ghost" icon="share">Share</Button>} />
      <ConnectionBar status="offline" />
      <Banner />
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 pt-6">
        <h1 className="text-4xl">Dibs <Highlight>design kit</Highlight></h1>
        <p className="mt-2 text-muted">Every component in every state. Sample data only. Not indexed.</p>

        <Section title="Colour tokens (text ratio on paper / card)">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {SWATCHES.map((s) => (
              <div key={s.name} className="overflow-hidden rounded-md border-2 border-ink bg-card">
                <div className="h-14 border-b-2 border-ink" style={{ background: s.hex }} />
                <div className="p-2 text-sm leading-snug">
                  <p className="font-semibold">{s.name} <span className="font-mono text-muted">{s.hex}</span></p>
                  {s.ink && <p className="font-semibold" style={{ color: `var(--color-${s.name === "muted" ? "muted" : `${s.name}-ink`})` }}>{s.name === "muted" ? "muted" : `${s.name}-ink`} {s.ink[0]} / {s.ink[1]}</p>}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Type">
          <p className="text-5xl font-extrabold tracking-tight">Archivo 800 — First tap wins.</p>
          <p className="mt-2 text-xl font-semibold">Archivo 600 — Everyone sees it.</p>
          <p className="mt-1">Archivo 400 body, 16 px — Nobody gets lost in the DMs.</p>
          <p className="mt-2 font-hand text-2xl">Patrick Hand — Sold to Priya S. · 0.4 s</p>
          <p className="mt-1 font-mono text-xl font-bold">JetBrains Mono — ₹1,450 · 09:41</p>
        </Section>

        <Section title="Logo and icons">
          <Row><Logo size="lg" /><Logo /><Logo size="sm" /></Row>
          <div className="mt-6 grid grid-cols-4 gap-3 sm:grid-cols-8">
            {ICON_NAMES.map((n) => (
              <div key={n} className="flex flex-col items-center gap-1 rounded-md border-2 border-ink/20 bg-card p-2 text-center">
                <Icon name={n} size={28} draw />
                <span className="w-full truncate font-mono text-xs text-muted">{n}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex max-w-md flex-col gap-4">
            <Button variant="dibs" icon="tap" busy={busy} onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 1200); }}>Dibs!</Button>
            <Button variant="dibs" icon="tap" busy>Dibs!</Button>
            <Button variant="dibs" icon="tap" disabledReason="Reconnecting…">Dibs!</Button>
            <Button variant="dibs" disabledReason="Loading the photo…">Dibs!</Button>
          </div>
          <Row className="mt-6">
            <Button variant="primary" icon="plus">Primary</Button>
            <Button variant="ghost" icon="copy">Ghost</Button>
            <Button variant="danger" icon="trash">Danger</Button>
            <Button variant="primary" disabled>Disabled</Button>
            <Button variant="ghost" disabledReason="Only the owner can">Ghost</Button>
          </Row>
          <Row className="mt-4">
            <Button size="sm">Small</Button><Button size="md">Medium</Button><Button size="lg">Large</Button>
            <LinkButton href="/try" variant="ghost" icon="arrowRight">Link button</LinkButton>
          </Row>
        </Section>

        <Section title="Cards and sheets">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {TINTS.map((t, i) => <Card key={t} tint={t} alt={i % 2 === 1}><p className="font-semibold">tint=&quot;{t}&quot;</p><p className="text-muted">Card body text.</p></Card>)}
            <Card draw><p className="font-semibold">draw</p><p className="text-muted">The frame draws itself on entrance.</p></Card>
            <Card flat><p className="font-semibold">flat</p><p className="text-muted">Smaller shadow for rows.</p></Card>
            <Sheet title="Sheet with tape"><p>A taped sheet for grouped content.</p></Sheet>
          </div>
        </Section>

        <Section title="Chips (variants with stock)">
          <Row>
            {[{ k: "S", left: 0, waiting: 3 }, { k: "M", left: 2 }, { k: "L", left: 1 }, { k: "XL", left: 6 }].map((v) => (
              <Chip key={v.k} label={v.k} left={v.left} waiting={v.waiting} selected={chip === v.k} onSelect={() => setChip(v.k)} />
            ))}
            <Chip label="Free size" />
            <Chip label="XXL" left={4} disabled />
          </Row>
        </Section>

        <Section title="State pills, badges and stamps">
          <Row>{(Object.keys(PILL) as PillState[]).map((s) => <StatePill key={s} state={s} />)}</Row>
          <Row className="mt-3">
            <StatePill state="waitlisted" label="#2 on the waitlist" />
            <StatePill state="live" size="sm" /><StatePill state="paid" size="sm" />
            <Badge tint="sky" icon="eye">Badge</Badge><Badge tint="peach" icon="warning">Expiring soon</Badge><Badge>Plain</Badge>
          </Row>
          <Row className="mt-8 gap-8">
            <Stamp word="SOLD" /><Stamp word="PAID" tilt={6} /><Stamp word="SHIPPED" tilt={-4} /><Stamp word="YOURS" tilt={10} />
            <Stamp word="SOLD" size="lg" /><Stamp word="PAID" size="sm" />
          </Row>
        </Section>

        <Section title="Countdown">
          <Row>
            <Countdown expiresAt={iso(600)} label="Pay within" />
            <Countdown expiresAt={iso(125)} />
            <Countdown expiresAt={iso(70)} size="lg" />
            <Countdown expiresAt={iso(600)} paused />
            <Countdown expiresAt={iso(-5)} size="sm" onDone={() => toast("Hold ran out (onDone)", { tone: "warn" })} />
          </Row>
        </Section>

        <Section title="Ticker">
          <div className="max-w-md">
            <Button size="sm" variant="ghost" icon="plus" onClick={() => setLines((l) => [{ id: String(Date.now()), card: sold(names[l.length % names.length], 300 + l.length * 37) }, ...l])}>Add a line</Button>
            <Ticker lines={lines} className="mt-3" />
          </div>
        </Section>

        <Section title="Toasts">
          <Row>
            <Button variant="ghost" onClick={() => toast("Link copied.")}>Info</Button>
            <Button variant="ghost" onClick={() => toast("You got it! Pay within 10:00", { tone: "good" })}>Good</Button>
            <Button variant="ghost" onClick={() => toast("Your hold on #3 ran out. It went to the next buyer.", { tone: "warn" })}>Warn</Button>
            <Button variant="ghost" onClick={() => toast("2 minutes left to pay.", { tone: "urgent" })}>Urgent</Button>
          </Row>
        </Section>

        <Section title="Fields">
          <div className="grid max-w-2xl gap-5 sm:grid-cols-2">
            <Field label="Your name" hint="Shown as “Priya S.” in the room"><Input placeholder="Priya Sharma" autoComplete="name" /></Field>
            <Field label="Phone" error="Enter 10 digits"><Input inputMode="numeric" defaultValue="98765" /></Field>
            <Field label="Variant"><Select defaultValue="M"><option>S</option><option>M</option><option>L</option></Select></Field>
            <Field label="Note to the seller" hint="Optional"><Textarea placeholder="Gift wrap please" /></Field>
          </div>
        </Section>

        <Section title="Timeline">
          <div className="grid gap-6 sm:grid-cols-3">
            <Card flat><Timeline state="held" /></Card>
            <Card flat><Timeline state="payment_claimed" /></Card>
            <Card flat><Timeline state="paid" /></Card>
            <Card flat><Timeline state="shipped" /></Card>
            <Card flat><Timeline state="payment_claimed" failed failedLabel="Payment not received" /></Card>
            <Card flat><Timeline state="cancelled" /></Card>
          </div>
        </Section>

        <Section title="Highlight and doodles">
          <p className="text-3xl font-extrabold">The <Highlight>first tap</Highlight> wins, <Highlight color="pink" delay={0.6}>urgently</Highlight>.</p>
          <Row className="mt-4 gap-6">
            <Squiggle className="w-40 text-pink" /><Arrow /><Scribble className="h-10 w-32 text-pink" />
            <div className="relative grid size-32 place-items-center"><Burst className="absolute inset-0" /><span className="font-extrabold">Won!</span></div>
          </Row>
        </Section>

        <Section title="Avatars, price, banner, connection">
          <Row>
            <Avatar name="Priya Sharma" /><Avatar name="Rohan" size={48} /><Avatar name="Zoya" /><Avatar name="demo_bot_07" bot />
            <Price paise={145000} size="sm" /><Price paise={145000} /><Price paise={1299950} size="lg" /><Price paise={89900} size="xl" />
          </Row>
          <div className="mt-4 flex flex-col gap-2">
            <Banner /><ConnectionBar status="connecting" /><ConnectionBar status="offline" />
            <p className="text-sm text-muted">ConnectionBar status=&quot;connected&quot; renders nothing.</p>
          </div>
        </Section>

        <Section title="Empty state and skeleton">
          <div className="grid gap-6 sm:grid-cols-2">
            <EmptyState title="No orders yet" body="When someone wins a piece, their order shows up here." action={<LinkButton href="/try" size="sm">Try the demo</LinkButton>} />
            <div className="flex flex-col gap-3"><Skeleton className="aspect-[4/5] w-40" /><Skeleton className="h-6 w-3/4" /><Skeleton className="h-6 w-1/2" /></div>
          </div>
        </Section>

        <Section title="Photos, QR, phone frame">
          <div className="grid gap-8 md:grid-cols-3">
            <PhotoCarousel photos={["/demo/kundan-choker.svg", "/demo/kundan-choker-2.svg", "/demo/stone-ring.svg"]} alt="Kundan choker">
              <Stamp word="SOLD" size="lg" className="absolute left-4 top-6" />
            </PhotoCarousel>
            <div className="flex flex-col gap-4">
              <PhotoCarousel photos={["/demo/bangle-set.svg"]} alt="Bangle set" className="w-40" />
              <PhotoCarousel photos={[]} alt="Nothing" className="w-40" />
            </div>
            <div className="flex flex-col items-start gap-3">
              <QR value="upi://pay?pa=sample@upi&pn=Sample%20Shop&am=1450.00&cu=INR" label="Sample UPI QR code" />
              <p className="font-mono text-sm text-muted">sample@upi</p>
            </div>
          </div>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <PhoneFrame label="PhoneFrame (sample content)" height={360}>
              <div className="flex flex-col gap-3 px-3">
                <StatePill state="live" />
                <PhotoCarousel photos={["/demo/silver-anklet.svg", "/demo/pendant-chain.svg"]} alt="Silver anklet" />
                <Button variant="dibs" icon="tap">Dibs!</Button>
              </div>
            </PhoneFrame>
            <div className="flex flex-col gap-3">
              <Button variant="primary" icon="users" onClick={() => setSheet(true)}>Open the join sheet</Button>
              <p className="text-muted">BottomSheet: native modal dialog, Esc closes, focus stays inside.</p>
            </div>
          </div>
        </Section>
      </main>
      <Footer />

      <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Join the sale room">
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setSheet(false); toast("Joined (sample).", { tone: "good" }); }}>
          <Field label="Your name"><Input autoComplete="name" required /></Field>
          <Field label="Phone" hint="10 digits. Only the shop's team sees it."><Input inputMode="numeric" pattern="[0-9]{10}" required /></Field>
          <p className="text-[0.95rem] text-muted">By joining you agree that the shop can message you about pieces you claim.</p>
          <Button type="submit" variant="primary" size="lg">Join</Button>
        </form>
      </BottomSheet>
    </>
  );
}
