// The audit's coach contradictions (docs/audit-ux.md finding 3), as cases.
import test from "node:test";
import assert from "node:assert/strict";
import { coachLine, type CoachInput } from "./coach.ts";

const base: CoachInput = {
  status: "live", startsInMs: 0, live: { position: 1, soldOut: false }, hold: null, wonLive: false, waitPos: null,
  queueMoved: false, paidBefore: false, slowServer: false,
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

test("winnable is never said about a piece that is lost", () => {
  assert.match(line({ live: { position: 3, soldOut: false }, paidBefore: true }), /beat the bots/);
  assert.doesNotMatch(line({ live: { position: 3, soldOut: true }, paidBefore: true }), /beat the bots|winnable/);
  assert.doesNotMatch(line({ live: { position: 3, soldOut: false }, paidBefore: true, waitPos: 2 }), /beat the bots|winnable/);
});

test("waitlist, queue moving, ended, waiting room and a slow server", () => {
  assert.equal(line({ waitPos: 3 }), "Bots tap fast. You're #3 on the waitlist.");
  assert.match(line({ waitPos: 2, queueMoved: true }), /you're #2 now/);
  assert.match(line({ status: "ended", hold: { position: 1, state: "held", promoted: false } }), /That's Dibs/);
  assert.equal(line({ status: "scheduled", live: null, startsInMs: 4200 }), "Piece 1 drops in 5… get ready to tap Dibs!");
  assert.equal(line({ live: null, slowServer: true }), "Waiting for the server…");
  assert.match(line({ hold: { position: 1, state: "payment_claimed", promoted: true } }), /Payment sent/);
});
