// Order page heartbeat (every 10 s), buyer or staff: sweep that drop, return the state and the timer.
import { afterWrite } from "@/lib/server/after";
import { sql } from "@/lib/server/db";
import { json, route, uuidParam } from "@/lib/server/http";
import { orderAccess, sweep } from "@/lib/server/queries";
import type { OrderState } from "@/lib/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = route("POST /api/orders/:id/heartbeat", async (_req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const { order } = await orderAccess(id);
  if (await sweep(order.drop_id)) await afterWrite(order.drop_id);
  const [r] = await sql<{ state: OrderState; expires_at: Date | null }[]>`
    select o.state, case when o.state = 'held' and c.state = 'held' then c.expires_at end as expires_at
      from orders o join claims c on c.id = o.claim_id where o.id = ${id}`;
  return json({ state: r.state, expiresAt: r.expires_at?.toISOString() ?? null });
});
