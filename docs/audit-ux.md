# Dibs — independent UX, visual and accessibility audit

Audited live at https://tapdibs.vercel.app on 2026-11-19 (read-only; no app files changed). Python Playwright (Chromium) at 360×640, 390×844, 768×1024, 1440×900, plus 640×400 standing in for 1280 px at 200 % zoom. Screenshots are in `.shots/audit/`. Six demo rooms were started over about 40 minutes (3 buyer, 2 seller, 1 keyboard). No real shops, no join sheet submitted, no emails.

Runs referenced below:
- **b1440**: full buyer run at 1440×900 (`b1440_*.png`; timings are seconds after the room loaded).
- **b390**: buyer run at 390×844 with API timings (`b390_*.png`).
- **kb2**: keyboard-only buyer run at 360×640, with reload, second tab, offline and back/forward (`k360_*.png`).
- **s1440 / s390**: seller runs (`s1440_*.png`, `s390_*.png`).
- **static**: every public route at the four viewports (`static_*.png`).

Not tested: a very long buyer name, a very long product title, 4 variants and a single-variant piece. The demo catalogue is fixed (3 variants per piece), and testing these needs either a real shop or a join-sheet submission with a phone number on production. From the code: the name is capped at 40 characters (`JoinSheet.tsx:39`) and truncated in the ledger, but the piece `h1` in the sale room has no clamp.

## Findings

### Blocker

**1. The sale room can sit on a skeleton for a minute, and the demo's beats stretch from 38 s to 95 s, with nothing on screen saying why.**
Screen: sale room, after "Back to the room" from the order room. Viewport: 390×844.
Evidence: `b390_16_132s.png` and `b390_zz_final.png` show grey skeleton blocks from 132 s to 190 s (58 s+) with no text. In the same run the server was slow: `POST /api/try/tick` took **80,894 ms** (and later 12.5 s and 10.3 s), `POST /api/claims` took **8,292 ms**, and the waitlist-to-promotion wait was **95 s** (5.6 → 100.9 s). In b1440 the same wait was 38 s. Three `curl` calls to `GET /api/drops/by-code/...` took 8.7 s, 1.8 s and 1.2 s. "Demo staff confirms in 3 s…" took 11 s (b390, 119 → 130 s). I could not tell whether the slowness was the app or other traffic on the shared rooms, but the UI gives a judge no sign of it either way.
Fix: in `SaleRoom.tsx` `RoomSkeleton` (and `OrderSkeleton`), after about 6 s show "Still connecting… [Retry]", and keep polling `loadState`. On the server, find out why `/api/try/tick` can block for 80 s (lock wait or cold start per tick). Bound it with a statement timeout and let the next tick retry. Make the coach say "Waiting for the server…" when a tick is in flight for more than 3 s.

### High

**2. The order chat opens by itself while the next piece is live, so a judge misses pieces, and a promotion on another piece goes unannounced.**
Screen: sale room → order room. Viewport: 1440.
Evidence: b1440 at 126 s: the judge is promoted on #4 and sees "Opening your order chat…". At 133 s #5 goes live and the coach says "Tap fast, this one is winnable" (`b1440_33_133s.png`). At 137 s the page navigates away to the order room. Pieces #5 and #6 then sold out while the judge was paying. Meanwhile the judge was promoted on #3 off-screen. The order room has no alert for other pieces, and the judge only found the #3 hold on the end card, with **00:39** left on it (`b1440_39_177s.png`). b390 shows the same pattern at 101–114 s: promoted on #1 while #2 is live, then yanked away mid-claim.
Fix: in judge mode, don't auto-open (`setAutoOpen` in `SaleRoom.tsx:95/165/278`) while `state.live` is a different item than the order's item. Show the "Pay now" button instead. In `OrderRoom.tsx`, listen for the personal `promoted` alert and show a toast that links to the new order. Or, smaller: have the sandbox script hold the next piece until the judge's open hold is paid or expired.

**3. The coach strip often contradicts what is on screen.**
Evidence:
- On arrival, piece #1 already wears the SOLD stamp and the status reads "Sold out · tap to join the waitlist", yet the coach says "It's live! Tap Dibs! now — 🤖 bots are tapping too." (`b1440_02_0s.png`).
- After the promotion alert (b1440 at 126 s), the coach still said "You're #1 on the waitlist" for 7 s.
- On piece #3 the coach said "Tap fast, this one is winnable", and the judge tapped 0.6 s after Dibs was enabled and landed **#2 on the waitlist** (b1440 at 85 s).
- In b390 at 101.7 s it says "Next piece is live. Tap Dibs!" while the alert says "It's yours! … Pay within 01:30".

