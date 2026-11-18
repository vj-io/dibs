"use client";
// Shop details, used to create the shop (after sign-in) and to edit it (settings). Checks mirror the server's ShopFields.
import { useState, type FormEvent } from "react";
import { Button, Card, Field, Icon, Input, useToast } from "@/components/ui";
import { api } from "@/lib/client/api";
import { isIndianPhone, isUpiId } from "@/lib/upi";
import type { SellerMe, ShopInput, ShopSettings } from "@/lib/types";
import { errMsg, uploadPhoto } from "./kit";

type F = {
  name: string; slug: string; ownerName: string; upiId: string; payeeName: string; supportWhatsapp: string;
  holdMinutes: string; maxHolds: string; highValue: string; autoAdvance: boolean; faq: string[]; logoUrl: string | null;
};

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

function check(f: F, create: boolean): Partial<Record<keyof F | `faq${number}`, string>> {
  const e: Partial<Record<keyof F | `faq${number}`, string>> = {};
  const name = f.name.trim();
  if (name.length < 2 || name.length > 60) e.name = "Use 2 to 60 characters.";
  if (create && !/^[a-z0-9-]{3,30}$/.test(f.slug)) e.slug = "3 to 30 lower-case letters, digits or dashes.";
  if (create && f.ownerName.trim().length > 40) e.ownerName = "Up to 40 characters.";
  if (f.upiId.trim() && !isUpiId(f.upiId)) e.upiId = "That isn't a UPI ID. It looks like name@bank.";
  if (f.payeeName.trim().length > 60) e.payeeName = "Up to 60 characters.";
  if (f.supportWhatsapp.trim() && !isIndianPhone(f.supportWhatsapp)) e.supportWhatsapp = "Use a 10-digit Indian mobile number.";
  const h = Number(f.holdMinutes);
  if (!Number.isInteger(h) || h < 5 || h > 30) e.holdMinutes = "A whole number from 5 to 30.";
  const m = Number(f.maxHolds);
  if (!Number.isInteger(m) || m < 1 || m > 5) e.maxHolds = "A whole number from 1 to 5.";
  if (f.highValue.trim() && !(Number(f.highValue) >= 1)) e.highValue = "An amount in rupees, or leave it empty.";
  f.faq.forEach((l, i) => { if (l.trim().length > 200) e[`faq${i}`] = "Up to 200 characters."; });
  return e;
}

const toInput = (f: F): Omit<ShopInput, "name" | "slug"> => ({
  upiId: f.upiId.trim() || null,
  payeeName: f.payeeName.trim() || null,
  supportWhatsapp: f.supportWhatsapp.trim() || null,
  holdMinutes: Number(f.holdMinutes),
  maxHolds: Number(f.maxHolds),
  highValuePaise: f.highValue.trim() ? Math.round(Number(f.highValue) * 100) : null,
  autoAdvance: f.autoAdvance,
  faq: f.faq.map((l) => l.trim()).filter(Boolean),
});

