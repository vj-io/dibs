// Display names for chat senders, from the database. Chat lines carry a sender name the client chose
// (senderUserInfo / the SDK profile, both client-writable), so screens never show that: they ask here.
// Public: display names already appear in sale-room tickers. Unknown ids are left out (the screen says "Buyer").
import { sql } from "@/lib/server/db";
import { clientIp, json, route } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/ratelimit";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = route("GET /api/names", async (req: Request) => {
  await rateLimit(`names:${clientIp(req)}`, 120, 60);
  const ids = [...new Set((new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(Boolean))].slice(0, 50);
  const buyers = ids.filter((x) => x.startsWith("b_") && UUID.test(x.slice(2))).map((x) => x.slice(2));
  const staff = ids.filter((x) => x.startsWith("s_") && UUID.test(x.slice(2))).map((x) => x.slice(2));
  const bots = ids.filter((x) => /^demo_bot_\d{2}$/.test(x));
  const rows = await sql<{ uid: string; name: string }[]>`
    select 'b_' || id as uid, display_name as name from buyers where id = any(${buyers}::uuid[]) and not is_bot
    union all select nexconn_user_id, display_name from buyers where is_bot and nexconn_user_id = any(${bots}::text[])
    union all select 's_' || id, display_name from staff where id = any(${staff}::uuid[])`;
  const names: Record<string, string> = Object.fromEntries(rows.map((r) => [r.uid, r.name]));
  if (ids.includes("dibs_assistant")) names.dibs_assistant = "Dibs assistant";
  return json({ names });
});
