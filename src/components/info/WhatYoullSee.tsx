import Link from "next/link";
import { Card } from "@/components/ui";

const BEATS: { what: string; nex: string }[] = [
  { what: "Race the 🤖 bots for piece 1.", nex: "The server decides who was first; the sold card reaches the room through a Nexconn open channel." },
  { what: "Land on the waitlist, then get promoted when a bot's hold runs out.", nex: "A system-channel alert tells you privately." },
  { what: "Open your private order chat and tap I've paid (a demo payment, no real money).", nex: "A Nexconn group channel with the order card, pay card and read receipts." },
  { what: "Win piece 2 outright.", nex: "Server-decided claim; the whole room sees it over the open channel." },
  { what: "Open the fairness record from the end card.", nex: "Every tap of your demo drop in the order the server committed it, bots marked." },
];

// Below the demo entry on /try. Short, so the demo buttons stay the first thing on screen.
export function WhatYoullSee() {
  return (
    <section aria-labelledby="see" className="mx-auto w-full max-w-xl px-4 pb-12">
      <Card flat className="p-5">
        <h2 id="see" className="text-2xl">What you&apos;ll see</h2>
        <ol className="mt-3 flex flex-col gap-3">
          {BEATS.map((b, i) => (
            <li key={b.what} className="flex items-start gap-3">
              <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full border-2 border-ink bg-lime font-mono text-sm font-bold">{i + 1}</span>
              <span><strong>{b.what}</strong> <span className="text-muted">{b.nex}</span></span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[0.95rem] text-muted">All buyers in the demo room besides you are labelled bots. <Link href="/how-it-works" className="font-bold text-ink underline decoration-2">How it works</Link></p>
      </Card>
    </section>
  );
}
