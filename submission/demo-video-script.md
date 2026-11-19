# Dibs: demo video script (v2, 2:57, narrated)

Team **Kaching** · Vaibhav Jangid · Nexconn Build Challenge 2026 · Track: Marketplace & Support

This is the plan the current cut follows: `submission/video/dibs-demo.mp4`. The first cut (2:34) is kept as `submission/video/dibs-demo-v1.mp4`. The exact spoken lines with their times are in `submission/video/narration.txt`.

Style: documentary voiceover, one continuous track with no pauses (no gap of 0.45 s or longer in the voice), fast, animation on every beat, doodle look (paper, ink, lime, hot pink). 31 lines, 560 words. Captions for every line are burned in.

## Honesty rules for this video

- Every app picture is a real screen. Scenes 3, 4, 5, 9 and the first half of 7 were recorded on the deployed app, https://tapdibs.vercel.app, on 19 Nov 2026, and carry a "real screen" tag.
- Scene 6 (new seller) and the second half of scene 7 (club post reaching a member) are screenshots from the project's own end-to-end runs on a test build with sample data. They are tagged "screenshot · local test build · sample data" and "screenshot · test run · synthetic member", and the address bar shows `localhost`. Nothing says or implies they are production. The staff invite link is covered.
- Every bot is labelled 🤖 on screen and the app's own banner "Demo room · 40 🤖 demo buyers · nothing here is real money" stays in the demo cuts. The payment card shown is the demo one ("Demo shop: nothing to pay", with "Pay with UPI (demo)" switched off).
- Footage that is sped up, slowed or paused says so in a tag under the screen.
- No real drop has run and the club has no real members. The end card and the club scene say so. No real users, sales or money are shown or implied.
- Not claimed anywhere: video calling, a Hindi interface, or blocking a message before delivery. The scam scene says the message is deleted just after delivery, because pre-message blocking is not on our Nexconn plan.

## Numbers used, and where each comes from

| Number | Where it appears | Source |
| --- | --- | --- |
| 40 demo bots; try it in 60 seconds | scenes 3 and 10 | README.md, "Try it in 60 seconds" |
| Bot hold runs out after 12 s | scene 3 | README.md, same section |
| "23 seconds after my tap" (on screen also: 22 to 27 s over 25 simulated runs) | scene 3 | this recording (tap at 14.72 s, "It's yours" at 37.88 s); the range is from README.md |
| 300 synthetic taps inside 504 ms on 2 units; 2 winners; 200 waitlisted; 98 "waitlist full"; 0 errors; 8 of 8 database invariants; 19 Nov 2026 | scene 8 | README.md "Load test", docs/WRITEUP.md |
| Both winning taps 163 ms and 181 ms, from one laptop ("under 200 ms" in the voice) | scene 8 | same |
| Shop club median delivery 213 ms, 10 of 10, our test, 19 Nov 2026 | scene 7 | README.md "Shop club" |

The first cut's "about 0.4 seconds" card latency line is removed.

## Scenes

| # | Time | On screen | Narration (summary; exact text in narration.txt) |
| --- | --- | --- | --- |
| 1 | 0:00 to 0:12 | Drawn group chat flooding with "booked!!", captioned "illustration · not a real chat". | Sellers run drops in group chats; two people say booked; nobody can prove who was first. |
| 2 | 0:12 to 0:25 | Title, then the real seller console and a real buyer phone at the moment of Drop next. | This is Dibs. First tap wins. Built on the Nexconn Chat SDK. |
| 3 | 0:25 to 1:13 | Production `/try` → Be a buyer. 40 🤖 bots, piece 1 drops, "#3 on the waitlist", the ticker, the server-decides sketch, bot holds expiring after 12 s, "It's yours" 23 s after the tap, the order room, the demo payment card, I've paid, "Paid · confirmed by Asha (demo staff)". | The judge demo; the server decides in one locked transaction; bots never pay; the queue moves; Dibs never touches the money; the demo has nothing to pay. |
| 4 | 1:13 to 1:22 | Production room chat: a UPI ID is posted and deleted, the notice appears. | The scam shield removes it for everyone within seconds. |
| 5 | 1:22 to 1:43 | Production `/try` → Be the seller: Drop next, the claims ledger with 🤖 Demo buyer pills and "🤖 demo payment", a hold expiring and "from waitlist", the Desk tab (mark paid, mark shipped, Download CSV), the Dashboard tab. | The console, the ledger, promotion with no seller action, the team desk, the CSV, the dashboard. |
| 6 | 1:43 to 2:00 | Test-build screenshots: create account, the three-step wizard, the share kit (English and Hinglish text, QR PNG, rehearse link), the staff invite. | Password account with no email step, three short steps, the share kit, staff invite link. |
| 7 | 2:00 to 2:14 | Production seller Club tab and buyer club page of the demo shop (0 members), then test-run screenshots of a post reaching a member; "213 ms"; "No real club members yet." | A club per shop on a Nexconn community channel: #drops, #chat, #reviews; median delivery 213 ms in our test. |
| 8 | 2:14 to 2:33 | Drawn funnel of 300 dots into 2 units, result tiles, then "8 of 8 database invariants passed" and the two winning-tap times. | The synthetic load test on production. |
| 9 | 2:33 to 2:45 | The real `/how-it-works` feature map, camera moving card to card, a checklist of seven Nexconn features. | Everything live runs on Nexconn, now with a community channel for the club. |
| 10 | 2:45 to 2:57 | End card: "Dibs! First tap wins", `tapdibs.vercel.app/try`, Nexconn App Key `qd46yzrfq1obf`, repository, team, and "No real drop has run yet. Demo rooms use labelled 🤖 bots." | Try it yourself in sixty seconds. |

Dropped from the first cut to make room: the notebook beat, the "no app, no password" checklist, the piece 2 win and the moderation-log beat.

## How to rebuild it

Everything is in `submission/video/work/`. `build.sh` runs the whole chain (add `voice` to re-synthesise): `vo/vo.sh` (voice), `gen_footage.py` (frame index and stills), `patch.py` (first-cut page plus `mid.js` and `g.js` gives `dibs.html`), the slideshow audit, the read check, `score.py` (music), the mix and the render. The production recordings are in `work/cap2/` and were made with `rec.py`, `rec2.py` and `full.py`, one demo room at a time.

## Upload checklist

1. Watch it once end to end with sound, checking the pronunciation of "UPI", "QR", "CSV" and "Kaching".
2. Upload to YouTube as Unlisted (or Loom or Vimeo), anyone with the link, test it in a private window, paste the link into the form.
