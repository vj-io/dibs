// Owner copies the invite link of a pending team member again (a fresh 7-day link for the same row and email).
import { sql } from "@/lib/server/db";
import { fail, json, route, uuidParam } from "@/lib/server/http";
import { requireOwner } from "@/lib/server/queries";
import { inviteUrl } from "@/app/api/seller/_signin";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; staffId: string }> };

export const POST = route("POST /api/shops/:id/staff/:staffId/link", async (_req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const staffId = await uuidParam(ctx, "staffId");
  await requireOwner(id);
  const [st] = await sql<{ email: string }[]>`select email from staff where id = ${staffId} and shop_id = ${id} and not active and email is not null`;
  if (!st) fail(404, "not_found", "Only a pending invite has a link.");
  return json({ inviteUrl: await inviteUrl(staffId, st.email.toLowerCase()) });
});
