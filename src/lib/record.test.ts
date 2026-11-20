import test from "node:test";
import assert from "node:assert/strict";
import { buildRecord, payLines, recordHeadline, totalsLine, type RecordPiece, type RecordTap } from "./record.ts";

const pieces: RecordPiece[] = [
  { itemId: "i2", position: 2, title: "Note", liveAt: "2026-11-20T06:47:45.426Z", variants: 1 },
  { itemId: "i1", position: 1, title: "Review", liveAt: "2026-11-20T06:45:15.277Z", variants: 2 },
];
const tap = (t: Partial<RecordTap> & Pick<RecordTap, "seq" | "itemId" | "buyerId" | "buyer">): RecordTap =>
  ({ isBot: false, variantLabel: "M", state: "paid", ms: 1000, promoted: false, waitPos: null, passedTo: null, ...t });

// handed over shuffled: the record must follow seq (the server's commit order), not the input order
const taps: RecordTap[] = [
  tap({ seq: 3, itemId: "i1", buyerId: "b3", buyer: "9876543210 Priya Sharma", state: "shipped", ms: 7608, promoted: true, waitPos: 1 }),
  tap({ seq: 1, itemId: "i1", buyerId: "b1", buyer: "Kuldeep", state: "released", ms: 3128, passedTo: "9876543210 Priya Sharma" }),
  tap({ seq: 4, itemId: "i2", buyerId: "b2", buyer: "Aarav", isBot: true, state: "waitlisted", ms: 19077, waitPos: 2 }),
  tap({ seq: 2, itemId: "i1", buyerId: "b2", buyer: "Aarav", isBot: true, state: "expired", ms: 6164 }),
];

test("record keeps the server's order and says what happened", () => {
  const r = buildRecord(pieces, taps);
  assert.deepEqual(r.pieces.map((p) => p.position), [1, 2]);
  assert.deepEqual(r.pieces[0].taps.map((t) => t.name), ["Kuldeep", "Aarav", "Priya S."]);
  assert.deepEqual(r.pieces[0].taps.map((t) => t.steps.join(" → ")), [
    "Won → Released the hold → went to Priya S.",
    "Won → Hold ran out",
    "Waitlisted #1 → Got it from the waitlist → Paid",
  ]);
  assert.deepEqual(r.pieces[0].taps.map((t) => t.time), ["3.1 s", "6.2 s", "7.6 s"]);
  assert.equal(r.pieces[0].taps[1].isBot, true);
  assert.equal(r.pieces[0].taps[0].variant, "M", "size shown when the piece has more than one");
  assert.equal(r.pieces[1].taps[0].variant, null);
  assert.deepEqual(r.pieces[1].taps[0].steps, ["Waitlisted #2", "Still in line"]);
  assert.deepEqual(r.totals, { pieces: 2, taps: 4, buyers: 3, fastestMs: 3128 });
  assert.equal(totalsLine(r.totals), "2 pieces · 4 taps · 3 buyers");
  assert.equal(recordHeadline(r.totals, "ended", false), "Fair drop: 2 pieces · 4 taps · fastest tap 3.1 s");
  assert.equal(recordHeadline(r.totals, "ended", true), "Demo drop: 2 pieces · 4 taps · fastest tap 3.1 s");
});

test("record never contains a phone number", () => {
  const out = JSON.stringify(buildRecord(pieces, taps));
  assert.doesNotMatch(out, /\d{10}|98765/);
});

test("paid-order lines: real, demo, and none when nothing is paid", () => {
  assert.deepEqual(payLines({ paidOrders: 6, spanMs: 332_027, medianPayMs: 71_732 }, false), [
    "6 orders sold and paid in 5.5 minutes",
    "Median time from order to confirmed payment: 1.2 minutes",
  ]);
  assert.deepEqual(payLines({ paidOrders: 1, spanMs: 45_000, medianPayMs: 12_400 }, true), [
    "1 demo order sold and paid in 45 s (demo payments, not real money)",
    "Median time from order to confirmed payment: 12 s",
  ]);
  assert.deepEqual(payLines({ paidOrders: 0, spanMs: null, medianPayMs: null }, false), []);
});
