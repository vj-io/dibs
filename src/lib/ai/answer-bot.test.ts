import test from "node:test";
import assert from "node:assert/strict";
import { buildKnowledge, isQuestion, validateAnswer } from "./answer-bot.ts";

const live = { title: "Silk saree", pricePaise: 145000, note: "Pure silk", variants: [{ label: "Red", left: 2 }, { label: "Blue", left: 0 }] };
const faq = ["COD available, shipping 3-5 days", "Returns within 7 days if unopened", "10% off on 3 pieces"];
const K = buildKnowledge(faq, live);

test("isQuestion", () => {
  for (const t of ["price?", "kitne ka hai", "COD hai kya", "M size hai?", "kab milega", "shipping?", "is it original", "silver ya gold", "delivery kitne din", "milega?", "colour?", "Is this available 👀?"])
    assert.ok(isQuestion(t), t);
  for (const t of ["booked", "wow 😍", "mine!", "#3 M", "nice saree", "done", "Love the colour", "Beautiful work", "So pretty", "silver", "M",
    "gold colour 😍", "waiting for the choker", "what a beauty", "price list is nice", "first time here, nice"]) assert.ok(!isQuestion(t), t);
  for (const t of ["silver hai kya", "COD milega", "price?", "any discount?", "which size is left", "Is it 925 silver"]) assert.ok(isQuestion(t), t);
});
test("buildKnowledge", () => {
  assert.match(K, /Price: ₹1,450\b/);
  assert.match(K, /Blue \(sold out\)/);
  assert.match(K, /- COD available/);
  assert.equal(buildKnowledge([], null), "");
  assert.equal(buildKnowledge(["", " "], null), "");
});
test("validateAnswer accepts grounded answers", () => {
  assert.deepEqual(validateAnswer({ answerable: true, answer: "Yes, COD hai. Shipping 3-5 days." }, K), { answerable: true, answer: "Yes, COD hai. Shipping 3-5 days." });
  assert.equal(validateAnswer({ answerable: true, answer: "Price ₹1450, 2 red left." }, K).answerable, true);
  assert.equal(validateAnswer({ answerable: true, answer: "Rs 1,450 only" }, K).answerable, true);
  assert.equal(validateAnswer('```json\n{"answerable": true, "answer": "Return within 7 days"}\n```', K).answerable, true);
  assert.equal(validateAnswer({ answerable: true, answer: "Pure silk hai" }, K).answerable, true);
});
test("validateAnswer never invents price, discount or days", () => {
  for (const a of ["Price is ₹999", "Rs. 1200 mein mil jayega", "1200 rupees only", "20% off for you", "25 percent discount", "Delivery in 4 days", "Aaj 6 din mein pahunch jayega", "Only ₹1,450 but 500 rs shipping", "Free in 24 hours"]) {
    const r = validateAnswer({ answerable: true, answer: a }, K);
    assert.deepEqual(r, { answerable: false, answer: "" }, a);
  }
});
test("validateAnswer handles bad output", () => {
  for (const raw of [null, undefined, "", "sorry", "{bad json", { answerable: "yes" }, { answerable: true }, { answerable: true, answer: "  " }, { answerable: false, answer: "COD hai" }, 5])
    assert.deepEqual(validateAnswer(raw, K), { answerable: false, answer: "" });
});
test("validateAnswer trims to 160", () => {
  const r = validateAnswer({ answerable: true, answer: "  " + "COD hai. ".repeat(40) }, K);
  assert.ok(r.answerable && r.answer.length <= 160);
});
