// Public: resolves a share link (/s/<shop>/d/<code>) to the drop and its state (sweep first).
import { afterWrite } from "@/lib/server/after";
import { sql } from "@/lib/server/db";
import { json, notFound, route } from "@/lib/server/http";
import { dropState, sweep } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ shop: string; code: string }> };

export const GET = route("GET /api/drops/by-code/:shop/:code", async (_req: Request, ctx: Ctx) => {
  const { shop, code } = await ctx.params;
  if (!/^[a-z0-9-]{3,30}$/.test(shop) || !/^[A-Za-z0-9]{6}$/.test(code)) notFound();
  const [d] = await sql<{ id: string }[]>`
    select d.id from drops d join shops s on s.id = d.shop_id where s.slug = ${shop} and d.code = ${code.toUpperCase()}`;
  if (!d) notFound();
  if (await sweep(d.id)) await afterWrite(d.id);
  return json({ dropId: d.id, state: await dropState(d.id) });
});
