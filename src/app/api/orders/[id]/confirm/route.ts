// Staff: payment received (-> paid) or not received (-> held again with 5 minutes).
import { z } from "zod";
import { afterWrite } from "@/lib/server/after";
import { fn } from "@/lib/server/db";
import { body, json, route, uuidParam } from "@/lib/server/http";
import { engineOk, orderAccess, staffOfOrder } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ received: z.boolean(), note: z.string().trim().max(200).optional() });

export const POST = route("POST /api/orders/:id/confirm", async (req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const { order, staff } = staffOfOrder(await orderAccess(id, "staff"));
  const b = await body(req, Body);
  engineOk(await fn<{ ok: boolean; error?: string }>("order_confirm", id, staff.staffId, b.received, b.note ?? null));
  await afterWrite(order.drop_id);
  return json({ ok: true });
});
