"use client";
/* eslint-disable @next/next/no-img-element -- product thumbnails */
// /seller/start: first run after creating a shop. 1 payment details (with the card buyers will see and a ₹1 QR to
// check the name), 2 first pieces (the catalog editor, or 3 sample pieces), 3 first drop -> the share kit. Each step
// can be skipped.
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, cx, Field, Icon, Input, LinkButton, Price, QR, Sheet, Skeleton, useToast } from "@/components/ui";
import { api } from "@/lib/client/api";
import { rupees } from "@/lib/codec";
import { isUpiId } from "@/lib/upi";
import type { Product, ShopSettings } from "@/lib/types";
import { errMsg, useMe } from "./kit";
import { Products } from "./Products";
import { ShareKit } from "./ShareKit";

const STEPS = ["Payment details", "First pieces", "First drop"];
const SAMPLE = "Sample: ";

export function StartWizard() {
  const me = useMe();
  const [step, setStep] = useState(0);
  const [shop, setShop] = useState<ShopSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api("GET /api/shops/:id", undefined, { id: me.shop.id }).then(setShop, (e) => setErr(errMsg(e))); }, [me.shop.id]);
  const next = () => { setStep((s) => Math.min(s + 1, STEPS.length - 1)); scrollTo({ top: 0 }); };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-3xl">Get your first drop ready</h1>
        <p className="mt-1 text-muted">Three short steps. Skip any of them and come back later from the menu.</p>
      </div>
      <nav aria-label="Setup steps">
        <ol className="grid grid-cols-3 gap-2">
          {STEPS.map((label, i) => (
            <li key={label}>
              <button type="button" onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}
                className={cx("flex w-full flex-col items-start gap-1 rounded-wobble-2 border-2 border-ink px-2 py-1.5 text-left",
                  i === step ? "bg-lime shadow-ink-sm" : i < step ? "bg-mint" : "bg-card")}>
                <span className="flex items-center gap-1 font-mono text-sm font-bold">{i < step ? <Icon name="check" size={16} /> : null}Step {i + 1}<span className="sr-only"> of 3</span></span>
                <span className="text-[0.95rem] font-semibold leading-tight">{label}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {err ? <p role="alert" className="font-semibold text-pink-ink">{err}</p>
        : !shop ? <Skeleton className="h-80" />
        : step === 0 ? <PaymentStep shop={shop} onSaved={(s) => { setShop(s); next(); }} onSkip={next} />
        : step === 1 ? <PiecesStep onNext={next} />
        : <DropStep shopName={shop.name} />}
    </div>
  );
}

// ---------------------------------------------------------------- 1. payment details

