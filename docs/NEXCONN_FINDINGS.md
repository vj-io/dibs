# Nexconn proof of concept: findings (19 Nov 2026, SG data centre, live)

Runs: `node --env-file=.env.local scripts/nexconn-poc.ts` (server-only checks) and
`~/.claude/brag-scaled-venv/bin/python scripts/nexconn-poc-browser.py [--live]` against `npx next dev -p 3102`
(two headless Chromium contexts on `/poc`, a bare Web SDK harness, and `/poc/live`, the product `live.ts`).
SDK `@nexconn/chat` / `@nexconn/engine` 26.2.1. Every test id starts with `dibspoc_`; test open channels were destroyed.
Timings are wall-clock from this Mac (India) to SG; "ms" for a Server API call is one signed POST.

## Console settings

Nothing the product needs was blocked. Already on for this app (no 23426 / 1009 / 26314 seen):
open-channel metadata service, open-channel message priority, group read receipts.

Still to do in the Console (cannot be tested from localhost):
- Webhook URL `https://<deploy>/api/nexconn/webhook`, event `message:send` (+ "Include Server API Messaging in post-event webhooks" if the bot's own messages should arrive).
- Pre-messaging callback for open channels (flag `FEATURE_PREMESSAGE`), if the plan offers it.
- Optional: "Open Channel cloud retention" — off now (open-channel history query returns **23414**). Not needed: join history comes with `enterChannel({ messageCount })` and state comes from `GET /api/drops/:id/state`.

## Results

| # | Check | Result | Evidence / code | Timing |
|---|---|---|---|---|
| 1 | Tokens for two users; both connect in the browser | PASS | `/v4/auth/access-token/issue` code 0; `NCEngine.connect` code 0 | token 205-736 ms; connect 1.3-2.1 s (first, cold) |
| 2 | Server creates open channel; both enter; text both ways | PASS | enter code 0, `participantCount` 1 then 2; text arrives through the global `MessageHandler.onMessageReceived` | create 173 ms; enter 204-218 ms; A→B text ≈ 545 ms |
| 2 | Channel type on a received message | — | `m.channelIdentifier.channelType` = 4 (OPEN), `.channelId` set; flat `m.channelId` / `m.channelType` are **undefined** | |
| 3 | `DB:Sold` custom type from `dibs_bot`, priority 2, **registered** with `registerCustomMessages` | PASS | `messageType: "DB:Sold"`, `content` = the JSON object we sent (already parsed), sender `dibs_bot` | |
| 3 | Same message to a client that did **not** register `DB:*` | FAIL (by design) | nothing reaches `onMessageReceived`: **unregistered custom types are dropped silently** | |
| 3 | Unregistered type `DB:Unreg` to a registered client | FAIL (by design) | dropped silently (confirms the rule: register every type sent) | |
| 3 | Envelope text `[[DB:Sold]]{…}` (RC:TxtMsg) | PASS | `messageType "RC:TxtMsg"`, `content.text` = envelope | |
| 3 | Latency server send → browser receive, 20 custom cards, priority 2 | PASS | n=20 | **median 436 ms** (min 377, max 2093) |
| 3 | Latency, 20 envelope cards | PASS | n=20 | median 441 ms (min 389, max 991) |
| 3 | Persistence / history of custom types | PASS (group) | group history returns `DB:Sold` + text, `isPersisted: true`; open-channel history needs cloud retention (**23414**) | history 50 msgs ≈ 100-200 ms |
| 3 | Priority 2 on `/v4/open-channel/message/send` | PASS | code 0 (no 1009) | 114-142 ms per send |
| 4 | Server sets metadata (`/metadata/batch/set`, owner `dibs_bot`) | PASS | code 0; server get shows owner `dibs_bot` | 99-155 ms |
| 4 | Browser gets change events | PASS | `OpenChannelHandler.onMetadataChanged` `{changeInfo:[{key, value, operationType 0}]}` | |
| 4 | Browser reads metadata on (re)enter | PASS | events `entered → metaSynced → meta` then join history; `getMetadata()` returns `{db_state: …}` | 190 ms |
| 4 | **Can a buyer overwrite bot metadata?** | YES (risk) | client `setMetadata({db_state}, overwrite:false)` → **23428**; with `overwrite: true` → **0**, value and owner replaced, every client gets the change event | |
| 5 | Group (buyer + staff + `dibs_bot`): server card arrives | PASS | `DB:Sold` custom card, channelType 3; create on an existing id → **25409 (HTTP 400)**, then `/join` | create 189 ms, send 87-125 ms |
| 5 | Read receipts | PASS | `sendReadReceiptResponse` code 0 → sender gets `onMessageReceiptResponse` `{read:1,total:2}`; `getMessageReadReceiptInfo` code 0 | |
| 5 | History loads | PASS | `BaseChannel.createMessagesQuery({isAscending:false})` page comes back **oldest first** already | |
| 6 | Personal alert, direct from `dibs_bot` | PASS | channelType 1, channelId `dibs_bot`, custom `DB:*` content intact | 129-164 ms |
| 6 | Personal alert, system channel | PASS | channelType 6, channelId `dibs_bot`; server call **rejects `isEchoToSender`** (1002 "type mismatch"), so it is not sent | 86 ms |
| 7 | Mute via Server API → send fails | PASS | client send **23408**; unmute → 0 | mute 87 ms |
| 7 | Ban via Server API → send fails, re-enter refused | PASS | send **23409**, `enterChannel` **23409**; no `onParticipantBanned` event observed; unban → re-enter 0 | ban 116 ms |
| 8 | Server recall `/v4/message/delete` (open channel) of a bot message | PASS | `onMessageDeleted` `{messageId, channelIdentifier: {channelType 4}}` | ≈ 120 ms |
| 8 | Server recall of a **buyer's** text (scam-shield fallback), `fromUserId` = buyer | PASS | same event on other clients | |
| 9 | Online status `/v4/user/connection-status/get` | PASS | `"1"` while connected, `"0"` after the page closed (3 s) | 128 ms |
| 10 | Community create / subchannel / join / send | PASS | all code 0; web `CommunitySubChannel(id,'drops').sendMessage` code 0, peer gets channelType 10; `getSubChannels()` returned `[]` right after creation | ≈ 100 ms each |
| 11 | Participant count | PARTIAL | `enterChannel` → `participantCount`; server `/v4/open-channel/get` `participantCount` = 2 (correct); `/participant/list` `total`. **`onParticipantChanged` never fired** (two runs, a third user entering 3 s later) | 97-161 ms |
| 12 | 10 s offline (`context.set_offline`) | PASS (quiet) | no status change; the 2 messages sent meanwhile were delivered together when back online | |
| 12 | 40 s offline | PASS | status SUSPENDED (code 30012) → CONNECTING → SUSPENDED (35008) → CONNECTING → CONNECTED; SDK **re-entered the room by itself** (`onEntered`); messages sent while offline arrived as join history; no re-enter needed, no duplicates in `live.ts` (it re-enters anyway and dedupes by id) | reconnect ≈ 5.5 s after network back |
| 13 | Webhook / pre-message signature | NEEDS DEPLOY | `verifyWebhook()` in `src/lib/server/nexconn.ts` + unit tests (synthetic requests). Needs deployed URL + Console setting | |

Idempotency codes (HTTP 400 with a business code; treated as success): room exists **23435**, group exists **25409**. Room gone: **23410**.
Unmute / unban of a user not on the list: code 0. Destroy of a missing room: code 0.

## live.ts in the browser (`--live`, real Server API, token route answered by Playwright)

PASS: connect both; room custom card and envelope card → `kind: "card"`; a buyer pasting `[[DB:Sold]]{…}` → `kind: "text"`;
room text with sender name (`content.senderUserInfo.name`); muted send rejects `LiveError` code `23408`; group card; markRead → onReceipts;
group history oldest first; `onAlert` via direct and via system channel; 40 s offline → card sent meanwhile arrives after reconnect, 0 duplicates.
Mock mode (`REALTIME_MODE=mock`, real cookies + DB rows + `POST /api/outbox/drain` with `CRON_SECRET`): replay on join, text with name,
pasted card stays text, group card to members only, alert, history, non-member history refused — all PASS.

`drainOutbox()` against Postgres (scratch schema): two concurrent drains → no double send; per-channel order kept; a failing head
blocks only its channel (retried at 1 s); after 5 failed attempts the row is `failed` and the channel moves on. Against live Nexconn:
EnsureRoom, DB:State (+ metadata mirror), RoomMeta, Mute, Unban, EnsureGroup, DB:Status, DB:Alert, DestroyRoom — 9/9 sent.

## Decisions

- **Custom message types, not the envelope** (`NEXCONN_TEXT_ENVELOPE=0`): they arrive intact with equal latency (median 436 vs 441 ms) and persist in group history. Rule: the client must `registerCustomMessages` every `DB:*` type before `connect` (unregistered types vanish without an error); `live.ts` registers `CARD_TYPES`. Keep the envelope as a fallback flag; `live.ts` and the codec accept both.
- **Personal alerts: system channel** (`FEATURE_SYSTEM_CHANNEL=1`): arrives on web like a direct message (channelType 6) and keeps buyers' direct-message list clean. Direct (=0) works identically as fallback.
- **Community** (`FEATURE_COMMUNITY=1` is safe): create/join/send all work on this plan.
- **Metadata is a hint only.** Any connected client can overwrite `db_state`/`db_item` with `overwrite:true`. `live.ts` does not read metadata; truth = `dibs_bot` cards + `GET /api/drops/:id/state`. The drain still mirrors `DB:State` → `db_state` and `DB:Item`/`DB:Stock` → `db_item` (best effort) so the feature is visible.
- **Viewer counter:** `participantCount` from enter plus a server poll of `roomCount()` (`/v4/open-channel/get`); no client event.
- **Reconnect:** rely on the SDK; `live.ts` also re-enters joined rooms on every reconnect and dedupes by message id; fresh token on DISCONNECTED with a code, except 31010 (kicked by another login).
- Server sends to rooms use `shouldPersist: 1`, `priority` 2 for cards (falls back to 0 on 1009 automatically).

## Unverified

- Webhook and pre-messaging delivery (needs deployed URL + Console). Call SDK not tested.
- `onParticipantChanged` / `onParticipantBanned` never fired — unknown whether a Console switch enables them.
- Latency from phones on 4G; >2 concurrent clients; behaviour at the plan's connection limit.

## Per-user group cap: 1,000 (measured 19 Nov 2026)

- `/v4/group-channel/create` answers `{"code":22413}` when the owner is already in 1,000 group channels. The code is not in the public status-code list. `/v4/group-channel/joined/list` for `dibs_bot` returned exactly 1,000 groups at that moment; a create with a fresh owner returned `0` in the same minute.
- Cause on our side: `dibs_bot` was owner and member of every order room, and test and demo runs never dismissed theirs.
- Fix: each order room is owned by an id made for it (`own_<room>`) that is never issued a token, so no browser holds owner rights, and the bot sends as a non-member (the Server API allows it). Checked in a production browser: `DB:Order` and `DB:Pay` frames arrived over the socket in a room the bot is not in. Deleted orders and shops queue their group for `/v4/group-channel/dismiss` (cron sweep). 992 orphan groups were dismissed.
- Dismissing a group that does not exist answers `25410`; treated as done.
- Still a ceiling: a staff member is in every order room of the shop, so 1,000 undeleted order rooms per staff member. Rooms of long-finished orders are not dismissed yet.

## Code 1008 on group sends = rate limit (measured 19 Nov 2026)

- 40 group sends fired at once to one group: 19 answered `0`, 21 answered `1008` with the text "API call frequency exceeded limit. Try again later." The documented limit is 20 messages per second.
- The 327 `group_send` failures logged on 18 Nov fall in the minutes of the load simulation and parallel test runs. The outbox retries a failed send, so the cards were delivered late, not lost.
- A send to a group id that does not exist answers `0` with a message id. A missing order room is therefore silent on the send path; `/health` only shows it through failed `group_create` rows.
