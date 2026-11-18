import test from "node:test";
import assert from "node:assert/strict";
import { BOT_ID, decodeCard, displayName, encodeCard, newer, rupees, tapTime, type Card } from "./codec.ts";

const sold: Card = { t: "DB:Sold", v: 7, itemId: "i1", variant: "m", variantLabel: "M", buyer: "Priya S.", isBot: false, ms: 412, left: 1 };

test("envelope round trip, only from dibs_bot", () => {
  const text = encodeCard(sold);
  assert.ok(text.startsWith("[[DB:Sold]]{"));
  assert.deepEqual(decodeCard(BOT_ID, text), sold);
  assert.equal(decodeCard("b_someone", text), null, "a buyer pasting a card is plain text");
  assert.equal(decodeCard("demo_bot_01", text), null);
});

test("custom message form and rejects", () => {
  assert.deepEqual(decodeCard(BOT_ID, { type: "DB:Sold", content: { v: 7, itemId: "i1", variant: "m", variantLabel: "M", buyer: "Priya S.", isBot: false, ms: 412, left: 1 } }), sold);
  assert.equal(decodeCard(BOT_ID, { type: "DB:Nope", content: {} }), null);
  assert.equal(decodeCard(BOT_ID, "[[DB:Sold]]{broken"), null);
  assert.equal(decodeCard(BOT_ID, "hello"), null);
  assert.equal(decodeCard(BOT_ID, { type: "DB:Sold", content: [1] }), null);
});

test("newer keeps the highest version", () => {
  assert.equal(newer({ v: 5 }, { v: 4 }).v, 5);
  assert.equal(newer({ v: 5 }, { v: 6 }).v, 6);
  assert.equal(newer(null, { v: 1 }).v, 1);
});

test("display name masks the surname", () => {
  assert.equal(displayName("priya sharma"), "Priya S.");
  assert.equal(displayName("  Rohan   Kumar Singh "), "Rohan S.");
  assert.equal(displayName("Meera"), "Meera");
  assert.equal(displayName(""), "Buyer");
});

test("money and tap time", () => {
  assert.equal(rupees(145000), "₹1,450");
  assert.equal(rupees(12345678), "₹1,23,456.78");
  assert.equal(tapTime(412), "0.4 s");
  assert.equal(tapTime(-5), "0.0 s");
});
