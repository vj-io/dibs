# Dibs build contract

Every builder reads this first. The product spec is `docs/PRD.md` (read the sections your work package names). This file fixes the decisions the PRD leaves open so parallel work fits together. If something here conflicts with the PRD, this file wins; if you must deviate from this file, say so in your report.

Project root: `/Users/mac/Documents/Projects/Nexxcom/.claude/worktrees/dips-hackathon-build-d7016f/Dips` (its own git repo, called ROOT below). Never write anything outside ROOT. The parent folder is a different product (ClarityLoop); you may read `../src` for reference, never edit it.

## Stack (installed, do not add dependencies without need)

- Next.js 16.4.6 App Router, React 19, TypeScript strict, Tailwind v4 (via `@tailwindcss/turbopack`). **Read `AGENTS.md`: this Next.js has breaking changes; check `node_modules/next/dist/docs/` before using an API** (route handler `params` are Promises, `cookies()` is async, etc.).
- Postgres (Supabase, Mumbai) through the `postgres` npm library: `src/lib/server/db.ts` exports `sql`. All logic that changes claims/stock/orders lives in **Postgres functions**; API routes call them. No supabase-js for business data.
- supabase-js only for seller email OTP (Auth) and product photo Storage.
- `zod` v4 for input validation, `jose` for session cookies, `qrcode` for QR, `ai` v7 + `@ai-sdk/google` for AI.
- Tests: `node --test` (Node 26 runs `.ts` directly; use explicit `.ts` import extensions in files tests reach). Unit tests live beside code as `*.test.ts`; DB tests in `tests/db/*.test.ts` (`npm run test:db`, real Postgres).
- Imports: `@/` = `src/`. Server-only modules live in `src/lib/server/` and must never be imported from a `"use client"` file.

## Sessions and roles

One cookie system (`src/lib/server/session.ts`, jose HS256, HttpOnly, SameSite=Lax, Secure in production, 30 days):

- `dibs_buyer` cookie: `{ kind: "buyer", buyerId }`.
- `dibs_staff` cookie: `{ kind: "staff", staffId, shopId, role: "owner" | "staff" }`. Set after Supabase email OTP is verified (`POST /api/seller/session` receives the Supabase access token, validates it with the service client, finds or creates the `staff` row), or by judge mode for the sandbox shop.
- Helpers: `getBuyer()`, `getStaff()`, `requireBuyer()`, `requireStaff(shopId?)` — the `require*` versions throw `HttpError(401 | 403)`.

Nexconn user ids: buyer `b_<uuid>`, staff `s_<uuid>`, system bot `dibs_bot`, demo bots `demo_bot_01`…`demo_bot_40`, answer bot `dibs_assistant` (its chat lines are plain text from a known sender id).

## HTTP conventions

`src/lib/server/http.ts`: `route(name, handler)` wraps a handler: catches `HttpError` and zod errors, returns `{ error: code, message }` with the status, logs `{ requestId, route, ms, result }`. Success bodies are plain JSON objects. Request/response shapes are declared in `src/lib/types.ts` (`Api` map); client code calls `api("POST /api/claims", body)` from `src/lib/client/api.ts`.

## Realtime ("live") layer

The database decides; the live layer only carries. Every state change inserts `outbox` rows in the same transaction; `drainOutbox()` (`src/lib/server/outbox.ts`) sends them, in id order per channel, right after the write (inline) and from the cron.

Two transports behind one interface, chosen by `REALTIME_MODE`:

- `nexconn`: Nexconn Server API (`src/lib/server/nexconn.ts`) + Web SDK (`src/lib/client/live.ts`).
- `mock`: in-process bus (`src/lib/server/mockbus.ts`) + SSE `GET /api/mock/stream` + `POST /api/mock/send`. Refuses to run when `VERCEL_ENV === "production"`.

Client interface (`src/lib/client/live.ts`, `"use client"`): `getLive(): Promise<Live>`

```ts
type LiveMsg = { id: string; channel: string; from: string; fromName?: string; at: number; kind: "text" | "card"; text?: string; card?: Card };
interface Live {
  kind: "nexconn" | "mock";
  userId: string;
  onStatus(cb: (s: "connecting" | "connected" | "offline") => void): () => void;
  joinRoom(channelId: string, cb: (m: LiveMsg) => void): Promise<() => void>;   // open channel (sale room)
  watchGroup(channelId: string, cb: (m: LiveMsg) => void): () => void;         // group channel (order room, desk)
  history(channelId: string): Promise<LiveMsg[]>;                               // group history, oldest first
  sendText(target: { type: "room" | "group"; id: string }, text: string): Promise<LiveMsg>;
  markRead(groupId: string, ids: string[]): void;
  onReceipts(cb: (r: { id: string; read: number; total: number }[]) => void): () => void;
  onAlert(cb: (card: Card) => void): () => void;                                // personal DB:Alert / DB:Prompt cards
}
```

