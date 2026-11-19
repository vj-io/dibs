// Public club summary: shop, member count, next drop, last announcements and reviews; chat lines for members only.
import { summary } from "@/lib/server/club";
import { json, route } from "@/lib/server/http";
import { getBuyer } from "@/lib/server/session";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ shopSlug: string }> };

export const GET = route("GET /api/club/:shopSlug", async (_req: Request, ctx: Ctx) => {
  const { shopSlug } = await ctx.params;
  return json(await summary(shopSlug.slice(0, 64), (await getBuyer())?.buyerId ?? null));
});
