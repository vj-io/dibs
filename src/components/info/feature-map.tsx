// The Nexconn feature map: every Nexconn feature Dibs uses, what it does, where to see it, its live status
// and what our proof of concept measured (docs/NEXCONN_FINDINGS.md, 19 Nov 2026). Pure render: statuses come in as props.
import Link from "next/link";
import { Badge, Card, Icon } from "@/components/ui";
import type { PublicConfig } from "@/lib/types";

export type FeatureStatus = "On" | "Fallback in use" | "Off";
type Flag = keyof PublicConfig["features"];

type Feature = {
  name: string; job: string; see: string; proof: string;
  /** Feature behind a flag; absent = part of the core path. */
  flag?: Flag; fallback: string;
  /** What it does when the flag is off: "off" (feature absent) or "fallback" (a substitute runs). */
  whenOff?: "off" | "fallback";
};

export const FEATURES: Feature[] = [
  { name: "Access tokens", job: "The server issues a token for the signed-in person's own id only. The browser never holds a secret.",
    see: "Sale room on /try (you join as a buyer)", proof: "Measured: token 205-736 ms; first connect 1.3-2.1 s (cold).", fallback: "Mock transport: an in-process bus with the same interface." },
  { name: "Open channel: the sale room", job: "One open channel per drop carries the live piece, stock and the ticker to everyone with the link.",
    see: "Sale room on /try", proof: "Measured: create 173 ms, enter 204-218 ms.", fallback: "Mock transport: an in-process bus with the same interface." },
  { name: "Custom message types DB:*, sent by dibs_bot", job: "Typed cards (item, sold, back, stock, order, pay, status). A card counts only if dibs_bot sent it; a pasted copy stays text.",
    see: "The ticker under the Dibs button", proof: "Measured: server send to browser receive, median 436 ms, n=20 (min 377, max 2093).", fallback: "Plain-text envelope [[DB:Sold]]{...}: median 441 ms, n=20." },
  { name: "Message priority", job: "Sold and stock cards are sent at high priority so they are not queued behind chat.",
    see: "Sold cards in the ticker", proof: "Priority 2 accepted by the Server API (code 0). Whether it changes delivery order: not measured.", fallback: "Sent at normal priority when Nexconn refuses it (error 1009)." },
  { name: "Open-channel metadata mirror", job: "The server mirrors state into the channel's metadata as a hint. Dibs never trusts it.",
    see: "Not visible in the UI; the cards and the state API are the truth", proof: "Measured: set 99-155 ms; browsers get the change event. Risk found: any connected client can overwrite it, so it is only a hint.", fallback: "Skipped; cards and the state API carry everything." },
  { name: "Group channel: order room per winner", job: "A private room for the buyer and the assigned staff member: order card, UPI pay card, status. dibs_bot sends the cards from outside the room.",
    see: "Win a piece on /try; the order room opens", proof: "Measured: create 189 ms, send 87-125 ms, 50-message history 100-200 ms. A user can be in at most 1,000 groups (code 22413), so the bot is not a member; checked in a production browser. Bursts above 20 sends/s get code 1008 and are retried.", fallback: "Mock transport: an in-process bus with the same interface." },
  { name: "Group channel: team desk", job: "All of a shop's staff watch every order in one feed.",
    see: "Be the seller on /try, open the desk", proof: "Same group mechanism as the order room (measured above).", fallback: "Mock transport: an in-process bus with the same interface." },
  { name: "Read receipts in order rooms", job: "Shows how many people in the order room have read a message.",
    see: "Order room on /try", proof: "Verified: a read receipt came back as read 1 of 2.", fallback: "Mock transport: an in-process bus with the same interface." },
  { name: "System channel: personal alerts", job: "Private alerts (you were promoted, hold expiring, paid, shipped) that keep direct-message lists clean.",
    see: "Get promoted off the waitlist on /try", flag: "systemChannel", whenOff: "fallback",
    proof: "Measured: 86 ms. The direct-message fallback measured 129-164 ms.", fallback: "A direct message from dibs_bot (identical to the buyer)." },
  { name: "Mute and ban lists", job: "A seller mutes or bans from the console; Nexconn itself refuses the person's messages.",
    see: "Be the seller on /try and mute a bot", proof: "Measured: mute 87 ms (send then fails with 23408), ban 116 ms (send and re-enter fail with 23409).", fallback: "Mock transport: an in-process bus with the same interface." },
  { name: "Server-side message delete: the scam shield", job: "A message with a phone number or UPI id is removed for everyone, whoever sent it.",
    see: "Type a phone number in the sale room on /try", proof: "Measured: about 120 ms; other clients get the delete event, including for a buyer's own text.", fallback: "A DB:Hide card tells every screen to hide that message." },
  { name: "Online status: staff routing", job: "New orders go to staff who are online right now.",
    see: "Be the seller on /try", proof: "Measured: 128 ms; reads 1 while connected and 0 about 3 s after the page closed.", fallback: "Round-robin over all active staff." },
  { name: "message:send webhook", job: "Nexconn tells the server about each chat line. That drives the typed-claim helper, the answer bot and the scam shield.",
    see: "Type \"booked\" in the sale room on /try", proof: "Working on production since 19 Nov 2026: a buyer message with a UPI id was delivered, then removed for everyone about 5 s later, and the sender saw the notice (one manual run).", fallback: "Mock transport: an in-process bus with the same interface." },
  { name: "Pre-message callback", job: "The scam shield decides pass or block before a message is delivered, from rules only.",
    see: "Type a UPI id in the sale room on /try", flag: "premessage", whenOff: "off",
    proof: "Not available on our Nexconn plan (greyed out in the Console), so it is off.", fallback: "With this off, the app refuses such text before sending and the webhook removes anything sent around the app." },
  { name: "Community channel: shop club", job: "A club per shop with subchannels #drops (announcements), #chat (members only) and #reviews (paid buyers).",
    see: "Be the seller on /try and open Club", flag: "community", whenOff: "off",
    proof: "Shop club (FEATURE_COMMUNITY): community channel + #drops/#chat/#reviews proven live 19 Nov 2026: 14/14 browser checks, bot→member delivery 10/10, median 213 ms; non-members receive nothing. On production: club flow 6/6 browser steps, 0 errors. No real members yet.", fallback: "No club; everything else works without it." },
  { name: "Call SDK: video viewing", job: "A one-to-one video call between buyer and seller to look at a piece.",
    see: "Order room on /try", flag: "calls", whenOff: "off",
    proof: "Not tested.", fallback: "No video call; the order room chat is unchanged." },
];

