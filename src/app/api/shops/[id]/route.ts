// Shop settings: staff of the shop read them; only the owner changes them.
import { sql } from "@/lib/server/db";
import { body, fail, forbidden, json, route, uuidParam } from "@/lib/server/http";
import { activeStaff, isShopPhoto, requireOwner, shopSettings, ShopFields } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route("GET /api/shops/:id", async (_req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const s = await activeStaff();
  if (s.shopId !== id) forbidden();
  return json(await shopSettings(id));
});

export const PATCH = route("PATCH /api/shops/:id", async (req: Request, ctx: Ctx) => {
  const id = await uuidParam(ctx, "id");
  const owner = await requireOwner(id);
  const b = await body(req, ShopFields);
  if (b.logoUrl && !isShopPhoto(id, b.logoUrl)) fail(400, "invalid", "logoUrl: upload the logo first.");
  if (b.slug) {
    const [taken] = await sql`select 1 from shops where slug = ${b.slug} and id <> ${id}`;
    if (taken) fail(409, "slug_taken", "That shop link is taken. Try another.");
  }
  const set: Record<string, unknown> = {};
  if (b.name !== undefined) set.name = b.name;
  if (b.slug !== undefined) set.slug = b.slug;
  if (b.upiId !== undefined) set.upi_id = b.upiId;
  if (b.payeeName !== undefined) set.payee_name = b.payeeName;
  if (b.supportWhatsapp !== undefined) set.support_whatsapp = b.supportWhatsapp;
  if (b.logoUrl !== undefined) set.logo_url = b.logoUrl;
  if (b.holdMinutes !== undefined) set.hold_seconds = b.holdMinutes * 60;
  if (b.maxHolds !== undefined) set.max_holds = b.maxHolds;
  if (b.highValuePaise !== undefined) set.high_value_paise = b.highValuePaise;
  if (b.autoAdvance !== undefined) set.auto_advance = b.autoAdvance;
  if (b.faq !== undefined) set.faq = sql.json(b.faq);
  if (Object.keys(set).length) {
    await sql`update shops set ${sql(set as Record<string, never>)} where id = ${id}`
      .catch((e: { code?: string }) => e?.code === "23505" ? fail(409, "slug_taken", "That shop link is taken. Try another.") : Promise.reject(e));
  }
  await sql`update staff set proof_notice_at = null where id = ${owner.staffId} and proof_notice_at is not null`; // they have been through the settings
  return json(await shopSettings(id));
});
