"use client";
// Small pieces shared by the seller screens: the signed-in staff context, clocks, share card, photo upload.
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Button, Card, Icon, QR, useToast } from "@/components/ui";
import { api, ApiError } from "@/lib/client/api";
import { PHOTO_BUCKET, supabaseBrowser } from "@/lib/client/supabase-browser";
import type { SellerMe } from "@/lib/types";

const MeCtx = createContext<SellerMe | null>(null);
export const MeProvider = ({ me, children }: { me: SellerMe; children: ReactNode }) => <MeCtx.Provider value={me}>{children}</MeCtx.Provider>;
export function useMe(): SellerMe {
  const me = useContext(MeCtx);
  if (!me) throw new Error("useMe needs <MeProvider>");
  return me;
}

export const errMsg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong. Try again.");

/** Ticks every `ms`; null until mounted (no server/client mismatch). */
export function useNow(ms = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const WIDE = "(min-width: 1024px)";
/** true at >= 1024 px. false on the server. */
export function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(WIDE); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(WIDE).matches,
    () => false,
  );
}

/** "12 s" / "3 min 04 s" / "1 h 02 min" since a time. */
export function since(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
}

export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const clock = (at: string | number) => new Date(at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/** wa.me link to message one buyer about their order (staff only; null without a 10-digit phone, e.g. demo shops). */
export function waBuyer(phone: string | null, o: { shop: string; buyer: string; orderNo: number | null; item: string; variant: string; amount?: string; orderId: string }): string | null {
  if (!phone || !/^[6-9]\d{9}$/.test(phone)) return null;
  const link = `${typeof location === "undefined" ? "" : location.origin}/o/${o.orderId}`;
  const text = `Hi ${o.buyer}, this is ${o.shop} about your Dibs order${o.orderNo != null ? ` #${o.orderNo}` : ""}: ${o.item} (${o.variant})${o.amount ? `, ${o.amount}` : ""}. Your order page: ${link}`;
  return `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;
}

export const waLink = (title: string, url: string) =>
  `https://wa.me/?text=${encodeURIComponent(`${title} is dropping on Dibs. First tap wins! ${url}`)}`;

/** Share link + copy + WhatsApp + QR. */
export function ShareCard({ title, url, compact, className }: { title: string; url: string; compact?: boolean; className?: string }) {
  const toast = useToast();
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast("Link copied", { tone: "good" }); }
    catch { toast("Couldn't copy. Press and hold the link to copy it.", { tone: "warn" }); }
  };
  return (
    <Card flat className={className}>
      <p className="font-hand text-xl">Share link</p>
      <p className="mt-1 break-all font-mono text-sm" data-testid="share-url">{url}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" icon="copy" onClick={copy}>Copy</Button>
        <a href={waLink(title, url)} target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-12 items-center gap-2 rounded-wobble-2 border-[2.5px] border-ink bg-mint px-3.5 font-extrabold shadow-ink-sm">
          <Icon name="share" size={20} />WhatsApp
        </a>
      </div>
      {!compact && (
        <div className="mt-3 flex items-center gap-3">
          <QR value={url} size={132} label="QR code of the share link" />
          <p className="text-[0.95rem] text-muted">Buyers scan this to open the sale room.</p>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- photos

/** Shrinks an image to at most 1,200 px on the long side and re-encodes it as WebP (JPEG where WebP isn't supported). */
export async function compressImage(file: File, max = 1200): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const enc = (type: string) => new Promise<Blob | null>((r) => c.toBlob(r, type, 0.82));
  const webp = await enc("image/webp");
  if (webp?.type === "image/webp") return webp;
  const jpg = await enc("image/jpeg");
  if (!jpg) throw new Error("Couldn't read that photo. Try a JPEG or PNG.");
  return jpg;
}

/** Compress, ask for a signed upload URL, upload to Storage; returns the public URL to save. */
export async function uploadPhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("That file isn't a photo.");
  const blob = await compressImage(file);
  const contentType = blob.type === "image/webp" ? "image/webp" : "image/jpeg";
  const { path, token, publicUrl } = await api("POST /api/products/upload-url", { contentType });
  const { error } = await supabaseBrowser().storage.from(PHOTO_BUCKET).uploadToSignedUrl(path, token, blob, { contentType });
  if (error) throw new Error("Photo upload failed. Try again.");
  return publicUrl;
}
