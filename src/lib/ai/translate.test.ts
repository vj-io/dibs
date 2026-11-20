import test from "node:test";
import assert from "node:assert/strict";
import { translate, TranslateBody } from "./jobs.ts";
import { cachedTranslator, defaultTarget, type Lang } from "./translate.ts";

test("default target: staff read English; a buyer reads Hindi only when the browser asks for it", () => {
  for (const l of ["hi", "hi-IN", "en-IN", "", undefined]) assert.equal(defaultTarget("staff", l), "en", String(l));
  for (const l of ["hi", "hi-IN", "HI-in"]) assert.equal(defaultTarget("buyer", l), "hi", l);
  for (const l of ["en-IN", "en", "", "hil", "mr-IN", undefined]) assert.equal(defaultTarget("buyer", l), "en", String(l));
});

test("body: text 1-500 characters after trimming, target en or hi", () => {
  assert.deepEqual(TranslateBody.parse({ text: "  kal tak milega?  ", to: "en" }), { text: "kal tak milega?", to: "en" });
  assert.ok(TranslateBody.safeParse({ text: "x".repeat(500), to: "hi" }).success);
  for (const b of [{ text: "x".repeat(501), to: "hi" }, { text: "  ", to: "en" }, { text: "hi", to: "fr" }, { text: "hi" }, { to: "en" }, { text: 5, to: "en" }, null])
    assert.equal(TranslateBody.safeParse(b).success, false, JSON.stringify(b));
});

function fakeAi(answer: (text: string, to: Lang) => string | null) {
  const calls: string[] = [];
  return { calls, ai: async (text: string, to: Lang) => { calls.push(`${to}:${text}`); return answer(text, to); } };
}

test("cache: a repeated tap is not a second model call; the target is part of the key", async () => {
  const f = fakeAi((t, to) => `${to}(${t})`);
  const tr = cachedTranslator(f.ai);
  assert.equal(await tr("kal tak?", "en"), "en(kal tak?)");
  assert.equal(await tr("kal tak?", "en"), "en(kal tak?)");
  assert.equal(await tr("kal tak?", "hi"), "hi(kal tak?)");
  assert.deepEqual(f.calls, ["en:kal tak?", "hi:kal tak?"]);
});

test("cache: a failure is not remembered, so Try again asks the model again", async () => {
  let up = false;
  const f = fakeAi(() => (up ? "ok" : null));
  const tr = cachedTranslator(f.ai);
  assert.equal(await tr("a", "en"), null);
  up = true;
  assert.equal(await tr("a", "en"), "ok");
  assert.equal(f.calls.length, 2);
});

test("cache: capped, the oldest entry goes first", async () => {
  const f = fakeAi((t) => t.toUpperCase());
  const tr = cachedTranslator(f.ai, 2);
  await tr("a", "en"); await tr("b", "en"); await tr("c", "en"); // "a" dropped
  await tr("c", "en"); await tr("b", "en");
  assert.equal(f.calls.length, 3, "b and c still cached");
  await tr("a", "en");
  assert.deepEqual(f.calls, ["en:a", "en:b", "en:c", "en:a"]);
});

test("translate: no model reachable (no key here) answers null, which the route turns into a 503", async () => {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; // generateJson stops before any network call
  try { assert.equal(await translate("Bhaiya ye kal tak mil jayega kya?", "en"), null); }
  finally { if (key !== undefined) process.env.GOOGLE_GENERATIVE_AI_API_KEY = key; }
});
