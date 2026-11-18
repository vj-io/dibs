import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { encode, verifyWebhook } from "./nexconn.ts";

const creds = { appKey: "key123", appSecret: "secret456" };
const now = 1_795_000_000_000;
const signed = (over: Record<string, string> = {}) => {
  const nonce = "n0nce", ts = String(now - 1000);
  return new Headers({
    AppKey: creds.appKey, Nonce: nonce, Timestamp: ts,
    Signature: createHash("sha1").update(creds.appSecret + nonce + ts).digest("hex"), ...over,
  });
};

test("webhook: a correctly signed request passes (sha1 of secret + nonce + timestamp)", () => {
  assert.equal(verifyWebhook(signed(), creds, now), true);
  const h = signed(); h.set("Signature", h.get("Signature")!.toUpperCase());
  assert.equal(verifyWebhook(h, creds, now), true, "hex case does not matter");
});

test("webhook: wrong signature, app key, stale or missing fields fail", () => {
  assert.equal(verifyWebhook(signed({ Signature: "0".repeat(40) }), creds, now), false);
  assert.equal(verifyWebhook(signed({ AppKey: "other" }), creds, now), false);
  assert.equal(verifyWebhook(signed(), { ...creds, appSecret: "nope" }, now), false);
  assert.equal(verifyWebhook(signed(), creds, now + 6 * 60_000), false, "older than 5 min");
  assert.equal(verifyWebhook(signed({ Timestamp: "abc" }), creds, now), false);
  assert.equal(verifyWebhook(signed({ Nonce: "" }), creds, now), false);
  assert.equal(verifyWebhook(new Headers(), creds, now), false);
  assert.equal(verifyWebhook(signed(), { appKey: "", appSecret: "" }, now), false, "unconfigured never passes");
});

test("encode: cards as custom types or envelope text, text as RC:TxtMsg", () => {
  const card = { t: "DB:Hide", v: 3, messageId: "m1" } as const;
  assert.deepEqual(encode({ card }, false), { messageType: "DB:Hide", content: JSON.stringify({ v: 3, messageId: "m1" }) });
  assert.deepEqual(encode({ card }, true), { messageType: "RC:TxtMsg", content: JSON.stringify({ content: '[[DB:Hide]]{"v":3,"messageId":"m1"}' }) });
  assert.deepEqual(encode({ text: "hi" }), { messageType: "RC:TxtMsg", content: '{"content":"hi"}' });
});
