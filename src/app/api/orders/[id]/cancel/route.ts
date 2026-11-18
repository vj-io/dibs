// Staff: cancel a hold (held or payment claimed) with a reason; the next buyer in line is promoted.
import { z } from "zod";
import { afterWrite } from "@/lib/server/after";
import { fn } from "@/lib/server/db";
import { body, json, route, uuidParam } from "@/lib/server/http";
import { engineOk, orderAccess, staffOfOrder } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ reason: z.string().trim().min(1).max(200) });

export const POST = route("POST /api/orders/:id/cancel", async (req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const { order, staff } = staffOfOrder(await orderAccess(id));
  const b = await body(req, Body);
  engineOk(await fn<{ ok: boolean; error?: string }>("release_claim", order.claim_id, "staff", staff.staffId, b.reason));
  await afterWrite(order.drop_id);
  return json({ ok: true });
});
