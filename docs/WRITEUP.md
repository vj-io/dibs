# Dibs

First tap ==wins==. Everyone sees it. Nobody gets lost in the DMs.

> **Live app:** https://tapdibs.vercel.app · judge demo at /try (no sign-up)
> **Code:** https://github.com/vj-io/dibs (public)
> **Nexconn App Key:** [[qd46yzrfq1obf]] (Singapore data center; the live app uses this key)
> **Track:** Marketplace & Support · **Team Kaching:** Vaibhav Jangid

## 1. Problem and who it is for

Small Indian sellers run "first come, first served" drops in comments, DMs and WhatsApp groups. Messages cross. Two people claim one piece. Orders live in a notebook. A slow reply sends the buyer to another brand.

- A live-selling tool vendor lists comment floods, lost orders, delayed payments and buyers asking "did you see mine?" (Ulive.me).
- In many small brands one person replies from one phone, and a DM left for three hours often becomes a sale for another brand (Wati).
- Instagram stopped product tagging in live broadcasts on 16 March 2023 (Business Insider India), so there is no native live checkout.
- In the US, CommentSold already lets shoppers claim products by commenting (CommentSold help). Existing tools are built for US and Southeast Asian Facebook sellers, not WhatsApp, Hinglish and UPI.

**Who it is for.** Meera runs a jewellery brand and sells drops of 10 to 30 pieces to a WhatsApp group. Asha handles payments and shipping from one phone. Priya is a buyer in a tier-2 city who pays by UPI and fears fake sellers. Rohan taps a moment late and wants to know where he stands.

## 2. What we built

Dibs is a live sale room. The seller drops one piece at a time. Buyers tap **Dibs**. The server decides who was first, and the whole room sees it within about a second. Late buyers join a waitlist with a live position. If the winner does not pay, the next buyer is promoted automatically. Each winner gets one private order chat with the seller's team, with a UPI payment card and read receipts. Dibs never touches the money.

