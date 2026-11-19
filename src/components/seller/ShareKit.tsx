"use client";
// Everything a seller needs to announce a drop and run it: announcement texts (English, Hinglish) to copy or send on
// WhatsApp, an Instagram story hint, the QR as a PNG, a rehearsal link, and the run-your-drop checklist.
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Button, Card, Icon, LinkButton, QR, useToast } from "@/components/ui";
import { announcements } from "./announce";

const CHECKLIST = [
  "Rehearse once in the demo room so the buttons feel familiar.",
  "Share the link about 2 hours before, in your WhatsApp groups and Instagram story.",
  "At the start time, press Go live. Buyers can chat while they wait.",
  "Press Drop next for each piece. The first tap wins; others join the waitlist.",
  "Check payments on the Desk: mark each order received once the money is in your bank, then shipped.",
  "Press End drop when you're done. Download the orders sheet from Results.",
];

export function ShareKit({ shopName, title, startsAt, url, scheduled = true }: { shopName: string; title: string; startsAt: string; url: string; scheduled?: boolean }) {
  const toast = useToast();
  const [png, setPng] = useState<string | null>(null);
  const text = announcements(shopName, title, startsAt, url);
  useEffect(() => {
    let gone = false;
    QRCode.toDataURL(url, { width: 1024, margin: 4, errorCorrectionLevel: "M" }).then((d) => { if (!gone) setPng(d); }, () => {});
    return () => { gone = true; };
  }, [url]);
  const copy = async (s: string, what: string) => {
    try { await navigator.clipboard.writeText(s); toast(`${what} copied`, { tone: "good" }); }
    catch { toast("Couldn't copy. Press and hold the text to copy it.", { tone: "warn" }); }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="share-kit">
      <Card flat className="flex flex-col gap-2">
        <p className="font-hand text-xl">Share link</p>
        <p className="break-all font-mono text-sm" data-testid="share-url">{url}</p>
        <Button size="sm" variant="ghost" icon="copy" className="self-start" onClick={() => copy(url, "Link")}>Copy link</Button>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {([["en", "English"], ["hi", "Hinglish"]] as const).map(([k, label]) => (
          <Card key={k} flat className="flex flex-col gap-2" data-testid={`announce-${k}`}>
            <p className="font-hand text-xl">Announcement · {label}</p>
            <p className="whitespace-pre-line break-words rounded-wobble border-2 border-ink/20 bg-paper p-3 text-[0.95rem]">{text[k]}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" icon="copy" onClick={() => copy(text[k], `${label} message`)}>Copy</Button>
              <a href={`https://wa.me/?text=${encodeURIComponent(text[k])}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex min-h-12 items-center gap-2 rounded-wobble-2 border-[2.5px] border-ink bg-mint px-3.5 font-extrabold shadow-ink-sm">
                <Icon name="share" size={20} />WhatsApp
              </a>
            </div>
          </Card>
        ))}
      </div>

      <Card flat className="flex flex-wrap items-center gap-4">
        <QR value={url} size={132} label="QR code of the share link" />
        <div className="flex min-w-0 flex-1 basis-52 flex-col gap-2">
          <p className="font-semibold">Instagram story</p>
          <p className="text-[0.95rem] text-muted">Download the QR, post it as a story, and add a Link sticker with the share link so buyers can tap it.</p>
          {png
            ? <a href={png} download={`dibs-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "drop"}-qr.png`}
                className="inline-flex min-h-12 items-center gap-2 self-start rounded-wobble-2 border-[2.5px] border-ink bg-card px-3.5 font-extrabold shadow-ink-sm">
                <Icon name="qr" size={20} />Download QR (PNG)
              </a>
            : <span className="text-muted">Preparing the QR image…</span>}
        </div>
      </Card>

      {scheduled && (
        <Card flat tint="violet" className="flex flex-col gap-2">
          <LinkButton href="/try?role=seller" target="_blank" rel="noopener" variant="ghost" icon="robot" className="self-start">Rehearse this drop</LinkButton>
          <p className="text-[0.95rem]">Opens a practice room with 🤖 demo buyers in a new tab. It has nothing to do with your real drop: no real buyers, no real money.</p>
        </Card>
      )}

      <Card flat tint="paper" className="flex flex-col gap-2" data-testid="run-checklist">
        <h3 className="text-xl">How to run your drop</h3>
        <ol className="flex flex-col gap-1.5">
          {CHECKLIST.map((line, i) => (
            <li key={i} className="flex items-start gap-2"><span className="w-6 shrink-0 font-mono font-bold">{i + 1}.</span><span>{line}</span></li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
