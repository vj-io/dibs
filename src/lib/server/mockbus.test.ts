import test from "node:test";
import assert from "node:assert/strict";
import { bus, type BusMsg } from "./mockbus.ts";
import { decodeCard, encodeCard, BOT_ID } from "../codec.ts";

test("room: last 20 replayed on join, then live; leaving stops delivery", () => {
  const b = bus();
  b.ensureRoom("dr_T1");
  for (let i = 0; i < 25; i++) b.publish("room", "dr_T1", "b_x", `m${i}`);
  const got: BusMsg[] = [];
  const off = b.subscribe("b_me", ["dr_T1"], (m) => got.push(m));
  assert.equal(got.length, 20);
  assert.equal(got[0].text, "m5");
  b.publish("room", "dr_T1", BOT_ID, encodeCard({ t: "DB:Hide", v: 1, messageId: "x" }));
  assert.equal(got.length, 21);
  assert.equal(decodeCard(got[20].from, got[20].text)?.t, "DB:Hide");
  off();
  b.publish("room", "dr_T1", "b_x", "after");
  assert.equal(got.length, 21);
});

test("group: only members receive and read history; personal goes to one user", () => {
  const b = bus();
  b.ensureGroup("ord_T2", [BOT_ID, "b_1", "s_1"]);
  const a: BusMsg[] = [], c: BusMsg[] = [];
  b.subscribe("b_1", [], (m) => a.push(m));
  b.subscribe("b_2", [], (m) => c.push(m));
  b.publish("group", "ord_T2", BOT_ID, "card");
  b.publish("user", "b_2", BOT_ID, "alert");
  assert.deepEqual(a.map((m) => m.text), ["card"]);
  assert.deepEqual(c.map((m) => m.text), ["alert"]);
  assert.equal(b.history("ord_T2", "b_2"), null);
  assert.equal(b.history("ord_T2", "s_1")?.length, 1);
  assert.equal(b.refusal("group", "ord_T2", "b_2"), "not_member");
});

test("room moderation: mute and ban refuse with the live codes, unban clears both", () => {
  const b = bus();
  b.ensureRoom("dr_T3");
  assert.equal(b.refusal("room", "dr_T3", "b_1"), null);
  b.mute("dr_T3", "b_1", 5);
  assert.equal(b.refusal("room", "dr_T3", "b_1"), "23408");
  b.ban("dr_T3", "b_1", 5);
  assert.equal(b.refusal("room", "dr_T3", "b_1"), "23409");
  b.unban("dr_T3", "b_1");
  assert.equal(b.refusal("room", "dr_T3", "b_1"), null);
  assert.equal(b.refusal("room", "dr_NONE", "b_1"), "23410");
});

test("refuses to run in production", () => {
  process.env.VERCEL_ENV = "production";
  try { assert.throws(() => bus(), /not allowed in production/); }
  finally { delete process.env.VERCEL_ENV; }
});
