import assert from "node:assert/strict";
import { test } from "node:test";
import { deskFeedFloor, holdOrder, sellerCoach } from "./consoleLogic.ts";

const row = (state: string, extra: object = {}) => ({ state, promoted: false, ...extra }) as never;
const items = (s: string) => [{ state: s }] as never;
const base = { status: "live" as const, live: null, items: items("queued") };
const none = { ledger: [], moderation: [], bans: [] };

test("coach follows the seller demo script from real state, and names where each step happens", () => {
  assert.match(sellerCoach({ ...base, status: "scheduled" }, none).text, /^Press Go live, then Drop next — 40 demo buyers/);
  assert.deepEqual(sellerCoach(base, none), { text: "Press Drop next — 40 demo buyers are waiting", step: "drop" });
  assert.deepEqual(sellerCoach({ ...base, items: items("live") }, none), { text: "Watch the ledger: first taps win, the rest queue", step: "claims" });
  assert.equal(sellerCoach(base, { ...none, ledger: [row("held"), row("waitlisted")] }).text, "Demo holds run out fast: watch the queue move by itself");
  assert.deepEqual(sellerCoach(base, { ...none, ledger: [row("held"), row("payment_claimed")] }), { text: "Open an order that says paid and confirm it", step: "claims" });
  assert.equal(sellerCoach(base, { ...none, ledger: [row("paid"), row("payment_claimed")] }).text, "Mark it shipped");
  const caught = { ledger: [row("shipped")], moderation: [{ rule: "upi", buyerId: "b1" }] as never, bans: [] };
  assert.deepEqual(sellerCoach(base, caught), { text: "Mute the buyer the scam shield caught", step: "moderation" });
  assert.deepEqual(sellerCoach(base, { ...caught, bans: [{ buyerId: "b1" }] as never }), { text: "End the drop and see the results", step: "end" });
  assert.equal(sellerCoach(base, { ...none, ledger: [row("shipped")] }).text, "End the drop and see the results");
  assert.deepEqual(sellerCoach({ ...base, status: "ended" }, none).step, "results");
  assert.match(sellerCoach({ ...base, status: "ended" }, none).text, /results/);
});

test("ledger order holds still while frozen; new rows go last", () => {
  const a = { claimId: "a" }, b = { claimId: "b" }, c = { claimId: "c" };
  assert.deepEqual(holdOrder([b, a], null), [b, a]);
  assert.deepEqual(holdOrder([b, c, a], ["a", "b"]), [a, b, c]);
});

test("demo desk feed starts at this visit's drop; real shops show everything", () => {
  const drops = [{ createdAt: "2026-11-20T03:32:00.000Z" }, { createdAt: "2026-11-20T03:40:00.000Z" }];
  const floor = deskFeedFloor(true, drops);
  assert.equal(floor, Date.parse("2026-11-20T03:32:00.000Z") - 2000);
  const feed = [Date.parse("2026-11-20T03:02:00.000Z"), Date.parse("2026-11-20T03:32:05.000Z")];
  assert.deepEqual(feed.filter((at) => at >= floor), [feed[1]], "an earlier visitor's 3:02 am order is not shown");
  assert.equal(deskFeedFloor(true, null), Infinity);
  assert.equal(deskFeedFloor(true, []), 0);
  assert.equal(deskFeedFloor(false, drops), 0);
});
