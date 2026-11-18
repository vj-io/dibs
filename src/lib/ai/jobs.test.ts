import test from "node:test";
import assert from "node:assert/strict";
import { scamVerdict } from "./jobs.ts";
import { borderline } from "./scam-shield.ts";

test("a throttled borderline message goes to review without a model call", async () => {
  const text = "dm me for a better price";
  assert.ok(borderline(text), "fixture must be borderline");
  let asked = 0;
  assert.deepEqual(await scamVerdict(text, async () => { asked++; return false; }), { action: "review", rule: "throttled" });
  assert.equal(asked, 1);
  assert.deepEqual(await scamVerdict("so pretty", async () => { asked++; return false; }), { action: "pass", rule: "" });
  assert.equal(asked, 1, "not asked for normal chat");
});
