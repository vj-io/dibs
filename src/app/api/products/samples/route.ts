// Three clearly-labelled sample pieces (demo art) for a new seller to edit, and one tap to remove the unused ones.
// A sample is a product whose title still starts with "Sample: "; renaming it makes it a normal product.
import { sql } from "@/lib/server/db";
import { json, route } from "@/lib/server/http";
import { activeEditor, products } from "@/lib/server/queries";

export const dynamic = "force-dynamic";

const PREFIX = "Sample: ";
const NOTE = "Sample piece. Edit the photo, title, price and sizes, or remove it.";
const SAMPLES = [
  { title: "Silver jhumka", pricePaise: 145000, photo: "/demo/jhumka-earrings.svg", variants: [["one", "One size", 2]] },
  { title: "Kundan choker", pricePaise: 320000, photo: "/demo/kundan-choker.svg", variants: [["one", "One size", 1]] },
  { title: "Glass bangle set", pricePaise: 89000, photo: "/demo/bangle-set.svg", variants: [["s", "2.4", 2], ["m", "2.6", 2]] },
] as const;

export const POST = route("POST /api/products/samples", async () => {
  const s = await activeEditor();
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${"samples:" + s.shopId}))`;
    const [has] = await tx`select 1 from products where shop_id = ${s.shopId} and title like ${PREFIX + "%"}`;
    if (has) return; // once is enough: a second tap doesn't pile up copies
    for (const p of SAMPLES) {
      const [r] = await tx<{ id: string }[]>`
        insert into products (shop_id, title, price_paise, note, photos) values (${s.shopId}, ${PREFIX + p.title}, ${p.pricePaise}, ${NOTE}, ${[p.photo]}) returning id`;
      for (const [i, [key, label, qty]] of p.variants.entries()) {
        await tx`insert into product_variants (product_id, key, label, qty, sort) values (${r.id}, ${key}, ${label}, ${qty}, ${i})`;
      }
    }
  });
  return json({ products: await products(s.shopId) });
});

/** Removes every sample piece that has never been in a drop (those keep their order history). */
export const DELETE = route("DELETE /api/products/samples", async () => {
  const s = await activeEditor();
  const gone = await sql`
    delete from products p where p.shop_id = ${s.shopId} and p.title like ${PREFIX + "%"}
       and not exists (select 1 from drop_items i where i.product_id = p.id) returning p.id`;
  return json({ removed: gone.length, products: await products(s.shopId) });
});
