// Item control: item_reopen. The item must belong to the drop in the path; the engine checks the staff member's shop.
import { afterWrite } from "@/lib/server/after";
import { fn, sql } from "@/lib/server/db";
import { json, notFound, route, uuidParam } from "@/lib/server/http";
import { activeStaff, engineOk } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; itemId: string }> };

export const POST = route("POST /api/drops/:id/items/:itemId/reopen", async (_req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const itemId = await uuidParam(ctx, "itemId");
  const s = await activeStaff();
  const [it] = await sql`select 1 from drop_items where id = ${itemId} and drop_id = ${id}`;
  if (!it) notFound();
  const r = engineOk(await fn<{ ok: boolean; error?: string; liveItemId: string | null }>("item_reopen", itemId, s.staffId));
  await afterWrite(id, { type: "item_live", dropId: id, itemId });
  return json({ ok: true, liveItemId: r.liveItemId ?? null });
});
