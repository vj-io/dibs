// Per-drop results for the shop's staff. viewers null = not measured yet.
import { fn } from "@/lib/server/db";
import { json, route, uuidParam } from "@/lib/server/http";
import { staffForDrop } from "@/lib/server/queries";
import type { DropDashboard } from "@/lib/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route("GET /api/drops/:id/dashboard", async (_req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  await staffForDrop(id);
  const d = await fn<DropDashboard>("drop_dashboard", id);
  return json({ ...d, medianWinMs: d.medianWinMs == null ? null : Math.round(d.medianWinMs) } satisfies DropDashboard);
});
