import test from "node:test";
import assert from "node:assert/strict";
import { borderline, scamRules } from "./scam-shield.ts";

const BLOCK: [string, string][] = [
  ["call me 9876543210", "phone"], ["98765 43210", "phone"], ["98765-43210", "phone"], ["98765.43210", "phone"],
  ["9 8 7 6 5 4 3 2 1 0", "phone"], ["+91-98765-43210", "phone"], ["+91 9876543210", "phone"], ["919876543210", "phone"],
  ["09876543210", "phone"], ["nine 8 7 6 5 4 3 2 1 0", "phone"], ["nine eight seven six five four three two one zero", "phone"],
  ["98 76 54 32 10", "phone"], ["८९७६५४३२१०", "phone"], ["९८७६५ ४३२१०", "phone"], ["mera number 7012345678 hai", "phone"],
  ["whatsapp me on 6000000001", "phone"], ["wa.me/919876543210", "phone"], ["t.me/sellerx", "phone"], ["９８７６５４３２１０", "phone"],
  ["Rs 1450 bhej do 8123456789", "phone"], ["nau 8 saat 6 5 4 3 2 1 0", "phone"], ["9876​543210", "phone"],
  ["pay to meera@upi", "upi"], ["name @ okaxis", "upi"], ["name at ybl", "upi"], ["name(at)paytm", "upi"], ["name [at] okhdfcbank", "upi"],
  ["priya at the rate of oksbi", "upi"], ["raj@ybl", "upi"], ["raj.k@okicici", "upi"], ["a@gmail.com", "upi"], ["mail me raj at gmail", "upi"],
  ["x@axl", "upi"], ["9876543210@paytm", "phone"], ["sunil_77 @ ibl", "upi"], ["shop (at) upi", "upi"],
  ["upi://pay?pa=x@ybl", "pay_link"], ["pay.google.com/xyz", "pay_link"], ["https://pay.me/abc", "pay_link"], ["http://x.in/payment?id=2", "pay_link"],
  ["phon.pe/abc", "pay_link"], ["rzp.io/l/xyz", "pay_link"], ["paytm.me/abcd", "pay_link"],
  ["send money first", "pay_request"], ["gpay 500 advance", "pay_request"], ["pay me 500", "pay_request"], ["phonepe pe 1000 bhejo", "pay_request"],
  ["send 500 advance", "pay_request"], ["transfer money now", "pay_request"], ["send me 200 on paytm", "pay_request"],
  ["account number 12345678901", "pay_request"], ["IFSC SBIN0001234", "pay_request"], ["paytm 1450", "pay_request"],
  ["paise bhej 500 abhi", "pay_request"], ["500 on gpay", "pay_request"],
];
const PASS = [
  "₹1450", "1450 rs", "price 1,450?", "kitne ka hai 1450?", "#3", "3 no", "no 3", "number 3 chahiye", "size 38", "sizes 8 9 10 11 12 13",
  "order 123456", "order 1234567890", "5876543210 is not mine", "booked", "mine!", "M size hai?", "Wow 😍", "price?", "kitna hai", "COD hai?",
  "nice saree", "mujhe red wala chahiye", "I'll take it", "3 pieces 2 red 1 blue", "1450 + 100 shipping", "6,00,000 rs ka car nahi hai",
  "do you accept gpay?", "can I pay by UPI?", "payment kaise karna hai", "pay kaise karu", "pay within 10 minutes", "I will pay now",
  "paid!", "7000 5000", "delivery 3 days", "4 5 6 7", "rate kya hai 899 rs", "#12 #13", "item 7 and 8", "Rs.1450 only", "2 no 3 no",
  "kal tak 500 mil jayega?", "25% off?", "1200 mein de do", "size M 38 40 42", "dibs on #4 L", "length 42 inch width 36",
  "bahut sundar hai", "ek piece chahiye", "teen din mein milega?", "nine to five", "one piece please", "pincode 560001", "8 pcs left",
  "@priya nice", "I'm in", "it's 1450", "weight 450 g", "call kab tak chalega", "live kab hai", "same price for all?",
  "ok done 👍", "mujhe 2 chahiye",
];

test("scamRules blocks with the right rule", () => {
  for (const [t, rule] of BLOCK) {
    const r = scamRules(t);
    assert.ok(r.blocked, `should block: ${t}`);
    assert.equal(r.rule, rule, `rule for: ${t}`);
  }
  assert.ok(BLOCK.length >= 40);
});
test("scamRules lets normal chat through", () => {
  for (const t of PASS) assert.deepEqual(scamRules(t), { blocked: false, rule: null }, `should pass: ${t}`);
  assert.ok(PASS.length >= 40);
});
test("borderline", () => {
  for (const t of ["DM me", "cheaper rate milega, msg me", "whatsapp me", "msg me personally", "inbox", "dm kar do", "apne pass sasta hai", "message me for deal", "contact me"])
    assert.ok(borderline(t), t);
  for (const t of ["price?", "booked", "#3 M", "size hai?", "nice"]) assert.ok(!borderline(t), t);
});
