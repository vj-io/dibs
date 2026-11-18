// DB:* cards: the only messages a client treats as facts. Shared by server and browser (no imports).
// Trust rule: a card is a card only when the sender is dibs_bot. Anything else that looks like one is plain text.
export const BOT_ID = "dibs_bot";
export const ASSISTANT_ID = "dibs_assistant";

export type VariantLive = { key: string; label: string; left: number; waiting: number };
export type OrderState = "held" | "payment_claimed" | "paid" | "shipped" | "cancelled";

export type Card =
  | { t: "DB:State"; v: number; status: "scheduled" | "live" | "ended"; liveItemId: string | null; startsAt: string }
  | { t: "DB:Item"; v: number; itemId: string; position: number; title: string; pricePaise: number; note: string | null; photos: string[]; liveAt: string; variants: VariantLive[] }
  | { t: "DB:Sold"; v: number; itemId: string; variant: string; variantLabel: string; buyer: string; isBot: boolean; ms: number; left: number }
  | { t: "DB:Back"; v: number; itemId: string; variant: string; variantLabel: string; buyer: string | null; isBot: boolean; reason: "expired" | "released" | "cancelled" }
  | { t: "DB:Stock"; v: number; itemId: string; state: "live" | "sold_out" | "closed"; variants: VariantLive[] }
  | { t: "DB:Hide"; v: number; messageId: string }
  | { t: "DB:Alert"; kind: "promoted" | "expiring" | "paid" | "shipped" | "not_received" | "expired" | "blocked" | "missed"; orderId: string | null; dropCode: string | null; text: string }
  | { t: "DB:Prompt"; itemId: string; position: number; variant: string | null; text: string }
  | { t: "DB:Order"; orderId: string; orderNo: number; item: string; variantLabel: string; pricePaise: number; expiresAt: string | null; photo: string | null }
  | { t: "DB:Pay"; orderId: string; amountPaise: number; upiId: string; payee: string; upiLink: string }
  | { t: "DB:Status"; orderId: string; state: OrderState; by: string; note: string | null; at: string }
  | { t: "DB:Desk"; orderId: string; orderNo: number; buyer: string; item: string; variantLabel: string; amountPaise: number; assignedTo: string | null; state: OrderState; event: "new" | "payment_claimed" | "paid" | "shipped" | "cancelled" | "assigned" };

export type CardType = Card["t"];
export const CARD_TYPES: readonly CardType[] = [
  "DB:State", "DB:Item", "DB:Sold", "DB:Back", "DB:Stock", "DB:Hide", "DB:Alert", "DB:Prompt", "DB:Order", "DB:Pay", "DB:Status", "DB:Desk",
];
const isCardType = (t: unknown): t is CardType => typeof t === "string" && (CARD_TYPES as readonly string[]).includes(t);

/** Text envelope: `[[DB:Sold]]{json}`. Used in mock mode and when NEXCONN_TEXT_ENVELOPE=1. */
export const encodeCard = (card: Card): string => {
  const { t, ...rest } = card;
  return `[[${t}]]${JSON.stringify(rest)}`;
};

const ENVELOPE = /^\[\[(DB:[A-Za-z]+)\]\](\{[\s\S]*\})$/;

/**
 * Decodes a received message into a card, or null when it is not one we trust.
 * `raw` is either envelope text, or `{ type, content }` for a Nexconn custom message.
 */
export function decodeCard(from: string, raw: string | { type: string; content: unknown }): Card | null {
  if (from !== BOT_ID) return null;
  let t: unknown, rest: unknown;
  if (typeof raw === "string") {
    const m = ENVELOPE.exec(raw);
    if (!m) return null;
    t = m[1];
    try { rest = JSON.parse(m[2]); } catch { return null; }
  } else {
    t = raw.type;
    rest = raw.content;
  }
  if (!isCardType(t) || !rest || typeof rest !== "object" || Array.isArray(rest)) return null;
  return { ...(rest as object), t } as Card;
}

/** Keeps the newest version seen across metadata, messages and HTTP state. */
export const newer = <T extends { v: number }>(cur: T | null | undefined, next: T): T => (!cur || next.v >= cur.v ? next : cur);

/** "Priya Sharma" -> "Priya S." ; one word stays as it is. Public names never show a full surname. */
export function displayName(name: string): string {
  const parts = name.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (!parts.length) return "Buyer";
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const first = cap(parts[0]).slice(0, 20);
  return parts.length > 1 ? `${first} ${parts[parts.length - 1].charAt(0).toUpperCase()}.` : first;
}

/** 145000 paise -> "₹1,450" (Indian grouping; paise shown only when not zero). */
export const rupees = (paise: number): string =>
  "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 });

/** 412 ms -> "0.4 s" (ticker time, rounded to 0.1 s). */
export const tapTime = (ms: number): string => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
