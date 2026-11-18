// Judge mode: one click, a private sandbox drop with 40 demo bots, no sign-up. Sets the buyer cookie (and, for the
// seller script, a staff cookie for the slot's demo owner). The bot runner keeps going after the response.
import { after } from "next/server";
import { z } from "zod";
import { runLoop } from "@/lib/server/bots";
import { body, clientIp, json, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";
import { DemoBusy, startTry } from "@/lib/server/sandbox";
import { setBuyer, setStaff } from "@/lib/server/session";

export const maxDuration = 300;

const Start = z.object({ role: z.enum(["buyer", "seller"]).default("buyer"), name: z.string().trim().max(40).optional() });

export const POST = route("POST /api/try/start", async (req: Request) => {
  const b = await body(req, Start);
  await rateLimit(`try:${clientIp(req)}`, 6, 60, "Too many demo rooms from here. Try again in a minute.");
  await rateLimit("try:all", 30, 60, "Lots of people are trying Dibs right now. Try again in a minute.");
  let s;
  try { s = await startTry(b.role, b.name); } catch (e) {
    if (!(e instanceof DemoBusy)) throw e;
    return Response.json({ error: "demo_busy", message: `All demo rooms are busy. Retrying in ${e.retryInSeconds} s.`, retryInSeconds: e.retryInSeconds },
      { status: 503, headers: { "Retry-After": String(e.retryInSeconds) } });
  }
  await setBuyer(s.buyerId);
  if (s.role === "seller") await setStaff({ staffId: s.ownerId, shopId: s.shopId, role: "owner" }, 2 * 60 * 60);
  after(() => runLoop(s.dropId).catch((e) => console.error("[try/start] runner", e instanceof Error ? e.message : e)));
  const shareUrl = `${new URL(req.url).origin}/s/${s.shopSlug}/d/${s.code}`;
  return json({ dropId: s.dropId, code: s.code, shopSlug: s.shopSlug, shareUrl, role: s.role, script: s.script });
});
