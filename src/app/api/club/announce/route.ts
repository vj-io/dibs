// Staff post to their shop's #drops, as dibs_bot, optionally with a drop's share link. Not in a demo shop (read-only).
import { z } from "zod";
import { announce } from "@/lib/server/club";
import { body, json, route } from "@/lib/server/http";
import { activeEditor } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
const Body = z.object({ text: z.string().trim().min(1).max(280), dropCode: z.string().trim().length(6).nullish() });

export const POST = route("POST /api/club/announce", async (req: Request) => {
  const s = await activeEditor();
  const b = await body(req, Body);
  await announce(s.shopId, s.staffId, b.text, b.dropCode);
  return json({ ok: true });
});
