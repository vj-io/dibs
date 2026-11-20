# Submission form answers: Dibs (copy and paste)

**Submitted 20 Nov 2026, 11:20 IST** (track Marketplace & Support). Updated the same day: new write-up PDF (section 8 now describes the team's work) and the traction proof link. Edits are allowed until 22 Nov 2026, 23:59 IST; judges see the version saved at the deadline.

Form: https://reskilll.com/hack/nexconn/dashboard/submit
Team: **Kaching** (Vaibhav Jangid). One submission per team. Deadline 22 Nov 2026, 23:59 IST.

Checked against the live form on 20 Nov 2026. It has 10 required items: project name, summary (max 2000), Nexconn packages used, App Key, SDK features (min 30), live app link, public GitHub repo, demo video link, write-up PDF upload, and the confirmation box. Traction (proof link and active users) is optional but counts as a significant bonus. All 10 were filled and submitted on 20 Nov 2026.

## Track (on the dashboard, not in this form)

**Marketplace & Support**: set on the dashboard (Step 2) and confirmed saved on 20 Nov 2026. It had been on Workplace & Collaboration.

## 01 Project

**Project name** (the form needs at least 5 characters, so "Dibs" alone is too short)

```
Dibs: first tap wins
```

**Tagline** (use it if there is a tagline field, or as the first line of the summary)

```
First tap wins. Everyone sees it. Nobody gets lost in the DMs.
```

**One-paragraph summary** (limit 2000; this is 1988)

```
Dibs is a live sale room for Indian sellers who sell on WhatsApp and Instagram. The seller drops one piece at a time. Buyers tap Dibs. The server, not a phone and not a chat message, decides who was first, and everyone in the room sees "Sold to Priya S. · 0.4 s" within about a second.

Late buyers join a waitlist and see their position. If the winner does not pay, the next buyer is promoted automatically. Each winner gets one private order chat with the seller's team: order card, UPI payment card and read receipts. Dibs never handles money: buyers pay the seller's UPI directly and staff confirm.

Fairness is enforced in Postgres. One transaction locks the stock row, so concurrent taps queue and are served in commit order; a unique index allows one active claim per buyer per piece. On production, 300 synthetic taps from one laptop inside 504 ms at 2 units gave 2 won, 200 waitlisted, 98 waitlist full, 0 errors, and all 8 database invariants held (19 Nov 2026). None of this is real buyers.

For sellers: sign up with email and password, a three-step start wizard, a share kit (English and Hinglish texts, QR PNG, rehearsal link), CSV export, staff invite links, and a shop club on Nexconn community channels (#drops, #chat, #reviews), live in production.

A scam shield blocks phone numbers, UPI IDs and payment links from non-staff. AI does three helper jobs only: a private one-tap prompt when a buyer types "booked", an answer bot that uses only the shop's FAQ, and unclear scam text. AI never decides who was first, confirms a payment or changes stock.

Try it alone in about a minute at /try: no sign-up, a private room with 40 demo buyers labelled with a robot icon. They tap through the same claim function and never pay; the demo payment reads "Demo shop: nothing to pay".

Status: no real drop has run yet, so 0 real users. A single warm tap takes about 150 to 220 ms from a laptop; in the 300-tap burst the median was 2.75 s. No phone verification; no video calling.
```

## 02 Proof of Nexconn integration

**Nexconn packages used**: tick **Chat SDK** only. (Chat UI: not used. Call SDK: not used; video calling is not built.)

**Nexconn App Key**

```
qd46yzrfq1obf
```

**SDK features you used** (at least 30 characters; this is specific on purpose)

```
Chat SDK for Web (@nexconn/chat 26.2.1 + @nexconn/engine). Browser: NCEngine.initialize, registerCustomMessages for the DB:* card types (must run before connect), addConnectionStatusHandler, addMessageHandler (onMessageReceived), connect with a server-issued token, reconnect with a fresh token. Open channel (the sale room): OpenChannel.enterChannel with join history, sendMessage, OpenChannelHandler.onMetadataChanged. Group channels (one order room per winner, owned by a per-room id that nobody can sign in as, with dibs_bot sending as a non-member; one team desk per shop): GroupChannel, BaseChannel.createMessagesQuery for history, read receipts with sendReadReceiptResponse and onMessageReceiptResponse. System channel and direct channel for personal alerts (promoted, expiring, paid, shipped). Community channel with subchannels #drops, #chat and #reviews: the shop club, on in production (FEATURE_COMMUNITY=1); proven live 19 Nov 2026: 14/14 browser checks, bot to member delivery 10/10, median 213 ms, non-members receive nothing; production club flow 6/6 browser steps, 0 errors. Custom message types DB:Item, DB:Sold, DB:Back, DB:Stock, DB:Order, DB:Pay, DB:Status, DB:Alert, DB:Desk, DB:Hide are accepted only when the sender is dibs_bot.

Server API (signed with App-Key, Nonce, Timestamp, Signature): /v4/auth/access-token/issue, /v4/open-channel/create and destroy, /v4/open-channel/message/send with priority, /v4/open-channel/metadata/batch/set, open-channel participant mute-list and ban-list add and remove, /v4/message/delete (the scam shield removes a message for everyone), /v4/user/connection-status/get (route orders to online staff), group-channel create and join, /v4/direct-channel/message/send and /v4/system-channel/message/send. The message:send webhook is set in the Console and works on production (scam shield, answer bot, typed-claim prompts); signature, timestamp, nonce and message id are checked. The pre-message callback is not available on our plan, so the app refuses a phone number or UPI ID before sending, every screen hides such a line on arrival, and the webhook removes anything sent around the app (from any sender who is not the shop's staff).

Measured live on the Singapore data center on 19 Nov 2026 (one machine in India): server to browser card median 436 ms (n=20). Limits found on production: a user can be in at most 1,000 group channels (code 22413, so each order room has its own owner id that nobody can sign in as and the cron sweep dismisses groups of deleted orders), and code 1008 is a 20 messages per second rate limit (the outbox retries). Details in docs/NEXCONN_FINDINGS.md.
```

## 03 Links

**Live app**

```
https://tapdibs.vercel.app
```

Judge demo to mention in any "how to test" field: `https://tapdibs.vercel.app/try` (returned 200 when last checked).

**Public GitHub repository** (root URL only; public since 19 Nov 2026)

```
https://github.com/vj-io/dibs
```

**Demo video**: the form accepts YouTube, Loom, Google Drive or Vimeo, and anyone with the link must be able to watch. File: `submission/video/dibs-demo.mp4` (3:26.6, 66 MB, 1080p). Script: `submission/demo-video-script.md`.

Upload it (YouTube: visibility **Unlisted**, not Private; Drive: Share → General access → **Anyone with the link**). Then open the link in a private window to check it plays without signing in. Suggested YouTube title and description:

```
Dibs: first tap wins (Nexconn Build Challenge 2026, Team Kaching)
```

```
Dibs is a live sale room for Indian sellers on WhatsApp and Instagram, built on the Nexconn Chat SDK. The seller drops one piece at a time, buyers tap Dibs, the server decides who was first, late buyers join a waitlist, and every winner gets a private order chat.

Try it yourself: https://tapdibs.vercel.app/try
Code: https://github.com/vj-io/dibs

All buyers in the demo scenes are labelled bots or test buyers; no real drop has run yet.
```

```
https://youtu.be/Thbq509PAsA
```

Uploaded 20 Nov 2026 to the Vaibhav Jangid channel as Unlisted; checked that it plays without signing in.

## 04 Write-up

Upload `submission/Dibs-writeup.pdf` (4 pages, rebuilt 20 Nov 2026 with `node submission/build-writeup.mjs`; limit 25 MB). It covers why we built it, the problem, the features that use the Nexconn SDK, and the App Key, as the form asks.

## 05 Traction (optional, significant bonus)

The rules: "Proof that real people use your app ... Traction gives a significant bonus." Judges count early users as active users on Nexconn. Today the honest number is 0, so the fastest real traction before 22 Nov is one small real drop:

1. Sign up at https://tapdibs.vercel.app/seller (email and password, no email step), finish the 3-step wizard with your own UPI ID, and add 2 to 4 real pieces (they can be small, cheap items; buyers pay you by UPI only if they really want them).
2. Schedule the drop, open the share kit and send its WhatsApp text (English or Hinglish) to a group of friends, family or a seller you know. Ask them to open the link on their own phones at the start time.
3. Run the drop from the console: Go live, Drop next, confirm any payments, mark shipped.
4. Afterwards https://tapdibs.vercel.app/impact shows the real numbers (real buyers only; demo rooms and bots never count). Use that page as the proof link and its buyer count as "Active users". A screenshot of the drop's dashboard and a short note from the seller also help.

Never count the demo bots, the test scripts or ClarityLoop's traffic on the shared Nexconn app.


**Proof link** (saved 20 Nov 2026)

```
https://tapdibs.vercel.app/impact
```

The page counts real drops and real buyers only (demo rooms, bots and test scripts never count), so the same link shows real numbers after the first real drop. Today it says no real drop has run yet.

**Active users** (whole number, optional): left blank. The honest number today is **0 real users**. Judges count active users on the Nexconn app through the App Key; ClarityLoop shares this Nexconn app, so the Console may show its users and test traffic too. Do not claim them as Dibs users. After a real drop, enter the buyer count from `/impact`, not the raw Console count.

## 06 Prior work

**Did any part of this project exist before the challenge?** Choose **No, built for this challenge**. If a details box appears (or you choose "Yes, it extends earlier work"), paste this:

```
Dibs is a new build made for this challenge. It reuses two things from our own earlier entry, ClarityLoop (same team, same Nexconn app): the pattern for a signed Nexconn Server API client, and the doodle design language (paper, ink lines, lime highlighter, hot pink marker). Everything else, including the claim engine, the database, the sale room, the order room, judge mode and the scam shield, was built in the challenge window. We wrote the spec, set the fairness and honesty rules, chose the design direction, set up Nexconn and ran every test and review; we used AI coding tools for much of the implementation.
```

## Confirmation box

Tick it yourself after reading the rules (https://reskilll.com/hack/nexconn/rules) and Terms (https://reskilll.com/hack/nexconn/terms), then press **Submit project**. You can edit until 22 Nov 2026, 23:59 IST.