export function ShopForm({ initial, readOnly, onCreated, onSaved }: {
  /** Absent = create a new shop. */
  initial?: ShopSettings; readOnly?: boolean;
  onCreated?: (me: SellerMe) => void; onSaved?: (s: ShopSettings) => void;
}) {
  const create = !initial;
  const toast = useToast();
  const [f, setF] = useState<F>(() => ({
    name: initial?.name ?? "", slug: initial?.slug ?? "", ownerName: "",
    upiId: initial?.upiId ?? "", payeeName: initial?.payeeName ?? "", supportWhatsapp: initial?.supportWhatsapp ?? "",
    holdMinutes: String(initial?.holdMinutes ?? 10), maxHolds: String(initial?.maxHolds ?? 3),
    highValue: initial?.highValuePaise ? String(initial.highValuePaise / 100) : "", autoAdvance: initial?.autoAdvance ?? false,
    faq: initial?.faq.length ? initial.faq : [""], logoUrl: initial?.logoUrl ?? null,
  }));
  const [slugEdited, setSlugEdited] = useState(false);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const errors = check(f, create);
  const show = (k: string) => (shown.has("*") || shown.has(k) ? errors[k as keyof typeof errors] : undefined);
  const blur = (k: string) => () => setShown((s) => new Set(s).add(k));
  const set = <K extends keyof F>(k: K, v: F[K]) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setShown(new Set(["*"]));
    if (Object.keys(errors).length) return;
    setBusy(true); setErr(null);
    try {
      if (create) {
        const r = await api("POST /api/shops", { name: f.name.trim(), slug: f.slug, ownerName: f.ownerName.trim() || undefined, ...toInput(f) });
        onCreated?.(r.me);
      } else {
        const r = await api("PATCH /api/shops/:id", { name: f.name.trim(), logoUrl: f.logoUrl, ...toInput(f) }, { id: initial!.id });
        toast("Shop settings saved", { tone: "good" });
        onSaved?.(r);
      }
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    setLogoBusy(true);
    try { set("logoUrl", await uploadPhoto(file)); } catch (x) { toast(errMsg(x), { tone: "warn" }); } finally { setLogoBusy(false); }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" aria-label={create ? "Create your shop" : "Shop settings"}>
      <fieldset disabled={readOnly} className="flex flex-col gap-5">
        <Field label="Shop name" error={show("name")}>
          <Input value={f.name} onBlur={blur("name")} maxLength={60} autoComplete="organization" name="shopName"
            onChange={(e) => { set("name", e.target.value); if (create && !slugEdited) set("slug", slugify(e.target.value)); }} />
        </Field>
        {create ? (
          <Field label="Shop link" hint={<>Your drops live at dibs…/s/<b>{f.slug || "your-shop"}</b>. You can&apos;t change it later.</>} error={show("slug")}>
            <Input value={f.slug} onBlur={blur("slug")} maxLength={30} name="slug" autoCapitalize="none" spellCheck={false}
              onChange={(e) => { setSlugEdited(true); set("slug", e.target.value.toLowerCase()); }} />
          </Field>
        ) : (
          <p className="text-muted">Shop link: <span className="font-mono text-ink">/s/{f.slug}</span> (fixed)</p>
        )}
        {create && (
          <Field label="Your name" hint="Shown to your team. Buyers see the shop name." error={show("ownerName")}>
            <Input value={f.ownerName} onBlur={blur("ownerName")} maxLength={40} autoComplete="name" name="ownerName" onChange={(e) => set("ownerName", e.target.value)} />
          </Field>
        )}
        {!create && (
          <div className="flex flex-col gap-1">
            <p className="font-hand text-xl leading-tight">Logo <span className="text-muted">(optional)</span></p>
            <div className="flex flex-wrap items-center gap-3">
              {f.logoUrl
                // eslint-disable-next-line @next/next/no-img-element -- Storage URL, already compressed
                ? <img src={f.logoUrl} alt="Shop logo" className="size-16 rounded-blob border-[2.5px] border-ink object-cover" />
                : <span className="grid size-16 place-items-center rounded-blob border-[2.5px] border-dashed border-ink/50 text-muted"><Icon name="bag" /></span>}
              <label className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-wobble-2 border-[2.5px] border-ink bg-card px-3.5 font-extrabold shadow-ink-sm has-[:focus-visible]:outline-3">
                <Icon name={logoBusy ? "clock" : "plus"} size={20} />{logoBusy ? "Uploading…" : f.logoUrl ? "Change logo" : "Upload logo"}
                <input type="file" accept="image/*" className="sr-only" disabled={logoBusy || readOnly} onChange={(e) => pickLogo(e.target.files?.[0])} />
              </label>
              {f.logoUrl && <Button size="sm" variant="ghost" icon="trash" onClick={() => set("logoUrl", null)}>Remove</Button>}
            </div>
          </div>
        )}

        <Card flat tint="paper" className="flex flex-col gap-5">
          <p className="font-extrabold">How buyers pay you</p>
          <Field label="UPI ID" hint="Buyers pay this directly. Dibs never touches the money." error={show("upiId")}>
            <Input value={f.upiId} onBlur={blur("upiId")} placeholder="meera@upi" autoCapitalize="none" spellCheck={false} name="upiId" onChange={(e) => set("upiId", e.target.value)} />
          </Field>
          <Field label="Payee name" hint="The name your UPI app shows when someone pays." error={show("payeeName")}>
            <Input value={f.payeeName} onBlur={blur("payeeName")} maxLength={60} name="payeeName" onChange={(e) => set("payeeName", e.target.value)} />
          </Field>
          <Field label="Support WhatsApp" hint="Optional. Shown to buyers who need help." error={show("supportWhatsapp")}>
            <Input value={f.supportWhatsapp} onBlur={blur("supportWhatsapp")} inputMode="tel" autoComplete="tel" placeholder="98765 43210" name="supportWhatsapp" onChange={(e) => set("supportWhatsapp", e.target.value)} />
          </Field>
        </Card>

        <Card flat tint="paper" className="grid gap-5 sm:grid-cols-2">
          <p className="font-extrabold sm:col-span-2">Sale rules</p>
          <Field label="Hold time (minutes)" hint="How long a winner has to pay: 5 to 30." error={show("holdMinutes")}>
            <Input type="number" inputMode="numeric" min={5} max={30} value={f.holdMinutes} onBlur={blur("holdMinutes")} name="holdMinutes" onChange={(e) => set("holdMinutes", e.target.value)} />
          </Field>
          <Field label="Max holds per buyer" hint="Stops one buyer hoarding: 1 to 5." error={show("maxHolds")}>
            <Input type="number" inputMode="numeric" min={1} max={5} value={f.maxHolds} onBlur={blur("maxHolds")} name="maxHolds" onChange={(e) => set("maxHolds", e.target.value)} />
          </Field>
          <Field label="High-value orders (₹)" hint="Orders at or above this go to the owner. Empty = share them all." error={show("highValue")} className="sm:col-span-2">
            <Input type="number" inputMode="decimal" min={1} value={f.highValue} onBlur={blur("highValue")} placeholder="e.g. 5000" name="highValue" onChange={(e) => set("highValue", e.target.value)} />
          </Field>
          <label className="flex min-h-12 cursor-pointer items-start gap-3 sm:col-span-2">
            <input type="checkbox" checked={f.autoAdvance} onChange={(e) => set("autoAdvance", e.target.checked)} className="mt-1 size-6 accent-[var(--color-ink)]" />
            <span><span className="font-semibold">Auto-advance</span><span className="block text-[0.95rem] text-muted">Drop the next piece 60 s after one sells out.</span></span>
          </label>
        </Card>

        <div className="flex flex-col gap-2">
          <p className="font-hand text-xl leading-tight">FAQ for the answer bot <span className="text-muted">({f.faq.filter((l) => l.trim()).length}/10)</span></p>
          <p className="text-[0.95rem] text-muted">One answer per line: COD, shipping time, returns. The 🤖 assistant answers buyers from these.</p>
          {f.faq.map((line, i) => (
            <div key={i} className="flex items-start gap-2">
              <Field label={<span className="sr-only">FAQ line {i + 1}</span>} error={show(`faq${i}`)} className="flex-1">
                <Input value={line} maxLength={200} placeholder={i === 0 ? "We ship in 3 days across India." : ""} name={`faq${i}`}
                  onChange={(e) => set("faq", f.faq.map((l, j) => (j === i ? e.target.value : l)))} />
              </Field>
              <Button size="sm" variant="ghost" icon="trash" aria-label={`Remove FAQ line ${i + 1}`} className="mt-1 w-12 px-0"
                onClick={() => set("faq", f.faq.length > 1 ? f.faq.filter((_, j) => j !== i) : [""])}><span className="sr-only">Remove</span></Button>
            </div>
          ))}
          {f.faq.length < 10 && <Button size="sm" variant="ghost" icon="plus" className="self-start" onClick={() => set("faq", [...f.faq, ""])}>Add a line</Button>}
        </div>
      </fieldset>

      {err && <p role="alert" className="flex items-start gap-2 rounded-wobble border-2 border-ink bg-pink-soft px-3 py-2 font-semibold"><Icon name="warning" className="mt-0.5 text-pink-ink" />{err}</p>}
      {!readOnly && (
        <Button type="submit" size="lg" icon={create ? "sparkle" : "check"} busy={busy} busyLabel={create ? "Creating…" : "Saving…"} className="self-start">
          {create ? "Create my shop" : "Save settings"}
        </Button>
      )}
    </form>
  );
}
