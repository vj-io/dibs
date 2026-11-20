// The order's buyer or the shop's staff: one order-chat message in English or Hindi, for the asker's eyes only.
// Nothing is stored (an in-process cache aside) and the message text is never logged.
import { translate, TranslateBody } from "@/lib/ai/jobs";
import { body, fail, json, route, uuidParam } from "@/lib/server/http";
import { orderAccess } from "@/lib/server/queries";
import { rateLimit } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = route("POST /api/orders/:id/translate", async (req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const a = await orderAccess(id);
  const b = await body(req, TranslateBody);
  await rateLimit(`translate:${a.as === "staff" ? a.staff.staffId : a.order.buyer_id}`, 20, 60, "That's a lot of translations. Wait a minute and try again.");
  const text = await translate(b.text, b.to);
  if (text === null) return fail(503, "ai_unavailable", "Translation isn't available right now. Try again.");
  return json({ text });
});
