import { tapTime } from "../codec.ts";

// Judge-mode coach line: one pure function from real state, in a fixed priority order
// (ended > the last piece won > a hold waiting for payment > won > waitlisted > live piece sold out for you > live and
// tappable > waiting). It never claims a piece is winnable once it is lost, and never repeats a waitlist place after
// "It's yours". Piece 2 is the buyer demo's last piece and the only one the bots leave open for a quick tap.

export type CoachInput = {
  status: "scheduled" | "live" | "ended";
  /** ms until the drop's startsAt (in a demo room: until piece 1 drops). */
  startsInMs: number;
  /** Some piece has gone live already. */
  dropped: boolean;
  /** The piece on screen, or null between pieces. soldOut = no unit left in any variant. */
  live: { position: number; soldOut: boolean } | null;
  /** Dibs! is off only because no size/colour is picked yet. */
  pickFirst: boolean;
  /** An unpaid or paying hold anywhere in this drop, the one to act on first. */
  hold: { position: number; state: "held" | "payment_claimed"; promoted: boolean } | null;
  /** Won the piece on screen with my own tap (held or paid). */
  wonLive: boolean;
  waitPos: number | null;
  /** A hold ahead of me on this piece ran out or was released (the queue moved). */
  queueMoved: boolean;
  /** I have a paid order from an earlier piece. */
  paidBefore: boolean;
  /** The demo heartbeat has been waiting on the server for a while. */
  slowServer: boolean;
};

export function coachLine(c: CoachInput): string {
  if (c.status === "ended") return "That's the whole demo. Thanks for trying it!"; // the end card under it says "That's Dibs"
  if (c.live && c.wonLive && c.live.position >= 2) return "Clean win! You beat the bots on this one.";
  if (c.hold) {
    if (c.hold.state === "payment_claimed") return "Payment sent. Demo staff confirms it in a few seconds.";
    return c.hold.promoted
      ? `It's yours! The buyer ahead didn't pay. Open your order for #${c.hold.position} and tap I've paid.`
      : `It's yours! Open your order for #${c.hold.position} and tap I've paid.`;
  }
  if (c.live && c.wonLive) return "Paid! Piece 2 drops in a moment. You can beat the bots on that one.";
  if (c.live && c.waitPos) {
    return c.queueMoved
      ? `Bot holds run out fast. Watch the queue move: you're #${c.waitPos} now.`
      : `Bots tap fast. You're #${c.waitPos} on the waitlist.`;
  }
  if (c.live && c.live.soldOut) return "Bots got there first. Tap Dibs! to join the waitlist.";
  if (c.live) {
    const two = c.live.position === 2;
    if (c.pickFirst) return two ? "Pick a size/colour, then tap Dibs! You can beat the bots on this one." : "It's live! Pick a size/colour, then tap Dibs!";
    if (c.live.position === 1) return "It's live! Tap Dibs! now. 🤖 Bots are tapping too.";
    return two ? "Tap fast, you can beat the bots on this one." : "Next piece is live. Tap Dibs!";
  }
  if (c.slowServer) return "Waiting for the server…";
  if ((c.status === "scheduled" || !c.dropped) && c.startsInMs > 0) return `Piece 1 drops in ${Math.ceil(c.startsInMs / 1000)}… get ready to tap Dibs!`;
  return c.paidBefore ? "The next piece is on its way. Stay here." : "Piece 1 is about to drop… get your thumb ready.";
}

/** One of my claims as my_status (0016) reports it: ms after the drop I tapped; promotedMs = tap to promotion. */
export type MyTimes = { position: number; ms?: number | null; promotedMs?: number | null; waitedAt?: number | null };

/**
 * The buyer demo's end card: my own numbers, only what the server recorded (my_status and my claim's answer), in piece
 * order. "Piece 1: waitlisted at #3, yours 23.4 s after your tap", "Piece 2: won 0.9 s after it dropped".
 * `won` is my last winning tap's answer, kept in memory: it outlives a hold that later runs out.
 */
export function demoFacts(holds: MyTimes[], won: { position: number; ms: number } | null): string[] {
  const s = (ms: number) => tapTime(ms).replace(" ", " "); // "12.7 s" never breaks across lines
  const facts = holds.filter((h) => h.ms != null).map((h) => ({
    position: h.position,
    text: h.promotedMs != null
      ? `Piece ${h.position}: waitlisted${h.waitedAt ? ` at #${h.waitedAt}` : ""}, yours ${s(h.promotedMs)} after your tap`
      : `Piece ${h.position}: won ${s(h.ms!)} after it dropped`,
  }));
  if (won && !facts.some((f) => f.position === won.position)) facts.push({ position: won.position, text: `Piece ${won.position}: won ${s(won.ms)} after it dropped` });
  return facts.sort((a, b) => a.position - b.position).map((f) => f.text);
}
