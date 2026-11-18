// Drop control: drop_next (the engine checks the staff member belongs to the drop's shop).
import { afterWrite } from "@/lib/server/after";
import { fn } from "@/lib/server/db";
import { json, route, uuidParam } from "@/lib/server/http";
import { activeStaff, engineOk } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = route("POST /api/drops/:id/next", async (_req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const s = await activeStaff();
  const r = engineOk(await fn<{ ok: boolean; error?: string; liveItemId: string | null }>("drop_next", id, s.staffId));
  await afterWrite(id, r.liveItemId ? { type: "item_live", dropId: id, itemId: r.liveItemId } : undefined);
  return json({ ok: true, liveItemId: r.liveItemId ?? null });
});
