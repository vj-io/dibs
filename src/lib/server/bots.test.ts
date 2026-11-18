import test from "node:test";
import assert from "node:assert/strict";
import { chooseKeep, leaveOffsets, planTaps, servedAt } from "./bots.ts";

const JHUMKA = [{ key: "gold", qty: 1 }, { key: "silver", qty: 1 }, { key: "rose", qty: 2 }];

test("piece 1: ten bot taps within 80-400 ms, each variant sold with 2 bots waiting", () => {
  const t = planTaps("buyer", 1, JHUMKA);
  assert.equal(t.length, 10);
  assert.ok(t.every((x) => x.ms >= 80 && x.ms <= 400));
  for (const v of JHUMKA) assert.equal(t.filter((x) => x.variant === v.key).length, v.qty + 2);
});

test("piece 2: first bot per variant at 1.5-3 s leaves a unit, the rest come after 6 s", () => {
  const t = planTaps("buyer", 2, [{ key: "green", qty: 2 }, { key: "red", qty: 2 }]);
  assert.ok(t.filter((x) => x.ms < 6000).every((x) => x.ms >= 1500 && x.ms <= 3000));
  assert.equal(t.filter((x) => x.ms < 6000).length, 2);
});

test("piece 2: every variant keeps a unit for the first 6 s", () => {
  for (let n = 0; n < 50; n++) {
    const vs = [{ key: "a", qty: 1 }, { key: "b", qty: 2 }, { key: "c", qty: 3 }];
    const t = planTaps("buyer", 2, vs);
    for (const v of vs) assert.ok(t.filter((x) => x.variant === v.key && x.ms < 6000).length <= v.qty - 1, v.key);
  }
});

test("seller: 3 fast taps, 5 more over 1-6 s", () => {
  const t = planTaps("seller", 1, JHUMKA);
  assert.equal(t.filter((x) => x.ms <= 400).length, 3);
  assert.equal(t.filter((x) => x.ms >= 1000 && x.ms <= 6000).length, 5);
});

test("servedAt chains 20 s holds", () => {
  assert.equal(servedAt([20_000], 0), 20_000);
  assert.equal(servedAt([20_000], 2), 60_000);
  assert.equal(servedAt([20_000, 20_300], 2), 40_000);
  assert.equal(servedAt([], 0), Infinity);
});

test("chooseKeep: judge promoted within 43 s of the tap, as many bots ahead as allowed", () => {
  // tap at +6 s after live, one unit (hold ends at 20.1 s), 2 bots ahead: keep 1 -> promoted at 40.1 s
  assert.equal(chooseKeep([20_100], 2, 6000), 1);
  // two units: both bots ahead can stay -> promoted at 40.1 s
  assert.equal(chooseKeep([20_100, 20_300], 2, 6000), 2);
  // late tap (after the first promotion): nobody needs to leave
  assert.equal(chooseKeep([40_100], 1, 26_000), 1);
  // holds that end too late: all leave
  assert.equal(chooseKeep([60_000], 3, 0), 0);
  for (let tap = 1000; tap <= 10_000; tap += 500)
    for (const ends of [[20_100], [20_100, 20_400]]) {
      const k = chooseKeep(ends, 2, tap);
      const at = servedAt(ends, k);
      assert.ok(at - tap <= 43_000 && at - tap >= 20_000, `tap ${tap} ends ${ends}: ${at - tap}`);
    }
});

test("leaveOffsets: spread out, all before the first hold ends", () => {
  const o = leaveOffsets(3, 14_000);
  assert.equal(o.length, 3);
  assert.ok(o[0] > 0 && o[0] < o[1] && o[1] < o[2] && o[2] <= 14_000 - 1200);
  assert.deepEqual(leaveOffsets(2, 500), [0, 0]);
  assert.ok(leaveOffsets(1, Infinity)[0] > 0);
});
