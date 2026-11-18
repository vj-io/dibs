import test from "node:test";
import assert from "node:assert/strict";
import { isIndianPhone, isUpiId, upiLink } from "./upi.ts";

test("upiLink matches the PRD shape", () => {
  assert.equal(
    upiLink({ upiId: "meera@upi", payee: "Meera Jewels", amountPaise: 145000, orderNo: 123 }),
    "upi://pay?pa=meera%40upi&pn=Meera%20Jewels&am=1450.00&cu=INR&tn=Dibs%20order%20123",
  );
});
test("upiLink keeps paise and encodes the payee", () => {
  const l = upiLink({ upiId: "a.b@ybl", payee: "R&D Saree's", amountPaise: 12905, orderNo: 7 });
  assert.match(l, /&am=129\.05&/);
  assert.match(l, /pn=R%26D%20Saree's&/);
});
test("isUpiId", () => {
  for (const ok of ["meera@upi", "98765.43210@ybl", "a-b_c@okaxis"]) assert.ok(isUpiId(ok), ok);
  for (const bad of ["meera", "a@b", "meera@gmail.com", "@upi", "me era@upi", ""]) assert.ok(!isUpiId(bad), bad);
});
test("isIndianPhone normalises", () => {
  for (const s of ["9876543210", "98765 43210", "+91 98765-43210", "+919876543210", "09876543210", "0091 98765 43210", "98765.43210", "(98765) 43210"])
    assert.equal(isIndianPhone(s), "9876543210", s);
  for (const s of ["1234567890", "5876543210", "987654321", "98765432101", "abc9876543210", "98765+43210", "", "+91 12345 67890"])
    assert.equal(isIndianPhone(s), null, s);
});
