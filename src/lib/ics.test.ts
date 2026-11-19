import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIcs, fold } from "./ics.ts";
import { istWhen } from "./when.ts";

const ics = buildIcs({ uid: "u1", title: "Diwali, drop; №1 ₹ ✨ " + "x".repeat(120), startsAt: new Date("2026-11-21T14:30:00Z"), url: "https://dibs.example/s/shop/d/ABC123", now: new Date("2026-11-19T00:00:00Z") });

test("ics: CRLF, UTC times, 30 min, alarm", () => {
  assert.ok(ics.endsWith("\r\n") && !/[^\r]\n/.test(ics));
  assert.match(ics, /DTSTART:20261121T143000Z\r\n/);
  assert.match(ics, /DTEND:20261121T150000Z\r\n/);
  assert.match(ics, /TRIGGER:-PT10M\r\n/);
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 1);
});

test("ics: lines folded to <= 75 octets and unfold back to the original text", () => {
  for (const l of ics.split("\r\n")) assert.ok(Buffer.byteLength(l) <= 75, l);
  const unfolded = ics.replace(/\r\n /g, "");
  assert.ok(unfolded.includes("SUMMARY:Diwali\\, drop\; №1 ₹ ✨ " + "x".repeat(120)));
  assert.equal(fold("a".repeat(75)), "a".repeat(75));
});

test("istWhen: tonight, tomorrow, dated", () => {
  const now = Date.parse("2026-11-19T10:00:00Z"); // 3:30 pm IST, Thu 19 Nov
  assert.equal(istWhen("2026-11-19T14:30:00Z", now), "Tonight · 8:00 pm IST");
  assert.equal(istWhen("2026-11-19T05:00:00Z", now), "Today · 10:30 am IST");
  assert.equal(istWhen("2026-11-20T14:30:00Z", now), "Tomorrow · 8:00 pm IST");
  assert.equal(istWhen("2026-11-21T14:30:00Z", now), "Sat 21 Nov · 8:00 pm IST");
  assert.equal(istWhen("2026-11-19T19:00:00Z", now), "Tomorrow · 12:30 am IST");
});
