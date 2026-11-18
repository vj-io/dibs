"use client";
/* eslint-disable @next/next/no-img-element -- product photos are Storage URLs compressed in the browser, or /demo/ SVGs */
// /seller/products: catalog list and the editor sheet (photos, title, price in rupees, variants, note).
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BottomSheet, Button, Card, EmptyState, Field, Icon, Input, Price, Skeleton, Textarea, useToast } from "@/components/ui";
import { api } from "@/lib/client/api";
import type { Product, Variant } from "@/lib/types";
import { errMsg, uploadPhoto, useMe } from "./kit";
import { DEMO_NOTE } from "./ShopSettings";

type Row = { key: string | null; label: string; qty: string };
type Draft = { id: string | null; title: string; price: string; note: string; photos: string[]; rows: Row[] };

const blank = (): Draft => ({ id: null, title: "", price: "", note: "", photos: [], rows: [{ key: null, label: "One size", qty: "1" }] });

/** Variant key from its label ("Size M" -> "size-m"), unique within the product, [A-Za-z0-9_-]{1,16}. */
function keysFor(rows: Row[]): string[] {
  const used = new Set(rows.map((r) => r.key).filter(Boolean) as string[]);
  return rows.map((r) => {
    if (r.key) return r.key;
    const base = r.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 12) || "v";
    let k = base, n = 2;
    while (used.has(k)) k = `${base}-${n++}`.slice(0, 16);
    used.add(k);
    return k;
  });
}

function check(d: Draft) {
  const e: Record<string, string> = {};
  if (!d.title.trim() || d.title.trim().length > 80) e.title = "Give it a name, up to 80 characters.";
  const p = Number(d.price);
  if (!d.price.trim() || !(p >= 1) || Math.round(p * 100) !== p * 100) e.price = "Price in rupees, at least ₹1 (up to 2 decimals).";
  if (d.note.trim().length > 300) e.note = "Up to 300 characters.";
  if (!d.rows.length) e.rows = "Add at least one size or colour.";
  d.rows.forEach((r, i) => {
    if (!r.label.trim() || r.label.trim().length > 30) e[`l${i}`] = "Name it (up to 30 characters).";
    const q = Number(r.qty);
    if (!Number.isInteger(q) || q < 1 || q > 999) e[`q${i}`] = "1 to 999.";
  });
  const labels = d.rows.map((r) => r.label.trim().toLowerCase());
  labels.forEach((l, i) => { if (l && labels.indexOf(l) !== i) e[`l${i}`] = "Two rows have this name."; });
  return e;
}

