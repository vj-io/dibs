// Shop club (community channel) proof against live Nexconn. Server side; the browser half is tests/e2e/club_live.py.
//   node --env-file=.env.local scripts/club-poc.ts probe            -> raw calls, prints every code (used to pick okCodes)
//   node --env-file=.env.local scripts/club-poc.ts <cmd> ...        -> one action, JSON on stdout (driven by club_live.py)
// Every id is prefixed dibspoc_. `cleanup <club>` dismisses the community.
import { call, NexconnError, ensureClub, joinClub, leaveClub, sendClub, dismissClub, issueToken, deleteClubMessage, type ClubSub } from "../src/lib/server/nexconn.ts";

const raw = async (label: string, path: string, body: unknown) => {
  const t0 = Date.now();
  try { const r = await call("poc", path, body); console.log("OK  ", label, r.code, Date.now() - t0, "ms", JSON.stringify(r.result ?? null).slice(0, 300)); return r; }
  catch (e) { console.log("FAIL", label, e instanceof NexconnError ? e.code : e, Date.now() - t0, "ms", e instanceof Error ? e.message.slice(0, 200) : ""); return null; }
};

const commands: Record<string, (...a: string[]) => Promise<unknown>> = {
  token: async (userId, name) => ({ token: await issueToken(userId, name ?? userId) }),
  ensure: async (club) => { const t0 = Date.now(); await ensureClub(club, "Dibs POC club"); return { ok: true, ms: Date.now() - t0 }; },
  join: async (club, user) => { const t0 = Date.now(); await joinClub(club, user); return { ok: true, ms: Date.now() - t0 }; },
  leave: async (club, user) => { await leaveClub(club, user); return { ok: true }; },
  send: async (club, sub, from, text) => ({ messageId: await sendClub(club, sub as ClubSub, { text }, from), sentAt: Date.now() }),
  recall: async (club, sub, from, messageId) => { await deleteClubMessage({ channelId: club, sub: sub as ClubSub, messageId, fromUserId: from }); return { ok: true }; },
  cleanup: async (club) => { await dismissClub(club); return { ok: true }; },
};

async function probe() {
  const club = `dibspoc_club_${Date.now().toString(36)}`, A = "dibspoc_ca", B = "dibspoc_cb";
  await issueToken("dibs_bot", "Dibs"); await issueToken(A, "POC A"); await issueToken(B, "POC B");
  await raw("create", "/v4/community-channel/create", { userId: "dibs_bot", channelId: club, name: "Dibs POC club" });
  await raw("create again", "/v4/community-channel/create", { userId: "dibs_bot", channelId: club, name: "Dibs POC club" });
  for (const s of ["drops", "chat", "reviews"]) await raw(`sub ${s}`, "/v4/community-channel/subchannel/create", { channelId: club, subchannelId: s, channelVisibility: 0 });
  await raw("sub chat again", "/v4/community-channel/subchannel/create", { channelId: club, subchannelId: "chat", channelVisibility: 0 });
  await raw("sub list", "/v4/community-channel/subchannel/list", { channelId: club });
  await raw("join A", "/v4/community-channel/join", { userId: A, channelId: club });
  await raw("join A again", "/v4/community-channel/join", { userId: A, channelId: club });
  await raw("exist A", "/v4/community-channel/member/exist", { userId: A, channelId: club });
  await raw("exist B (not member)", "/v4/community-channel/member/exist", { userId: B, channelId: club });
  const t = Date.now();
  await raw("send bot -> drops", "/v4/community-channel/message/send", { fromUserId: "dibs_bot", toChannelIds: [club], subchannelId: "drops", messageType: "RC:TxtMsg", content: JSON.stringify({ content: "drop soon" }), shouldPersist: 1 });
  await raw("send A -> chat", "/v4/community-channel/message/send", { fromUserId: A, toChannelIds: [club], subchannelId: "chat", messageType: "RC:TxtMsg", content: JSON.stringify({ content: "hi from A" }), shouldPersist: 1 });
  await raw("send B (non-member) -> chat", "/v4/community-channel/message/send", { fromUserId: B, toChannelIds: [club], subchannelId: "chat", messageType: "RC:TxtMsg", content: JSON.stringify({ content: "hi from B" }), shouldPersist: 1 });
  await new Promise((r) => setTimeout(r, 1500));
  await raw("history chat (bot)", "/v4/community-channel/history-message/list", { channelId: club, subchannelId: "chat", userId: "dibs_bot", startAt: Date.now(), endAt: t - 60_000, pageSize: 50, includeStart: true });
  await raw("leave A", "/v4/community-channel/leave", { userId: A, channelId: club });
  await raw("leave A again", "/v4/community-channel/leave", { userId: A, channelId: club });
  await raw("exist A after leave", "/v4/community-channel/member/exist", { userId: A, channelId: club });
  await raw("dismiss", "/v4/community-channel/dismiss", { channelId: club });
  await raw("dismiss again", "/v4/community-channel/dismiss", { channelId: club });
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "probe") await probe();
else if (!cmd || !commands[cmd]) { console.error(`usage: probe | ${Object.keys(commands).join(" | ")}`); process.exitCode = 2; }
else {
  try { console.log(JSON.stringify(await commands[cmd](...args))); }
  catch (e) { console.log(JSON.stringify({ error: e instanceof NexconnError ? e.code : "throw", message: e instanceof Error ? e.message : String(e) })); process.exitCode = 1; }
}
process.exit();
