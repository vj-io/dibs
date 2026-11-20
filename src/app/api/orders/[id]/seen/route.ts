// Staff: the order room is open, so the buyer's messages are read (clears the seller inbox line for this order).
import { sql } from "@/lib/server/db";
import { json, route, uuidParam } from "@/lib/server/http";
import { orderAccess, staffOfOrder } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = route("POST /api/orders/:id/seen", async (_req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  staffOfOrder(await orderAccess(id, "staff"));
  await sql`update orders set buyer_unread = 0 where id = ${id} and buyer_unread > 0`;
  return json({ ok: true });
});
