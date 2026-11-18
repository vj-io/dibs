# Nexconn Chat API fact sheet (verified 2026-11-19)

Rule: nothing here is invented. Every item cites a source. `NOT FOUND` = not in the sources read. `UNVERIFIED LIVE` = documented/typed but never exercised against the real service by us.

Source key:
- **D.TS** = `/Users/mac/Documents/Projects/Nexxcom/node_modules/@nexconn/chat/index.d.ts` (and `@nexconn/engine/index.d.ts`, `index.esm.js` for runtime checks). Line numbers are for the installed 26.2.1.
- **WEB** = `https://docs.nexconn.ai/chatsdk-web/...` (append `.md` for raw markdown; `https://docs.nexconn.ai/llms.txt` is the page index).
- **API** = `https://docs.nexconn.ai/platform-chat-api/...` (append `.md`).
- **SDK** = `https://github.com/NexconnAI-Dev/nexconn-server-sdk-node` (`api.ts` has every `localVarPath`, request interfaces).
- **PROVEN** = `src/lib/server/nexconn.ts`, `src/lib/client/transport.ts` (working in this repo).

## 0. Versions

- Installed `@nexconn/chat` 26.2.1 and `@nexconn/engine` 26.2.1 (package.json). `npm view @nexconn/chat version` = 26.2.1 (latest; an `alpha` tag 26.5.0-alpha.9 exists). No newer stable.
- `@nexconn/call` EXISTS on npm: latest 26.2.1 (alpha 26.2.0-alpha.2). Docs: `https://docs.nexconn.ai/callsdk-web.md` (not read in depth).
- Result type: exported as `NCResult` (alias of engine `RCResult`): `{ isOk, code, msg, data }` (D.TS line 2 export alias; engine d.ts:4698). `code 0` = success.
- Docs/typing mismatches found:
  - WEB message/customize shows `isPersited` (typo). D.TS `CustomMessageRegistration` (line 583) and runtime (`registerCustomMessages` -> `registerMessageType(e.messageType,!!e.isPersisted,!!e.isCounted,[],!!e.isStatusMessage)` in chat `index.esm.js`) use `isPersisted`. Use `isPersisted`.
  - WEB message/receive says `msg.channelId` / `msg.channelType`. D.TS `Message` (line ~634) has `channelIdentifier` (`ChannelIdentifier` with getters `channelType`, `channelId`, line 440). Use `msg.channelIdentifier.channelType` (PROVEN-style access not yet used in transport.ts; treat as D.TS-typed).
  - D.TS comment on `OpenChannel.enterChannel` says `memberCount`; the interface is `participantCount` (D.TS 870).
  - `registerCustomMessages` is a silent no-op if the engine is not initialized (`var t=nt(); t && ...` in runtime). Call after `NCEngine.initialize`, before `connect`.

## 1. Web SDK

