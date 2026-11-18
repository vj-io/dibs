import test from "node:test";
import assert from "node:assert/strict";
import { claimIntent, promptText } from "./claim-helper.ts";

const live = { itemId: "it3", position: 3, variants: [{ key: "s", label: "S" }, { key: "m", label: "M" }, { key: "l", label: "L" }] };
const colours = { itemId: "it3", position: 3, variants: [{ key: "b1", label: "Blue" }, { key: "b2", label: "Navy Blue" }, { key: "r", label: "Red" }] };
const one = { itemId: "it3", position: 3, variants: [{ key: "free", label: "Free size" }] };
const p = (variantKey: string | null) => ({ kind: "prompt", itemId: "it3", position: 3, variantKey });

test("keyword claims", () => {
  for (const t of ["booked", "Mine!", "dibs", "mera", "mujhe chahiye", "I want this", "le lunga", "le lungi", "lena hai", "sold", "done", "I'll take it", "Booked 🙌"])
    assert.deepEqual(claimIntent(t, live, []), p(null), t);
});
test("variants and aliases", () => {
  assert.deepEqual(claimIntent("M wala chahiye", live, []), p("m"));
  assert.deepEqual(claimIntent("mujhe large chahiye", live, []), p("l"));
  assert.deepEqual(claimIntent("booked small", live, []), p("s"));
  assert.deepEqual(claimIntent("I'm taking medium, booked", live, []), p("m"));
  assert.deepEqual(claimIntent("mine L", live, []), p("l"));
  assert.deepEqual(claimIntent("laal chahiye", { ...colours, variants: [{ key: "r", label: "Red" }, { key: "k", label: "Black" }] }, []), p("r"));
  assert.deepEqual(claimIntent("XL booked", { ...live, variants: [...live.variants, { key: "xl", label: "XL" }] }, []), p("xl"));
  assert.deepEqual(claimIntent("extra large booked", { ...live, variants: [...live.variants, { key: "xl", label: "XL" }] }, []), p("xl"));
});
test("item numbers", () => {
  assert.deepEqual(claimIntent("#3 red please", colours, []), p("r"));
  assert.deepEqual(claimIntent("3 no", live, []), p(null));
  assert.deepEqual(claimIntent("no 3 booked", live, []), p(null));
  assert.deepEqual(claimIntent("number 3 mine", live, []), p(null));
  assert.deepEqual(claimIntent("#3", one, []), p("free"), "label Free size is not mentioned");
});
test("another item's number", () => {
  assert.deepEqual(claimIntent("#2 booked", live, [1, 2]), { kind: "none" });
  assert.deepEqual(claimIntent("#9 booked", live, [1, 2]), { kind: "unclear" });
  assert.deepEqual(claimIntent("#2 and #3 booked", live, [2]), { kind: "unclear" });
});
test("questions are never claims", () => {
  for (const t of ["M size hai?", "price?", "mine?", "kitna hai", "booked kaise karu", "kya M milega", "can I book?", "#3 price kya hai", "I want to know price"])
    assert.deepEqual(claimIntent(t, live, []), { kind: "none" }, t);
});
test("chatter is nothing", () => {
  for (const t of ["", "nice", "wow 😍", "M", "red", "so pretty", "I'm here", "hello"])
    assert.deepEqual(claimIntent(t, live, []), { kind: "none" }, t);
});
test("unclear goes to the model", () => {
  assert.deepEqual(claimIntent("woh blue wala", colours, []), { kind: "unclear" });
  assert.deepEqual(claimIntent("booked blue", colours, []), { kind: "unclear" }, "blue is also Navy Blue");
  assert.deepEqual(claimIntent("booked navy blue", colours, []), p("b2"));
  assert.deepEqual(claimIntent("woh wala", live, []), { kind: "unclear" });
  assert.deepEqual(claimIntent("M ya L booked", live, []), { kind: "unclear" });
});
test("promptText is the PRD copy", () => {
  assert.equal(promptText(3, "M"), "Want this? Tap to Dibs #3 · M");
  assert.equal(promptText(12, null), "Want this? Tap to Dibs #12");
});