- **Seller:** an account with an email and password (no email needed), a three-step start wizard (`/seller/start`), then the console: go live, drop next, claims ledger, room chat with mute and ban, team desk, dashboard, CSV export of a drop's orders, staff invite links. A share kit gives the drop link, announcement texts in English and Hinglish, a QR PNG and a rehearsal link into the demo room.
- **Buyer:** one link from WhatsApp (with a generated preview image), a name and a phone number, one tap. Before the start: add-to-calendar and WhatsApp-share buttons.
- **Shop club:** each shop can run a club on Nexconn community channels with #drops, #chat and #reviews. On in production.
- **Judge mode (/try):** a private demo room with 40 labelled 🤖 bots, the promotion and the order room come about 25 seconds after the tap (about 34 seconds from the click; 25 simulated judges on this build, 22 to 27 s after the tap; bot holds 12 s, yours 90 s). The demo payment card reads "Demo shop: nothing to pay" and cannot be paid. Piece 2 is the last piece and stays winnable for 10 s; the demo then ends on a card with your own times (about a minute from the click on production, 20 Nov 2026). Be a buyer or be the seller.
- **Pages:** /how-it-works (the Nexconn feature map with live flag state), /impact (real usage only), /health (staff only; shows the sale's health only).

Stack: Next.js 16, TypeScript, Supabase Postgres in Mumbai, Vercel in Mumbai, Nexconn Chat Web SDK and Server API (Singapore), Vercel AI SDK.

## 3. How it uses Nexconn

Everything live runs on Nexconn. The database decides; Nexconn carries what people see. We ran a proof of concept live against the Singapore data center on 19 Nov 2026 (two real browser contexts, SDK 26.2.1, from India) before building any screen.

| Feature | Job in Dibs | Status | Measured |
| --- | --- | --- | --- |
| Access tokens | Per-person token, issued by the server | Proven live | 205 to 736 ms; first connect 1.3 to 2.1 s |
| Open channel | The sale room | Proven live | Create 173 ms; enter 204 to 218 ms |
| Custom `DB:*` messages from `dibs_bot` | Item, sold, back, stock, order, pay, status cards | Proven live | Server to browser median 436 ms, n=20 (min 377, max 2093) |
| Message priority | Sold and stock cards ahead of chat | Proven live | Accepted (code 0); effect on order not measured |
| Open-channel metadata | Mirror of state, as a hint only | Proven live | 99 to 155 ms; any client can overwrite it, so it is never trusted |
| Group channels | One order room per winner (owned by an id nobody can sign in as; the bot sends as a non-member); one team desk per shop | Proven live | Create 189 ms; send 87 to 125 ms |
| Read receipts | "Seen" on order-room messages | Proven live | Receipt came back read 1 of 2 |
| System channel | Personal alerts (promoted, expiring, paid) | Proven live (flag on) | 86 ms |
| Mute and ban lists | Seller moderation, enforced by Nexconn | Proven live | Mute 87 ms (send fails 23408); ban 116 ms (23409) |
| Server-side message delete | Scam shield removes a message for everyone | Proven live | About 120 ms |
| Online status | Route orders to staff who are online | Proven live | 128 ms |
| Community channel | Shop club with #drops, #chat, #reviews | Proven live 19 Nov 2026; on in production | 14/14 browser checks; bot to member delivery 10/10, median 213 ms; non-members receive nothing. Production club flow: 6/6 browser steps, 0 errors |
| `message:send` webhook | Typed-claim helper, answer bot, scam shield | Proven live on production (Console set to our URL) | Manual run: a UPI id was removed for everyone within about 5 s; the answer bot replied from the FAQ |
| Pre-message callback | Block scams before delivery | Not available on this plan (greyed out in the Console); flag off | The app refuses before sending; the webhook removes after delivery |
| Call SDK | Video viewing | Behind flag (off) | Not tested; not built |

The numbers above come from the proof of concept (`docs/NEXCONN_FINDINGS.md`), measured from one Mac in India, not from phones on 4G. Production tap latency is in section 4.

Findings that cost us time and may help others: a user can be in at most 1,000 group channels (code 22413); `dibs_bot` hit it because it owned every order room, so each room now has its own owner id that nobody can sign in as and the cron sweep dismisses groups of deleted orders (992 orphans dismissed). Code 1008 is the 20-messages-per-second rate limit (40 simultaneous group sends: 19 sent, 21 refused); the outbox retries, so cards arrive late, not lost. unregistered custom message types are dropped silently, so the client registers every type before connecting. Open-channel history needs cloud retention, so join history comes from `enterChannel`. Metadata can be overwritten by any client, so we use cards and an HTTP state call as the truth.

## 4. Why it is fair

A fair first tap has to be decided in one place. In Dibs that place is a Postgres function, not a phone and not a chat message.

- `claim_dibs` locks the variant's stock row (`SELECT ... FOR UPDATE`). Concurrent taps queue on the lock and are served in commit order. The time shown ("0.4 s") is the commit time minus the moment the piece went live.
- A unique partial index allows one active claim per buyer per piece. A buyer can hold at most 3 pieces per drop.
- A win is a hold with a timer. When it ends, `sweep_drop` promotes the next waitlisted buyer in order. The unit never returns to stock in between. Running the sweep twice changes nothing.
- Every change writes the claim, an audit row and an outbox row in one transaction. A failed chat send never undoes a sale.

**Test evidence** (real Postgres, synthetic taps, not real buyers; 74 unit, 32 database, 27 API, 19 judge-mode and webhook, plus browser end-to-end flows for buyer, seller and club, and production checks in `tests/prod`; `npm test`, `npm run test:db`, `npm run test:api`, `npm run test:sandbox`, `npm run test:e2e`):

- 300 concurrent claims on 2 units: exactly 2 won, 20 waitlisted in commit order, 278 "waitlist full".
- The same buyer tapping at once: one claim.
- Claims racing an item close: fully accepted or refused, never half-written.
- Ten concurrent sweeps promote each unit exactly once.
- A random mix of claims, releases, expiries and closes across concurrent workers keeps stock exact.
- Reproduce with `npm run test:db`. Full suite list is in the README.

**Production load simulation** (`scripts/load-sim.ts` against https://tapdibs.vercel.app, 19 Nov 2026; synthetic taps from one laptop, not real buyers; full log in `docs/load-sim-results.md`):

- Latest run (19 Nov 2026, 10:09 UTC, commit 892489c): 300 taps inside 504 ms on a variant with 2 units, 400 simulated buyers. 2 won, 200 waitlisted (the cap for that test shop), 98 "waitlist full", 0 errors, 0 rate-limited. All 8 database invariants passed: zero double sells, stock never negative, waitlist positions unique and in commit order.
- Client-observed claim latency inside the burst: median 2,752 ms, p95 3,952 ms; server time per claim, median 1,845 ms. Each simulated buyer opens its own TLS connection from one laptop, so this is burst queueing, not a normal tap. The two winning taps took 163 and 181 ms. A single warm tap outside the burst took 149 to 217 ms (earlier run).
- Our target of a median under 700 ms is met for a single warm tap from a laptop in India. It is not met inside a 300-tap burst from one machine. Phones on 4G are not measured.
- The first production runs failed on database connection limits. Moving engine calls to Supabase's HTTP RPC (so a burst queues instead of failing; migration 0007) and making the tap one round trip (`api_claim`) fixed it. The failing runs are kept in the results file. `docs/perf.md` explains where the burst time goes and what we did not change. Migration 0013 also makes five throwaway tables unlogged to cut disk writes.

## 5. Innovation

- **Server-decided first tap.** Not "first comment", not a phone's clock. Everyone sees who won and how fast.
- **Automatic waitlist promotion.** Bots and real buyers alike: hold ends, next in line gets it, a private alert says so.
- **One order chat per winner.** A group channel for the buyer and the assigned staff member; the bot posts the cards from outside the room. Nothing gets lost in DMs. Orders go to the owner above a value the owner sets, otherwise to the staff member with the fewest open orders.
- **Shop club.** A per-shop community channel: the seller's announcements, member chat and reviews from buyers with a paid order, each in its own subchannel. It turns one drop into a following. No real club has run yet.
- **Scam shield.** Phone numbers, UPI IDs and payment links from anyone who is not staff are blocked in the sale room and logged without storing the text. The payment card says: pay only here, never to a number in chat.
- **Judge mode with honest bots.** A judge can finish the whole loop alone. Bots are labelled, tap through the same claim function, never pay in the buyer demo, and never count in real numbers.
- **AI as a helper, never the decider.** A typed "booked" gets a private one-tap prompt, never a claim. An answer bot uses only the shop's FAQ lines. AI never decides who was first, confirms a payment or changes stock.

## 6. Business and growth

**Who pays.** The seller. Buyers use it free, with no app and no sign-up beyond a name and phone number.

**Pricing hypothesis (untested).** Free for small drops. A flat monthly fee per shop above that. No cut of sales, because Dibs does not handle money. The price point is not set. We will ask the first sellers what a drop is worth to them before we choose one.

**Go to market.** The seller's own WhatsApp group is the channel. Each drop gives a share link and QR code. Buyers open it, type a name and phone number, and are in. Every drop is a message the seller already sends.

**First seller (a plan, not a result).** Kundanvi Jewels, a jewellery seller who already sells on WhatsApp, is the planned first real drop. **No real drop has run yet.** Real Dibs buyers on our Nexconn App Key: 0 until that drop.

**Market.** Estimates vary. Redseer projected Indian live commerce at $4 to 5 billion GMV by 2025 (via Adgully). IMARC puts it at about $7.0 billion in 2025. We cite both, as context, not as our forecast. Tanishq reported around ₹100 crore in sales through video calls over two months in 2020 (Business Insider India), which is why video viewing is on our list.

## 7. Honest status and limits

- No real drop has run. No real users, orders or seller feedback.
- No phone verification: a typed phone number is not verified.
- No payments handled. Buyers pay the seller's UPI directly; Dibs records the seller's confirmation.
- Pre-message blocking is not available on our plan, so the app refuses such text before sending, every screen hides it on arrival (a line sent straight through the Server API never rendered), and the webhook removes it after delivery.
- The club has no real members yet; it was tested with synthetic buyers.
- Tap speed in buyers' browsers is recorded but no real-buyer numbers exist yet.
- Video viewing is not built; no Hindi interface toggle; the order room links to the seller's WhatsApp number.
- Light theme only; English screens only.
- Latencies come from one machine in India. Phones on 4G are not measured. The 700 ms median target is met for a single warm tap (149 to 217 ms) and not met inside a 300-tap burst from one machine (median 2,752 ms).
- All tests and the load simulation use synthetic taps.

## 8. What existed before, and how we built it

Dibs is a new build made for this hackathon. It reuses two things from the same team's earlier entry, ClarityLoop (same team, same Nexconn app): the pattern for a signed Nexconn Server API client, and the doodle design language.

**How the team worked.** Team Kaching (Vaibhav Jangid) wrote the product spec, chose the problem and set the rules Dibs must never break (the server decides who was first, bots are always labelled, no invented numbers). The team set the design direction, configured Nexconn (Console app, webhook, Polaris message tracing to debug a missed scam removal), and ran the checks on production and in iPhone Safari on the iOS Simulator. The demo film's side-by-side real drop and four-phone race were the team's ideas. We used AI coding tools for much of the implementation; every feature was specified, reviewed and tested by the team. The product also uses AI at run time for three helper jobs, described above.

Evidence sources: Ulive.me, Wati, Business Insider India (Instagram live shopping; Tanishq), Adgully, IMARC, CommentSold help. Links are in the README.