Fix: in `Coach` (`SaleRoom.tsx:640`), give `promoLive`/held-unpaid lines priority over everything else, and pass `promoLive` in. Add a line for when the live piece is sold out and the judge hasn't tapped yet: "Bots got there first. Tap Dibs! to join the waitlist." Only say "winnable" when the server script actually guarantees it, or soften it to "Tap fast, you can beat the bots on this one."

**4. Piece 1 is live, and sold out, before the judge sees the room.**
Evidence: the time from clicking /try to the room rendering was 6.3 s, 6.2 s, 7.6 s and 7.0 s across four runs. The PRD says piece 1 goes live 5 s after the judge joins, but the judge never sees the waiting room or the "Piece 1 drops in 5…" countdown. The first frame already shows SOLD (`b1440_02_0s.png`, `k360_after_kbd_dibs.png`). The race that makes the fairness point happens before they arrive.
Fix: start the 5 s clock from the room's first `/api/try/tick` (the room is already calling it), not from `/api/try/start`.

**5. "I've paid" is below the fold on every viewport, while the coach tells the judge to tap it.**
Evidence: at 1440×900 the first screen ends at the UTR field (`b1440_08_42s.png`, `b1440_35_137s.png`). At 360×640 the first screen ends at the payment sentence (`k360_order_top.png`). With the keyboard it takes 6 Tabs to reach. The coach line "Demo: tap I've paid" is at the top of the page.
Fix: in `OrderRoom.tsx`, put the I've-paid form directly under the "Pay ₹… to …" line, with the QR and UTR after it. Or, in sandbox, show a sticky bottom bar with I've paid, the same way the sale room's action bar works.

**6. The demo QR code is a payable UPI code for `demo@upi`.**
Evidence: `supabase/migrations/0005_sandbox.sql:61` sets the sandbox UPI ID to `demo@upi`. `src/lib/upi.ts:20` builds `upi://pay?pa=demo%40upi&…&am=1450.00`, and the order room draws it as a scannable QR (`b1440_08_42s.png`). A judge who scans it "to see what happens" gets a real payment screen for a handle that may belong to a stranger. That undercuts the "nothing here is real money" banner.
Fix: in sandbox, don't encode `upi://pay`. Render the QR with a "DEMO" overlay and a payload such as `https://tapdibs.vercel.app/how-it-works`, or show a striped placeholder labelled "Demo: no QR".

**7. The seller demo has no guide, and it opens on an alarm.**
Screen: `/seller/drops/[id]`. Viewport: 1440.
Evidence: `s1440_01_console.png` shows no coach strip at all (the buyer demo has one). The first thing in the console is a peach "Connecting… · Dibs is paused until we're back" bar, next to "0 watching", although the PRD promises "40 bots already in the room". The PRD seller script (Drop next → watch promotion → open a "Says paid" order → Payment received → Mark shipped → mute the bot) is not signposted anywhere.
Fix: reuse the `Coach` pattern in `Console.tsx` with one line per beat, driven by real state ("Press Drop next", "Watch Karan's hold run out, and the next buyer moves up", "Open a Says paid order and confirm it", "Mute Reyansh C., the shield already blocked his UPI ID"). Delay `ConnectionBar` by 3 s on first connect so a normal connect never flashes the alarm.

**8. After joining a waitlist, the selected chip jumps to a different variant.**
Evidence: the judge queued on Gold ("You're #3 on the waitlist"), but the lime ✓ chip moved to **Silver** (`b1440_03_2s.png`). At 360 px the chip the judge is queued on scrolls out of view (`k360_after_kbd_dibs.png`). The cause is `SaleRoom.tsx:230-234`: once every variant is sold out, `chosen` falls back to the shortest waitlist.
Fix: when `wait` or `hold` exists for the live item, set `chosen` to that claim's variant before the fallbacks.

**9. Keyboard and screen reader: focus is lost after a Dibs tap, and a disabled Dibs can't be reached.**
Evidence (kb2): Dibs is the 9th Tab stop, after two header links, the carousel, two photo dots and three chips. That is acceptable. Enter, Enter sent exactly **1** claim (good). But the button then goes `disabled` and focus falls to `<body>` ("focus after claim: BODY"). Before it is enabled, `disabled` takes Dibs out of the Tab order, so a keyboard user can't reach it to hear why ("Loading photo…", "Pick an option first").
Fix: in `ui/button.tsx`, render `aria-disabled="true"` and swallow the click instead of setting `disabled` for the `dibs` variant (the Button already does this for `busy`). Or move focus to `#dibs-status` (`tabIndex={-1}`) when the result arrives.

