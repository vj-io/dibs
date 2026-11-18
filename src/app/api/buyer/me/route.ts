// The signed-in buyer (own phone included), or null.
import { sql } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { getBuyer } from "@/lib/server/session";
import type { BuyerSelf } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route("GET /api/buyer/me", async () => {
  const s = await getBuyer();
  if (!s) return json({ buyer: null });
  const [b] = await sql<BuyerSelf[]>`
    select id, name, display_name as "displayName", phone from buyers where id = ${s.buyerId} and deleted_at is null`;
  return json({ buyer: b ?? null });
});
