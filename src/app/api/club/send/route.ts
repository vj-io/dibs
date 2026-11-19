// A member's #chat line: screened (scam shield rules), recorded, then sent to the community by the Server API as the buyer.
import { z } from "zod";
import { sendChat } from "@/lib/server/club";
import { body, json, route } from "@/lib/server/http";
import { requireBuyer } from "@/lib/server/session";

export const dynamic = "force-dynamic";
const Body = z.object({ shopSlug: z.string().min(1).max(64), text: z.string().trim().min(1).max(200) });

export const POST = route("POST /api/club/send", async (req: Request) => {
  const b = await requireBuyer();
  const { shopSlug, text } = await body(req, Body);
  return json({ message: await sendChat(shopSlug, b.buyerId, text) });
});
