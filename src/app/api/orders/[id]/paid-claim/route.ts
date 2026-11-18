// The order's buyer says "I've paid" (optional UTR): the hold timer pauses until staff confirm.
import { z } from "zod";
import { afterWrite } from "@/lib/server/after";
import { fn } from "@/lib/server/db";
import { body, forbidden, json, route, uuidParam } from "@/lib/server/http";
import { engineOk, orderAccess } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ utr: z.string().trim().regex(/^[A-Za-z0-9]{6,22}$/, "6-22 letters or digits").optional().or(z.literal("")) });

export const POST = route("POST /api/orders/:id/paid-claim", async (req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const a = await orderAccess(id);
  if (a.as !== "buyer") forbidden();
  const b = await body(req, Body);
  engineOk(await fn<{ ok: boolean; error?: string }>("order_paid_claim", id, a.order.buyer_id, b.utr || null));
  await afterWrite(a.order.drop_id, { type: "order_paid_claim", dropId: a.order.drop_id, orderId: id });
  return json({ ok: true });
});
