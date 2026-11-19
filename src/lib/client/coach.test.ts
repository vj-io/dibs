// The audit's coach contradictions (docs/audit-ux.md finding 3, judge audit 2 finding 7), as cases.
import test from "node:test";
import assert from "node:assert/strict";
import { coachLine, demoFacts, type CoachInput } from "./coach.ts";

const base: CoachInput = {
  status: "live", startsInMs: 0, dropped: true, live: { position: 1, soldOut: false }, pickFirst: false, hold: null, wonLive: false,
  waitPos: null, queueMoved: false, paidBefore: false, slowServer: false,
};
const line = (o: Partial<CoachInput>) => coachLine({ ...base, ...o });

test("a piece that is already sold out never says Tap Dibs now", () => {
  const l = line({ live: { position: 1, soldOut: true } });
  assert.match(l, /Bots got there first/);
  assert.doesNotMatch(l, /Tap Dibs! now/);
});

test("after a promotion the waitlist line is gone, even while my status still lists the place", () => {
  const l = line({ waitPos: 1, hold: { position: 1, state: "held", promoted: true } });
  assert.match(l, /^It's yours! The buyer ahead didn't pay/);
  assert.doesNotMatch(l, /waitlist/);
});

test("a hold waiting for payment outranks a newer live piece", () => {
  const l = line({ live: { position: 2, soldOut: false }, hold: { position: 1, state: "held", promoted: true }, paidBefore: false });
  assert.match(l, /Open your order for #1/);
});

test("winnable is said only about piece 2, and never once it is lost", () => {
  assert.match(line({ live: { position: 2, soldOut: false }, paidBefore: true }), /beat the bots/);
  assert.match(line({ live: { position: 2, soldOut: false }, paidBefore: false }), /beat the bots/, "piece 2 by the fallback is just as winnable");
  assert.doesNotMatch(line({ live: { position: 3, soldOut: false }, paidBefore: true }), /beat the bots|winnable/);
  assert.doesNotMatch(line({ live: { position: 2, soldOut: true }, paidBefore: true }), /beat the bots|winnable/);
  assert.doesNotMatch(line({ live: { position: 2, soldOut: false }, paidBefore: true, waitPos: 2 }), /beat the bots|winnable/);
});

test("back in the room after paying for piece 1: point at piece 2, not 'that's the whole loop'", () => {
  const l = line({ wonLive: true, paidBefore: true });
  assert.match(l, /Piece 2 drops in a moment/);
  assert.doesNotMatch(l, /whole loop/);
});

test("winning piece 2 says Clean win, not the order chore", () => {
  const l = line({ live: { position: 2, soldOut: false }, wonLive: true, hold: { position: 2, state: "held", promoted: false }, paidBefore: true });
  assert.equal(l, "Clean win! You beat the bots on this one.");
});

test("live while nothing is picked: pick first, never 'Tap Dibs! now' over a grey button", () => {
  assert.equal(line({ pickFirst: true }), "It's live! Pick a size/colour, then tap Dibs!");
  assert.match(line({ pickFirst: true, live: { position: 2, soldOut: false } }), /^Pick a size\/colour, then tap Dibs! You can beat the bots/);
  assert.match(line({ pickFirst: true, live: { position: 1, soldOut: true } }), /Bots got there first/, "a sold-out piece preselects a line");
});

test("before piece 1 in a live demo room: the countdown, not 'next piece'", () => {
  assert.equal(line({ live: null, dropped: false, startsInMs: 4200 }), "Piece 1 drops in 5… get ready to tap Dibs!");
  assert.equal(line({ live: null, dropped: false, startsInMs: 0 }), "Piece 1 is about to drop… get your thumb ready.");
});

test("waitlist, queue moving, ended, waiting room and a slow server", () => {
  assert.equal(line({ waitPos: 3 }), "Bots tap fast. You're #3 on the waitlist.");
  assert.match(line({ waitPos: 2, queueMoved: true }), /you're #2 now/);
  assert.match(line({ status: "ended", hold: { position: 1, state: "held", promoted: false } }), /^That's the whole demo/);
  assert.equal(line({ status: "scheduled", live: null, dropped: false, startsInMs: 4200 }), "Piece 1 drops in 5… get ready to tap Dibs!");
  assert.equal(line({ live: null, slowServer: true }), "Waiting for the server…");
  assert.match(line({ hold: { position: 1, state: "payment_claimed", promoted: true } }), /Payment sent/);
});

test("end card facts: only recorded times, in piece order; a won tap outlives its expired hold", () => {
  const promoted = { position: 1, ms: 1200, promotedMs: 23_400, waitedAt: 3 };
  const won = { position: 2, ms: 900, promotedMs: null, waitedAt: null };
  assert.deepEqual(demoFacts([won, promoted], null), [
    "Piece 1: waitlisted at #3, yours 23.4\u00a0s after your tap",
    "Piece 2: won 0.9\u00a0s after it dropped",
  ]);
  // piece 2's hold ran out (gone from my status): the claim answer in memory still says it
  assert.deepEqual(demoFacts([promoted], { position: 2, ms: 900 }), ["Piece 1: waitlisted at #3, yours 23.4\u00a0s after your tap", "Piece 2: won 0.9\u00a0s after it dropped"]);
  assert.deepEqual(demoFacts([won], { position: 2, ms: 900 }), ["Piece 2: won 0.9\u00a0s after it dropped"], "no duplicate");
  // an older server without the 0016 keys, or a judge who never tapped: nothing invented
  assert.deepEqual(demoFacts([{ position: 1 }], null), []);
  assert.deepEqual(demoFacts([], null), []);
  assert.deepEqual(demoFacts([{ position: 1, ms: 1200, promotedMs: 5000, waitedAt: null }], null), ["Piece 1: waitlisted, yours 5.0\u00a0s after your tap"]);
});
