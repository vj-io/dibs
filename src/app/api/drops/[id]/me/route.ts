// The calling buyer's holds (with timers) and waitlist positions in this drop (sweep first).
import { afterWrite } from "@/lib/server/after";
import { fn } from "@/lib/server/db";
import { json, notFound, route, uuidParam } from "@/lib/server/http";
import { sweep } from "@/lib/server/queries";
import { requireBuyer } from "@/lib/server/session";
import type { MyStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route("GET /api/drops/:id/me", async (_req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const b = await requireBuyer();
  if (await sweep(id)) await afterWrite(id);
  return json((await fn<MyStatus | null>("my_status", id, b.buyerId)) ?? notFound());
});
