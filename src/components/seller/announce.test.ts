import assert from "node:assert/strict";
import { test } from "node:test";
import { announcements, whenWords } from "./announce.ts";

// 2026-11-19 10:00 IST = 04:30 UTC
const now = new Date("2026-11-19T04:30:00Z");

test("start time in words, India time", () => {
  assert.deepEqual(whenWords("2026-11-19T14:30:00Z", now), { en: "tonight 8 pm", hi: "aaj raat 8 baje" });
  assert.deepEqual(whenWords("2026-11-19T09:00:00Z", now), { en: "today 2:30 pm", hi: "aaj dopahar 2:30 baje" });
  assert.deepEqual(whenWords("2026-11-20T14:30:00Z", now), { en: "tomorrow 8 pm", hi: "kal raat 8 baje" });
  assert.match(whenWords("2026-11-22T05:00:00Z", now).en, /^Sun,? 22 Nov, 10:30 am$/);
});

test("announcements carry the title, the time and the link", () => {
  const a = announcements("Meera Jewels", "Diwali Edit", "2026-11-19T14:30:00Z", "https://x.test/s/m/d/ABC");
  assert.ok(a.en.includes("Diwali Edit") && a.en.endsWith("https://x.test/s/m/d/ABC") && a.en.includes("First tap wins"));
  assert.ok(a.hi.includes("Jo pehle tap karega"));
});