### 1.1 Open channel (class `OpenChannel`, D.TS 4157)
- `new OpenChannel(channelId)`. Client cannot create open channels (WEB open-channel/join, service-config): create via server API.
- Join: `enterChannel({ messageCount: number /*required*/, extra?: string }): Promise<NCResult<OpenChannelEnterResponseInfo>>` (D.TS 4196, 4099). `messageCount` = recent messages fetched on join (docs: up to 50 delivered by default, WEB/API open-channel service-config). Response: `{ createTime, participantCount, isAllChannelMuted, isCurrentUserMuted, isCurrentChannelMuted, isCurrentChannelInAllowlist, enterTime }` (D.TS 870). Join history arrives via the message handler (UNVERIFIED LIVE).
- Leave: `exitChannel(extra?: string): Promise<NCResult>` (D.TS 4208). `disconnect` also exits. SDK auto-rejoins after reconnect (WEB open-channel/join); by default a user can be in only one open channel (WEB join; console toggle "Allow participation in multiple channels", API open-channel/service-config).
- Send text: `channel.sendMessage(new SendTextMessageParams({ text }))` (inherited `BaseChannel.sendMessage<T>(params: SendMessageParams<T>): Promise<NCResult<Message<T>>>`, D.TS 3672; WEB message/send line ~105). Rate: 5 msg/s per user (WEB open-channel/service-config). Error `30004` = frequency limit, `30003` not in channel, `30010` channel does not exist, `33003` destroyed, `30014` kicked (WEB code).
- Receive: global `NCEngine.addMessageHandler(id, new MessageHandler({ onMessageReceived({ messages }) {} }))` (D.TS 1775, 1710). WEB message/receive: "Messages from all channel types (direct, group, open channel, community) are delivered through the same listener. Use channelType to filter." Channel type: `msg.channelIdentifier.channelType === ChannelType.OPEN` (`ChannelType = { DIRECT:1, GROUP:3, OPEN:4, SYSTEM:6, COMMUNITY:10 }`, D.TS 21). UNVERIFIED LIVE for open channels.
- History: `OpenChannel.createOpenChannelMessagesQuery({ channelId, pageSize?, isAscending?, startTime? })` then `loadNextPage()` -> `{data: Message[]}` page (D.TS 4176, 4108). Needs "Open Channel cloud retention" service; else code `30009` (WEB get-history-messages, code).
- Count: `participantCount` from enter response, and live via `OpenChannelHandler.onParticipantChanged({ channelId, participantCount, actions:[{userId, action: 0 EXIT|1 ENTER, extra?}] })` (D.TS 1343, 927, 296). No separate "get info" method (WEB get-open-channel-info). Server-side: see 2.1.
- Metadata: `setMetadata({ metadata: Record<string,string>, deleteWhenLeft?, overwrite? })`, `getMetadata(key?) -> NCResult<Record<string,string>>`, `deleteMetadata({ keys: string[] })` (D.TS 4225-4239, 4121-4135). Listen: `NCEngine.addOpenChannelHandler(id, new OpenChannelHandler({ onMetadataChanged({ changeInfo }), onMetadataSynced({ channelId }) }))` (WEB open-channel-kv). `OpenChannelMetadataChangeInfo = { channelId, key, value, operationType: UPDATE 0 | REMOVE 1 }` (D.TS 938, 199). Limit 100 pairs per channel; only the setter can modify unless `overwrite:true` (WEB open-channel-kv). Server enables metadata as a service (API open-channel/create mentions "only when the metadata service is enabled").
- Other `OpenChannelHandler` callbacks (D.TS 1415-1436): `onEntered, onEnterFailed, onExited, onChannelDestroyed, onMetadataChanged, onMetadataSynced, onParticipantChanged, onNotifyMultiLoginSync, onParticipantMuted, onParticipantBanned`. Register BEFORE `enterChannel`.
- Auto-exit: server webhook `open_channel:operation` status `1` "went offline for 30 seconds or 30 messages without activity" (API webhook/open-channel/operation).
- Limits: see 2.1 (auto-destroy default 60 min inactivity).

### 1.2 Custom message types
- Register: `NCEngine.registerCustomMessages([{ messageType, isPersisted, isCounted, isStatusMessage?, remoteFileUrlField? }])` (D.TS 583, 3146). Register after `initialize`, before `connect` (WEB message/customize). Avoid `RC:`/`NC:` prefix; type must match across platforms.
- Send: `new SendMessageParams<T>(content: T, messageType: string)` then `channel.sendMessage(params)` (D.TS 966, 3672). Optional fields: `directedUserIds, disableNotification, disableUpdateLastMessage, needReceipt, metadata, pushConfig, onMessageInited, onMessageSending`. No `priority` field (see 1.7).
- Receive: in `onMessageReceived`, `msg.messageType === 'App:Custom'` and `msg.content as T` (WEB message/customize). Content is an object (typed `T extends Record<string, any>`).
- Server-sent custom/unknown objectName when NOT registered: **NOT FOUND**. WEB only warns "Unregistered types may not be properly decoded". Register every custom type you send from the server, or test live first. Server custom types must not start with `RC:` and be <= 32 chars (API message/send-*).
- Server wire: `content` is a JSON string, e.g. `"{\"content\":\"hello\"}"` for `RC:TxtMsg` (API open-channel send example; PROVEN in nexconn.ts sendGroupText). Web exposes text as `content.text` (PROVEN in transport.ts `toMsg`).

