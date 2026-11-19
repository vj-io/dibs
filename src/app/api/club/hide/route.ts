// Staff hide a review in their shop's club, with a reason (logged to moderation_events).
import { z } from "zod";
import { hideReview } from "@/lib/server/club";
import { body, json, route } from "@/lib/server/http";
import { activeStaff } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
const Body = z.object({ reviewId: z.string().regex(/^\d{1,18}$/), reason: z.string().trim().min(3).max(200) });

export const POST = route("POST /api/club/hide", async (req: Request) => {
  const s = await activeStaff();
  const b = await body(req, Body);
  await hideReview(s.shopId, s.staffId, b.reviewId, b.reason);
  return json({ ok: true });
});
