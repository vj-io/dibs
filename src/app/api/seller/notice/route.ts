// The owner has read the one-time "check your UPI ID and payee name" note (shown after the first sign-in by emailed
// code on an account that already had a password): clear it. Saving the shop settings clears it too.
import { sql } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { activeStaff } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

export const DELETE = route("DELETE /api/seller/notice", async () => {
  const s = await activeStaff();
  await sql`update staff set proof_notice_at = null where id = ${s.staffId}`;
  return json({ ok: true });
});