### 1.3 Group channel read receipts / typing
- Read receipts PROVEN in transport.ts: send with `needReceipt`, `Message.needReceipt`/`sentReceipt` (D.TS 661, 669), `BaseChannel.sendReadReceiptResponse(messageIds)`, `getMessageReadReceiptInfo(messageIds)`, `getMessagesReadReceiptByUsers(params)` (D.TS 3701-3715), `MessageHandler.onMessageReceiptResponse` (D.TS 1791). Error 26314/26315 = service off (PROVEN transport.ts). Server flag: `needReadReceipt: 1` on group send (API message/send-group).
- Typing: `DirectChannel.sendTypingStatus(typingMessageType: string)` (D.TS ~4241, WEB channel/typing-status). Listen: `NCEngine.addChannelHandler(id, new ChannelHandler({ onTypingStatusChanged({ channelIdentifier, userTypingStatus:[{userId, typingMessageType, sentTime}] }) }))` (D.TS 1565-1585, 1530). Docs: typically direct channels; transient; clear after ~6 s. Group/open typing: NOT FOUND (only `DirectChannel` has `sendTypingStatus`).

### 1.4 Direct and system channels
- `DirectChannel(userId)`, `SystemChannel(channelId)` (D.TS ~4241-4247). Both extend `BaseChannel`.
- Receiving server-sent system messages on web: **no web doc page**. By type, `ChannelType.SYSTEM = 6`; per WEB message/receive all messages come through `onMessageReceived` (system not explicitly named). Treat as UNVERIFIED LIVE. Server send: see 2.3.

### 1.5 Community channel
- Classes: `CommunityChannel(channelId)` with `getSubChannels(): NCResult<CommunitySubChannel[]>` (D.TS 4007, 4070); `CommunitySubChannel(channelId, subChannelId)` (D.TS 4082) with `sendMessage`. Receive via the global handler, filter `ChannelType.COMMUNITY (10)` (WEB community-channel/chat). Subchannel fields: `subChannelId, channelId, subChannelType (PUBLIC 0|PRIVATE 1)`.
- Join/create is server-only (WEB community-channel/create: "client SDK provides messaging and query capabilities only"). Default subchannel `NCDefault`. Limits: 10,000 members, 50 subchannels, 50 user groups (WEB community-channel/service-config). Not on Starter plan.
- Handlers: `ChannelHandler.onCommunitySubChannelTypeChanged/Deleted/UserKicked` (D.TS 1577-1581); `MessageHandler.onCommunityChannelMessageMetadataChanged`.

### 1.6 Connection
- Init/connect: `NCEngine.initialize({ appKey, areaCode, logLevel })`, `NCEngine.connect({ token }): NCResult<{ userId }>` (WEB connection/connect; PROVEN). `NCEngine.getConnectionStatus()` (D.TS 2997), `addConnectionStatusHandler(id, new ConnectionStatusHandler({ onConnectionStatusChanged({ status, code }) }))` (D.TS 1259-1290).
- Exported `ConnectionStatus` = engine `RCConnectionStatus` (D.TS line 2 alias; engine d.ts:1688): `CONNECTED 0, CONNECTING 1, DISCONNECTED 2, SUSPENDED 3` ("SDK will automatically reconnect after 5 seconds"). (A different, larger engine-internal enum named `ConnectionStatus` exists at engine d.ts:6558 but is NOT what `@nexconn/chat` exports.)
- Reconnect: automatic, every 5 s, until a connection-error callback fires or `disconnect` is called (WEB connection/reconnect-kick). `33007` = auto-reconnect count exceeded, manual reconnect needed (WEB code).
- Codes (WEB code): `31004` token incorrect or expired; `31005` AppKey/token mismatch; `31009` user blocked; `31010` kicked (another device; status DISCONNECTED + code 31010, no reconnect); `30002` not connected; `33001` SDK not initialized; `34006` AppKey invalid; `-1` timeout.
- Token lifetime/TTL: **NOT FOUND**. Server can invalidate tokens: `POST /v4/auth/access-token/expire {userIds[<=20], expiresAt(ms)}` (API user/expire; connected users are not disconnected).

### 1.7 Recall / delete / priority
- Recall for everyone: `channel.deleteMessageForAll(message): NCResult` (D.TS 3640, "Deletes (recalls)"); peers get `MessageHandler.onMessageDeleted({ messages:[{ channelIdentifier, messageId, operationTime }] })` (D.TS 1714-1724, 1781). Delete for me: `deleteMessagesForMe(messages[])`, `deleteMessagesForMeByTimestamp(params)` (D.TS 3610, 3647). Code `30016` = recalled/not found.
- Priority on web send: **NOT FOUND** (`SendMessageParams` has no priority). Priority is server-side only and open-channel only (2.1).

## 2. Server REST API

