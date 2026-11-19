// Judge-mode coach line: one pure function from real state, in a fixed priority order
// (ended > a hold waiting for payment > won > waitlisted > live piece sold out for you > live and tappable > waiting).
// It never claims a piece is winnable once it is lost, and never repeats a waitlist place after "It's yours".

export type CoachInput = {
  status: "scheduled" | "live" | "ended";
  startsInMs: number;
  /** The piece on screen, or null between pieces. soldOut = no unit left in any variant. */
  live: { position: number; soldOut: boolean } | null;
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
  if (c.status === "ended") return "That's Dibs. Thanks for trying it!";
  if (c.hold) {
    if (c.hold.state === "payment_claimed") return "Payment sent. Demo staff confirms it in a few seconds.";
    return c.hold.promoted
      ? `It's yours! The buyer ahead didn't pay. Open your order for #${c.hold.position} and tap I've paid.`
      : `It's yours! Open your order for #${c.hold.position} and tap I've paid.`;
  }
  if (c.live && c.wonLive) return c.live.position === 1 ? "Paid and confirmed. That's the whole loop!" : "Clean win! You beat the bots on this one.";
  if (c.live && c.waitPos) {
    return c.queueMoved
      ? `Bot holds run out fast. Watch the queue move: you're #${c.waitPos} now.`
      : `Bots tap fast. You're #${c.waitPos} on the waitlist.`;
  }
  if (c.live && c.live.soldOut) return "Bots got there first. Tap Dibs! to join the waitlist.";
  if (c.live) {
    if (c.live.position === 1) return "It's live! Tap Dibs! now. 🤖 Bots are tapping too.";
    return c.paidBefore ? "Tap fast, you can beat the bots on this one." : "Next piece is live. Tap Dibs!";
  }
  if (c.slowServer) return "Waiting for the server…";
  if (c.status === "scheduled" && c.startsInMs > 0) return `Piece 1 drops in ${Math.ceil(c.startsInMs / 1000)}… get ready to tap Dibs!`;
  return c.paidBefore ? "The next piece is on its way. Stay here." : "Piece 1 is about to drop… get your thumb ready.";
}
