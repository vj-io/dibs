import { test } from "node:test";
import assert from "node:assert/strict";
import { TapMetric } from "./tap-metric.ts";

const id = "6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
const ok = (o: object) => TapMetric.safeParse({ dropId: id, result: "won", clientMs: 420, ...o }).success;

test("tap metric: accepts a normal report", () => {
  assert.ok(ok({}));
  assert.ok(ok({ serverMs: 85, conn: "4g", clientMs: 0 }));
  assert.ok(ok({ clientMs: 60000 }));
});
test("tap metric: rejects out-of-range, fractional, bad ids and stray fields (names, phones)", () => {
  assert.ok(!ok({ clientMs: 60001 }));
  assert.ok(!ok({ clientMs: -1 }));
  assert.ok(!ok({ clientMs: 12.5 }));
  assert.ok(!ok({ dropId: "nope" }));
  assert.ok(!ok({ result: "Won!" }));
  assert.ok(!ok({ conn: "wifi" }));
  assert.ok(!ok({ phone: "9876543210" }));
  assert.ok(!ok({ name: "Priya" }));
});
