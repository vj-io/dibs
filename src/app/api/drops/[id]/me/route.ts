// The calling buyer's holds (with timers) and waitlist positions in this drop (sweep first).
import { after } from "next/server";
import { afterWrite } from "@/lib/server/after";
import { rpc } from "@/lib/server/db";
import { json, notFound, route, uuidParam } from "@/lib/server/http";
import { requireBuyer } from "@/lib/server/session";
import type { MyStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route("GET /api/drops/:id/me", async (_req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const b = await requireBuyer();
  // one round trip: sweep (lock-free unless a hold is due) + my_status (api_me, 0008). Every room card makes each
  // connected buyer refetch this, so in a burst it competes with the claims for PostgREST's pool.
  const r = await rpc<{ swept: boolean; status: MyStatus | null }>("api_me", { p_drop: id, p_buyer: b.buyerId });
  if (r.swept) after(() => afterWrite(id));
  return json(r.status ?? notFound());
});
