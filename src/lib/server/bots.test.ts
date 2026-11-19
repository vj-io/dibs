import test from "node:test";
import assert from "node:assert/strict";
import { SCRIPT, chooseKeep, itemPlan, leaveOffsets, planTaps, servedAt } from "./bots.ts";

const JHUMKA = [{ key: "gold", qty: 1 }, { key: "silver", qty: 1 }, { key: "rose", qty: 2 }];

test("piece 1: ten bot taps within 80-400 ms, each variant sold with 2 bots waiting", () => {
  const t = planTaps("buyer", 1, JHUMKA);
  assert.equal(t.length, 10);
  assert.ok(t.every((x) => x.ms >= 80 && x.ms <= 400));
  for (const v of JHUMKA) assert.equal(t.filter((x) => x.variant === v.key).length, v.qty + 2);
});

test("piece 2: first bot per variant at 1.5-3 s leaves a unit, the rest come after 10 s", () => {
  const t = planTaps("buyer", 2, [{ key: "green", qty: 2 }, { key: "red", qty: 2 }]);
  assert.ok(t.filter((x) => x.ms < 10_000).every((x) => x.ms >= 1500 && x.ms <= 3000));
  assert.equal(t.filter((x) => x.ms < 10_000).length, 2);
});

test("piece 2: every variant keeps a unit for the first 10 s", () => {
  for (let n = 0; n < 50; n++) {
    const vs = [{ key: "a", qty: 1 }, { key: "b", qty: 2 }, { key: "c", qty: 3 }];
    const t = planTaps("buyer", 2, vs);
    for (const v of vs) assert.ok(t.filter((x) => x.variant === v.key && x.ms < 10_000).length <= v.qty - 1, v.key);
  }
});

test("buyer script: piece 2 is the last; it carries the demo's end, and no piece after it drops", () => {
  const bots = Array.from({ length: 40 }, (_, i) => ({ id: `b${i}`, uid: `demo_bot_${i}`, name: `Bot ${i}` }));
  const item = (position: number) => ({ id: `i${position}`, position, variants: [{ key: "green", qty: 2 }, { key: "red", qty: 2 }] });
  const p2 = itemPlan({ role: "buyer" }, item(2), bots);
  assert.deepEqual(p2.filter((r) => r.action !== "tap"), [{ ms: SCRIPT.lastEndMs, action: "end", payload: {} }]);
  assert.ok(Math.max(...p2.filter((r) => r.action === "tap").map((r) => r.ms)) < SCRIPT.lastEndMs, "every bot tap lands before the end");
  assert.deepEqual(itemPlan({ role: "buyer" }, item(1), bots).filter((r) => r.action !== "tap"), [], "piece 1: piece 2 waits for the judge");
  assert.deepEqual(planTaps("buyer", 3, item(3).variants), []);
  const seller = itemPlan({ role: "seller" }, item(2), bots);
  assert.ok(seller.every((r) => r.action === "tap") && seller.length === 8, "the seller demo is unchanged: taps only, the judge drops and ends");
});

test("seller: 3 fast taps, 5 more over 1-6 s", () => {
  const t = planTaps("seller", 1, JHUMKA);
  assert.equal(t.filter((x) => x.ms <= 400).length, 3);
  assert.equal(t.filter((x) => x.ms >= 1000 && x.ms <= 6000).length, 5);
});

test("servedAt chains 12 s bot holds", () => {
  assert.equal(servedAt([12_000], 0), 12_000);
  assert.equal(servedAt([12_000], 2), 36_000);
  assert.equal(servedAt([12_000, 12_300], 2), 24_000);
  assert.equal(servedAt([], 0), Infinity);
});

test("chooseKeep: judge promoted within 30 s of the tap, as many bots ahead as allowed", () => {
  // tap 1 s after live, one unit (bot hold ends at 12.1 s), 2 bots ahead: keep 1 -> promoted at 24.1 s
  assert.equal(chooseKeep([12_100], 2, 1000), 1);
  // two units: both bots ahead can stay -> promoted at 24.1 s
  assert.equal(chooseKeep([12_100, 12_300], 2, 1000), 2);
  // late tap (after the first promotion): nobody needs to leave
  assert.equal(chooseKeep([24_100], 1, 14_000), 1);
  // holds that end too late: all leave
  assert.equal(chooseKeep([60_000], 3, 0), 0);
  for (let tap = 1000; tap <= 10_000; tap += 500)
    for (const ends of [[12_100], [12_100, 12_400]]) {
      const k = chooseKeep(ends, 2, tap);
      const at = servedAt(ends, k);
      assert.ok(at - tap <= 30_000 && at - tap >= 10_000, `tap ${tap} ends ${ends}: ${at - tap}`);
    }
});

test("leaveOffsets: spread out, all before the first hold ends", () => {
  const o = leaveOffsets(3, 14_000);
  assert.equal(o.length, 3);
  assert.ok(o[0] > 0 && o[0] < o[1] && o[1] < o[2] && o[2] <= 14_000 - 1200);
  assert.deepEqual(leaveOffsets(2, 500), [0, 0]);
  assert.ok(leaveOffsets(1, Infinity)[0] > 0);
});
