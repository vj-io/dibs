// The staff member's catalog: list and create.
import { sql } from "@/lib/server/db";
import { body, fail, json, route } from "@/lib/server/http";
import { activeStaff, isShopPhoto, ProductFields, products } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

export const GET = route("GET /api/products", async () => {
  const s = await activeStaff();
  return json({ products: await products(s.shopId) });
});

export const POST = route("POST /api/products", async (req: Request) => {
  const s = await activeStaff();
  const b = await body(req, ProductFields);
  const photos = b.photos ?? [];
  if (photos.some((p) => !isShopPhoto(s.shopId, p))) fail(400, "invalid", "photos: upload each photo first.");
  const [n] = await sql<{ n: number }[]>`select count(*)::int as n from products where shop_id = ${s.shopId}`;
  if (n.n >= 500) fail(409, "catalog_full", "A shop can have up to 500 products.");
  const id = await sql.begin(async (tx) => {
    const [p] = await tx<{ id: string }[]>`
      insert into products (shop_id, title, price_paise, note, photos)
      values (${s.shopId}, ${b.title}, ${b.pricePaise}, ${b.note ?? null}, ${photos}) returning id`;
    for (const [i, v] of b.variants.entries()) {
      await tx`insert into product_variants (product_id, key, label, qty, sort) values (${p.id}, ${v.key}, ${v.label}, ${v.qty}, ${i})`;
    }
    return p.id;
  });
  return json({ product: (await products(s.shopId, id))[0] });
});