### Medium

**10. Buyer screens at 1440 px look like a phone page dropped into the middle of the screen.**
Evidence: the content is a 576 px column (`max-w-xl`) under a header that spans about 1110 px (`b1440_02_0s.png`). The chip row still scrolls sideways and cuts the third chip to "Re…" even with 860 px of empty space on the sides. The fixed action bar's top rule runs edge to edge while its content is 576 px.
Fix: at `lg`, let the chips wrap (`lg:flex-wrap lg:overflow-visible` on the chip group) and give the room two columns (piece card and action bar on the left; My status, Sold to… and chat on the right, `lg:max-w-5xl lg:grid-cols-[1fr_22rem]`). At minimum, match the header width to the content column.

**11. Screen readers hear the same sentence three times, and hear noise.**
Evidence (kb2 `LIVE REGIONS`): "You're #3 on the waitlist…" sits in three polite regions at once: the sr-only `announce`, the `Coach` and the `StatusLine`. The ticker (`ticker.tsx:21`, `aria-live="polite"`) announces every bot sale, and the chat character counter "0/200" (`Chat.tsx:148`) is `aria-live="polite"`.
Fix: drop `role="status"` from `Coach` (or announce it only when the beat changes). Keep `StatusLine` as the one result region and delete the duplicate sr-only `announce`, or the reverse. Set the counter to `aria-live="off"`. Keep the ticker region but announce only sales involving "You".

**12. The seller's order sheet speaks in the buyer's voice.**
Evidence: `s1440_09_order_open.png`, where the staff view reads "Expired · Your hold on #1 ran out. It went to the next buyer."
Fix: in `OrderRoom.tsx`, when `viewer === "staff"`, say "Karan S.'s hold ran out. It went to the next buyer."

**13. The claims ledger reorders under the pointer.**
Evidence: in s1440 at 37 s, the first "Order" button belonged to a hold with 1 s left. By the time the sheet opened, the order was Expired and had moved down the list (`s1440_09_order_open.png`). Rows remount and re-sort every update (`Ledger.tsx` key `${claimId}:${state}`).
Fix: pause re-sorting while the pointer or focus is inside the ledger (apply the sort only on `pointerleave`/`blur`), or sort holds by `expiresAt` descending so rows about to expire sink rather than sit on top.

**14. /impact says bots "never pay", but in the seller demo they do.**
Evidence: `/impact` says "Demo bots: they are labelled 🤖 and never pay". In the seller demo, bot rows show "Says paid" with UTR numbers (`s1440_13_desk.png`, the "UTR 430870051433" row).
Fix: say "Demo bots never pay real money. In the seller demo they tap I've paid so you can confirm a payment."

**15. The navigation into the order room is slow, so "Opening your order chat…" lingers.**
Evidence: in b1440, "Opening your order chat…" was on screen for **11 s** (126 → 137 s) against a 1.6 s timer. `router.push` waits for the `/o/[id]` server render, and a new piece went live meanwhile.
Fix: add `src/app/o/[orderId]/loading.tsx` (the `OrderSkeleton`) so navigation commits at once, and prefetch the order link when the promotion arrives.

**16. At 360×640, the piece title hides behind the action bar.**
Evidence: `k360_after_kbd_dibs.png` and `k360_offline.png` show "#1 Temple" with the rest of the title and the price row under the bar. The SOLD stamp is clipped to "SOL".
Fix: on short screens (`max-height: 700px`), cap the photo at `min(100%,16vh)` in `SaleRoom.tsx:459`, and scale the stamp with the photo (`Stamp size="md"` under 400 px).

**17. The "Back in play" ticker line doesn't match the spec and is ambiguous.**
Evidence: the room ticker shows "Back in play → S is free again" (reopened room, `reopen_ended_demo_390.png`). The PRD's key copy is "Back in play → Rohan S. from the waitlist". "S" reads like a buyer's initial.
Fix: when nobody is waiting, write "Back in play → size S is free again". Use the PRD string when there is a promotion.

**18. The dashboard draws a bar for zero and shows a dead tile.**
Evidence: `s1440_14_dashboard.png`, where "Paid 0" has a lime block and "Viewers: not measured" is set in large mono.
Fix: in `Dashboard.tsx`, use width 0 (or a hairline) for a 0 value, and hide the Viewers tile until it is measured.

**19. /impact opens on six bright zero tiles.**
Evidence: `static_1440_impact.png`. The honest empty state is there, but a judge's eye goes to the big "0" tiles.
Fix: when `drops === 0`, render only the empty state and the "What is never counted" list.

