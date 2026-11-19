// Drop control: drop_go_live (the engine checks the staff member belongs to the drop's shop).
import { afterWrite } from "@/lib/server/after";
import { announceDrop } from "@/lib/server/club";
import { fn } from "@/lib/server/db";
import { json, route, uuidParam } from "@/lib/server/http";
import { activeStaff, engineOk } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = route("POST /api/drops/:id/live", async (_req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const s = await activeStaff();
  const r = engineOk(await fn<{ ok: boolean; error?: string; liveItemId: string | null }>("drop_go_live", id, s.staffId));
  await afterWrite(id, { type: "drop_live", dropId: id });
  await announceDrop(id); // shop club #drops (never throws; no-op when the club flag is off)
  return json({ ok: true, liveItemId: r.liveItemId ?? null });
});
