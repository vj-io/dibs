// The claim's buyer leaves a waitlist.
import { afterWrite } from "@/lib/server/after";
import { fn, sql } from "@/lib/server/db";
import { json, notFound, route, uuidParam } from "@/lib/server/http";
import { engineOk } from "@/lib/server/queries";
import { requireBuyer } from "@/lib/server/session";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = route("POST /api/claims/:id/leave", async (_req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const b = await requireBuyer();
  const [c] = await sql<{ drop_id: string }[]>`select drop_id from claims where id = ${id}`;
  if (!c) notFound();
  engineOk(await fn<{ ok: boolean; error?: string }>("leave_waitlist", id, b.buyerId));
  await afterWrite(c.drop_id);
  return json({ ok: true });
});