Base: `POST https://<host>/<path>`, JSON. Hosts: SG `api.sg-light-api.com` (backup `api-b.`), NA `api.us-light-api.com`, SA `api.sau-light-api.com` (API prepare-to-use-api/base-url; PROVEN). Headers `App-Key`, `Nonce` (<=18 chars), `Timestamp` (ms), `Signature = sha1(AppSecret + Nonce + Timestamp)` lowercase hex; optional `X-Request-ID` (API prepare-to-use-api/auth; SDK `configuration.ts`). Reply `{ code, result?, errorMessage? }`, success `code 0`. Rate limit exceeded: HTTP 429 (API prepare-to-use-api/limits). Avoid KeepAlive >55 s / >80 reuses.
All paths below are present in SDK `api.ts` `localVarPath` AND the API docs page named in parentheses.

### 2.1 Open channel (channelType 4)
| Op | Path | Body | Response |
|---|---|---|---|
| Create | `/v4/open-channel/create` (open-channel/create) | `channelId`; opt `destroyType`(0 inactivity default, 1 scheduled), `ttlMinutes`(60-10080), `shouldFreeze`, `allowedSendersList`(<=20), `metadataOwnerId`+`metadata`(<=20) | `{code}` |
| Destroy | `/v4/open-channel/destroy` | `channelIds[]` | `{code}` |
| Query | `/v4/open-channel/get` | `channelId` | `result.{channelId, createdAt, participantCount, destroyType, ttlMinutes, isFrozen}`; code `23410` = not exist |
| Set destroy type | `/v4/open-channel/destroy-type/set` | `channelId, destroyType?, ttlMinutes?` | `{code}` |
| Send as user | `/v4/open-channel/message/send` | `fromUserId, toChannelIds[](<=10 advised), messageType, content(JSON string, <=10KB), shouldPersist(1 default, needs cloud-retention service), isEchoToSender(0 default), priority` | `result.messageIds[{channelId,messageId}]` |
| Broadcast to all open channels | `/v4/open-channel/message/broadcast` | `fromUserId, messageType, content, isEchoToSender` | `{code}`; 1 req/s |
| Metadata set | `/v4/open-channel/metadata/batch/set` | `channelId, metadataOwnerId, metadata{k:v}(<=20), shouldAutoDelete(0/1)` | `{code}`; key <=128 chars `[A-Za-z0-9+=-_]`, value <=4096 |
| Metadata delete | `/v4/open-channel/metadata/batch/remove` | `channelId, metadataOwnerId, metadataKeys[]` | `{code}` |
| Metadata get | `/v4/open-channel/metadata/batch/get` | `channelId, metadataKeys?[]`(<=100) | `result.metadata[{key,value,metadataOwnerId,shouldAutoDelete,updatedAt}]` |
| Mute user | `/v4/open-channel/participant/mute-list/add` | `channelId, participantIds[<=20], durationMinutes(<=43200), needNotify?, extra?` | `{code}` |
| Unmute | `/v4/open-channel/participant/mute-list/remove` | `channelId, participantIds[], needNotify?, extra?` | |
| Ban (kick) user | `/v4/open-channel/participant/ban-list/add` | `channelId, participantIds[<=20], durationMinutes(<=43200), needNotify?, extra?` | |
| Unban | `/v4/open-channel/participant/ban-list/remove` | `channelId, participantIds[], needNotify?, extra?` | |
| Ban list | `/v4/open-channel/participant/ban-list/get` | `channelId` | `result.bannedParticipants`... |
| Member list / count | `/v4/open-channel/participant/list` | `channelId, pageSize<=500, order(1 asc,2 desc by join)` | `result.total, result.participants[{participantId, createdAt UTC string}]` |
| Is in channel | `/v4/open-channel/participant/exist` | `channelId, participantIds[]` | `result.participants[{participantId, isInOpenChannel 0/1}]` |
| Freeze/unfreeze | `/v4/open-channel/freeze-list/add`, `/remove` | `channelId, needNotify?, extra?` | |
- Priority field: `priority` on `/v4/open-channel/message/send` only. Values: `0` standard (default), `1` allowlisted (needs allowlist feature), `2` high, `3` low (dropped first under load; needs priority-message-type service). SDK `OpenChannelMessageSendRequest.priority?: number`. Related lists: `/v4/open-channel/priority-sender-list/*` (<=20), `priority-message-type-list/*`, `low-priority-message-type-list/*`.
- Default auto-destroy: 60 min inactivity unless configured (API open-channel/create, destroy-about). Docs inconsistency: destroy-about says `destroyTime`; create page + SDK say `ttlMinutes`. Use `ttlMinutes`. Keep-alive channels never auto-destroy.
- Rate: most 100/s; message send 100 msg/s (a 10-channel send counts 10). Client per-user 5 msg/s.
- Users need not be joined to send via server API.

