# Dibs

**First tap wins. Everyone sees it. Nobody gets lost in the DMs.**

Dibs is a live sale room for Indian sellers who sell on WhatsApp and Instagram. The seller drops one piece at a time. Buyers tap **Dibs**. The server decides who was first, and everyone in the room sees the result live.

Late buyers join a waitlist and are promoted automatically if the winner does not pay. Each winner gets one private order chat with the seller's team. Everything live runs on the Nexconn Chat SDK.

Built for the Nexconn Build Challenge 2026, track **Marketplace & Support**. Team Kaching (Vaibhav Jangid).

| | |
| --- | --- |
| Live app | https://tapdibs.vercel.app |
| Judge demo | https://tapdibs.vercel.app/try (goes live at submission; it was not on the deployed build when this was written) |
| Feature map | https://tapdibs.vercel.app/how-it-works |
| Real usage | https://tapdibs.vercel.app/impact (shows "nothing yet" until a real drop runs) |
| Code | https://github.com/vj-io/dibs (public at submission) |
| Nexconn App Key | `qd46yzrfq1obf` (public by design; Singapore data center) |
| Write-up PDF | `submission/Dibs-writeup.pdf` |

## Try it in 60 seconds

No sign-up, no second device.

1. Open `/try` and tap **Be a buyer**.
2. You join a demo sale room with 40 🤖 demo buyers. A banner says so: "Demo room · 40 🤖 demo buyers · nothing here is real money".
3. Five seconds in, piece 1 goes live. About ten bots tap 0.08 to 0.4 seconds after it goes live. Tap **Dibs!** yourself. You will almost certainly land on the waitlist: "You're #3 on the waitlist."
4. Bots never pay. Each bot hold runs out after 20 seconds, and the next buyer in line is promoted. When it is your turn you see "It's yours! The buyer ahead didn't pay" and an order chat opens.
5. In the order chat you see the order card and a payment card with a demo UPI ID. Tap **I've paid**. Asha, a labelled demo staff member, confirms about 3 seconds later. You get 90 seconds to pay in the demo; bots get 20.
6. Piece 2 drops. Bots wait 1.5 to 3 seconds this time, so a quick tap wins outright. The room ticker shows "Sold to You" with your time.
7. The demo room closes after 3 minutes with a "That's Dibs" card and links to the seller view.

To run the seller side instead, tap **Be the seller**. You get the live console with the same 40 bots in the room. Press **Drop next**, watch taps, holds and waitlists fill the ledger, see a bot hold expire and the next buyer get promoted, open the team desk, mark an order paid and shipped, and mute a bot. A bot posts a fake UPI ID about 30 seconds in; the scam shield blocks it and it shows in the moderation log.

The bots tap at set delays. The claim logic is the same code a real drop uses; it is never changed for the judge.

## The problem

Small Indian sellers run "first come, first served" drops in comments, DMs and WhatsApp groups. Messages cross, two people claim one piece, orders live in a notebook, and slow replies send buyers elsewhere. Evidence, from the product requirements (`docs/PRD.md`):

