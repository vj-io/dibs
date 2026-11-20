# Submission form answers: Dibs (copy and paste)

**Submitted 20 Nov 2026, 11:20 IST** (track Marketplace & Support). Updated the same day: new write-up PDF (section 8 describes the team's work), the traction proof link, then the first real drop's numbers (3 active users). Edits are allowed until 22 Nov 2026, 23:59 IST; judges see the version saved at the deadline.

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

**One-paragraph summary** (limit 2000; this is 1914)

```
Dibs is a live sale room for Indian sellers on WhatsApp and Instagram, built on the Nexconn Chat SDK. The seller drops one piece at a time, buyers tap Dibs, the server decides who was first, late buyers join a waitlist, and every winner gets a private order chat.

Try it yourself (under a minute, no sign-up): https://tapdibs.vercel.app/try
Live app: https://tapdibs.vercel.app
How it works and the Nexconn feature map: https://tapdibs.vercel.app/how-it-works
Real usage (real drops and real buyers only): https://tapdibs.vercel.app/impact
First real drop's fairness record: https://tapdibs.vercel.app/s/kundnvi/d/HL89WL/record
Code: https://github.com/vj-io/dibs
Nexconn platform findings: https://github.com/vj-io/dibs/blob/main/docs/NEXCONN_FINDINGS.md
Production load test: https://github.com/vj-io/dibs/blob/main/docs/load-sim-results.md

Chapters
0:00 The problem
0:12 Meet Dibs
0:25 Be a buyer: the judge demo and the scam shield
1:12 The seller side: inbox and Translate
1:29 One drop, both sides
1:55 Four phones, one piece
2:10 The first real drop and its fairness record
2:31 Load test and Nexconn
2:50 Try it

First real drop, 20 Nov 2026: our own small shop sold 3 digital pieces to 3 friends on their own phones. 6 orders sold and paid in 5.5 minutes (₹32 by UPI), 2 waitlist saves, median 281 ms tap to result.

The demo scenes use bots (each marked with a robot) or test buyers on a test shop. Only the first-real-drop scene shows real buyers.

Team Kaching · Nexconn Build Challenge 2026 · Marketplace & Support
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

Server API (signed with App-Key, Nonce, Timestamp, Signature): /v4/auth/access-token/issue, /v4/open-channel/create and destroy, /v4/open-channel/message/send with priority, /v4/open-channel/metadata/batch/set, open-channel participant mute-list and ban-list add and remove, /v4/message/delete (the scam shield removes a message for everyone), /v4/user/connection-status/get (route orders to online staff), group-channel create and join, /v4/direct-channel/message/send and /v4/system-channel/message/send. The message:send webhook is set in the Console and works on production (scam shield, answer bot, typed-claim prompts, and the seller inbox: a buyer's order-room message shows on every seller page); signature, timestamp, nonce and message id are checked. The pre-message callback is not available on our plan, so the app refuses a phone number or UPI ID before sending, every screen hides such a line on arrival, and the webhook removes anything sent around the app (from any sender who is not the shop's staff).

Measured live on the Singapore data center on 19 Nov 2026 (one machine in India): server to browser card median 436 ms (n=20). Limits found on production: a user can be in at most 1,000 group channels (code 22413, so each order room has its own owner id that nobody can sign in as and the cron sweep dismisses groups of deleted orders), and code 1008 is a 20 messages per second rate limit (the outbox retries). Details: https://github.com/vj-io/dibs/blob/main/docs/NEXCONN_FINDINGS.md
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

**Demo video**: the form accepts YouTube, Loom, Google Drive or Vimeo, and anyone with the link must be able to watch. File: `submission/video/dibs-demo.mp4` (3:02.8, 58 MB, 1080p). Script: `submission/demo-video-script.md`.

Upload it (YouTube: visibility **Unlisted**, not Private; Drive: Share → General access → **Anyone with the link**). Then open the link in a private window to check it plays without signing in. Suggested YouTube title and description:

```
Dibs: first tap wins (Nexconn Build Challenge 2026, Team Kaching)
```

```
Dibs is a live sale room for Indian sellers on WhatsApp and Instagram, built on the Nexconn Chat SDK. The seller drops one piece at a time, buyers tap Dibs, the server decides who was first, late buyers join a waitlist, and every winner gets a private order chat.

Try it yourself (under a minute, no sign-up): https://tapdibs.vercel.app/try
Live app: https://tapdibs.vercel.app
How it works and the Nexconn feature map: https://tapdibs.vercel.app/how-it-works
Real usage (real drops and real buyers only): https://tapdibs.vercel.app/impact
First real drop's fairness record: https://tapdibs.vercel.app/s/kundnvi/d/HL89WL/record
Code: https://github.com/vj-io/dibs
Nexconn platform findings: https://github.com/vj-io/dibs/blob/main/docs/NEXCONN_FINDINGS.md
Production load test: https://github.com/vj-io/dibs/blob/main/docs/load-sim-results.md

New since this video: a public fairness record for every drop (every tap in the server's order, shareable on WhatsApp), Translate in the order chat (Hindi, Hinglish, English), a seller inbox for new buyer messages, and a faster judge demo (promoted about 11 s after your tap).

First real drop, 20 Nov 2026: our own small shop sold 3 digital pieces to 3 friends on their own phones. 6 orders sold and paid in 5.5 minutes (₹32 by UPI), 2 waitlist saves, median 281 ms tap to result.

The buyers in this video's demo scenes are labelled bots or test buyers; the video was recorded before that first real drop.

Team Kaching · Nexconn Build Challenge 2026 · Marketplace & Support
```

```
https://youtu.be/rBW5mbluSdg
```

Uploaded 20 Nov 2026 to the Vaibhav Jangid channel as Unlisted (v7, 3:03: the faster buyer demo, the seller inbox and Translate, the first real drop and its fairness record). The earlier 3:27 cut, https://youtu.be/Thbq509PAsA, stays up with a pointer to this one. YouTube makes external links clickable only after the channel's one-time verification.

## 04 Write-up

Upload `submission/Dibs-writeup.pdf` (4 pages, rebuilt 20 Nov 2026 with `node submission/build-writeup.mjs`; limit 25 MB). It covers why we built it, the problem, the features that use the Nexconn SDK, and the App Key, as the form asks.

## 05 Traction (optional, significant bonus)

The rules: "Proof that real people use your app ... Traction gives a significant bonus." Judges count early users as active users on Nexconn. The first real drop ran on 20 Nov 2026 (3 real buyers). More real traction before 22 Nov comes the same way:

1. Sign up at https://tapdibs.vercel.app/seller (email and password, no email step), finish the 3-step wizard with your own UPI ID, and add 2 to 4 real pieces (they can be small, cheap items; buyers pay you by UPI only if they really want them).
2. Schedule the drop, open the share kit and send its WhatsApp text (English or Hinglish) to a group of friends, family or a seller you know. Ask them to open the link on their own phones at the start time.
3. Run the drop from the console: Go live, Drop next, confirm any payments, mark shipped.
4. Afterwards https://tapdibs.vercel.app/impact shows the real numbers (real buyers only; demo rooms and bots never count). Use that page as the proof link and its buyer count as "Active users". A screenshot of the drop's dashboard and a short note from the seller also help.

Never count the demo bots, the test scripts or ClarityLoop's traffic on the shared Nexconn app.


**Proof link** (saved 20 Nov 2026)

```
https://tapdibs.vercel.app/impact
```

The page counts real drops and real buyers only (demo rooms, bots and test scripts never count). After the first real drop (20 Nov 2026) it shows 1 drop, 3 buyers, 8 claims won, 6 paid orders, ₹32 paid, 2 waitlist saves.

**Active users** (whole number, optional)

```
3
```

The three buyers of the first real drop (20 Nov 2026): friends of the team, each on their own phone, confirmed by the team as three different people. Judges count active users on the Nexconn app through the App Key; ClarityLoop shares this Nexconn app, so the Console may show its users and test traffic too. Never claim those as Dibs users; use the `/impact` buyer count.

## 06 Prior work

**Did any part of this project exist before the challenge?** Choose **No, built for this challenge**. If a details box appears (or you choose "Yes, it extends earlier work"), paste this:

```
Dibs is a new build made for this challenge. It reuses two things from our own earlier entry, ClarityLoop (same team, same Nexconn app): the pattern for a signed Nexconn Server API client, and the doodle design language (paper, ink lines, lime highlighter, hot pink marker). Everything else, including the claim engine, the database, the sale room, the order room, judge mode and the scam shield, was built in the challenge window. We wrote the spec, set the fairness and honesty rules, chose the design direction, set up Nexconn and ran every test and review; we used AI coding tools for much of the implementation.
```

## Confirmation box

Tick it yourself after reading the rules (https://reskilll.com/hack/nexconn/rules) and Terms (https://reskilll.com/hack/nexconn/terms), then press **Submit project**. You can edit until 22 Nov 2026, 23:59 IST.
