# Dibs

First tap ==wins==. Everyone sees it. Nobody gets lost in the DMs.

> **Live app:** https://tapdibs.vercel.app · judge demo at /try (no sign-up)
> **Code:** https://github.com/vj-io/dibs (public at submission)
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

- **Seller console:** go live, drop next, claims ledger, room chat with mute and ban, team desk, dashboard.
- **Buyer:** one link from WhatsApp, a name and a phone number, one tap.
- **Judge mode (/try):** a private demo room with 40 labelled 🤖 bots, a manual run on production reached the promotion and the order room about 30 to 40 seconds after the tap. Be a buyer or be the seller.
- **Pages:** /how-it-works (the Nexconn feature map with live flag state), /impact (real usage only), /health (staff only).

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
| Group channels | One order room per winner; one team desk per shop | Proven live | Create 189 ms; send 87 to 125 ms |
| Read receipts | "Seen" on order-room messages | Proven live | Receipt came back read 1 of 2 |
| System channel | Personal alerts (promoted, expiring, paid) | Proven live (flag on) | 86 ms |
| Mute and ban lists | Seller moderation, enforced by Nexconn | Proven live | Mute 87 ms (send fails 23408); ban 116 ms (23409) |
| Server-side message delete | Scam shield removes a message for everyone | Proven live | About 120 ms |
| Online status | Route orders to staff who are online | Proven live | 128 ms |
| Community channel | Planned shop club | Proven live in the proof of concept; flag off, club not built | About 100 ms per call |
| `message:send` webhook | Typed-claim helper, answer bot, scam shield | Proven live on production (Console set to our URL) | Manual run: a UPI id was removed for everyone within about 5 s; the answer bot replied from the FAQ |
| Pre-message callback | Block scams before delivery | Not available on this plan (greyed out in the Console); flag off | Scam shield removes after delivery instead |
| Call SDK | Video viewing | Behind flag (off) | Not tested; not built |

The numbers above come from the proof of concept (`docs/NEXCONN_FINDINGS.md`), measured from one Mac in India, not from phones on 4G. Production tap latency is in section 4.

Findings that cost us time and may help others: unregistered custom message types are dropped silently, so the client registers every type before connecting. Open-channel history needs cloud retention, so join history comes from `enterChannel`. Metadata can be overwritten by any client, so we use cards and an HTTP state call as the truth.

## 4. Why it is fair

A fair first tap has to be decided in one place. In Dibs that place is a Postgres function, not a phone and not a chat message.

- `claim_dibs` locks the variant's stock row (`SELECT ... FOR UPDATE`). Concurrent taps queue on the lock and are served in commit order. The time shown ("0.4 s") is the commit time minus the moment the piece went live.
- A unique partial index allows one active claim per buyer per piece. A buyer can hold at most 3 pieces per drop.
- A win is a hold with a timer. When it ends, `sweep_drop` promotes the next waitlisted buyer in order. The unit never returns to stock in between. Running the sweep twice changes nothing.
- Every change writes the claim, an audit row and an outbox row in one transaction. A failed chat send never undoes a sale.

**Test evidence** (real Postgres, synthetic taps, not real buyers; 52 unit, 27 database engine and concurrency, 17 judge-mode and webhook, 10 API, 33 browser checks; `npm test`, `npm run test:db`, `npm run test:sandbox`, `npm run test:api`, `npm run test:e2e`):

- 300 concurrent claims on 2 units: exactly 2 won, 20 waitlisted in commit order, 278 "waitlist full".
- The same buyer tapping at once: one claim.
- Claims racing an item close: fully accepted or refused, never half-written.
- Ten concurrent sweeps promote each unit exactly once.
- A random mix of claims, releases, expiries and closes across concurrent workers keeps stock exact.
- Reproduce with `npm run test:db`. Full suite list is in the README.

**Production load simulation** (`scripts/load-sim.ts` against https://tapdibs.vercel.app, 19 Nov 2026; synthetic taps from one laptop, not real buyers; full log in `docs/load-sim-results.md`):

- 400 simulated buyers, 300 taps on one variant with 2 units, spread over 0.6 to 0.8 s. Latest run: 2 won, 200 waitlisted (the cap for that test shop), 98 "waitlist full", 0 errors, 0 rate-limited. All 8 database invariants passed: zero double sells, stock never negative, waitlist positions unique and in commit order.
- Client-observed claim latency inside the burst: median 2.8 s, p95 4.0 s. Each simulated buyer opens its own TLS connection from one laptop, so this is burst queueing, not a normal tap. The two winning taps took 301 ms and 497 ms. A single warm tap outside the burst took 149 to 217 ms.
- Our target of a median under 700 ms is met for a single warm tap from a laptop in India. It is not met inside a 300-tap burst from one machine. Phones on 4G are not measured.
- The first production runs failed on database connection limits. Moving engine calls to Supabase's HTTP RPC (so a burst queues instead of failing; migration 0007) and making the tap one round trip (`api_claim`) fixed it. The failing runs are kept in the results file.

## 5. Innovation

- **Server-decided first tap.** Not "first comment", not a phone's clock. Everyone sees who won and how fast.
- **Automatic waitlist promotion.** Bots and real buyers alike: hold ends, next in line gets it, a private alert says so.
- **One order chat per winner.** A group channel with the buyer, the assigned staff member and the bot. Nothing gets lost in DMs. Orders go to the owner above a value the owner sets, otherwise to the staff member with the fewest open orders.
- **Scam shield.** Phone numbers, UPI IDs and payment links from anyone who is not staff are blocked in the sale room and logged without storing the text. The payment card says: pay only here, never to a number in chat.
- **Judge mode with honest bots.** A judge can finish the whole loop alone. Bots are labelled, tap through the same claim function, never pay, and never count in real numbers.
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
- Pre-message blocking is not available on our plan, so the scam shield removes a message after delivery (about 5 seconds in a manual run), not before.
- No shop club (flag off).
- Video viewing is not built; the order room links to the seller's WhatsApp number.
- Light theme only; English screens only.
- Latencies come from one machine in India. Phones on 4G are not measured. The 700 ms median target is met for a single warm tap (149 to 217 ms) and not met inside a 300-tap burst from one machine (median 2.8 s).
- All tests and the load simulation use synthetic taps.

## 8. What existed before, and AI assistance

Dibs is a new build made for this hackathon. It reuses two things from the same team's earlier entry, ClarityLoop (same team, same Nexconn app): the pattern for a signed Nexconn Server API client, and the doodle design language.

**AI coding agents (Claude Code) wrote most of the code under the team's direction.** The team set the product, the fairness rules and the tests, and reviewed the results. The product also uses AI at run time for three helper jobs, described above.

Evidence sources: Ulive.me, Wati, Business Insider India (Instagram live shopping; Tanishq), Adgully, IMARC, CommentSold help. Links are in the README and `docs/PRD.md`.