- Doing it by hand is messy: comment floods, lost orders, delayed payments and buyers asking "did you see mine?" ([Ulive.me](https://blog.ulive.me/posts/guide-to-live-selling-on-facebook-and-instagram-without-manual-work)).
- Slow replies lose sales: in many small brands one person replies from one phone, and a DM left for three hours often becomes a sale for another brand ([Wati](https://www.wati.io/en/blog/how-to-sell-on-instagram/)).
- No native live checkout: Instagram stopped product tagging in live broadcasts on 16 March 2023 ([Business Insider India](https://www.businessinsider.in/tech/apps/news/instagram-to-end-live-shopping-feature-on-march-16/amp_articleshow/97935811.cms)).
- The market is large, though estimates vary: Redseer projected Indian live commerce at $4 to 5 billion GMV by 2025 ([Adgully](https://www.adgully.com/indian-live-commerce-market-to-reach-4-5-bn-by-2025-mansi-jain-143341.html)); IMARC puts it at about $7.0 billion in 2025 ([IMARC](https://www.imarcgroup.com/india-live-commerce-market)).
- Video calls sell jewellery: Tanishq reported around ₹100 crore in sales through video calls over two months in 2020 ([Business Insider India](https://www.businessinsider.in/advertising/brands/article/tanishq-has-brought-in-around-rs-100-crore-sales-through-video-calls-in-the-last-2-months/articleshow/77767849.cms)).
- The model works abroad: CommentSold lets US shoppers claim products by commenting ([CommentSold help](https://help.commentsold.com/hc/en-us/articles/4401982035860)).

**No real drop has run yet.** The planned first drop is with Kundanvi Jewels, a jewellery seller who already sells on WhatsApp. It is a plan, not a result.

## How a drop works

**Seller (Meera, shop owner; Asha, staff)**

1. Sign in with an email one-time code. Create the shop: name, UPI ID, payee name, support WhatsApp number, hold time for unpaid claims.
2. Add products with photos, price and variants (for example sizes), each with a quantity.
3. Create a drop (title, start time, products in order). Dibs gives a share link, `/s/<shop>/d/<drop>`, and a QR code. Share it in the WhatsApp group.
4. Press **Go live**, then **Drop next**. The piece appears for everyone at once. The console shows live taps, holds, waitlists and stock.
5. Each win creates an order. It goes to the team desk, assigned to the owner if it is over a value the owner sets, otherwise to the staff member with the fewest open orders.
6. Staff mark **Payment received** (or **Not received**), then **Shipped**. **End drop** closes the sale.

**Buyer (Priya, Rohan)**

1. Open the link. First visit: type a name and a 10-digit phone number. No app, no password.
2. Pick a variant and tap **Dibs!**. Result comes back at once: "You got it! Pay within 10:00" or "You're #2 on the waitlist."
3. The room sees "Sold to Priya S." with the time in seconds after the piece went live.
4. A winner gets an order chat with a UPI payment card (a button on phones, a QR code on laptops). Pay in your UPI app, tap **I've paid**, add the UTR number if you want. Staff confirm.
5. A waitlisted buyer is promoted when a hold ends and is told in a personal alert.

Dibs does not take or hold money. The buyer pays the seller directly by UPI. Dibs records only the seller's confirmation.

## The fairness rules

In plain words:

1. The only way to claim is the **Dibs** button. Typing "booked" in chat claims nothing.
2. "First" means first committed by the database, not first to arrive. Order is decided on the server, never by a phone's clock.
3. A piece is always in stock, held by exactly one buyer, or sold. Two buyers can never hold one unit.
4. One active claim per buyer per piece. A buyer can hold at most 3 pieces per drop (a shop setting).
5. Claims open only while the piece is live.
6. A win is a hold with a timer. If it runs out, the buyer releases it, or staff cancel it, the next waitlisted buyer gets it, in order. The unit never returns to stock in between.
7. "I've paid" pauses the timer. If staff mark "Not received", the hold returns with 5 more minutes.
8. The waitlist holds at most 20 buyers per variant.

**How it is enforced.** The rules live in Postgres functions, not in the app. `claim_dibs` locks the variant's stock row with `SELECT ... FOR UPDATE`, so concurrent taps queue on the lock and are served in commit order. A unique partial index (`claims_one_active`) stops a second active claim by the same buyer. `sweep_drop` expires holds and promotes the next buyer, using `FOR UPDATE SKIP LOCKED`; running it twice changes nothing. Every state change writes the claim, an audit row and an outbox row in the same transaction. A failed chat send never undoes a sale.

Tests on a real Postgres check this (see Tests): 300 concurrent claims on 2 units give exactly 2 won, 20 waitlisted in commit order, the rest "waitlist full"; the same buyer tapping at once gets one claim; claims racing a close are never half-written; ten concurrent sweeps promote each unit exactly once; a random mix of claims, releases, expiries and closes keeps stock exact. These are tests on synthetic taps, not real buyers.

## Nexconn feature map

Statuses come from `docs/NEXCONN_FINDINGS.md` (proof of concept run live against the Singapore data center on 19 Nov 2026, two real browser contexts, SDK `@nexconn/chat` and `@nexconn/engine` 26.2.1). The same map, with the live flag state, is at `/how-it-works`.

| Feature | What it does in Dibs | Where in code | Status |
| --- | --- | --- | --- |
| Access tokens | Server issues a token for the signed-in person's own id only | `src/lib/server/nexconn.ts` (`issueToken`), `src/app/api/nexconn/token/route.ts` | Proven live. Token 205 to 736 ms; first connect 1.3 to 2.1 s (cold) |
| Open channel (sale room) | One per drop; carries the live piece, stock, ticker and chat | `nexconn.ts` (`ensureRoom`, `sendRoom`), `src/lib/client/live.ts` | Proven live. Create 173 ms, enter 204 to 218 ms |
| Custom message types `DB:*` from `dibs_bot` | Typed cards: item, sold, back, stock, order, pay, status, alert. Only `dibs_bot` cards count; a pasted copy stays text | `src/lib/codec.ts`, `live.ts` (`registerCustomMessages`) | Proven live. Server send to browser: median 436 ms, n=20 (min 377, max 2093). Text-envelope fallback: median 441 ms, n=20 |
| Message priority | Sold and stock cards sent at high priority | `nexconn.ts` (`sendRoom`) | Proven live. Priority 2 accepted (code 0). Effect on delivery order not measured |
| Open-channel metadata | Server mirrors state as a hint; Dibs never trusts it | `nexconn.ts` (`setRoomMeta`), `src/lib/server/outbox.ts` | Proven live (set 99 to 155 ms; browsers get the change event). Any connected client can overwrite it, so it is a hint only |
| Group channel: order room | Private room for buyer, assigned staff and `dibs_bot` | `nexconn.ts` (`ensureGroup`, `sendGroup`), `src/components/order/OrderRoom.tsx` | Proven live. Create 189 ms, send 87 to 125 ms |
| Group channel: team desk | All staff see every order in one feed | `nexconn.ts`, `src/components/seller/DeskView.tsx` | Proven live (same mechanism as the order room) |
| Read receipts | Shows who has read a message in an order room | `live.ts` (`sendReadReceiptResponse`), `OrderRoom.tsx` | Proven live. A receipt came back read 1 of 2 |
| System channel (personal alerts) | Private alerts: promoted, hold expiring, paid, shipped | `nexconn.ts` (`sendUser`) | Proven live. 86 ms. Behind `FEATURE_SYSTEM_CHANNEL`, on in production. Direct-message fallback also works (129 to 164 ms) |
| Mute and ban lists | Seller mutes or bans from the console; Nexconn refuses the person's messages | `nexconn.ts` (`muteInRoom`, `banInRoom`) | Proven live. Mute 87 ms (send fails 23408); ban 116 ms (send and re-enter fail 23409) |
| Server-side message delete | Scam shield removes a message for everyone, including a buyer's own text | `nexconn.ts` (`deleteMessage`), `src/lib/server/webhook.ts` | Proven live. About 120 ms |
| Online status | New orders go to staff who are online | `nexconn.ts` (`onlineStatus`) | Proven live. 128 ms |
| Community channel (shop club) | A club per shop with subchannels | `nexconn.ts`, flag `FEATURE_COMMUNITY` | Proven live behind `FEATURE_COMMUNITY` (create, join, send all succeeded, about 100 ms each). `getSubChannels()` returned an empty list right after creation |
| `message:send` webhook | Drives the typed-claim helper, answer bot and scam shield | `src/app/api/nexconn/webhook/route.ts`, `webhook.ts` | Needs Console setting and the deployed URL. Not yet tested against a real Nexconn delivery. Signature check has unit tests on synthetic requests only |
| Pre-message callback | Scam shield blocks before delivery, rules only | `src/app/api/nexconn/premessage/route.ts` | Behind `FEATURE_PREMESSAGE` (off). Not yet tested against Nexconn. With it off, the scam shield runs after delivery through the webhook |
| Call SDK | Planned one-to-one video viewing | flag `FEATURE_CALLS` | Behind `FEATURE_CALLS` (off). Not tested; `@nexconn/call` is not installed. With the flag off, the order room shows the seller's WhatsApp number |

Also found live: unregistered custom message types are dropped silently, so the client registers every `DB:*` type before connecting. Any message a buyer pastes in the `[[DB:Sold]]{...}` shape stays plain text. Open-channel history needs cloud retention (error 23414), which is off; join history comes with `enterChannel`, and state comes from `GET /api/drops/:id/state`.

Console settings already on for this app: open-channel metadata service, open-channel message priority, group read receipts. Still to do in the Console: the webhook URL with `message:send`, and the pre-message callback if the plan offers it.

## AI helpers, and what AI never does

AI does three helper jobs through the Vercel AI SDK (`src/lib/ai/`). Each tries plain rules first and calls a model only when the rules cannot decide. If the model fails, the app carries on without it. Model output is checked with zod. Only message text and shop or item data go to the model, never names or phone numbers.

- **Typed-claim helper.** A buyer types "booked" or "M wala chahiye". They get a private one-tap prompt ("Want this? Tap to Dibs #3 · M"). It never claims by itself.
- **Answer bot.** Answers repeat questions in the sale room from the shop's FAQ lines and the live piece's data, labelled "Dibs assistant". It stays silent if the facts are not there. At most 1 answer per 10 seconds per room.
- **Scam shield.** Blocks phone numbers, UPI IDs and payment links posted by anyone who is not staff. Rules decide; AI is used only for unclear text on the after-delivery path.

**AI never** decides who was first, creates or cancels a claim, confirms a payment, changes a price or stock, or speaks for the seller beyond the shop's own FAQ facts.

## Architecture

```
 Browser (buyer / seller)                      Vercel (bom1, Mumbai)                 Supabase (Mumbai)
 ┌──────────────────────┐   POST /api/claims   ┌─────────────────────┐   one tx    ┌──────────────────┐
 │ Next.js pages        │ ───────────────────▶ │ API route           │ ──────────▶ │ claim_dibs()     │
 │ Nexconn Web SDK      │                      │ session + zod       │             │ row lock         │
 │ (receive + chat)     │ ◀─── result ──────── │ rate limit          │ ◀────────── │ claim+audit+     │
 └──────────▲───────────┘                      └─────────┬───────────┘             │ outbox rows      │
            │ cards from dibs_bot                        │ drainOutbox()           └──────────────────┘
            │                                            ▼
            │                              ┌─────────────────────────┐
            └───────────────────────────── │ Nexconn (Singapore)     │   webhook message:send ──▶ /api/nexconn/webhook
                                           │ open channel, groups,   │
                                           │ system channel          │   AI (Gemini via AI SDK): typed claim,
                                           └─────────────────────────┘   answer bot, scam shield text
```

**The claim path:** browser, then `POST /api/claims`, then one Postgres transaction (`claim_dibs`) that writes the claim, order, audit row and outbox rows, then `drainOutbox()` sends the cards through the Nexconn Server API, then every browser receives them. The browser talks to Nexconn directly only to receive live updates and to chat.

The database decides; Nexconn carries what people see. Hold expiry is handled by `sweep_drop`, which runs on every call that touches a drop, on the seller console's heartbeat, on an open order page's heartbeat, and from cron. If the live connection drops, the sale room shows "Reconnecting", disables Dibs and polls the state API.

Stack: Next.js 16 (App Router), TypeScript, Tailwind v4, Supabase Postgres and Auth, `postgres` library, Nexconn Chat Web SDK and Server API, Vercel AI SDK with Google Gemini, `jose`, `zod`.

## Judge mode and bot honesty

- Bots exist only in demo drops (`is_sandbox = true`). There are 40 (`demo_bot_01` to `demo_bot_40`). They are labelled 🤖 and "demo" everywhere, and a banner says so on every demo screen.
- Bots tap through the same `claim_dibs` function as real buyers and win or lose honestly. Only their delays are scripted.
- Bots never pay. Their holds always expire after 20 seconds. That is how a judge sees a promotion.
- Bots cannot claim in real drops (a test checks this). Demo data is excluded from `/impact` and the dashboard totals (a test checks this).
- Demo drops come from a pool of 8 reusable open channels, to stay under Nexconn's open-channel limit.

## Tests

| Suite | What it proves | Command |
| --- | --- | --- |
| Unit (beside the code in `src/**/*.test.ts`) | UPI link builder, `DB:*` codec and its sender check, scam-shield rules, typed-claim rules, answer-bot output checks, outbox, mock bus, client version merge, bot planning | `npm test` |
| Claim engine on real Postgres (`tests/db/`) | No double sell under 300 concurrent claims; waitlist order; hold limit; sweep and promotion; idempotent sweep; payment pause; release and cancel; staff permission; anon role can call nothing | `npm run test:db` |
| API over real HTTP (`tests/api/`) | Full loop: shop, product, drop, live, claim race, release, promotion, pay, confirm, ship; permission walls; validation; rate limit; no phone numbers in public responses; data deletion | start the app with `REALTIME_MODE=mock DIBS_TEST_LOGIN=1` on port 3103, then `API_BASE=http://localhost:3103 node --env-file=.env.local --test "tests/api/*.test.ts"` |
| Judge mode and webhook (`tests/sandbox/`) | Simulated judges reach "It's yours", pay and win piece 2; bots only in demo drops; demo data not in impact; signed webhook, replay ignored, scam block, typed-claim prompt, answer-bot limits | `node --env-file=.env.local --test --test-concurrency=1 "tests/sandbox/*.test.ts"` |
| Browser end to end (`tests/e2e/`, Playwright, phone size 360 px) | Two buyers racing, pay and confirm, release and promotion, offline and back, seller console flow | `python tests/e2e/buyer_flow.py` and `python tests/e2e/seller_flow.py` against a dev server (see the file headers) |
| Nexconn proof of concept | The live findings in `docs/NEXCONN_FINDINGS.md` | `node --env-file=.env.local scripts/nexconn-poc.ts`, `python scripts/nexconn-poc-browser.py [--live]` |
| Static checks | Types, lint, secrets | `npm run typecheck`, `npm run lint`, `bash scripts/secret-scan.sh` |

All of these use synthetic taps and simulated people. Latest counts: `TBD-after-measurement`. A load simulation against the deployed API (300 taps in 500 ms) is not in this repo yet; results will be added as `TBD-after-measurement`. Production tap-to-result median and p95: `TBD-after-measurement`.

## Running locally

Developed on Node 26, which runs the `.ts` tests directly (older Node needs TypeScript stripping support). Needs a Postgres (Supabase).

```bash
npm install
cp .env.example .env.local     # fill in the values below
npm run db:apply               # applies supabase/migrations/*.sql in order (safe to re-run)
node --env-file=.env.local scripts/seed-demo.ts   # judge-mode data: 40 bots, 8 demo shop slots
npm run dev                    # http://localhost:3000
```

From `.env.example`:

| Variable | What it is |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project URL and public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Seller Auth and photo Storage |
| `DATABASE_URL` | Postgres through the transaction pooler (port 6543). All business reads and writes |
| `DATABASE_URL_SESSION` | Postgres through the session pooler (port 5432). Migrations and tests |
| `NEXCONN_APP_KEY`, `NEXCONN_APP_SECRET`, `NEXCONN_AREA` | Nexconn App Key, App Secret (server only), area `SG`, `NA` or `SA` |
| `REALTIME_MODE` | `nexconn` or `mock`. Production refuses `mock` |
| `NEXCONN_TEXT_ENVELOPE` | `1` sends cards as text if custom types do not reach clients |
| `FEATURE_PREMESSAGE`, `FEATURE_COMMUNITY`, `FEATURE_SYSTEM_CHANNEL`, `FEATURE_CALLS` | `0` or `1`. Unconfirmed Nexconn features, each with a fallback |
| `GOOGLE_GENERATIVE_AI_API_KEY`, `AI_MODEL`, `AI_FALLBACK_MODELS` | AI helpers. Server only. Optional: without a key the helpers stay quiet and everything else works |
| `SESSION_SECRET`, `CRON_SECRET` | 32 or more random characters each. Server only |
| `APP_URL` | Public base URL for share links and QR codes |

**Mock realtime mode (no Nexconn keys).** Set `REALTIME_MODE=mock`. An in-process message bus with the same interface replaces Nexconn (`src/lib/server/mockbus.ts`, with a server-sent-events stream). You still need Postgres. The app refuses to start in mock mode when `VERCEL_ENV=production`. `DIBS_TEST_LOGIN=1` enables a test-only seller sign-in outside production.

## Deploy notes

- Vercel functions in Mumbai (`bom1`, set in `vercel.json`) and Supabase in Mumbai, so the claim path is one short hop to the database. The Nexconn data center is Singapore.
- Hold expiry needs something to run when nobody is calling. The sweep also runs on every drop call and on console and order-page heartbeats. As a safety net, `vercel.json` has a Vercel cron for `/api/cron/sweep` once a day, and migration `0004_api.sql` sets up a per-minute Supabase `pg_cron` job with `pg_net` that calls the same route with `CRON_SECRET`. It starts working once the one-row `app_config` table holds the app URL and the secret.
- Nexconn Console: webhook URL `https://<host>/api/nexconn/webhook` with `message:send`; metadata service and message priority on; group read receipts on; add the deploy domain if the web domain allowlist is on.
- Set the four `FEATURE_*` flags to what the Console supports. `GET /api/config` returns the live flag state.

## Security notes

- Secrets are server only. The Nexconn App Secret, Supabase service key and AI key never reach the browser. The App Key is public by design.
- Tokens are issued only for the caller's own Nexconn id. Only the server creates channels, sends cards, mutes and bans.
- Clients treat a message as a card only when `dibs_bot` sent it. A pasted copy stays text.
- Every permission is checked on the server in the API route and inside the Postgres functions (a staff member of another shop gets `forbidden`). Hiding a button is never the protection. Tests cover the permission walls.
- Sessions are HttpOnly, SameSite=Lax, Secure in production, 30 days. Staff sign in with a Supabase email one-time code.
- Rate limits are stored in the database, so they hold across server instances: 5 claims per second per buyer, with a 429 above that.
- Webhooks: signature checked, 5-minute timestamp window, replay ignored by message id. Nexconn does not sign the body, so content is re-checked.
- Phone numbers never appear in Nexconn messages or public responses. Public names are first name plus last initial. A buyer can delete their data from `/me`.
- Headers: no framing (`X-Frame-Options: DENY`, `frame-ancestors 'none'`), `nosniff`, strict referrer policy. Row-level security is on for the tables; the anon role can call nothing (tested).
- `bash scripts/secret-scan.sh` scans tracked files for likely secrets before each push.

## Not in this build

Honest limits, each checked against the code:

- **No phone verification.** Buyers join with a name and a typed 10-digit number. There is no one-time code, so a phone number is not verified.
- **No payments handled.** Buyers pay the seller's UPI directly. Dibs shows the link or QR and records the seller's confirmation. There is no bank check, refund or escrow.
- **Video viewing is not built.** The Call SDK is not installed or tested. The order room shows a link to the seller's WhatsApp number instead. `FEATURE_CALLS` is off.
- **Pre-message blocking is off** and untested. The scam shield removes a message after delivery.
- **The webhook has not been tested against a real Nexconn delivery.** Until it is set in the Console, the typed-claim helper, answer bot and after-delivery scam shield do not run on live chat.
- **Light theme only.**
- **English interface only.** Typed Hinglish is understood by the helpers; the screens are not translated.
- **No video livestream, shipping integration, invoices or GST.**
- **No marketplace across shops.** Each shop has its own link.
- **No native apps.** It is a mobile-first web app.
- **Not tested on real phones, 4G or more than two live clients at once.** Behaviour at the plan's connection limit is unknown.
- **No real drop has run yet.** No real users, no seller feedback, no real orders.
- Open-channel participant-count events did not fire in our tests, so the viewer count comes from a server poll.

## What existed before

Dibs is a new build made for this hackathon. It reuses two things from the same team's earlier entry, **ClarityLoop** (same team, same Nexconn app): the pattern for a signed Nexconn Server API client, and the doodle design language (paper, ink lines, lime highlighter, hot pink marker). ClarityLoop itself is a separate repo and deployment.

**AI assistance:** AI coding agents (Claude Code) wrote most of the code under the team's direction. The team set the product, the rules and the checks, and reviewed the results.

## Credits and licence

MIT licence. See `LICENSE`.

Built on the Nexconn Chat SDK, Next.js, Supabase, the Vercel AI SDK and Vercel. Evidence links are in the problem section above. Thanks to Nexconn and Reskilll for the challenge.

Team Kaching: Vaibhav Jangid.
