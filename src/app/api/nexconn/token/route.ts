// Nexconn token for the caller's own id only (b_<buyerId> / s_<staffId>), never for an id the client names.
import { z } from "zod";
import { flags } from "@/lib/server/flags";
import { fail, json, route } from "@/lib/server/http";
import { issueToken, liveIdentity } from "@/lib/server/nexconn";

const Body = z.object({ as: z.enum(["buyer", "staff"]).optional() }).optional();

export const POST = route("POST /api/nexconn/token", async (req: Request) => {
  const raw = await req.text();
  let parsed: unknown;
  try { parsed = raw ? JSON.parse(raw) : undefined; } catch { fail(400, "invalid", "body must be JSON"); }
  const b = Body.parse(parsed);
  const me = await liveIdentity(b?.as);
  if (flags.mode === "mock") return json({ userId: me.userId, name: me.name, token: null });
  const token = await issueToken(me.userId, me.name).catch(() => fail(502, "nexconn_unavailable", "Live updates are unavailable right now."));
  return json({ userId: me.userId, name: me.name, token });
});
