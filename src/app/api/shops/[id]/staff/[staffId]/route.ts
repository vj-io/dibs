// Owner removes a staff member (or a pending invite). The row stays for order history but is inactive and loses
// its email, so the cookie stops working and the invite cannot be reused. Open orders keep their assignee name.
import { sql } from "@/lib/server/db";
import { fail, json, notFound, route, uuidParam } from "@/lib/server/http";
import { requireOwner } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; staffId: string }> };

export const DELETE = route("DELETE /api/shops/:id/staff/:staffId", async (_req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const staffId = await uuidParam(ctx, "staffId");
  await requireOwner(id);
  const [st] = await sql<{ role: string }[]>`select role from staff where id = ${staffId} and shop_id = ${id}`;
  if (!st) notFound();
  if (st.role === "owner") fail(409, "owner", "The owner can't be removed.");
  await sql`update staff set active = false, email = null where id = ${staffId}`;
  return json({ ok: true });
});