`kind: "card"` is set **only** when the sender is `dibs_bot` and the payload decodes (`src/lib/codec.ts`); anything else that looks like a card is `kind: "text"`.

### Cards (`src/lib/codec.ts`, shared by server and client)

`Card` is a discriminated union on `t`. `v` is `drops.version` at the time of the change.

```ts
type VariantLive = { key: string; label: string; left: number; waiting: number };
type OrderState = "held" | "payment_claimed" | "paid" | "shipped" | "cancelled";
type Card =
 | { t: "DB:State"; v: number; status: "scheduled" | "live" | "ended"; liveItemId: string | null; startsAt: string }
 | { t: "DB:Item";  v: number; itemId: string; position: number; title: string; pricePaise: number; note: string | null; photos: string[]; liveAt: string; variants: VariantLive[] }
 | { t: "DB:Sold";  v: number; itemId: string; variant: string; variantLabel: string; buyer: string; isBot: boolean; ms: number; left: number }
 | { t: "DB:Back";  v: number; itemId: string; variant: string; variantLabel: string; buyer: string | null; isBot: boolean; reason: "expired" | "released" | "cancelled" }   // buyer null = unit returned to stock
 | { t: "DB:Stock"; v: number; itemId: string; state: "live" | "sold_out" | "closed"; variants: VariantLive[] }
 | { t: "DB:Hide";  v: number; messageId: string }                                  // scam shield fallback: hide this chat message
 | { t: "DB:Alert"; kind: "promoted" | "expiring" | "paid" | "shipped" | "not_received" | "expired" | "blocked" | "missed"; orderId: string | null; dropCode: string | null; text: string }
 | { t: "DB:Prompt"; itemId: string; position: number; variant: string | null; text: string }   // typed-claim helper one-tap prompt
 | { t: "DB:Order"; orderId: string; orderNo: number; item: string; variantLabel: string; pricePaise: number; expiresAt: string | null; photo: string | null }
 | { t: "DB:Pay";   orderId: string; amountPaise: number; upiId: string; payee: string; upiLink: string }
 | { t: "DB:Status"; orderId: string; state: OrderState; by: string; note: string | null; at: string }
 | { t: "DB:Desk";  orderId: string; orderNo: number; buyer: string; item: string; variantLabel: string; amountPaise: number; assignedTo: string | null; state: OrderState; event: "new" | "payment_claimed" | "paid" | "shipped" | "cancelled" | "assigned" };
```

Wire format: Nexconn custom message type = the `t` value with the rest as content, or (flag `NEXCONN_TEXT_ENVELOPE=1`, and always in mock mode) plain text `[[DB:Sold]]{json}`. `encodeCard`, `decodeCard(from, raw)`, `BOT_ID = "dibs_bot"` live in the codec.

### Outbox row

`outbox(id bigserial, channel_type text check in ('room','group','user'), channel_id text, msg_type text, payload jsonb, priority text check in ('high','normal','low'), status, attempts, next_attempt_at, created_at, sent_at)`. `channel_type = 'user'` means a personal alert to that Nexconn user id (system channel when `FEATURE_SYSTEM_CHANNEL=1`, otherwise a direct message from `dibs_bot`). For cards, `msg_type` is the card's `t` and `payload` is the full card JSON including `t`.

Channel ids: sale room `dr_<dropCode>` (stored in `drops.nexconn_channel_id`), order room `ord_<20 hex chars of the order id>` (stored in `orders.nexconn_group_id`; never recompute, read the column), team desk `desk_<20 hex chars of the shop id>` (stored in `shops.nexconn_desk_id`).

Creating Nexconn channels and adding members is **not** done in SQL. SQL writes an outbox row with a `SYS:*` `msg_type` ahead of the cards for that channel; the drain worker executes it through the Server API:

| msg_type | payload |
| --- | --- |
| `SYS:EnsureGroup` | `{ channelId, name, memberIds: string[] }` (create or join; idempotent) |
| `SYS:EnsureRoom` | `{ channelId, name }` |
| `SYS:DestroyRoom` | `{ channelId }` (row has `next_attempt_at` in the future) |
| `SYS:RoomMeta` | `{ channelId, key: "db_state" \| "db_item", value: string }` |
| `SYS:Mute` / `SYS:Ban` / `SYS:Unban` | `{ channelId, userId, minutes }` |
| `SYS:LeaveGroup` | `{ channelId, memberIds: string[] }` (a removed staff member leaves the desk and order rooms) |

Integration notes (0006): room cards carry `dropId`; the engine no longer writes `SYS:RoomMeta` (the drain mirrors `DB:State` / `DB:Item` / `DB:Stock` into metadata); `SYS:DestroyRoom` rows use channel key `destroy:<roomId>` so their 10-minute delay never holds back room cards.

