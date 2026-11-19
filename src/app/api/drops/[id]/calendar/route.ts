// Public .ics for one drop: start = drop start, 30 minutes, the share link, a 10-minute alarm. Not for sandbox drops.
import { notFound, route, uuidParam } from "@/lib/server/http";
import { appUrl } from "@/lib/server/queries";
import { dropById, shareUrl } from "@/lib/server/share";
import { buildIcs } from "@/lib/ics";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route("GET /api/drops/:id/calendar", async (_req: Request, ctx: Ctx) => {
  const d = (await dropById(await uuidParam(ctx, "id"))) ?? notFound();
  if (d.isSandbox) notFound();
  const body = buildIcs({ uid: d.dropId, title: `${d.title} · ${d.shop.name} on Dibs`, startsAt: new Date(d.startsAt), url: shareUrl(d, appUrl()) });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="dibs-${d.code}.ics"`,
      "Cache-Control": "public, max-age=60, s-maxage=60",
    },
  });
});
