# Dibs: demo video script (v7, 3:03, narrated)

Team **Kaching** · Vaibhav Jangid · Nexconn Build Challenge 2026 · Track: Marketplace & Support

This is the plan the current cut follows: `submission/video/dibs-demo.mp4`. The exact spoken lines with their times are in `submission/video/narration.txt`. The v6b cut (3:27) was moved to the Trash on 20 Nov 2026 as `dibs-demo v6b 3m27s.mp4`, like the v5 and v6 cuts before it.

What changed in v7 (20 Nov 2026):

- **Faster judge demo, re-recorded.** The buyer demo as deployed on 20 Nov (6 s bot holds in the buyer demo) was recorded again on production. This take's own end card says "Piece 1: waitlisted at #3, yours 11.4 s after your tap · Piece 2: won 1.8 s after it dropped", so the voice says "Eleven seconds after my tap" and "Each hold runs out after six seconds" (v6b said twenty-two and twelve). The end card's "See the fairness record" link is shown and named.
- **New: the seller side.** /try → Be the seller → Drop next: a 🤖 bot buyer writes "Bhaiya ye kal tak mil jayega kya?" in its order room; the seller sees the strip under the nav, "(1)" in the tab title and "1 new message" on its Desk row; opening the order and tapping Translate shows "Brother, will this be available by tomorrow?" labelled "Translated by AI".
- **New: the first real drop and its fairness record.** 20 Nov 2026, the team's own shop (`kundnvi`, drop `HL89WL`), three friends on their own phones: the real /impact page and the drop's public fairness record. v6b's "no real drop has run" is gone from the end card, the script and the narration notes.
- **Cut:** the new-seller onboarding (test-build screenshots) and the shop club (no real members). The load test lost its third line; the Nexconn line is shorter. The two-sided drop keeps its footage with one line fewer and is now tagged "A drop on production · test shop and test buyers" so it cannot be mistaken for the real drop.

Style: documentary voiceover, one continuous track with no pauses (no gap of 0.45 s or longer in the voice), fast, animation on every beat, doodle look (paper, ink, lime, hot pink). 33 lines, 590 words. Captions for every line are burned in.

## Honesty rules for this video