**20. The sale room ships more than twice the landing page's JavaScript.**
Evidence: `performance` resource `transferSize` is 393 KB of script on the sale room against 148 KB on `/`, plus 96 KB of fonts on both. The landing page's LCP is 1.15 s at 390 px (a text paragraph) and 0.57 s at 1440 (the hero image). CLS is 0.005 at 390 and 0.036 at 1440. That is fine for a laptop, but heavy for "a cheap phone on patchy 4G" (NFR).
Fix: lazy-load the chat, the emoji row and the "In this drop" strip (`next/dynamic`), and check for a full Nexconn SDK import on the room.

### Low

**21. Missing pages have no heading and return 200.**
Evidence: `/s/demo/d/doesnotexist` and `/o/<unknown>` return HTTP 200 with no `h1` (`static_390_s_demo_d_doesnotexist.png`).
Fix: render the `EmptyState` title as an `h1`, and call `notFound()` for a missing drop.

**22. Page titles.**
Evidence: the 404 page's title is "Dibs — First tap wins", and `/health` (signed out) has no `h1`.
Fix: set the 404 metadata title to "Page not found · Dibs", and add an `h1` "Health" on the signed-out panel.

**23. Small text on /how-it-works.**
Evidence: the diagram labels are 12.5–13.5 px ("POST /api/claims", "sees SOLD"), and `ItemWord` on the room's "In this drop" strip is `text-xs` (12 px).
Fix: raise the labels to `text-sm`/16 px.

**24. No dark mode.**
Evidence: `globals.css` has no `prefers-color-scheme` tokens, while the NFR says "good contrast in light and dark".
Fix: either add dark tokens or drop "and dark" from the PRD. (Light mode was fine: the defined token pairs are annotated at 5.1:1 or better, and a computed sweep of `/`, `/try`, `/impact`, `/seller` and `/me` found no real failure.)

**25. The tap time wraps away from its unit.**
Evidence: `k360_promoted.png`, where "Sold to Rohan M. · 2.6" breaks before "s".
Fix: put `whitespace-nowrap` on the time span in `ticker.tsx`.

**26. A finished timeline step shows a dot instead of a check.**
Evidence: `b1440_36_169s.png`, where the "Held" step shows "·".
Fix: use the `check` icon in `timeline.tsx` for completed steps.

**27. The hero mock's YOURS stamp covers the copy.**
Evidence: `land1440_how.png` and `static_1440_home.png`, where the stamp sits over "Pay within 10:00", the line the mock exists to show.
Fix: move the stamp to the photo.

**28. The seller console shows two room chats.**
Evidence: `s1440_01_console.png`, which has the chat in the phone preview and again in the full room chat. The preview also clips its "In this drop" heading at the bottom edge of the frame.
Fix: hide the chat inside the preview (`preview` prop), and end the frame above the strip.

**29. Copy drift between demo screens.**
Evidence: the coach says "The bot ahead didn't pay" while the alert says "The buyer ahead didn't pay". The sr-only text "Under 2 minutes left." is announced at the start of a 1:30 demo hold.
Fix: use one term, and skip the 2-minute announcement when the hold starts at or below 2:00.

## What already works well

- The landing page passes the 10-second test: "First tap wins." plus a one-line explanation, with one lime "Try the live demo" CTA above the fold at every width and no horizontal overflow at 360 px or at 200 % zoom.
- The demo starts in one click with no sign-up, the "Demo room · 40 🤖 demo buyers · nothing here is real money" banner appears on every demo screen, and bots carry the "🤖 Demo buyer" pill in the ticker, chat, ledger and desk.
- The fixed sale-room action bar (chips, 56 px Dibs!, two-line status) keeps the action on screen at 360×640, and it doesn't jump when the state changes.
- Tap targets measured 48 px or more everywhere except the skip link, focus rings are visible (3 px ink plus a lime halo), `lang="en-IN"` is set, and every route has its own title.
- The core loop holds up under abuse: a double Enter sent one claim, a reload mid-hold kept the countdown (01:27), a second tab on the order synced to "Paid", offline showed "Reconnecting… Dibs is paused" and cleared on reconnect, and back/forward stayed coherent.
- Waitlist feedback is instant (the result arrived 0.7 s after the tap), and every state has an icon and a word (Held, Says paid, Paid, Shipped, #3 waitlist, Expired).
- The desk's "Says paid — check your bank" group and the ledger's "from waitlist" badge tell the seller what to do and show the fairness story.
- The 404 page ("Someone already called dibs on this page."), the empty states and the doodle system (grid paper, ink borders, lime and pink, sticky-note tints) are consistent and feel deliberate. Reduced-motion users get no animations.