### 2.2 Group channel (channelType 3)
- Create `/v4/group-channel/create` `{channelId(<=64 alnum), name(<=64), owner, userIds?[<=30], groupProfile?, permissions?, groupExtProfile?}`; code `25409` = already exists (PROVEN).
- Join `/v4/group-channel/join` `{channelId, userIds[<=100]}` (response echoes group info) (PROVEN).
- Quit `/v4/group-channel/leave` `{channelId, userIds[<=100], shouldDeleteMute?, shouldDeleteAllowedSendersList?, shouldDeleteFavorites?}`.
- Dismiss `/v4/group-channel/dismiss` `{channelId}`.
- Send `/v4/group-channel/message/send` `{fromUserId, toChannelIds[<=3], toUserIds? (targeted, single group only), messageType, content, shouldPersist, isEchoToSender, needReadReceipt, hasMention, disablePush, hasMetadata, metadata, pushContent, pushData, title, pushConfigs...}` -> `result.messageIds[{channelId,messageId}]` (PROVEN fields: `messageType`, `content`, `isEchoToSender`, `shouldPersist`, `disablePush`, `needReadReceipt`). Custom `messageType` allowed (not `RC:*`, <=32 chars). Rate 20 msg/s. Non-members may send.
- Mute user `/v4/group-channel/user/mute-list/add` `{userIds[<=20], channelId? (empty = all groups), durationMinutes (<=43200, 0 = permanent)}`; unmute `.../remove`. Freeze group `/v4/group-channel/freeze-list/add|remove|get`.

### 2.3 Direct and system
- Direct send `/v4/direct-channel/message/send` `{fromUserId, toUserIds[<=1000], messageType, content(<=128KB), isEchoToSender, shouldPersist, verifyBlocklist, needReadReceipt, disablePush, hasMetadata, metadata, ...}` -> `result.messageIds[{userId,messageId}]`. 6000 msg/min.
- System send `/v4/system-channel/message/send` `{fromUserId, toUserIds[<=100], messageType, content(<=10KB), pushContent, pushData, shouldPersist, disablePush, ...}` -> `result.messageIds[{userId,messageId}]`. 100 msg/s. Also `/v4/system-channel/message/broadcast-online`, `broadcast-all`, `broadcast/delete`, `app-package-users/send`, `tagged-users/send`.

### 2.4 Community (channelType 10)
- Create `/v4/community-channel/create` `{userId (single initial member), channelId (<=64 alnum), name}`.
- Subchannel `/v4/community-channel/subchannel/create` `{channelId, subchannelId (<=20 alnum), channelVisibility 0 public|1 private}`.
- Join `/v4/community-channel/join` `{userId (one), channelId}`.
- Send `/v4/community-channel/message/send` `{fromUserId, toChannelIds[<=3], subchannelId?, messageType, content, shouldPersist, isCounted, hasMention, hasMetadata, metadata, ...}`; 100 msg/s total, 20/s per subchannel. History kept 7 days by default (API code 22201 text).

### 2.5 Recall / delete
- Recall one message: `/v4/message/delete` `{fromUserId (original sender), channelType (1,3,4,6,10), channelId, messageId, subchannelId?, sentAt?(ms), disablePush?, extra?, disableUpdateLastMsg?}` (API message/msgrecall; SDK `MessageDeleteRequest`; also `isAdmin?` in SDK). 100/s. Clients get `onMessageDeleted`.
- Clear channel history: `/v4/channel/message/history/delete` `{channelType, fromUserId, channelId, sentAt?}`.

