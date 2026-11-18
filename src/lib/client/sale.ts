// Pure sale-room state rules (no React): how a card changes the room, keeping the newest version seen.
// Shared by the sale room hook and its unit test.
import type { Card } from "../codec.ts";
import type { DropState, LiveItem } from "../types.ts";

export type TickerCard = DropState["recent"][number];

/** Stable id for a ticker line, the same whether it came from a card or from GET state. */
export const tickerKey = (c: TickerCard) => `${c.t}|${c.v}|${c.itemId}|${c.variant}|${c.buyer ?? ""}`;

/** An HTTP state replaces ours only when it is at least as new. Ticker lines from cards we already have stay. */
export function mergeState(cur: DropState | null, next: DropState): DropState {
  if (!cur || cur.dropId !== next.dropId) return next;
  if (next.version < cur.version) return cur;
  return next;
}

const setItemState = (s: DropState, itemId: string, state: LiveItem["state"]) =>
  s.items.map((i) => (i.itemId === itemId ? { ...i, state } : i));

/**
 * Applies one sale-room card. Facts with a version older than ours are ignored (ticker lines are still added,
 * they are history, not state). Returns the same object when nothing changed.
 */
export function applyCard(s: DropState, c: Card): DropState {
  switch (c.t) {
    case "DB:State": {
      if (c.v < s.version) return s;
      const live = c.liveItemId && s.live?.itemId === c.liveItemId ? s.live : null;
      return { ...s, version: c.v, status: c.status, startsAt: c.startsAt, live };
    }
    case "DB:Item": {
      if (c.v < s.version) return s;
      const live: LiveItem = { ...c, state: "live" };
      return { ...s, version: c.v, status: "live", live, items: setItemState(s, c.itemId, "live") };
    }
    case "DB:Stock": {
      if (c.v < s.version) return s;
      const live = s.live?.itemId === c.itemId ? { ...s.live, variants: c.variants, state: c.state } : s.live;
      return { ...s, version: c.v, live, items: setItemState(s, c.itemId, c.state) };
    }
    case "DB:Sold":
    case "DB:Back": {
      const key = tickerKey(c);
      const recent = s.recent.some((r) => tickerKey(r) === key) ? s.recent : [c, ...s.recent].slice(0, 8);
      if (c.v < s.version || c.t === "DB:Back") return recent === s.recent ? s : { ...s, recent };
      const live = s.live?.itemId === c.itemId
        ? { ...s.live, variants: s.live.variants.map((v) => (v.key === c.variant ? { ...v, left: c.left } : v)) }
        : s.live;
      return { ...s, version: c.v, recent, live };
    }
    default:
      return s;
  }
}
