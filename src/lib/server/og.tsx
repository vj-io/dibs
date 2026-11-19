// Link-preview cards (1200x630) drawn with ImageResponse. Server only.
// Fonts: TTFs bundled in src/assets/og and read from disk (Vercel traces the literal path.join); if a read fails the
// card falls back to ImageResponse's built-in font instead of failing. Photos: fetched here and inlined as data URIs
// (PNG/JPEG/GIF only: ImageResponse cannot draw SVG files or WebP reliably); anything else gets a drawn placeholder.
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { istWhen } from "../when.ts";
import type { SharedDrop } from "./share.ts";

export const OG_SIZE = { width: 1200, height: 630 };
export const PITCH = "First tap wins. Everyone sees it. Nobody gets lost in the DMs.";
const INK = "#0a0a0a", LIME = "#c8ff00", PINK = "#ff3d8b", PAPER = "#f0ede8", CARD = "#fbfaf7", MUTED = "#5f5b55";

type Font = { name: string; data: Buffer; weight: 400 | 800; style: "normal" };
let fontsP: Promise<Font[]> | undefined;
const fonts = () => (fontsP ??= (async () => {
  try {
    const [a, p] = await Promise.all([
      readFile(join(process.cwd(), "src/assets/og/Archivo-800.ttf")),
      readFile(join(process.cwd(), "src/assets/og/PatrickHand.ttf")),
    ]);
    return [
      { name: "Archivo", data: a, weight: 800, style: "normal" },
      { name: "Patrick Hand", data: p, weight: 400, style: "normal" },
    ] satisfies Font[];
  } catch (e) { console.warn("[og] fonts unavailable, using the default font", e instanceof Error ? e.message : e); fontsP = undefined; return []; }
})());

const HEAD = "Archivo, sans-serif", HAND = "'Patrick Hand', cursive";
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

const grid = {
  backgroundColor: PAPER,
  backgroundImage: "linear-gradient(rgba(10,10,10,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(10,10,10,0.07) 1px, transparent 1px)",
  backgroundSize: "40px 40px",
} as const;

function Logo({ size }: { size: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <svg width={size} height={size} viewBox="0 0 40 40" style={{ transform: "rotate(-14deg)" }}>
        <path d="M9.5 9.8 L24.6 9.2 L33.4 19.6 L24.9 30.4 L9.8 30.9 C8.5 23.8 8.4 16.6 9.5 9.8 Z" fill={LIME} stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
        <circle cx="26.2" cy="19.8" r="2.1" fill={CARD} stroke={INK} strokeWidth="2" />
        <path d="M16.6 14.4 C16.4 17 16.5 19.4 16.8 21.8 M16.9 25.6 L16.9 25.8" fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
      </svg>
      <div style={{ display: "flex", marginLeft: 10, padding: "0 8px", background: LIME, fontFamily: HEAD, fontWeight: 800, fontSize: size * 0.85, color: INK, letterSpacing: -1 }}>Dibs!</div>
    </div>
  );
}

const Stamp = ({ children, size = 34 }: { children: string; size?: number }) => (
  <div style={{ display: "flex", border: `5px solid ${PINK}`, color: PINK, borderRadius: 10, padding: "4px 18px", fontFamily: HEAD, fontWeight: 800, fontSize: size, transform: "rotate(-4deg)", letterSpacing: 1 }}>{children}</div>
);

export function SiteCard() {
  return (
    <div style={{ ...grid, width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64 }}>
      <Logo size={96} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontFamily: HEAD, fontWeight: 800, fontSize: 92, lineHeight: 1, color: INK, letterSpacing: -2 }}>First tap wins.</div>
        <div style={{ display: "flex", marginTop: 22, fontFamily: HAND, fontSize: 44, lineHeight: 1.2, color: INK, maxWidth: 900 }}>Everyone sees it. Nobody gets lost in the DMs.</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", fontFamily: HAND, fontSize: 32, color: MUTED }}>A live sale room for sellers on WhatsApp and Instagram</div>
        <Stamp>FIRST TAP WINS</Stamp>
      </div>
    </div>
  );
}

