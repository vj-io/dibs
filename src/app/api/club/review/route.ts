// One review per paid or shipped order of the calling buyer (posted to #reviews).
import { z } from "zod";
import { review } from "@/lib/server/club";
import { body, json, route } from "@/lib/server/http";
import { requireBuyer } from "@/lib/server/session";

export const dynamic = "force-dynamic";
const Body = z.object({ orderId: z.uuid(), stars: z.number().int().min(1).max(5), text: z.string().trim().max(280).default("") });

export const POST = route("POST /api/club/review", async (req: Request) => {
  const b = await requireBuyer();
  const r = await body(req, Body);
  return json({ review: await review(b.buyerId, r.orderId, r.stars, r.text) });
});
