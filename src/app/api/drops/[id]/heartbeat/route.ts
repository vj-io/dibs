// Seller console heartbeat (every 5 s): sweep, then the console state, the public state and the viewer count.
import { afterWrite } from "@/lib/server/after";
import { fn } from "@/lib/server/db";
import { json, route, uuidParam } from "@/lib/server/http";
import { dropState, engineOk, staffForDrop, sweep, viewers } from "@/lib/server/queries";
import type { ConsoleState, Heartbeat } from "@/lib/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = route("POST /api/drops/:id/heartbeat", async (_req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const s = await staffForDrop(id);
  if (await sweep(id)) await afterWrite(id);
  const [c, state] = await Promise.all([
    fn<{ ok: boolean; error?: string } & ConsoleState>("console_state", id, s.staffId).then(engineOk),
    dropState(id),
  ]);
  const { ledger, stock, moderation, bans } = c;
  return json({ state, console: { ledger, stock, moderation, bans }, viewers: await viewers(state.channelId) } satisfies Heartbeat);
});
