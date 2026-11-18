// drainOutbox against the real outbox table: batches per channel, per-channel order, no double send, a failing head
// blocks only its channel. Rows live on private test_* channels (drop_id null; a drain without a channel list skips
// test_*, so the shared dev server never takes them) and are deleted afterwards. Seeded an hour ahead, made due per test.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Card } from "../../src/lib/codec.ts";
import { drainOutbox, type Sender } from "../../src/lib/server/outbox.ts";
import { sql } from "../../src/lib/server/db.ts";
import { admin, closeAll } from "./helpers.ts";

const channels: string[] = [];
after(async () => {
  await admin`delete from outbox where channel_id in ${admin(channels)}`;
  await sql.end();
  await closeAll();
});

async function seed(n: number): Promise<string> {
  const ch = `test_ob_${randomUUID().slice(0, 8)}`;
  channels.push(ch);
  for (let i = 0; i < n; i++) {
    await admin`insert into outbox (channel_type, channel_id, msg_type, payload, priority, next_attempt_at)
                values ('room', ${ch}, 'DB:Hide', ${admin.json({ t: "DB:Hide", v: i, messageId: String(i) })}, 'high', now() + interval '1 hour')`;
  }
  return ch;
}

const due = (...chs: string[]) => admin`update outbox set next_attempt_at = now() where channel_id in ${admin(chs)}`;

function recorder(fail?: (ch: string, i: number) => boolean) {
  const sent = new Map<string, number[]>();
  const nop = async () => {};
  const s: Sender = {
    ensureRoom: nop, destroyRoom: nop, setRoomMeta: nop, ensureGroup: nop, leaveGroup: nop, mute: nop, ban: nop, unban: nop,
    async card(_type, channel, card: Card) {
      const i = (card as { v: number }).v;
      await new Promise((r) => setTimeout(r, 5));
      if (fail?.(channel, i)) throw new Error("boom");
      sent.set(channel, [...(sent.get(channel) ?? []), i]);
    },
  };
  return { s, sent };
}

const rows = (ch: string) => admin`select status, attempts, locked_until, next_attempt_at > now() as later from outbox where channel_id = ${ch} order by id`;

test("one drain sends every row of every channel in order, inside the inline budget", async () => {
  const a = await seed(12), b = await seed(4);
  const { s, sent } = recorder();
  await due(a, b);
  const t0 = Date.now();
  const r = await drainOutbox({ channels: [a, b], sender: s, budgetMs: 1500 });
  const ms = Date.now() - t0;
  assert.deepEqual(sent.get(a), [...Array(12).keys()]);
  assert.deepEqual(sent.get(b), [0, 1, 2, 3]);
  assert.equal(r.sent, 16);
  assert.equal(r.more, false);
  assert.ok((await rows(a)).every((x) => x.status === "sent" && x.attempts === 1 && x.locked_until === null));
  assert.ok(ms < 1500, `took ${ms} ms`);
});

test("two drains at once never send a row twice and keep each channel in order", async () => {
  const a = await seed(10), b = await seed(10);
  const { s, sent } = recorder();
  await due(a, b);
  await Promise.all([
    drainOutbox({ channels: [a, b], sender: s, budgetMs: 5000 }),
    drainOutbox({ channels: [a, b], sender: s, budgetMs: 5000 }),
  ]);
  assert.deepEqual(sent.get(a), [...Array(10).keys()]);
  assert.deepEqual(sent.get(b), [...Array(10).keys()]);
});

test("a failing head row holds back only its own channel; the rest of that channel waits unleased", async () => {
  const a = await seed(3), b = await seed(3);
  const { s, sent } = recorder((ch, i) => ch === a && i === 0);
  await due(a, b);
  const r = await drainOutbox({ channels: [a, b], sender: s, budgetMs: 1500 });
  assert.deepEqual(sent.get(b), [0, 1, 2]);
  assert.equal(sent.get(a), undefined);
  assert.equal(r.sent, 3);
  const ra = await rows(a);
  assert.deepEqual(ra.map((x) => [x.status, x.attempts, x.later]), [["pending", 1, true], ["pending", 0, false], ["pending", 0, false]]);
  assert.ok(ra.every((x) => x.locked_until === null));
});

test("never throws: a broken sender is a retry, not an exception", async () => {
  const a = await seed(1);
  const s = recorder(() => true).s;
  await due(a);
  const r = await drainOutbox({ channels: [a], sender: s, budgetMs: 1000 });
  assert.equal(r.sent, 0);
  assert.equal((await rows(a))[0].attempts, 1);
});