export function Products() {
  const toast = useToast();
  const demo = useMe().shop.isSandbox; // the shared demo shop's catalog is read-only
  const [list, setList] = useState<Product[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [d, setD] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [shown, setShown] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [del, setDel] = useState<Product | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  const load = useCallback(() => api("GET /api/products").then((r) => setList(r.products), (e) => setErr(errMsg(e))), []);
  useEffect(() => { void load(); }, [load]);

  const open = (p?: Product) => {
    setShown(false); setSaveErr(null);
    setD(p ? { id: p.id, title: p.title, price: String(p.pricePaise / 100), note: p.note ?? "", photos: p.photos,
      rows: p.variants.map((v) => ({ key: v.key, label: v.label, qty: String(v.qty) })) } : blank());
  };
  const errors = d ? check(d) : {};
  const ex = (k: string) => (shown ? errors[k] : undefined);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!d) return;
    setShown(true);
    if (Object.keys(errors).length) return;
    const keys = keysFor(d.rows);
    const variants: Variant[] = d.rows.map((r, i) => ({ key: keys[i], label: r.label.trim(), qty: Number(r.qty) }));
    const body = { title: d.title.trim(), pricePaise: Math.round(Number(d.price) * 100), note: d.note.trim() || null, photos: d.photos, variants };
    setSaving(true); setSaveErr(null);
    try {
      if (d.id) await api("PATCH /api/products/:id", body, { id: d.id });
      else await api("POST /api/products", body);
      toast(d.id ? "Saved" : `${body.title} added`, { tone: "good" });
      setD(null);
      await load();
    } catch (x) { setSaveErr(errMsg(x)); } finally { setSaving(false); }
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files || !d) return;
    const room = 4 - d.photos.length;
    const pick = [...files].slice(0, room);
    if (files.length > room) toast("Up to 4 photos per piece.", { tone: "warn" });
    setUploading((n) => n + pick.length);
    await Promise.all(pick.map(async (f) => {
      try { const url = await uploadPhoto(f); setD((x) => (x && x.photos.length < 4 ? { ...x, photos: [...x.photos, url] } : x)); }
      catch (x) { toast(errMsg(x), { tone: "warn" }); }
      finally { setUploading((n) => n - 1); }
    }));
  };

  const remove = async () => {
    if (!del) return;
    setDelBusy(true); setDelErr(null);
    try { await api("DELETE /api/products/:id", undefined, { id: del.id }); toast(`${del.title} deleted`, { tone: "good" }); setDel(null); await load(); }
    catch (x) { setDelErr(errMsg(x)); } finally { setDelBusy(false); }
  };

  const setRow = (i: number, r: Partial<Row>) => setD((x) => x && { ...x, rows: x.rows.map((y, j) => (j === i ? { ...y, ...r } : y)) });
  const total = (p: Product) => p.variants.reduce((a, v) => a + v.qty, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl">Products</h1>
        {!demo && <Button icon="plus" onClick={() => open()}>Add a piece</Button>}
      </div>
      {demo && <p className="rounded-wobble border-2 border-ink bg-sky px-3 py-2 font-semibold" data-testid="demo-note">{DEMO_NOTE}</p>}

      {err ? <EmptyState icon="warning" title="Couldn't load your products." body={err} action={<Button onClick={() => { setErr(null); void load(); }}>Try again</Button>} />
        : !list ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        : !list.length ? <EmptyState icon="bag" title="No pieces yet." body="Add the pieces you want to drop: photos, price and how many of each size." action={<Button icon="plus" onClick={() => open()}>Add your first piece</Button>} />
        : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="product-list">
            {list.map((p) => (
              <li key={p.id}>
                <Card flat className="flex h-full gap-3 p-3">
                  {p.photos[0]
                    ? <img src={p.photos[0]} alt="" className="size-20 shrink-0 rounded-wobble border-2 border-ink object-cover" />
                    : <span className="grid size-20 shrink-0 place-items-center rounded-wobble border-2 border-dashed border-ink/50 text-muted"><Icon name="bag" /></span>}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="truncate font-extrabold">{p.title}</p>
                    <Price paise={p.pricePaise} size="sm" />
                    <p className="text-sm text-muted">{total(p)} in stock · {p.variants.map((v) => v.label).join(", ")}</p>
                    {!demo && <div className="mt-auto flex gap-2 pt-2">
                      <Button size="sm" variant="ghost" onClick={() => open(p)} aria-label={`Edit ${p.title}`}>Edit</Button>
                      <Button size="sm" variant="ghost" icon="trash" onClick={() => { setDelErr(null); setDel(p); }} aria-label={`Delete ${p.title}`}>Delete</Button>
                    </div>}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}

      <BottomSheet open={!!d} onClose={() => setD(null)} title={d?.id ? "Edit piece" : "New piece"} className="sm:max-w-xl">
        {d && (
          <form onSubmit={save} noValidate className="flex max-h-[75dvh] flex-col gap-4 overflow-y-auto px-1 pb-2">
            <div className="flex flex-col gap-2">
              <p className="font-hand text-xl leading-tight">Photos <span className="text-muted">({d.photos.length}/4)</span></p>
              <div className="flex flex-wrap gap-2">
                {d.photos.map((src, i) => (
                  <div key={src} className="relative">
                    <img src={src} alt={`Photo ${i + 1}`} className="size-20 rounded-wobble border-2 border-ink object-cover" />
                    <button type="button" aria-label={`Remove photo ${i + 1}`} onClick={() => setD({ ...d, photos: d.photos.filter((x) => x !== src) })}
                      className="absolute -right-2 -top-2 grid size-8 place-items-center rounded-full border-2 border-ink bg-card"><Icon name="cross" size={14} /></button>
                  </div>
                ))}
                {d.photos.length + uploading < 4 && (
                  <label className="grid size-20 cursor-pointer place-items-center rounded-wobble border-[2.5px] border-dashed border-ink bg-card text-center text-sm font-semibold has-[:focus-visible]:outline-3">
                    <span className="flex flex-col items-center"><Icon name="plus" />Add</span>
                    <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} />
                  </label>
                )}
                {uploading > 0 && <span className="grid size-20 place-items-center rounded-wobble border-2 border-ink/30 bg-grey text-sm"><Icon name="clock" className="motion-safe:animate-spin" /></span>}
              </div>
              <p className="text-sm text-muted">Shrunk to 1,200 px on your phone before upload.</p>
            </div>
            <Field label="Title" error={ex("title")}><Input name="title" value={d.title} maxLength={80} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="Silver jhumka" /></Field>
            <Field label="Price (₹)" error={ex("price")}>
              <Input name="price" type="number" inputMode="decimal" min={1} step="0.01" value={d.price} onChange={(e) => setD({ ...d, price: e.target.value })} placeholder="1450" />
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="font-hand text-xl leading-tight">Sizes or colours, with how many you have</legend>
              {d.rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_5.5rem_3rem] items-start gap-2">
                  <Field label={<span className="sr-only">Name of option {i + 1}</span>} error={ex(`l${i}`)}>
                    <Input name={`variant${i}`} value={r.label} maxLength={30} placeholder="M" onChange={(e) => setRow(i, { label: e.target.value })} />
                  </Field>
                  <Field label={<span className="sr-only">Quantity of option {i + 1}</span>} error={ex(`q${i}`)}>
                    <Input name={`qty${i}`} type="number" inputMode="numeric" min={1} max={999} value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} />
                  </Field>
                  <button type="button" aria-label={`Remove option ${i + 1}`} disabled={d.rows.length === 1}
                    onClick={() => setD({ ...d, rows: d.rows.filter((_, j) => j !== i) })}
                    className="mt-0.5 grid size-12 place-items-center rounded-wobble border-2 border-ink bg-card disabled:opacity-40"><Icon name="trash" size={18} /></button>
                </div>
              ))}
              {d.rows.length < 10 && (
                <Button size="sm" variant="ghost" icon="plus" className="self-start"
                  onClick={() => setD({ ...d, rows: [...d.rows, { key: null, label: "", qty: "1" }] })}>
                  Add a size
                </Button>
              )}
            </fieldset>
            <Field label="Note (optional)" hint="Material, fit, care. Buyers see it on the piece." error={ex("note")}>
              <Textarea name="note" value={d.note} maxLength={300} rows={2} onChange={(e) => setD({ ...d, note: e.target.value })} placeholder="925 silver, adjustable" />
            </Field>
            {saveErr && <p role="alert" className="rounded-wobble border-2 border-ink bg-pink-soft px-3 py-2 font-semibold">{saveErr}</p>}
            <Button type="submit" size="lg" icon="check" busy={saving} busyLabel="Saving…" disabledReason={uploading ? "Photos still uploading" : undefined}>
              {d.id ? "Save changes" : "Add piece"}
            </Button>
          </form>
        )}
      </BottomSheet>

      <BottomSheet open={!!del} onClose={() => setDel(null)} title={`Delete ${del?.title ?? ""}?`}>
        <p>This removes it from your catalog. Past drops keep their records.</p>
        {delErr && <p role="alert" className="mt-3 rounded-wobble border-2 border-ink bg-pink-soft px-3 py-2 font-semibold">{delErr}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="danger" icon="trash" busy={delBusy} busyLabel="Deleting…" onClick={remove}>Delete</Button>
          <Button variant="ghost" onClick={() => setDel(null)}>Keep it</Button>
        </div>
      </BottomSheet>
    </div>
  );
}
