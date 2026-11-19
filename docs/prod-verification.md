# Production verification

Date: 19 Nov 2026, about 11:40 to 12:10 IST. Target: https://tapdibs.vercel.app (REALTIME_MODE=nexconn, real Supabase, real Nexconn webhook). Run from one Mac in India with Python Playwright 1.x from `~/.claude/brag-scaled-venv`.

Scripts (all in `tests/prod/`):

| Script | What it does |
| --- | --- |
| `common.py` | Reads `.env.local` (never prints it), Supabase Admin API helper, SQL through the project's `postgres` client |
| `seller_real.py` | Part A: real seller sign-in (code path and link path), shop, product with photo, drop, buyer, desk, scam shield, dashboard, health, staff invite, end drop, then deletes everything it made and checks that it is gone |
| `engine_pass.py [webkit\|chromium\|both]` | Part B: public pages and the `/try` buyer path in WebKit (iPhone 13 profile) and Chromium (Pixel 5 profile) |

Screenshots and `results.json` go to `.shots/prod/` (git-ignored).

No email was sent. Codes and links came from `POST /auth/v1/admin/generate_link` (returns `email_otp`, 8 digits, and `action_link`; flat response shape). In the code path the UI's "Send my code" request to `/auth/v1/otp` was fulfilled locally with `200 {}` by `page.route`; the code check (`/auth/v1/verify`) went to the real Supabase.

## A. Real seller sign-in and a real drop (`seller_real.py`, final run)

Seller context 1280×800, buyer context 390×844 (mobile, touch), staff context 1280×800.