export function statusOf(f: Feature, mode: PublicConfig["mode"], features: PublicConfig["features"]): FeatureStatus {
  if (f.flag) {
    if (!features[f.flag]) return f.whenOff === "fallback" ? "Fallback in use" : "Off";
    return mode === "mock" ? "Fallback in use" : "On";
  }
  return mode === "mock" ? "Fallback in use" : "On";
}

const BADGE: Record<FeatureStatus, { tint: "mint" | "yellow" | "grey"; icon: "check" | "warning" | "pause" }> = {
  On: { tint: "mint", icon: "check" },
  "Fallback in use": { tint: "yellow", icon: "warning" },
  Off: { tint: "grey", icon: "pause" },
};

export function FeatureMap({ mode, features }: { mode: PublicConfig["mode"]; features: PublicConfig["features"] }) {
  return (
    <ul className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {FEATURES.map((f, i) => {
        const st = statusOf(f, mode, features);
        return (
          <li key={f.name}>
            <Card as="article" flat alt={i % 2 === 1} className="flex h-full flex-col gap-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="min-w-0 flex-1 basis-40 text-lg leading-tight">{f.name}</h3>
                <Badge tint={BADGE[st].tint} icon={BADGE[st].icon} size="sm">{st}</Badge>
              </div>
              <p>{f.job}</p>
              <p className="text-[0.95rem]"><strong>Evidence:</strong> <span className="text-muted">{f.proof}</span></p>
              <p className="text-[0.95rem]"><strong>If it is not available:</strong> <span className="text-muted">{f.fallback}</span></p>
              <p className="mt-auto pt-1">
                <Link href="/try" className="inline-flex min-h-12 items-center gap-1.5 font-semibold underline decoration-2 hover:decoration-lime">
                  <Icon name="eye" size={18} /> See it: {f.see}
                </Link>
              </p>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
