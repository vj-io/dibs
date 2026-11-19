// Staff remove a member from their shop's club (logged to moderation_events). Not in a demo shop (read-only).
import { z } from "zod";
import { staffRemove } from "@/lib/server/club";
import { body, json, route } from "@/lib/server/http";
import { activeEditor } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
const Body = z.object({ buyerId: z.uuid() });

export const POST = route("POST /api/club/remove", async (req: Request) => {
  const s = await activeEditor();
  const { buyerId } = await body(req, Body);
  await staffRemove(s.shopId, s.staffId, buyerId);
  return json({ ok: true });
});