### 2.6 User
- Token/register `/v4/auth/access-token/issue` `{userId (<=64 bytes alnum), name (<=64), avatarUrl?}` -> `result.{userId, accessToken}` (PROVEN; 200/s).
- Online status `/v4/user/connection-status/get` `{userId}` -> `result.status` string `"1"` online / `"0"` offline.
- Platform ban `/v4/user/ban` `{userIds[<=20], durationMinutes(<=43200)}`, `/v4/user/unban`, `/v4/user/ban/list`. Web code 31009 when banned.
- User-to-user block (direct channel blocklist) `/v4/user/blocklist/add` `{userId, targetUserIds[<=20]}`, `/remove`, `/get` (limit 3000 entries, code 20107).
- Also `/v4/user/get`, `/v4/user/update`, `/v4/auth/access-token/expire`.

### 2.7 Webhooks (API webhook/overview, message/send, message/pre-messaging)
- Configure in Console > Chat > Chat settings > Webhooks (one URL, pick events). Pre-messaging needs Free or Pro plan (not Starter).
- Request: `POST`, JSON `{ type, id, time(ms), data:[ {...} ] }`. Headers on the callback: `AppKey`, `Nonce`, `Timestamp`, `Signature` (NB: `AppKey`, not `App-Key`). Verify `sha1(AppSecret + Nonce + Timestamp) === Signature` (lowercase hex). The body is not part of the signature.
- Delivery: 5 s timeout, 3 attempts total on timeout/non-2xx; return any 2xx. Circuit breaker: 30 failed events/min pauses the URL 1 min. IP allowlists per region listed on the overview page. Server-API-sent messages appear in webhooks only if "Include Server API Messaging in post-event webhooks" is enabled (API message/service-config).
- `message:send` data[0]: `userId, channelId, messageType, content (string), channelType, time, messageId, os (iOS|Android|Websocket|Server)`, opt `originalMessageId, profanityType (0/1/2), subchannelId, groupUserIds, aiGenerated`.
- Other event types: `message:delete`, `message_moderation:block|suspected`, `group_channel:changed|operation`, `open_channel:operation` (data: `channelId, userIds[], operationType 0 created|1 joined|2 left|3 destroyed, status 0 active|1 auto-exit|2 banned|3 auto-destroyed, time`), `open_channel:metadata_update` (`channelId,key,value,operationType,userId,time,version`), `user:connection_status`, `user:delete_state`, `user:friendship`, `user:profile_update`.
- Pre-messaging: types `direct_channel|group_channel|open_channel|community_channel:pre_messaging` (the overview table lists only group/open; the pre-messaging page lists all four). Synchronous. Request data[0]: `appKey, userId, channelId, channelType, messageType, content, time, messageId, os`, opt `pushContent, disablePush, pushConfig, isMetadata, metadata, groupUserIds, originalMessageId, subchannelId, clientIp, aiGenerated`. Response JSON: `pass` (required: `0` block, `1` allow + continue callbacks, `2` allow + skip remaining), opt `replaceContent` (JSON string, <=6 nesting levels), `replacePushContent`, `replaceDisablePush`, `replacePushConfig` (<=1.5KB), `replaceMetadata` (`{"key":{"v":"value"}}`), `extra` (only when pass=0, <=1024 chars, returned to sender client). 5 s timeout; on 3 timeouts the original message is delivered unchanged.

### 2.8 Limits summary
- Default 100 req/s per endpoint; exceptions: direct send 6000/min, group send 20 msg/s, system send 100 msg/s, community 100/s (20/s per subchannel), open-channel broadcast 1 req/s, token issue 200/s (API pages above; list at API prepare-to-use-api/chat-server-api-list).
- Message content: 10 KB (group, open, community, system; media types excepted), 128 KB (direct) (API message/send-*). Custom messageType <=32 chars, no `RC:` prefix.
- Metadata: open channel 20 keys/request, 100 per channel (client), value 4096. Mute/ban max 43,200 min (30 d), 20 users/request.
- Group: 300 members default; community 10,000; open unlimited (WEB open-channel/overview).

## 3. NOT FOUND / UNVERIFIED LIVE (summary)
- How an unregistered server-sent custom objectName surfaces in `onMessageReceived` (NOT FOUND).
- Web-side priority field (NOT FOUND); group/open typing (NOT FOUND); token TTL (NOT FOUND); a web doc page for receiving system-channel messages (NOT FOUND).
- Open-channel and system messages arriving through the global `MessageHandler`: documented only generically (UNVERIFIED LIVE).
- Web `Message.channelType/channelId` as documented vs `channelIdentifier` as typed (use typed).
- No webhook body signing; only header SHA1 of secret+nonce+timestamp (documented, UNVERIFIED LIVE here).