- Every app picture is a real screen of the deployed app, https://tapdibs.vercel.app, and carries a tag saying so ("real screen", "real screens on production", "real page"). Scenes 3 and 5 were recorded on 20 Nov 2026 in the afternoon (one demo room at a time), scenes 6 and 7 at 03:30 IST that day, scene 4 on 19 Nov; the /impact page, the fairness record and /how-it-works are full-page stills read on 20 Nov 2026. No screenshot of a test build is used in v7.
- Scenes 6 and 7 use a throwaway **test** shop, "Meera Jewels (test)", with UPI ID `test@upi` and four test buyers (phones 90000 00001 to 90000 00004), deleted after the capture (the deletion was checked: shop, drop, claim, buyer, staff and auth rows all 0; `/api/impact` back to its earlier totals). Their tags say "test shop and test buyers" and "test buyers · scripted taps"; the voice says "a test shop and test buyers" and "four test phones". The taps were scripted; the outcome was decided by the server. Nothing was paid.
- Scene 8 is the only real money in the film: the first real drop, 20 Nov 2026, 3 real buyers (friends of the team, each on their own phone), ₹32. Its numbers are read off https://tapdibs.vercel.app/impact and https://tapdibs.vercel.app/s/kundnvi/d/HL89WL/record; the tag says "3 real buyers, friends of the team" and the voice says "Small, but real". The record shows first names only, as the public page does. Nothing about the shop or its data was changed.
- No seller account or shop was created on production for v7: the seller side is the app's own /try demo room. Every bot is labelled 🤖 on screen and the app's banner "Demo room · 40 🤖 demo buyers · nothing here is real money" stays in the demo cuts.
- Footage that is sped up, slowed or paused says so in a tag next to the screen, computed from the edit itself (any speed outside 0.87× to 1.15×). In scene 6 both screens follow one clock ("both screens").
- The judge's time is the room's own figure (11.4 s, tap to promotion in the server's record); the screen says that on this recording the phone showed "It's yours" about 13 s after the tap.
- Not claimed anywhere: video calling, a Hindi interface, or blocking a message before delivery. The scam scene shows the app refusing a message before it is sent. Translate is shown as the app labels it ("Translated by AI"); the buyer's own words stay on screen above it.

## Numbers used, and where each comes from

| Number or claim | Where it appears | Source |
| --- | --- | --- |
| 40 demo bots; try it in 60 seconds | scenes 3 and 11 | README.md, "Try it in 60 seconds" |
| Bot hold runs out after 6 s (buyer demo) | scene 3 | README.md, same section (20 Nov 2026) |
| "#3 on the waitlist"; "Eleven seconds after my tap" (on screen: 11.4 s) | scene 3 | this take (`work/cap2/buyer7`, 20 Nov 2026 16:27 IST): the room's end card "Piece 1: waitlisted at #3, yours 11.4 s after your tap" (`promotedMs`, tap to promotion in the server's record) |
| "on this recording's screen: about 13 s after the tap" | scene 3 | capture clock of `buyer7`: Dibs clicked 13.24 s, "It's yours" first frame 26.195 s (12.6 to 13.0 s) |
| "I beat the bots · 1.8 s"; "Piece 2: won 1.8 s after it dropped" | scene 3 | the same take: action bar "You got it in 1.8 s! You beat the bots." and the end card |
| "See the fairness record" on the demo end card | scene 3 | the same take (end card button, clicked at 58.85 s) |
| Seller inbox: strip "1 new message · Order #1 · Temple jhumka earrings", "(1)" in the tab title, Desk row "1 new message" | scene 5 | `work/cap2/seller7` (20 Nov 2026 16:32 IST): page text and `document.title` of every frame ("(1) Live console · Dibs", "(1) Desk · Dibs") |
| "Bhaiya ye kal tak mil jayega kya?" → "Brother, will this be available by tomorrow?", "Translated by AI" | scene 5 | the same take: Translate tapped at 50.13 s, shown at 55.73 s (first tap of that take); the message is the seller demo's scripted bot line (`src/lib/server/bots.ts`) |
| "the message itself never changes" | scene 5 | README.md, "Translated order chat" |
| "Within a second" (Drop next to the piece on Priya's phone) | scene 6 | the 20 Nov recording: Drop next 51.64 s, the piece on the phone 52.59 s (`work/cap2/v_seller`, `v_priya`, one clock) |
| Ledger "tapped in 3.8 s" (Rohan) and "6.3 s" (Priya); hold timers 10:00 | scene 6 | app screens; `claims.ms_after_live` 3753 and 6318 ms (`work/cap2/v_run.json`, claims_A); 10 minutes is a shop's default `hold_seconds` |
| ₹1,450 and ₹2,200; order #2 | scenes 6 and 7 | the test pieces made for that capture, as the app shows them |
| Four phones, one piece, two units | scene 7 | the capture setup (`work/rec4.py`) |
| WON 1.5 s (Kabir), WON 1.6 s (Aisha), #1 WAITLIST 2.2 s (Rohan), #2 WAITLIST 2.5 s (Priya) | scene 7 | `claims.ms_after_live` 1535, 1600, 2188, 2531 ms in commit order (`v_run.json`, claims_B) |
| First real drop: 20 Nov 2026; our own small shop; three friends, each on their own phone | scene 8, end card | https://tapdibs.vercel.app/impact ("The first real drop ran on 20 Nov 2026: our own small shop sold three digital pieces (₹1 to ₹10) to three friends, each on their own phone.") |
| 1 drop run, 3 buyers who tapped, 8 claims won, 6 paid orders, ₹32 paid value, 2 waitlist saves | scene 8 (the page itself), end card (3 buyers, 6 paid orders, ₹32) | https://tapdibs.vercel.app/impact, read 20 Nov 2026 16:27 IST |
| "6 orders sold and paid in 5.5 minutes"; "3 pieces · 9 taps · 3 buyers"; the rows (Kuldeep 3.1 s, Kalu 6.2 s, Priya 7.6 s, …) | scene 8 | https://tapdibs.vercel.app/s/kundnvi/d/HL89WL/record, read 20 Nov 2026 16:27 IST |
| "Two of those orders went to buyers from the waitlist" | scene 8 | /impact "2 waitlist saves"; the record: piece #1 "Waitlisted #1 → Got it from the waitlist → Paid" (Priya), piece #3 the same (Kalu) |
| "every tap, in the order the server committed it, who won, who waited, and who paid"; "names only, never phone numbers"; "share it on WhatsApp" | scene 8 | the record page's own text and its "Share on WhatsApp" button; README.md "Public fairness record for every drop" |
| Tap to result on their phones: median 281 ms, 9 taps | scene 8 | README.md "First real drop, 20 Nov 2026" (reported by the buyers' browsers; 165 to 447 ms) |
| 300 synthetic taps inside 504 ms; 2 units; 2 winners; 200 waitlisted; 98 "waitlist full"; 0 errors; 8 of 8 database invariants; 19 Nov 2026 | scene 9 | README.md "Load test", docs/WRITEUP.md |
| Winning taps 163 ms and 181 ms, from one laptop | scene 9 (on screen only) | same |
| Open and group channels, custom cards from dibs_bot, server-side delete, message:send webhook for the seller inbox: all "On" | scene 10 | the real `/how-it-works` feature map, 20 Nov 2026 (`work/cap2/full7/hiw.jpg`) |

## Scenes

| # | Time | On screen | Narration (summary; exact text in narration.txt) |
| --- | --- | --- | --- |
| 1 | 0:00 to 0:12.6 | Drawn group chat flooding with "booked!!", captioned "illustration · not a real chat". | Sellers run drops in group chats; nobody can prove who was first. |
| 2 | 0:12.6 to 0:24.9 | Title, then the real seller console and a real buyer phone at the moment of Drop next. | This is Dibs. First tap wins. Built on the Nexconn Chat SDK. |
| 3 | 0:24.9 to 1:03.8 | Production `/try` → Be a buyer (20 Nov 2026 16:27 IST, 6 s bot holds): 40 🤖 bots, the countdown, piece 1 sold out to bots within 0.25 s (slow motion), "#3 on the waitlist", the ticker, bot holds running out, "Back in play → … from the waitlist", "It's yours! The buyer ahead didn't pay.", the order room and the demo payment card (paused under the money line), I've paid, "Paid · confirmed by Asha (demo staff)", piece 2 won in 1.8 s, the room's end card with this take's times and the "See the fairness record" link (zoomed in). | The judge demo; bots never pay, 6 s holds; eleven seconds after my tap it's mine; Dibs never touches the money; piece two, I beat the bots; the end card and its fairness-record link. |
| 4 | 1:03.8 to 1:12.2 | Production room chat: a UPI ID is refused before sending. | The scam shield. |
| 5 | 1:12.2 to 1:29.0 | **The seller side.** Production `/try` → Be the seller (20 Nov 2026 16:32 IST), desktop 1280×800 in a window that shows the page's own tab title and address: Drop next, the bots claim, the inbox strip under the nav and "(1)" in the tab, the Desk row "1 new message", Open, the 🤖 buyer's Hinglish line, Translate, the translation labelled "Translated by AI". Notes on the left pop as each appears. | A bot buyer writes in Hinglish; every seller page shows it; open, Translate. |
| 6 | 1:29.0 to 1:55.5 | **One drop, both sides** (test shop, 20 Nov 2026 03:30 IST): Priya's phone and the seller console on one clock, the seven-step strip, cause → effect arrows. Tag: "A drop on production · test shop and test buyers · 20 Nov 2026". | Within a second on Priya's phone; Rohan holds, Priya #1 on the waitlist; cancelled and promoted on the spot; paid by UPI (a test ID), received, shipped. |
| 7 | 1:55.5 to 2:09.8 | **Four phones, one piece** (test buyers, scripted taps), result chips from the server's record and the seller console inset, as in v6b. | The server decides in one locked transaction; Kabir and Aisha win, Rohan and Priya queue #1 and #2. |
| 8 | 2:09.8 to 2:31.3 | **The first real drop.** The real /impact page (camera on 1 drop, 3 buyers, 6 paid orders, ₹32, 2 waitlist saves) beside the numbers, then the drop's public fairness record on a phone with piece #1's three rows zoomed in and "won", "waited", "paid" stamps. Tag: "The first real drop · 20 Nov 2026 · 3 real buyers, friends of the team". | 20 November, small but real; 6 orders sold and paid by UPI in 5.5 minutes, ₹32, two through the waitlist; the record is public. |
| 9 | 2:31.3 to 2:42.6 | Drawn funnel of 300 dots into 2 units, result tiles (2, 200, 98, 0), "8 of 8 database invariants passed". | The synthetic load test on production. |
| 10 | 2:42.6 to 2:50.2 | The real `/how-it-works` feature map (20 Nov 2026), a checklist of five Nexconn features. | Everything live runs on Nexconn. |
| 11 | 2:50.2 to 3:02.8 | End card: `tapdibs.vercel.app/try`, Nexconn App Key `qd46yzrfq1obf`, repository, team, "First real drop, 20 Nov 2026: 3 buyers, 6 paid orders, ₹32 · live totals: tapdibs.vercel.app/impact · Demo rooms use labelled 🤖 bots." | Try it yourself in sixty seconds. |

Dropped from v6b to make room: the new-seller onboarding (test-build screenshots), the shop club, the load test's third line and three items of the Nexconn list.

## How to rebuild it

Everything is in `submission/video/work/`. `build.sh` runs the whole chain (add `voice` to re-synthesise): `vo/vo.sh` (voice: `mk_lines.py` writes the lines and the voice-only respellings, `assemble.py` joins them with short breaths), `gen_footage.py` (frame index, click positions, the tab title and address of every `seller7` frame), `patch.py` (first-cut page plus `mid.js`, `f.js` and `g.js` gives `dibs.html`), the activity audit, the read check, `score.py` (music), the mix and the render. v7 captures: `rec6.py buyer7 cap2/buyer7` (one demo room, about 70 s, first take), `rec6.py seller7 cap2/seller7` (one seller demo room, about 60 s; the third take: the first waited for the test id `desk-unread`, which the `Badge` component never renders, the second's first Translate answered 503 and needed a second tap), `rec6.py record cap2/record7` (full-page stills of /impact and the real record, read only) and `full7.py` (/how-it-works). Scenes 6 and 7 come from v6's `rec4.py` run (`work/cap2/v_*`, log and claim rows in `work/cap2/v_run.json`). The v6b versions of the changed files are kept beside them with a `-v6b` suffix.

## Upload checklist

1. Watch it once end to end with sound, especially scenes 3, 5 and 8 and the words "Nexconn", "Kaching", "Hinglish" and "Aisha".
   Machine check done on 20 Nov 2026 (v7, final file, 17:30 IST build): 3:02.8, 57.8 MB, 1920×1080 30 fps H.264 (High, yuv420p, BT.709), AAC stereo 48 kHz, faststart, -14.0 LUFS, true peak -1.4 dBTP. Voice stem: the largest gap inside the voice is 0.41 s (silencedetect -35 dB, 0.3 s), apart from the 3.0 s end-card hold. Activity audit: lively, median 6.6 %, 11 % quiet, no quiet stretch of 1.5 s or longer. Read check: all 75 pieces of text pass. Two local speech models (faster-whisper small.en and base.en) transcribed the final audio. small.en heard every line as written apart from number and spelling forms (40, 300, 20th, wait list, UPI) and these: "goes up and the chat" as "goes up in the chat", "never by" as "never buy", "under load too" as "two", "Aisha" as "Ayesha" (the voice spelling), "Nexconn" as "Nexcon", "Kaching" as "Ka Ching". base.en also heard "Be a buyer" as "via buyer", "Hinglish" as "English", "Rohan" as "Rohin", "Kabir" as "Cabar", "Aisha" as "Iesha", "invariants" as "invariance". Two v7 lines were respelled after the first round trip: "Here I tap I've paid" (heard "tap if paid" / "tap of paid") became "Here I tap the I've paid button", and "labelled as A I" (phonemised as a schwa plus "eye") became "labelled as AI"; both models hear both as written.
2. Upload to YouTube as Unlisted (or Loom or Vimeo), anyone with the link, test it in a private window, paste the link into the form.
