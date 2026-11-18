import test from "node:test";
import assert from "node:assert/strict";
import { afterFailure, execute, PermanentError, type OutboxRow, type Sender } from "./outbox.ts";

test("backoff: 1 s, 3 s, 10 s, 30 s, then failed", () => {
  assert.deepEqual([1, 2, 3, 4].map(afterFailure), [{ retryInMs: 1000 }, { retryInMs: 3000 }, { retryInMs: 10_000 }, { retryInMs: 30_000 }]);
  assert.deepEqual(afterFailure(5), { failed: true });
});

function fakeSender() {
  const calls: unknown[][] = [];
  const rec = (name: string) => async (...a: unknown[]) => { calls.push([name, ...a]); };
  const s = {
    ensureRoom: rec("ensureRoom"), destroyRoom: rec("destroyRoom"), setRoomMeta: rec("setRoomMeta"), ensureGroup: rec("ensureGroup"), leaveGroup: rec("leaveGroup"),
    mute: rec("mute"), ban: rec("ban"), unban: rec("unban"), card: rec("card"),
  } as Sender;
  return { s, calls };
}
const row = (msg_type: string, payload: Record<string, unknown>, channel_type: OutboxRow["channel_type"] = "room"): OutboxRow =>
  ({ id: "1", channel_type, channel_id: "dr_ABC123", msg_type, payload, priority: "high", attempts: 0 });

test("execute: SYS rows go to the matching Server API call", async () => {
  const { s, calls } = fakeSender();
  await execute(row("SYS:EnsureGroup", { channelId: "ord_x", name: "Order 7", memberIds: ["b_1", "s_2"] }, "group"), s);
  await execute(row("SYS:EnsureRoom", { channelId: "dr_ABC123", name: "Drop" }), s);
  await execute(row("SYS:RoomMeta", { channelId: "dr_ABC123", key: "db_state", value: "{}" }), s);
  await execute(row("SYS:Mute", { channelId: "dr_ABC123", userId: "b_1", minutes: 10 }), s);
  await execute(row("SYS:Ban", { channelId: "dr_ABC123", userId: "b_1", minutes: 60 }), s);
  await execute(row("SYS:Unban", { channelId: "dr_ABC123", userId: "b_1" }), s);
  await execute(row("SYS:DestroyRoom", { channelId: "dr_ABC123" }), s);
  await execute(row("SYS:LeaveGroup", { channelId: "desk_x", memberIds: ["s_2"] }, "group"), s);
  assert.deepEqual(calls, [
    ["ensureGroup", "ord_x", "Order 7", ["b_1", "s_2"]],
    ["ensureRoom", "dr_ABC123"],
    ["setRoomMeta", "dr_ABC123", { db_state: "{}" }],
    ["mute", "dr_ABC123", "b_1", 10],
    ["ban", "dr_ABC123", "b_1", 60],
    ["unban", "dr_ABC123", "b_1"],
    ["destroyRoom", "dr_ABC123"],
    ["leaveGroup", "desk_x", ["s_2"]],
  ]);
});

test("execute: room state cards are sent with their priority, then mirrored into metadata", async () => {
  const { s, calls } = fakeSender();
  const stock = { t: "DB:Stock", v: 4, itemId: "i1", state: "live", variants: [] };
  await execute(row("DB:Stock", stock), s);
  assert.deepEqual(calls, [["card", "room", "dr_ABC123", stock, "high"], ["setRoomMeta", "dr_ABC123", { db_item: JSON.stringify(stock) }]]);
});

test("execute: group and user cards are not mirrored; t comes from msg_type", async () => {
  const { s, calls } = fakeSender();
  await execute(row("DB:Status", { orderId: "o1", state: "paid" }, "group"), s);
  await execute(row("DB:Alert", { kind: "paid", orderId: "o1", dropCode: null, text: "Paid" }, "user"), s);
  assert.equal(calls.length, 2);
  assert.equal((calls[0][3] as { t: string }).t, "DB:Status");
  assert.equal(calls[1][0], "card");
});

test("execute: a failing metadata mirror does not fail the sent card", async () => {
  const { s } = fakeSender();
  s.setRoomMeta = async () => { throw new Error("23426"); };
  await execute(row("DB:State", { t: "DB:State", v: 1, status: "live", liveItemId: null, startsAt: "" }), s);
});

test("execute: unknown msg_type is a permanent failure", async () => {
  const { s } = fakeSender();
  await assert.rejects(execute(row("XX:Nope", {}), s), PermanentError);
});
