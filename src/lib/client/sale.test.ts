import test from "node:test";
import assert from "node:assert/strict";
import { applyCard, forOtherDrop, mergeState, tickerKey } from "./sale.ts";
import type { DropState } from "../types.ts";

const base: DropState = {
  dropId: "d", code: "ABC123", title: "T", status: "live", startsAt: "2026-11-19T10:00:00Z", version: 5, isSandbox: false,
  channelId: "dr_ABC123", shop: { id: "s", name: "Shop", slug: "shop", logoUrl: null },
  live: { t: "DB:Item", v: 4, itemId: "i1", position: 1, title: "Ring", pricePaise: 100, note: null, photos: [], liveAt: "", state: "live",
    variants: [{ key: "m", label: "M", left: 2, waiting: 0 }] },
  items: [{ itemId: "i1", position: 1, title: "Ring", pricePaise: 100, photo: null, state: "live" }],
  recent: [], viewers: null,
};

test("a newer Sold card lowers stock and adds one ticker line; a repeat adds nothing", () => {
  const sold = { t: "DB:Sold", v: 6, itemId: "i1", variant: "m", variantLabel: "M", buyer: "Priya S.", isBot: false, ms: 400, left: 1 } as const;
  const a = applyCard(base, sold);
  assert.equal(a.live!.variants[0].left, 1);
  assert.equal(a.version, 6);
  assert.equal(a.recent.length, 1);
  assert.equal(applyCard(a, sold).recent.length, 1);
});

test("an older card never rolls stock back but still reaches the ticker", () => {
  const old = { t: "DB:Sold", v: 3, itemId: "i1", variant: "m", variantLabel: "M", buyer: "Rohan S.", isBot: false, ms: 900, left: 0 } as const;
  const a = applyCard(base, old);
  assert.equal(a.live!.variants[0].left, 2);
  assert.equal(a.version, 5);
  assert.equal(tickerKey(a.recent[0]), tickerKey(old));
});

test("Stock marks the item sold out; State with another live item clears the card until its Item arrives", () => {
  const a = applyCard(base, { t: "DB:Stock", v: 7, itemId: "i1", state: "sold_out", variants: [{ key: "m", label: "M", left: 0, waiting: 3 }] });
  assert.equal(a.live!.state, "sold_out");
  assert.equal(a.items[0].state, "sold_out");
  const b = applyCard(a, { t: "DB:State", v: 8, status: "live", liveItemId: "i2", startsAt: base.startsAt });
  assert.equal(b.live, null);
});

test("HTTP state older than what we hold is ignored", () => {
  assert.equal(mergeState(base, { ...base, version: 2, status: "ended" }).status, "live");
  assert.equal(mergeState(base, { ...base, version: 9, status: "ended" }).status, "ended");
});

test("room cards stamped with another drop are not ours; unstamped and own cards are", () => {
  const card = { t: "DB:State", v: 99, status: "ended", liveItemId: null, startsAt: base.startsAt } as const;
  assert.equal(forOtherDrop({ ...card, dropId: "other" }, "d"), true);
  assert.equal(forOtherDrop({ ...card, dropId: "d" }, "d"), false);
  assert.equal(forOtherDrop(card, "d"), false);
});
