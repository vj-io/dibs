import assert from "node:assert/strict";
import { test } from "node:test";
import { holdOrder, sellerCoach } from "./consoleLogic.ts";

const row = (state: string, extra: object = {}) => ({ state, promoted: false, ...extra }) as never;
const items = (s: string) => [{ state: s }] as never;
const base = { status: "live" as const, live: null, items: items("queued") };
const none = { ledger: [], moderation: [], bans: [] };

test("coach follows the seller demo script from real state", () => {
  assert.match(sellerCoach({ ...base, status: "scheduled" }, none), /^Press Go live, then Drop next — 40 demo buyers/);
  assert.equal(sellerCoach(base, none), "Press Drop next — 40 demo buyers are waiting");
  assert.equal(sellerCoach({ ...base, items: items("live") }, none), "Watch the ledger: first taps win, the rest queue");
  assert.equal(sellerCoach(base, { ...none, ledger: [row("held"), row("waitlisted")] }), "Demo holds run out fast: watch the queue move by itself");
  assert.equal(sellerCoach(base, { ...none, ledger: [row("held"), row("payment_claimed")] }), "Open an order that says paid and confirm it");
  assert.equal(sellerCoach(base, { ...none, ledger: [row("paid"), row("payment_claimed")] }), "Mark it shipped");
  const caught = { ledger: [row("shipped")], moderation: [{ rule: "upi", buyerId: "b1" }] as never, bans: [] };
  assert.equal(sellerCoach(base, caught), "Mute the buyer the scam shield caught");
  assert.equal(sellerCoach(base, { ...caught, bans: [{ buyerId: "b1" }] as never }), "End the drop and see the results");
  assert.equal(sellerCoach(base, { ...none, ledger: [row("shipped")] }), "End the drop and see the results");
  assert.match(sellerCoach({ ...base, status: "ended" }, none), /results/);
});

test("ledger order holds still while frozen; new rows go last", () => {
  const a = { claimId: "a" }, b = { claimId: "b" }, c = { claimId: "c" };
  assert.deepEqual(holdOrder([b, a], null), [b, a]);
  assert.deepEqual(holdOrder([b, c, a], ["a", "b"]), [a, b, c]);
});
