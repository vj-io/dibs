// Staff: mark a paid order shipped, with an optional tracking note.
import { z } from "zod";
import { afterWrite } from "@/lib/server/after";
import { fn } from "@/lib/server/db";
import { body, json, route, uuidParam } from "@/lib/server/http";
import { engineOk, orderAccess, staffOfOrder } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ trackingNote: z.string().trim().max(200).optional() });

export const POST = route("POST /api/orders/:id/ship", async (req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const { order, staff } = staffOfOrder(await orderAccess(id));
  const b = await body(req, Body);
  engineOk(await fn<{ ok: boolean; error?: string }>("order_ship", id, staff.staffId, b.trackingNote ?? null));
  await afterWrite(order.drop_id);
  return json({ ok: true });
});
