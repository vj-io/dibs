# Submission form answers: Dibs (copy and paste)

Form: https://reskilll.com/hack/nexconn/dashboard/submit
Team: **Kaching** (Vaibhav Jangid). One submission per team. Deadline 22 Nov 2026, 23:59 IST.

Field limits used here come from `docs/research-crowdplay-judging.md` (title 5 to 200 characters, summary 10 to 2000, SDK features at least 30, prior-work details at least 10, App Key 8 to 64 characters). Check each field against the live form before pasting. Any value `TBD-after-measurement` is yours to fill.

## Step 2: Track

**Marketplace & Support**

## 01 Project

**Project name** (the form needs at least 5 characters, so "Dibs" alone is too short)

```
Dibs: first tap wins
```

**Tagline** (use it if there is a tagline field, or as the first line of the summary)

```
First tap wins. Everyone sees it. Nobody gets lost in the DMs.
```

**One-paragraph summary** (limit 2000; this is about 1,800)

```
Dibs is a live sale room for Indian sellers who sell on WhatsApp and Instagram. The seller drops one piece at a time. Buyers tap Dibs. The server, not a phone and not a chat message, decides who was first, and everyone in the room sees "Sold to Priya S. · 0.4 s" within about a second.

Late buyers join a waitlist and see their position. If the winner does not pay, the next buyer is promoted automatically. Each winner gets one private order chat with the seller's team, holding the order card, a UPI payment card (a button on phones, a QR code on laptops) and read receipts. Dibs never handles money: buyers pay the seller's UPI directly and staff confirm.

Fairness is enforced in Postgres. One transaction locks the stock row, so concurrent taps queue and are served in commit order. A unique index allows one active claim per buyer per piece. Tests on a real database fire 300 concurrent claims at 2 units and check that exactly 2 win and 20 are waitlisted in order. These are tests on synthetic taps, not real buyers.

A scam shield blocks phone numbers, UPI IDs and payment links from anyone who is not staff. AI does three helper jobs only: a private one-tap prompt when a buyer types "booked", an answer bot that uses only the shop's FAQ, and unclear scam text. AI never decides who was first, confirms a payment or changes stock.

Try it alone in about 90 seconds at /try: no sign-up, a private demo room with 40 demo buyers labelled with a robot icon. The bots tap through the same claim function and never pay, so you see the waitlist promotion for real. Bots exist only in the demo room and never count in real numbers.

Status: No real drop has run yet. The planned first drop is a jewellery seller who already sells on WhatsApp. No phone verification yet, and video viewing is not built.
```

## 02 Proof of Nexconn integration

**Nexconn packages used**: tick **Chat SDK**. (Chat UI: no. Call SDK: no, it is behind a flag and untested.)

**Nexconn App Key**

```
qd46yzrfq1obf
```

**SDK features you used** (at least 30 characters; this is specific on purpose)

```
Chat SDK for Web (@nexconn/chat 26.2.1 + @nexconn/engine). Browser: NCEngine.initialize, registerCustomMessages for the DB:* card types (must run before connect), addConnectionStatusHandler, addMessageHandler (onMessageReceived), connect with a server-issued token, reconnect with a fresh token. Open channel (the sale room): OpenChannel.enterChannel with join history, sendMessage, OpenChannelHandler.onMetadataChanged. Group channels (one order room per winner, one team desk per shop): GroupChannel, BaseChannel.createMessagesQuery for history, read receipts with sendReadReceiptResponse and onMessageReceiptResponse. System channel and direct channel for personal alerts (promoted, expiring, paid, shipped). Community channel with subchannels for a shop club (flag). Custom message types DB:Item, DB:Sold, DB:Back, DB:Stock, DB:Order, DB:Pay, DB:Status, DB:Alert, DB:Desk, DB:Hide are accepted only when the sender is dibs_bot.

Server API (signed with App-Key, Nonce, Timestamp, Signature): /v4/auth/access-token/issue, /v4/open-channel/create and destroy, /v4/open-channel/message/send with priority, /v4/open-channel/metadata/batch/set, open-channel participant mute-list and ban-list add and remove, /v4/message/delete (the scam shield removes a message for everyone), /v4/user/connection-status/get (route orders to online staff), group-channel create and join, /v4/direct-channel/message/send and /v4/system-channel/message/send. The message:send webhook is verified by signature, timestamp window and message id, but not yet tested against a real Nexconn delivery; the pre-message callback is behind a flag and off.

Measured live on the Singapore data center on 19 Nov 2026 (one machine in India): server to browser card median 436 ms (n=20). Details in docs/NEXCONN_FINDINGS.md.
```

## 03 Links

**Live app**

```
https://tapdibs.vercel.app
```

Judge demo to mention in any "how to test" field: `https://tapdibs.vercel.app/try` (it goes live at submission; at the time of writing it returned 404 on the deployed build, so check it before you submit).

**Public GitHub repository** (root URL only; the form rejects private or missing repos, so make it public first)

```
https://github.com/vj-io/dibs
```

**Demo video**: paste the YouTube (unlisted), Vimeo or Loom link here once uploaded, set so anyone with the link can watch. Script: `submission/demo-video-script.md`.

```
TBD-after-measurement (the video link, after upload)
```

## 04 Write-up

Upload `submission/Dibs-writeup.pdf` (build it with `node submission/build-writeup.mjs`) and paste its https URL if the form asks for one. It includes the App Key.

## 05 Traction (optional)

**Traction link** (https): leave empty unless a real drop has run. If it has, link a screenshot or analytics page you own. Only real numbers.

**Active users** (whole number)

The honest number today is **0 real users**. No real drop has run yet. Judges count active users on the Nexconn app through the App Key; ClarityLoop shares this Nexconn app, so the Console may show its users and test traffic too. Do not claim them as Dibs users.

Fill after the first real drop, from the Nexconn Console count for the App Key and the `/impact` page (real buyers only, never demo bots):

```
TBD-after-measurement (0 until a real drop has run)
```

## 06 Prior work

**Was this project built before the challenge?** Choose **No, built for this challenge**, then use the details box below (at least 10 characters). If the form wants a yes to "any existing work", choose yes and use the same text.

```
Dibs is a new build made for this challenge. It reuses two things from our own earlier entry, ClarityLoop (same team, same Nexconn app): the pattern for a signed Nexconn Server API client, and the doodle design language (paper, ink lines, lime highlighter, hot pink marker). Everything else, including the claim engine, the database, the sale room, the order room, judge mode and the scam shield, was built in the challenge window. AI coding agents (Claude Code) wrote most of the code under our direction. We set the product, the fairness rules and the tests, and reviewed the results.
```

## Confirmation box

Tick it yourself after reading the challenge rules and Terms.
