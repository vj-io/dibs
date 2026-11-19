// Public sale-room state (sweep first). No phone numbers or claim ids in it.
import { after } from "next/server";
import { afterWrite } from "@/lib/server/after";
import { rpc } from "@/lib/server/db";
import { json, notFound, route, uuidParam } from "@/lib/server/http";
import { cachedViewers } from "@/lib/server/queries";
import type { DropState } from "@/lib/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
type ApiState = { swept: boolean; state: Omit<DropState, "viewers"> | null };

// Viewers of one drop who ask at the same moment on this instance share one database call. In a tap burst every call
// waits in PostgREST's queue behind the claims, so 100 viewers were 100 more requests in that queue (docs/perf.md).
// The shared answer is never older than the call it waited for; clients keep the newest version they have seen.
const inflight = new Map<string, Promise<ApiState>>();

export const GET = route("GET /api/drops/:id/state", async (_req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  let p = inflight.get(id);
  if (!p) {
    // one round trip: the sweep (lock-free unless a hold is due) then drop_state (api_state, 0007)
    p = rpc<ApiState>("api_state", { p_drop: id }).finally(() => inflight.delete(id));
    inflight.set(id, p);
  }
  const r = await p;
  if (!r.state) notFound();
  if (r.swept) after(() => afterWrite(id)); // the viewer gets the state now; the room hears after the response
  return json({ ...r.state!, viewers: cachedViewers(r.state!.channelId) });
});
