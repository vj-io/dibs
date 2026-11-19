// Owner invites staff by email: a pending (inactive) staff row. It activates when that email signs in with an emailed
// code, or through the returned invite link (7 days, works without any email being sent).
import { z } from "zod";
import { sql } from "@/lib/server/db";
import { body, fail, json, route, uuidParam } from "@/lib/server/http";
import { requireOwner } from "@/lib/server/queries";
import { inviteUrl } from "@/app/api/seller/_signin";
import type { StaffMember } from "@/lib/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ email: z.email().max(200), name: z.string().trim().min(1).max(40) });

export const POST = route("POST /api/shops/:id/staff", async (req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  await requireOwner(id);
  const b = await body(req, Body);
  const email = b.email.toLowerCase();
  const [dup] = await sql`select 1 from staff where shop_id = ${id} and lower(email) = ${email}`;
  if (dup) fail(409, "already_invited", "That email is already on your team.");
  const [n] = await sql<{ n: number }[]>`select count(*)::int as n from staff where shop_id = ${id} and (active or email is not null)`;
  if (n.n >= 20) fail(409, "team_full", "A shop can have up to 20 team members.");
  const [r] = await sql<{ id: string }[]>`
    insert into staff (shop_id, role, display_name, email, active) values (${id}, 'staff', ${b.name}, ${email}, false) returning id`;
  return json({ member: { staffId: r.id, role: "staff", displayName: b.name, email, status: "pending" } satisfies StaffMember, inviteUrl: await inviteUrl(r.id, email) });
});
