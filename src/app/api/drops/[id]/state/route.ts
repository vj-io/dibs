// Public sale-room state (sweep first). No phone numbers or claim ids in it.
import { afterWrite } from "@/lib/server/after";
import { json, route, uuidParam } from "@/lib/server/http";
import { dropState, sweep } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route("GET /api/drops/:id/state", async (_req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const state = await dropState(id); // 404 before sweeping a drop that does not exist
  if (await sweep(id)) { await afterWrite(id); return json(await dropState(id)); }
  return json(state);
});
