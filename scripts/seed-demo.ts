// Creates or refreshes judge mode's sandbox data: 40 demo bots, 8 "Demo Jewels" slots (shop, owner, Asha the demo
// staff, 6 products, reusable open channel). Idempotent. Usage: node --env-file=.env.local scripts/seed-demo.ts
import postgres from "postgres";

const url = process.env.DATABASE_URL_SESSION ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL_SESSION is not set (run with --env-file=.env.local)");
const sql = postgres(url, { ssl: "require", max: 1, prepare: false, onnotice: () => {} });
try {
  const [{ r }] = await sql`select sandbox_seed() as r`;
  const slots = await sql`
    select t.slot, t.channel_id, s.slug, (select count(*)::int from products p where p.shop_id = s.id) as products,
           (select count(*)::int from staff st where st.shop_id = s.id) as staff
      from try_slots t join shops s on s.id = t.shop_id order by t.slot`;
  console.log(`bots: ${r.bots}, slots: ${r.slots}`);
  for (const s of slots) console.log(`  slot ${s.slot}: ${s.slug} ${s.channel_id} products=${s.products} staff=${s.staff}`);
} finally {
  await sql.end();
}
