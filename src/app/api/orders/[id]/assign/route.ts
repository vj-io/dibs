// Staff: reassign the order (the engine adds the new assignee to the order room and posts on the desk).
import { z } from "zod";
import { afterWrite } from "@/lib/server/after";
import { fn } from "@/lib/server/db";
import { body, json, route, uuidParam } from "@/lib/server/http";
import { engineOk, orderAccess, staffOfOrder } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ staffId: z.uuid() });

export const POST = route("POST /api/orders/:id/assign", async (req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const { order, staff } = staffOfOrder(await orderAccess(id));
  const b = await body(req, Body);
  engineOk(await fn<{ ok: boolean; error?: string }>("order_assign", id, staff.staffId, b.staffId));
  await afterWrite(order.drop_id);
  return json({ ok: true });
});
