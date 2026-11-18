// Edit or delete one product of the staff member's shop.
// Variants: labels and quantities can change and new keys can be added at any time (stock is copied when a drop
// is created); removing a variant key is refused once the product has been in any drop, because claims and orders
// point at it. Delete is refused once the product has been in any drop (deleting would cascade to its orders).
import { sql } from "@/lib/server/db";
import { body, fail, json, notFound, route, uuidParam } from "@/lib/server/http";
import { activeEditor, isShopPhoto, ProductFields, products } from "@/lib/server/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

async function own(ctx: Ctx) {
  const id = await uuidParam(ctx, "id");
  const s = await activeEditor();
  const [p] = await products(s.shopId, id);
  return p ? { s, p } : notFound();
}

export const PATCH = route("PATCH /api/products/:id", async (req: Request, ctx: Ctx) => {
  const { s, p } = await own(ctx);
  const b = await body(req, ProductFields.partial());
  if (b.photos?.some((x) => !isShopPhoto(s.shopId, x))) fail(400, "invalid", "photos: upload each photo first.");
  if (b.variants && p.usedInDrops > 0) {
    const keys = new Set(b.variants.map((v) => v.key));
    if (p.variants.some((v) => !keys.has(v.key))) fail(409, "in_use", "This product has been in a drop, so its sizes can't be removed.");
  }
  await sql.begin(async (tx) => {
    const set: Record<string, unknown> = {};
    if (b.title !== undefined) set.title = b.title;
    if (b.pricePaise !== undefined) set.price_paise = b.pricePaise;
    if (b.note !== undefined) set.note = b.note;
    if (b.photos !== undefined) set.photos = b.photos;
    if (Object.keys(set).length) await tx`update products set ${tx(set as Record<string, never>)} where id = ${p.id}`;
    if (b.variants) {
      await tx`delete from product_variants where product_id = ${p.id} and not (key = any(${b.variants.map((v) => v.key)}))`;
      for (const [i, v] of b.variants.entries()) {
        await tx`insert into product_variants (product_id, key, label, qty, sort) values (${p.id}, ${v.key}, ${v.label}, ${v.qty}, ${i})
                 on conflict (product_id, key) do update set label = excluded.label, qty = excluded.qty, sort = excluded.sort`;
      }
    }
  });
  return json({ product: (await products(s.shopId, p.id))[0] });
});

export const DELETE = route("DELETE /api/products/:id", async (_req: Request, ctx: Ctx) => {
  const { p } = await own(ctx);
  if (p.inLiveDrop) fail(409, "in_use", "This product is in a drop that hasn't ended.");
  if (p.usedInDrops > 0) fail(409, "in_use", "This product has orders from a past drop, so it can't be deleted.");
  await sql`delete from products where id = ${p.id}`;
  return json({ ok: true });
});
