// The signed-in staff member and shop, or null; pendingEmail = signed in by email but no shop yet.
import { json, route } from "@/lib/server/http";
import { sellerMe } from "@/lib/server/queries";
import { getStaff } from "@/lib/server/session";
import { getSellerClaim } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

export const GET = route("GET /api/seller/me", async () => {
  const s = await getStaff();
  const me = s ? await sellerMe(s.staffId, s.iat) : null;
  const claim = me ? null : await getSellerClaim();
  return json({ me, pendingEmail: claim?.email ?? null });
});