function PaymentStep({ shop, onSaved, onSkip }: { shop: ShopSettings; onSaved: (s: ShopSettings) => void; onSkip: () => void }) {
  const [upi, setUpi] = useState(shop.upiId ?? "");
  const [payee, setPayee] = useState(shop.payeeName ?? "");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const upiOk = isUpiId(upi);
  const errors = {
    upi: !upi.trim() ? "Enter the UPI ID buyers should pay." : upiOk ? undefined : "That isn't a UPI ID. It looks like name@bank.",
    payee: payee.trim().length > 60 ? "Up to 60 characters." : undefined,
  };
  const name = payee.trim() || shop.name;
  const testLink = upiOk ? `upi://pay?pa=${encodeURIComponent(upi.trim())}&pn=${encodeURIComponent(name)}&am=1.00&cu=INR&tn=${encodeURIComponent("Dibs name check")}` : null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setShown(true);
    if (errors.upi || errors.payee) return;
    setBusy(true); setErr(null);
    try { onSaved(await api("PATCH /api/shops/:id", { upiId: upi.trim(), payeeName: payee.trim() || null }, { id: shop.id })); }
    catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };

  return (
    <Sheet title="1 · How buyers pay you">
      <form onSubmit={save} noValidate className="flex flex-col gap-5">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Field label="UPI ID" hint="Winners pay this directly. Dibs never touches the money." error={shown ? errors.upi : undefined}>
              <Input name="upiId" value={upi} onChange={(e) => setUpi(e.target.value)} onBlur={() => setShown(true)} placeholder="meera@upi" autoCapitalize="none" spellCheck={false} />
            </Field>
            <Field label="Payee name" hint="The name your UPI app shows when someone pays you." error={shown ? errors.payee : undefined}>
              <Input name="payeeName" value={payee} maxLength={60} onChange={(e) => setPayee(e.target.value)} placeholder={shop.name} />
            </Field>
          </div>
          <div className="flex flex-col gap-3">
            <p className="font-hand text-xl leading-tight">What a winner sees</p>
            <Card className="flex flex-col gap-3" data-testid="pay-preview" aria-label="Preview of the payment card">
              <p className="flex items-center gap-2 text-xl font-extrabold"><Icon name="rupee" size={22} />Payment</p>
              <p className="text-lg font-semibold leading-snug">Pay {rupees(145000)} to {name}{upiOk ? ` (${upi.trim()})` : ""}. Pay only here, never to a number in chat.</p>
              <span className="inline-flex min-h-14 items-center justify-center gap-2 rounded-wobble-2 border-[2.5px] border-ink bg-lime px-5 text-xl font-extrabold shadow-ink">
                <Icon name="rupee" size={22} />Pay {rupees(145000)} with UPI
              </span>
              <p className="text-sm text-muted">Example amount. Buyers see your real price.</p>
            </Card>
            {testLink ? (
              <Card flat tint="yellow" className="flex flex-wrap items-center gap-3" data-testid="name-check">
                <QR value={testLink} size={132} label={`UPI QR code for ₹1 to ${name}`} />
                <p className="min-w-0 flex-1 basis-40 text-[0.95rem]">
                  <b>Check it&apos;s you:</b> scan this with your own UPI app. It opens a ₹1 payment to this UPI ID. Check the name your app shows
                  is yours, then back out. You don&apos;t need to pay.
                </p>
              </Card>
            ) : <p className="text-[0.95rem] text-muted">Enter your UPI ID to get a QR you can scan to check the name.</p>}
          </div>
        </div>
        {err && <p role="alert" className="rounded-wobble border-2 border-ink bg-pink-soft px-3 py-2 font-semibold">{err}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" icon="check" busy={busy} busyLabel="Saving…">Save and continue</Button>
          <Button variant="ghost" size="lg" onClick={onSkip}>Skip</Button>
        </div>
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------- 2. first pieces

function PiecesStep({ onNext }: { onNext: () => void }) {
  const toast = useToast();
  const [v, setV] = useState(0); // remounts the catalog after samples change
  const [samples, setSamples] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api("GET /api/products").then((r) => setSamples(r.products.filter((p) => p.title.startsWith(SAMPLE)).length), () => setSamples(0)); }, [v]);

  const add = async () => {
    setBusy(true);
    try { await api("POST /api/products/samples"); toast("3 sample pieces added. Edit them or remove them.", { tone: "good" }); setV(v + 1); }
    catch (x) { toast(errMsg(x), { tone: "warn" }); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try {
      const r = await api("DELETE /api/products/samples");
      toast(r.removed ? `${r.removed} sample pieces removed` : "Samples that were in a drop stay", { tone: "good" });
      setV(v + 1);
    } catch (x) { toast(errMsg(x), { tone: "warn" }); } finally { setBusy(false); }
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="pieces-h">
      <h2 id="pieces-h" className="font-hand text-2xl font-normal tracking-normal">2 · Add the pieces you&apos;ll drop</h2>
      <div className="flex flex-col gap-4">
        <Card flat tint="paper" className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 basis-56">
            {samples ? <>You have <b>{samples} sample {samples === 1 ? "piece" : "pieces"}</b> (titles start with “Sample:”). Edit them into your own, or remove them.</>
              : <>No photos handy? Start from 3 sample pieces, clearly marked “Sample:”, and edit them.</>}
          </p>
          {samples
            ? <Button size="sm" variant="ghost" icon="trash" busy={busy} busyLabel="Removing…" onClick={remove}>Remove sample pieces</Button>
            : <Button size="sm" variant="ghost" icon="sparkle" busy={busy} busyLabel="Adding…" onClick={add} disabled={samples === null}>Add 3 sample pieces to edit</Button>}
        </Card>
        <Products key={v} embedded />
        <div className="flex flex-wrap gap-2">
          <Button size="lg" icon="arrowRight" onClick={onNext}>Continue</Button>
          <Button variant="ghost" size="lg" onClick={onNext}>Skip</Button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 3. first drop

type Preset = "10min" | "tonight" | "tomorrow";
/** Today/tomorrow at 20:00 in the browser's time (sellers are in India; the share texts say IST). */
const at8 = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(20, 0, 0, 0); return d; };
const presetTime = (p: Preset) => (p === "10min" ? new Date(Date.now() + 10 * 60_000) : p === "tonight" ? at8(0) : at8(1));

function DropStep({ shopName }: { shopName: string }) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [tonightOk] = useState(() => Date.now() < at8(0).getTime() - 15 * 60_000); // fixed for this visit
  const [preset, setPreset] = useState<Preset>(() => (tonightOk ? "tonight" : "tomorrow"));
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<{ dropId: string; title: string; startsAt: string; shareUrl: string } | null>(null);
  useEffect(() => {
    api("GET /api/products").then((r) => { setProducts(r.products); setPicked(r.products.map((p) => p.id)); }, (e) => setErr(errMsg(e)));
  }, []);

  const errors = {
    title: !title.trim() || title.trim().length > 80 ? "Name the drop, up to 80 characters." : undefined,
    picked: picked.length ? undefined : "Pick at least one piece.",
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setShown(true);
    if (errors.title || errors.picked) return;
    setBusy(true); setErr(null);
    const startsAt = presetTime(preset).toISOString();
    try {
      const r = await api("POST /api/drops", { title: title.trim(), startsAt, productIds: products!.filter((p) => picked.includes(p.id)).map((p) => p.id) });
      setMade({ dropId: r.dropId, title: title.trim(), startsAt, shareUrl: r.shareUrl });
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };

  if (made) {
    return (
      <Sheet tint="lime" title="Your drop is ready to share" className="flex flex-col gap-4">
        <p className="text-lg font-semibold">{made.title}</p>
        <ShareKit shopName={shopName} title={made.title} startsAt={made.startsAt} url={made.shareUrl} />
        <LinkButton href={`/seller/drops/${made.dropId}`} icon="live" size="lg" className="self-start">Open the live console</LinkButton>
      </Sheet>
    );
  }
  return (
    <Sheet title="3 · Schedule your first drop">
      {!products ? <Skeleton className="h-40" /> : !products.length ? (
        <div className="flex flex-col gap-3">
          <p>A drop is a list of your pieces, so add at least one first.</p>
          <LinkButton href="/seller/products" icon="plus" className="self-start">Add pieces</LinkButton>
          <Link href="/seller/drops" className="font-semibold underline decoration-2">Skip for now</Link>
        </div>
      ) : (
        <form onSubmit={create} noValidate className="flex flex-col gap-5">
          <Field label="Drop title" error={shown && errors.title}>
            <Input name="dropTitle" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Diwali Edit" />
          </Field>
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-1 font-hand text-xl leading-tight">Starts</legend>
            <div className="flex flex-wrap gap-2">
              {([["10min", "In 10 minutes"], ["tonight", "Tonight 8 pm"], ["tomorrow", "Tomorrow 8 pm"]] as const).filter(([p]) => p !== "tonight" || tonightOk).map(([p, label]) => (
                <label key={p} className="flex min-h-12 cursor-pointer items-center gap-2 rounded-wobble-2 border-2 border-ink bg-card px-3 font-semibold has-[:checked]:bg-lime has-[:checked]:shadow-ink-sm has-[:focus-visible]:outline-3">
                  <input type="radio" name="preset" value={p} checked={preset === p} onChange={() => setPreset(p)} className="size-5 accent-[var(--color-ink)]" />{label}
                </label>
              ))}
            </div>
            <p className="text-[0.95rem] text-muted">Buyers see a countdown until you press Go live. Need another time? Make the drop from the Drops page.</p>
          </fieldset>
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-1 font-hand text-xl leading-tight">Pieces, in drop order</legend>
            <ul className="flex flex-col gap-2">
              {products.map((p) => {
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
            {shown && errors.picked && <p role="alert" className="font-semibold text-pink-ink">{errors.picked}</p>}
          </fieldset>
          {err && <p role="alert" className="rounded-wobble border-2 border-ink bg-pink-soft px-3 py-2 font-semibold">{err}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" icon="sparkle" busy={busy} busyLabel="Creating…">Create drop</Button>
            <LinkButton href="/seller/drops" variant="ghost" size="lg">Skip for now</LinkButton>
          </div>
        </form>
      )}
    </Sheet>
  );
}