| Step | Result | Timing / detail |
| --- | --- | --- |
| A2b Link path: open `action_link` (redirect_to `/seller`) | PASS | Landed on `https://tapdibs.vercel.app/seller#access_token=…`, hash stripped, "Set up your shop" in 1.5 to 2.0 s. `redirect_to=/seller` is honoured (on the allow list) |
| A2a Code path: email, "Send my code" (intercepted, 1 request), type the 8-digit code, Sign in | PASS | Real verify returned 200; "Set up your shop" in 0.8 to 0.9 s |
| A3 Shop through the UI (`zz-verify-<ts>`, `verify@upi`, payee "Verify") | PASS | Lands on `/seller/products` |
| A3 Photo upload (64×64 PNG, signed URL to Storage) | PASS | "Photo 1" shown in the editor |
| A3 Product with two variants (S, M) | PASS | "2 in stock · S, M" |
| A3 Drop created, share link shown | PASS | `/s/zz-verify-<ts>/d/<code>` |
| A3 Go live, Drop next | PASS | Current piece shown |
| A3 Buyer joins (name + 10-digit phone starting 9), taps Dibs | PASS | "You got it!" 0.23 to 0.84 s after the click (3 runs) |
| A3 Seller ledger shows the hold | PASS | 0.0 to 1.3 s after "You got it!" |
| A3 Order room, I've paid | PASS | "Payment sent. Your timer is paused" |
| A3 Desk lists the order under "Says paid" | PASS | |
| A3 Mark received, buyer sees "Paid · confirmed by" | PASS | 1.3 to 2.3 s |
| A3 Mark shipped, buyer sees Shipped | PASS | Already shown when checked |
| A3 Scam shield through the real Nexconn webhook (buyer posts a UPI id in the room chat) | PASS | Message shown to the sender, then removed; notice "Phone numbers and UPI IDs can't be shared…" shown. Removal 1.5, 2.1 and 5.2 s after send (3 runs). Also gone from the seller console chat. `moderation_events`: rule `upi`, action `blocked` |
| A3 Dashboard for the drop | PASS | Taps 1, Holds 1, Paid orders 1, Paid value ₹1,450, Waitlist saves 0, Median winning tap 5.0 to 6.3 s (time from Drop next to the tap, includes the script's join), Viewers "not measured" |
| A3 `/health` signed in shows OK with no failed outbox rows | **FAIL** | Outbox: 0 failed (pending 2 to 7). Page says **Status: Degraded**, because of the AI answer bot: 212 of 212 calls in 24 h logged with model `none` (no model available) plus 15 of 194 Gemini calls failed. Not caused by this run. See defect 2 |
| A4 Invite `<unique2>@dibs-verify.test` from Shop settings; that user signs in with an admin link in a third context | PASS | Lands on `/seller/drops` as role `staff` of the same shop; settings show "Only the shop owner can change these" with the form disabled; "Only the owner can invite or remove team members."; the desk opens and shows the shipped order |
| A3 End drop | PASS | Ended summary shown |
| Console errors / sideways scroll | PASS | 0 errors, 0 overflow in the final run. One earlier run logged one transient `net::ERR_CONNECTION_CLOSED` on the buyer page with no visible effect |

Earlier attempts in the same session: one aborted because `page.goto(action_link)` waited for the `load` event, which Playwright never reported after the cross-origin redirect to a hash URL (the page itself had loaded and signed in; fixed with `wait_until="commit"`); one had test-side timing mistakes (5 s default `expect` timeout, a non-waiting `count()`), fixed. Each attempt cleaned up after itself.

### Cleanup (A5)

After every run the script deleted: the shop (cascade: products, variants, drops, items, claims, orders, staff rows), the buyer created by the join, the product photo from bucket `product-photos` (Storage API delete by path), and every auth user it created (`DELETE /auth/v1/admin/users/<id>`, then `GET` returns 404). Final checks:

- `select … from shops where not is_sandbox` returns no rows.
- 0 staff rows with a `@dibs-verify.test` email, 0 buyers named "Verify Buyer".
- No auth users with a `dibs-verify` email.
- No `product-photos` objects created in the last 2 hours.
- `GET /api/impact`: `{"drops":0,"buyers":0,"claimsWon":0,"paidOrders":0,"waitlistSaves":0,"paidValuePaise":0}`.

No delete was refused. Note: at the start another session's test shop ("Meera Jewels", slug `t-e7c69ea0`, a live drop) was in the same database and `/api/impact` showed `drops: 1`. It was not touched by this run and was gone (removed by its owner) by the end.

## B. Browser engines (`engine_pass.py`)

WebKit was already installed (`webkit-2359` in the Playwright cache), so nothing was downloaded. Three demo rooms were started in about 6 minutes.

| Check | WebKit, iPhone 13 (390 px) | Chromium, Pixel 5 (393 px) |
| --- | --- | --- |
| `/`, `/how-it-works`, `/impact`, `/seller`: render, no console errors, no sideways scroll | PASS (both runs) | PASS |
| `/try` → Be a buyer → tap Dibs → waitlist copy | Run 1 **FAIL** (see defect 1); run 2 PASS: "You're #3 on the waitlist…" | PASS: "You're #3 on the waitlist…" |
| Promoted "It's yours!" | PASS, 39.8 s after the click | PASS, 40.3 s after the click |
| Order room opens | PASS, 44.8 s after the click | PASS, 59.5 s after the click |
| I've paid → "Paid · confirmed by" | PASS, 5.7 s | PASS, 6.2 s |
| Back to the room → piece 2 → win | PASS, "You got it!" 0.36 s after the click | PASS, 0.34 s after the click |
| Whole path, Be a buyer to piece 2 won | 67.5 s | 82.7 s |
| Network errors | 2 × `POST /api/try/tick`: "The network connection was lost" (no visible effect) | none |

## C. Honesty sweep

Checked `/`, `/try`, `/how-it-works`, `/impact` on production, `README.md`, `docs/WRITEUP.md` against A, B, `docs/NEXCONN_FINDINGS.md` and `docs/load-sim-results.md`.

| Where | Statement | What was observed |
| --- | --- | --- |
| `README.md` line 113 | "Still to do in the Console: the webhook URL with `message:send` …" | Out of date. The webhook is set and works on production (A3 scam shield; the README's own feature-map row says so). Contradicts the table above it |
| `README.md` "Try it" step 3; `docs/WRITEUP.md` line 27 | Promotion and the order room came "about 30 to 40 seconds after the tap" | Promotion 39.8 and 40.3 s (top of the range); the order room opened 44.8 s (WebKit) and 59.5 s (Chromium) after the tap. The order-room part is optimistic |
| `README.md`, `docs/WRITEUP.md`, `/how-it-works` | Scam shield removes the message "within about 5 s" | Matches: 1.5 to 5.2 s in 3 runs |
| `/try` | "About 90 seconds"; promotion "within about a minute" | Matches: 67.5 and 82.7 s; promotion about 40 s |
| `docs/WRITEUP.md` line 23 | Room sees the result "within about a second" | Matches for the tapper and the seller ledger (0.2 to 1.3 s) |
| `/impact` | "No real drop has run yet", all zeros | True after cleanup. During test runs non-sandbox test shops count briefly (expected; test shops are real shops) |

No other mismatches found. Statements about seller sign-in by email one-time code are now backed by a production run of both entry paths, except the delivery of the email itself.

## Defects

1. **WebKit: a Dibs tap can fail with "You're offline" on a dropped keep-alive connection, and is not retried.** Seen 1 of 2 WebKit runs on `/try`. Reproduce: `~/.claude/brag-scaled-venv/bin/python tests/prod/engine_pass.py webkit` (may need more than one run). After tapping Dibs the status never appears; the page shows "You're offline. Check your connection and try again." while the network is up, and the console has "Failed to load resource: The network connection was lost" (screenshot `.shots/prod/webkit/zz-failure.png`). The second run logged the same WebKit error on two `POST /api/try/tick` calls. Cause in code: `src/lib/client/api.ts` turns any `fetch` rejection into `ApiError("network", "You're offline…")` with no retry. Safari raises this error (NSURLErrorNetworkConnectionLost) when it reuses a connection the server has already closed, so real iPhones may see it. A single automatic retry of a POST that fails before any response would cover it; for claims a retry is safe because the engine returns `already` for a second active claim. Not verified on a real iPhone.
2. **`/health` is permanently "Degraded" on production** because of the AI answer bot, not the sale: in the last 24 h, 212 answer-bot calls were logged with model `none` and `ok = false` (in `src/lib/ai/model.ts` that means no API key or every model resting after a rate limit), plus 15 of 194 Gemini calls failed. They are still being written (latest a few minutes before the check). Also 10 of 116 `room_meta` calls failed in the last hour (last code 23410). A staff member opening `/health` sees Degraded with no failure in the sale path. Either the AI calls are really failing that often (rate limits), or calls skipped because every model is resting should not be logged as failures. Outbox: 0 failed.
3. Minor, test tooling: `page.goto(action_link)` never reports `load` in Playwright Chromium after Supabase's redirect to `/seller#access_token=…` (the page works). Use `wait_until="commit"`.

## Not verified

- Real email delivery (Supabase mailer, the email template, spam folders, the mailer's hourly rate limit). The send step was intercepted on purpose.
- Real handsets: an actual iPhone/Safari and Android phone, on 4G. WebKit and Chromium device profiles on a Mac are not the same as real phones.
- Typed-claim helper and answer bot on a real drop (only the scam shield was exercised).
- Read receipts, mute/ban and the system-channel alerts on a real (non-demo) drop were not checked separately.
- More than one buyer racing on a real drop, waitlist promotion on a real drop (covered only in the demo room).