## Database functions (the engine; `supabase/migrations/`)

All in schema `public`. Each returns `jsonb`. Each state change writes claim/order rows + `audit_events` + `outbox` and bumps `drops.version` in the same transaction.

| Function | Returns |
| --- | --- |
| `claim_dibs(p_item uuid, p_variant_key text, p_buyer uuid, p_received timestamptz)` | `{ result: 'won'\|'waitlisted'\|'not_live'\|'closed'\|'already'\|'too_many_holds'\|'waitlist_full'\|'banned'\|'no_variant', claimId, orderId, position, expiresAt, ms }` |
| `sweep_drop(p_drop uuid)` | `{ expired, promoted, returned, warned }` (idempotent; `warned` = "expiring in 2 min" alerts, once per claim; skipped when hold_seconds < 300) |
| `release_claim(p_claim uuid, p_actor_type text, p_actor_id uuid, p_reason text)` | `{ ok, error? }` — actor `buyer` ⇒ `released`, actor `staff` ⇒ `cancelled`; promotes next |
| `leave_waitlist(p_claim uuid, p_buyer uuid)` | `{ ok, error? }` |
| `order_paid_claim(p_order uuid, p_buyer uuid, p_utr text)` | `{ ok, error? }` |
| `order_confirm(p_order uuid, p_staff uuid, p_received boolean, p_note text)` | `{ ok, error? }` — not received ⇒ back to `held`, `expires_at = now + 5 min` |
| `order_ship(p_order uuid, p_staff uuid, p_note text)` | `{ ok, error? }` |
| `order_assign(p_order uuid, p_staff uuid, p_to uuid)` | `{ ok, error? }` |
| `drop_go_live(p_drop uuid, p_staff uuid)`, `drop_next(p_drop, p_staff)`, `item_close(p_item, p_staff)`, `item_reopen(p_item, p_staff)`, `drop_end(p_drop, p_staff)` | `{ ok, error?, liveItemId? }` |
| `drop_state(p_drop uuid)` | public state, read-only (no sweep inside): `{ dropId, code, title, status, startsAt, version, isSandbox, channelId, shop: { id, name, slug, logoUrl }, live: <DB:Item-shaped object with state> \| null, items: [{ itemId, position, title, pricePaise, photo, state }], recent: [last 8 DB:Sold / DB:Back cards, newest first] }` |
| `my_status(p_drop uuid, p_buyer uuid)` | `{ holds: [{ claimId, orderId, itemId, position, title, variantLabel, state, expiresAt, pricePaise }], waits: [{ claimId, itemId, position, title, variantKey, variantLabel, waitPosition }], mutedUntil, banned }` |

Staff permission (the staff member is active and belongs to the drop's shop) is checked **inside** the functions that take `p_staff`; error `forbidden`.

Sandbox: `shops.is_sandbox` / `drops.is_sandbox`; sandbox shops use `hold_seconds = 20`.

Assignment on a won claim (inside the engine): amount ≥ `shops.high_value_paise` (when set) ⇒ owner; else round-robin over active staff: fewest open orders, ties by oldest `staff.last_assigned_at`.

## Design system

Doodle set (brag-styles) as a web theme: grid paper, ink lines, hand-drawn boxes, a **lime highlighter** for the primary action (Dibs!, won, live) and a **hot pink marker** as the complement (sold stamps, urgency, countdowns). Sticky-note tints carry states. Tokens and components: `src/app/globals.css`, `src/components/ui/*` — use them; do not invent colours, radii or shadows (the Tailwind default colour/radius/shadow namespaces are reset, so `bg-blue-500` renders nothing).

Rules: phone first (360 px), body text ≥ 16 px, tap targets ≥ 48 px, Dibs button 56 px, every state = icon + word (never colour alone), visible focus, all motion inside `@media (prefers-reduced-motion: no-preference)`, resting CSS is the final drawn state.

## Honesty rules (hard)

- Bots only in sandbox drops, always labelled `🤖` and "demo". Sandbox data never appears in `/impact` or dashboard totals.
- No invented numbers anywhere in the app, README or write-up. A metric that has not been measured is shown as "not measured yet".
- Use the PRD "Key copy" strings exactly.

## Working rules for builders

- Stay inside the files your work package owns; if you need a change elsewhere, make the smallest edit and list it in your report.
- Never invent a Nexconn API: `docs/NEXCONN_API_FACTS.md` is the fact sheet; verify against `node_modules/@nexconn/*/` types.
- Do not run `git commit`, `git stash`, `git checkout` or a dev server on port 3000 (the lead does). For a local server use the port your brief gives you.
- Secrets live in `.env.local`; never print or commit them.
- Before reporting: `npm run typecheck` and your tests pass; say exactly what you ran and what you did not verify.
