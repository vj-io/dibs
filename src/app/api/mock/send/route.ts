// Mock transport (REALTIME_MODE=mock only). POST: send a text as the caller. GET ?history=<groupId>: group history.
import { after } from "next/server";
import { z } from "zod";
import { flags } from "@/lib/server/flags";
import { body, fail, json, notFound, route } from "@/lib/server/http";
import { bus } from "@/lib/server/mockbus";
import { liveIdentity } from "@/lib/server/nexconn";
import { handleRoomText } from "@/lib/server/webhook";

const As = z.enum(["buyer", "staff"]).optional();
const Send = z.object({
  target: z.object({ type: z.enum(["room", "group"]), id: z.string().min(1).max(64) }),
  text: z.string().trim().min(1).max(2000),
  as: As,
});

export const POST = route("POST /api/mock/send", async (req: Request) => {
  if (flags.mode !== "mock") notFound();
  const b = await body(req, Send);
  const me = await liveIdentity(b.as);
  const why = bus().refusal(b.target.type, b.target.id, me.userId);
  if (why) fail(403, `send_${why}`, "You can't send here right now.");
  const message = bus().publish(b.target.type, b.target.id, me.userId, b.text, me.name);
  if (b.target.type === "room") after(() => handleRoomText({ channelId: b.target.id, fromUserId: me.userId, messageId: message.id, text: b.text })); // judge-mode package: scam shield, claim helper, answer bot
  return json({ message });
});

export const GET = route("GET /api/mock/send", async (req: Request) => {
  if (flags.mode !== "mock") notFound();
  const url = new URL(req.url);
  const me = await liveIdentity(As.parse(url.searchParams.get("as") ?? undefined));
  const h = bus().history(url.searchParams.get("history") ?? "", me.userId);
  if (!h) fail(403, "forbidden");
  return json({ messages: h });
});