/** A raster photo as a data URI, or null (SVG, WebP, too big, slow, or not an image). */
export async function rasterDataUri(src: string | null | undefined, base: string): Promise<string | null> {
  if (!src) return null;
  try {
    const res = await fetch(new URL(src, base), { signal: AbortSignal.timeout(3000) });
    const type = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (!res.ok || !/^image\/(png|jpeg|gif)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 3_000_000 ? null : `data:${type};base64,${buf.toString("base64")}`;
  } catch { return null; }
}

function Placeholder() {
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", background: "#fff0a0" }}>
      <svg width="260" height="260" viewBox="0 0 40 40">
        <path d="M9.5 9.8 L24.6 9.2 L33.4 19.6 L24.9 30.4 L9.8 30.9 C8.5 23.8 8.4 16.6 9.5 9.8 Z" fill={LIME} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="26.2" cy="19.8" r="1.6" fill={CARD} stroke={INK} strokeWidth="1.2" />
        <path d="M16.6 14.4 C16.4 17 16.5 19.4 16.8 21.8 M16.9 25.6 L16.9 25.8" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
        <path d="M29.6 15.4 C33 12.6 35.2 9.4 35.6 4.6" fill="none" stroke={INK} strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </div>
  );
}

export function DropCard({ d, photo, now }: { d: SharedDrop; photo: string | null; now: number }) {
  // satori ignores lineClamp here, so the title is cut by length: at most 2 lines at 84/68 px, 3 at 54 px
  const t = d.title.trim(), shop = clip(d.shop.name, 40);
  const fs = t.length <= 24 ? 84 : t.length <= 44 ? 68 : 54;
  const title = fs === 54 ? clip(t, 54) : t;
  const n = d.items.length;
  const when = d.status === "ended" ? "This drop has ended" : d.status === "live" ? "Live right now" : istWhen(d.startsAt, now);
  return (
    <div style={{ ...grid, width: "100%", height: "100%", display: "flex", padding: 56 }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 650 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Logo size={52} />
          {d.status === "live" && (
            <div style={{ display: "flex", alignItems: "center", background: LIME, border: `4px solid ${INK}`, borderRadius: 999, padding: "4px 20px", fontFamily: HEAD, fontWeight: 800, fontSize: 34, color: INK }}>
              <div style={{ display: "flex", width: 20, height: 20, borderRadius: 999, background: PINK, border: `3px solid ${INK}`, marginRight: 12 }} />
              LIVE
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontFamily: HAND, fontSize: 40, color: MUTED, whiteSpace: "nowrap" }}>{shop}</div>
          <div style={{ display: "flex", marginTop: 6, fontFamily: HEAD, fontWeight: 800, fontSize: fs, lineHeight: 1.04, color: INK, letterSpacing: -1.5 }}>{title}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <div style={{ display: "flex", background: d.status === "ended" ? "#e2dfd8" : LIME, padding: "2px 16px", fontFamily: HEAD, fontWeight: 800, fontSize: 42, color: INK }}>{when}</div>
          <div style={{ display: "flex", marginTop: 10, fontFamily: HAND, fontSize: 36, color: INK }}>{n} {n === 1 ? "piece" : "pieces"}</div>
          <div style={{ display: "flex", marginTop: 18 }}><Stamp>FIRST TAP WINS</Stamp></div>
        </div>
      </div>
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
        <div style={{ display: "flex", width: 380, height: 470, background: CARD, border: `6px solid ${INK}`, boxShadow: `12px 12px 0 ${INK}`, transform: "rotate(3deg)", overflow: "hidden" }}>
          {photo
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- ImageResponse (satori) JSX, not the DOM
            ? <img src={photo} width={368} height={458} style={{ objectFit: "cover" }} />
            : <Placeholder />}
        </div>
      </div>
    </div>
  );
}

export async function ogImage(el: React.ReactElement, cacheSeconds?: number) {
  return new ImageResponse(el, {
    ...OG_SIZE,
    fonts: await fonts(),
    headers: cacheSeconds ? { "Cache-Control": `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}` } : undefined,
  });
}
