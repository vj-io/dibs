# Dibs: demo video script (2:45 maximum, narrated)

Team **Kaching** · Vaibhav Jangid · Nexconn Build Challenge 2026 · Track: Marketplace & Support

Style: documentary voiceover, one continuous track with no pauses, fast cuts (a new picture every 2 to 4 seconds), animation on the cuts. Recorded on the deployed app, https://tapdibs.vercel.app. Narration is about 425 words including the end slide, which is 2.6 words a second over 2:45: brisk, with no room for pauses. Read it once against a stopwatch. If it runs past 2:45, cut the last sentence of beats 3, 4 or 7 first.

## Honesty rules for this video

- Nothing on screen is faked. Every app picture is a real screen recording of the deployed app.
- Every bot is labelled 🤖 on screen (the banner "Demo room · 40 🤖 demo buyers · nothing here is real money" stays visible in the demo cuts).
- Beat 3 uses two real browser windows on a drop the team created. Caption it "Team test drop · two browser windows". It is not a real seller and not real buyers.
- No real drop has run, so the video shows no real numbers. Do not add any.
- Latency numbers come from `docs/NEXCONN_FINDINGS.md` and are captioned "proof of concept, one machine in India".
- Production tap-to-result median and p95, if you add them: `TBD-after-measurement` (fill after measurement, caption "measured on production").

## Beats

| # | Time | On screen | Narration (exact) |
| --- | --- | --- | --- |
| 1 | 0:00 to 0:14 | A WhatsApp-style group scrolling fast with "booked!!", "me first", "did you see mine?" (a drawn mock-up, captioned "illustration"). Two arrows point at one bangle. | Small sellers run drops in WhatsApp groups and comments. Two people say booked. Who was first? Nobody can prove it. Orders end up in a notebook, and slow replies send buyers away. |
| 2 | 0:14 to 0:30 | Title card "Dibs" with the pitch line. Cut to the seller console on a laptop and a phone sale room side by side. | This is Dibs. First tap wins. Everyone sees it. Nobody gets lost in the DMs. The seller drops one piece, and the whole room sees it at once, with the photo, the price, and the stock for each size. |
| 3 | 0:30 to 0:58 | Two real browser windows, buyer A and buyer B, caption "Team test drop · two browser windows". The seller presses Drop next. Both tap Dibs. A shows "You got it! Pay within 10:00". B shows "You're #1 on the waitlist". The ticker shows "Sold to … · 0.4 s" in both. | Two buyers tap together. The server decides, not a phone. One locked database transaction puts the taps in order. One buyer gets it. The other is number one on the waitlist. Everyone sees who won and how fast. No arguments, no screenshots, no he-said-she-said. And the tap works on a cheap phone with one thumb, with no app to install, and no password to remember. |
| 4 | 0:58 to 1:18 | The judge demo at /try: tap "Be a buyer". Banner with 40 🤖 demo buyers. The judge taps, lands on the waitlist "You're #3". Cut to bot holds counting down, then "It's yours! The buyer ahead didn't pay". | Judges can try it alone. Forty demo buyers, each marked with a robot, tap at set delays through the same claim code. They never pay. Their holds run out, and you are promoted automatically, with a private alert that says it is yours. The waitlist is not a promise. It is a queue the server keeps in order, and it moves the moment someone drops out. |
| 5 | 1:18 to 1:38 | The order room: order card, UPI payment card with "Pay only here, never to a number in chat", "Seen" on a message, "I've paid" tapped, the demo staff member confirms, timeline moves to Paid. | Every winner gets one private order chat with the team. A UPI card, read receipts, and a clear status from held, to paid, to shipped. The buyer pays the seller directly, and the seller confirms. Nothing gets lost in the DMs, and Dibs never touches the money, so there is nothing to refund. |
| 6 | 1:38 to 1:52 | Sale room chat: a demo bot posts a fake UPI ID. The message disappears. The sender sees the block notice. The seller's moderation log shows the entry. | If someone posts a phone number or UPI ID in the room, the scam shield removes it for everyone. Fake pay-me-here messages never reach buyers, and the seller sees what was blocked, without the message text being stored. |
| 7 | 1:52 to 2:12 | Seller console in "Be the seller": claims ledger filling, waitlist counts, Drop next, a hold expiring and the promotion in the ledger, the team desk with orders, Mark paid, Mark shipped, mute a bot. | The seller runs it all from one console. Taps, holds and waitlists fill live. Orders land on the team desk. Mark paid, mark shipped, mute anyone. If a winner does not pay, the console shows the hold run out and the next buyer step in, with no seller action at all. One screen, one sale, and no notebook. |
| 8 | 2:12 to 2:30 | The /how-it-works feature map, scrolling fast. Captions pop on three rows: "Custom cards from dibs_bot · median 436 ms, n=20", "Order rooms · group channels", "Read receipts". Then a diagram: browser, one Postgres transaction, outbox, Nexconn, every browser. | Everything live runs on Nexconn. Open channels for the room. Group channels for orders. Custom cards from the server bot, a median of four hundred thirty-six milliseconds in our proof of concept. Read receipts. Mute and ban. Server-side delete. |
| 9 | 2:30 to 2:45 | End slide (variant A or B below). | See end slide. |

## End slide

Pick one. Variant A is the default and is true today. Use variant B only after a real drop has happened and the numbers come from the database.

**Variant A: no real drop yet**

On screen: "Dibs · First tap wins" · "Try it: tapdibs.vercel.app/try" · "Nexconn App Key: qd46yzrfq1obf" · "Team Kaching · Vaibhav Jangid" · small line: "No real drop has run yet. Planned first drop: a jewellery seller who already sells on WhatsApp."

Narration: Built on the Nexconn Chat SDK, with AI coding agents under our direction. No real drop has run yet. The first is planned with a jewellery seller on WhatsApp. Try it now. Dibs. First tap wins.

**Variant B: after a real drop (only if it happened)**

On screen: the same links, plus "Real drop: TBD-after-measurement buyers · TBD-after-measurement claims · TBD-after-measurement paid orders", taken from `/impact` and the database, real buyers only, never bots.

Narration: A real drop by a real jewellery seller. TBD-after-measurement buyers, TBD-after-measurement claims, TBD-after-measurement paid orders, straight from the database. Built on the Nexconn Chat SDK, with AI coding agents under our direction. Dibs. First tap wins.

## Recording checklist

1. Record on the deployed app after `/try` is live. Check it in a fresh private window first.
2. For beat 3, create a team test shop and drop. Use two browser windows, one per buyer. Keep the caption on screen.
3. Keep the demo banner visible in beats 4, 5, 6 and 7.
4. Voiceover: one continuous track. Listen once end to end for pronunciation of "dibs_bot" ("dibs bot") and "UPI" ("you-pee-eye").
5. Upload to YouTube as Unlisted (or Loom or Vimeo), anyone with the link, test it in a private window, paste it into the form.
