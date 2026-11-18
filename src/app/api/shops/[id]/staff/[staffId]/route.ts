// Owner removes a staff member (or a pending invite). The row stays for order history but is inactive and loses
// its email, so the cookie stops working and the invite cannot be reused. Their open orders go to the owner, and
// they leave the team desk and every order room they were added to (SYS:LeaveGroup through the outbox).
import { afterWrite } from "@/lib/server/after";
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
  const uid = `s_${staffId}`;
  await sql.begin(async (tx) => {
    await tx`update staff set active = false, email = null where id = ${staffId}`;
    await tx`update orders set assigned_staff_id = (select id from staff where shop_id = ${id} and role = 'owner' and active order by created_at limit 1)
              where shop_id = ${id} and assigned_staff_id = ${staffId} and state in ('held','payment_claimed','paid')`;
    await tx`insert into outbox (drop_id, channel_type, channel_id, msg_type, payload)
             select distinct on (o.channel_id) o.drop_id, 'group', o.channel_id, 'SYS:LeaveGroup', jsonb_build_object('channelId', o.channel_id, 'memberIds', jsonb_build_array(${uid}::text))
               from outbox o
              where o.msg_type = 'SYS:EnsureGroup' and o.payload->'memberIds' ? ${uid}
                and (o.channel_id = (select nexconn_desk_id from shops where id = ${id})
                     or o.channel_id in (select nexconn_group_id from orders where shop_id = ${id}))`;
  });
  await afterWrite(null);
  return json({ ok: true });
});
