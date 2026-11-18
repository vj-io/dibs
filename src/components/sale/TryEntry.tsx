"use client";
// /try: judge mode. One click gives a private sandbox drop with 40 labelled demo bots.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { AppHeader, Footer, Highlight, Icon, cx, type IconName } from "@/components/ui";

const CHOICES: { role: "buyer" | "seller"; icon: IconName; title: string; line: string }[] = [
  { role: "buyer", icon: "tap", title: "Be a buyer", line: "Race 🤖 demo buyers for a piece, get promoted from the waitlist, pay, and win one outright. About 90 seconds." },
  { role: "seller", icon: "users", title: "Be the seller", line: "Run the live console: drop pieces, watch taps, holds and waitlists fill, confirm a payment and ship it." },
];

export function TryEntry({ suggested = "buyer" }: { suggested?: "buyer" | "seller" }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"buyer" | "seller" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function start(role: "buyer" | "seller") {
    setBusy(role); setErr(null);
    try {
      const r = await api("POST /api/try/start", { role });
      router.push(role === "buyer" ? `/s/${r.shopSlug}/d/${r.code}` : `/seller/drops/${r.dropId}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't start the demo. Try again.");
      setBusy(null);
    }
  }

  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 pb-10 pt-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl">Try a live drop <Highlight>right now</Highlight></h1>
          <p className="text-lg">One tap, no sign-up, no second phone. You get a private demo room of your own.</p>
        </div>
        <div className="flex flex-col gap-4">
          {CHOICES.map((c) => {
            const primary = c.role === suggested;
            return (
              <button key={c.role} type="button" onClick={() => void start(c.role)} disabled={!!busy} aria-busy={busy === c.role || undefined}
                className={cx(
                  "flex min-h-28 w-full items-start gap-4 rounded-wobble border-[2.5px] border-ink p-4 text-left",
                  "active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:cursor-progress",
                  primary ? "bg-lime shadow-ink-lg" : "bg-card shadow-ink",
                )}>
                <span className={cx("grid size-14 shrink-0 place-items-center rounded-blob border-[2.5px] border-ink", primary ? "bg-card" : "bg-yellow")}>
                  <Icon name={busy === c.role ? "clock" : c.icon} size={28} stroke={2.4} className={busy === c.role ? "motion-safe:animate-spin motion-safe:[animation-duration:1.6s]" : undefined} />
                </span>
                <span className="flex flex-col gap-1">
                  <span className="text-2xl font-extrabold leading-tight">{busy === c.role ? "Opening your room…" : c.title}</span>
                  <span className="leading-snug">{c.line}</span>
                </span>
              </button>
            );
          })}
        </div>
        {err && <p role="alert" className="flex items-center gap-2 font-semibold text-pink-ink"><Icon name="warning" size={20} />{err}</p>}
        <div className="flex items-start gap-3 rounded-wobble border-2 border-dashed border-violet-ink bg-violet p-4">
          <Icon name="robot" size={24} className="mt-0.5 shrink-0 text-violet-ink" />
          <p className="leading-snug">
            <strong>About the bots:</strong> the 40 🤖 demo buyers tap at set delays and don&apos;t pay for what they win in your room, so you see a waitlist promotion within about a minute.
            They go through the same claim function as real buyers, nothing is rigged, and nothing here is real money.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
