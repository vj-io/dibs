// Staff remove a member from their shop's club (logged to moderation_events).
import { z } from "zod";
import { staffRemove } from "@/lib/server/club";
import { body, json, route } from "@/lib/server/http";
import { activeStaff } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
const Body = z.object({ buyerId: z.uuid() });

export const POST = route("POST /api/club/remove", async (req: Request) => {
  const s = await activeStaff();
  const { buyerId } = await body(req, Body);
  await staffRemove(s.shopId, s.staffId, buyerId);
  return json({ ok: true });
});
