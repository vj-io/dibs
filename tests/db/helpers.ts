// Shared fixtures for the claim-engine tests. Real Postgres: DATABASE_URL_SESSION for setup/inspection,
// DATABASE_URL (transaction pooler, prepare: false) for the calls that race.
// Every fixture is a sandbox shop with a unique slug; cleanup() deletes it (cascade) and its buyers.
import postgres from "postgres";
import { randomInt, randomUUID } from "node:crypto";

export const admin = postgres(process.env.DATABASE_URL_SESSION!, { ssl: "require", max: 3, onnotice: () => {} });
export const pool = postgres(process.env.DATABASE_URL!, {
  ssl: "require",
  prepare: false,
  max_pipeline: 1, // the Supavisor transaction pooler wedges on pipelined queries (postgres.js default is 100)
  max: Number(process.env.TEST_POOL_MAX ?? 40),
  connect_timeout: 30,
  onnotice: () => {},
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON from the engine in tests
export type J = Record<string, any>;

/** select <name>(args...) through the pooler; args are passed with explicit casts. */
export async function call(name: string, args: [unknown, string][], db = pool): Promise<J> {
  const sqlText = `select ${name}(${args.map(([, t], i) => `$${i + 1}::${t}`).join(", ")}) as r`;
  const rows = await db.unsafe(sqlText, args.map(([v]) => v) as never[]);
  return rows[0].r as J;
}

export const claim = (item: string, key: string, buyer: string, db = pool) =>
  call("claim_dibs", [[item, "uuid"], [key, "text"], [buyer, "uuid"], [new Date().toISOString(), "timestamptz"]], db);
export const sweep = (drop: string, db = pool) => call("sweep_drop", [[drop, "uuid"]], db);
export const staffCall = (name: string, id: string, staff: string, db = pool) => call(name, [[id, "uuid"], [staff, "uuid"]], db);

type ItemSpec = { title?: string; price?: number; variants: { key: string; qty: number }[] };
export type Fixture = {
  shopId: string; ownerId: string; staffIds: string[]; dropId: string; code: string;
  items: { id: string; variants: Record<string, string> }[]; buyers: string[];
};

const made: Fixture[] = [];

export async function makeFixture(opts: {
  items: ItemSpec[]; buyers?: number; holdSeconds?: number; maxHolds?: number; waitlistMax?: number;
  staff?: number; highValue?: number | null; goLive?: boolean;
}): Promise<Fixture> {
  const tag = randomUUID().slice(0, 8);
  const [shop] = await admin`
    insert into shops (slug, name, upi_id, payee_name, hold_seconds, max_holds, waitlist_max, high_value_paise, is_sandbox, nexconn_desk_id)
    values (${"t-" + tag}, ${"Test Shop " + tag}, 'test@upi', 'Test & Sons', ${opts.holdSeconds ?? 600}, ${opts.maxHolds ?? 3},
            ${opts.waitlistMax ?? 20}, ${opts.highValue ?? null}, true, ${"desk_" + tag})
    returning id`;
  const [owner] = await admin`insert into staff (shop_id, role, display_name, email) values (${shop.id}, 'owner', 'Owner', ${tag + "@o.test"}) returning id`;
  const staffIds: string[] = [owner.id];
  for (let i = 0; i < (opts.staff ?? 0); i++) {
    const [s] = await admin`insert into staff (shop_id, role, display_name, email) values (${shop.id}, 'staff', ${"Staff " + i}, ${tag + i + "@s.test"}) returning id`;
    staffIds.push(s.id);
  }
  const code = tag.slice(0, 6).toUpperCase();
  const [drop] = await admin`
    insert into drops (shop_id, code, title, starts_at, nexconn_channel_id, is_sandbox)
    values (${shop.id}, ${code}, 'Test drop', now(), ${"dr_" + code}, true) returning id`;
  const items: Fixture["items"] = [];
  for (const [i, spec] of opts.items.entries()) {
    const [p] = await admin`insert into products (shop_id, title, price_paise, photos) values (${shop.id}, ${spec.title ?? "Piece " + (i + 1)}, ${spec.price ?? 145000}, ${["https://x.test/p.jpg"]}) returning id`;
    const [di] = await admin`insert into drop_items (drop_id, product_id, position) values (${drop.id}, ${p.id}, ${i + 1}) returning id`;
    const variants: Record<string, string> = {};
    for (const [j, v] of spec.variants.entries()) {
      const [pv] = await admin`insert into product_variants (product_id, key, label, qty, sort) values (${p.id}, ${v.key}, ${"Size " + v.key}, ${v.qty}, ${j}) returning id`;
      await admin`insert into item_stock (drop_item_id, variant_id, total, available) values (${di.id}, ${pv.id}, ${v.qty}, ${v.qty})`;
      variants[v.key] = pv.id;
    }
    items.push({ id: di.id, variants });
  }
  const buyers: string[] = [];
  const n = opts.buyers ?? 5;
  if (n) {
    const rows = Array.from({ length: n }, (_, i) => ({
      name: `Buyer${i} Tester`, display_name: `Buyer${i} T.`, phone: `9${String(randomInt(1e8, 1e9))}`,
      is_sandbox: true,
    }));
    const ins = await admin`insert into buyers ${admin(rows)} returning id`;
    buyers.push(...ins.map((r) => r.id as string));
  }
  const f: Fixture = { shopId: shop.id, ownerId: owner.id, staffIds, dropId: drop.id, code, items, buyers };
  made.push(f);
  if (opts.goLive !== false) {
    const a = await staffCall("drop_go_live", drop.id, owner.id);
    if (!a.ok) throw new Error("go live: " + JSON.stringify(a));
    const b = await staffCall("drop_next", drop.id, owner.id);
    if (!b.ok) throw new Error("next: " + JSON.stringify(b));
  }
  return f;
}

export async function cleanup() {
  for (const f of made.splice(0)) {
    await admin`delete from shops where id = ${f.shopId}`;
    if (f.buyers.length) await admin`delete from buyers where id in ${admin(f.buyers)}`;
  }
}

export async function closeAll() {
  await cleanup();
  await Promise.all([admin.end({ timeout: 5 }), pool.end({ timeout: 5 })]);
}

/** Forces holds to be already expired (instead of waiting). */
export const forceExpire = (claimIds: string[]) =>
  admin`update claims set expires_at = clock_timestamp() - interval '1 second' where id in ${admin(claimIds)}`;

/** total = available + units in held/payment_claimed/paid/shipped, for every stock row of the drop. */
export async function stockInvariant(dropId: string) {
  return admin`
    select s.drop_item_id, s.variant_id, s.total, s.available,
           (select count(*)::int from claims c where c.drop_item_id = s.drop_item_id and c.variant_id = s.variant_id
              and c.state in ('held','payment_claimed','paid','shipped')) as taken
      from item_stock s join drop_items i on i.id = s.drop_item_id where i.drop_id = ${dropId}`;
}

export async function snapshot(dropId: string) {
  const [r] = await admin`
    select (select jsonb_agg(to_jsonb(c) order by c.id) from claims c where c.drop_id = ${dropId}) as claims,
           (select jsonb_agg(to_jsonb(o) order by o.id) from orders o where o.drop_id = ${dropId}) as orders,
           (select jsonb_agg(to_jsonb(s) order by s.drop_item_id, s.variant_id) from item_stock s join drop_items i on i.id = s.drop_item_id where i.drop_id = ${dropId}) as stock,
           (select jsonb_agg(to_jsonb(i) order by i.id) from drop_items i where i.drop_id = ${dropId}) as items,
           (select to_jsonb(d) from drops d where d.id = ${dropId}) as drop,
           (select count(*) from outbox where drop_id = ${dropId}) as outbox,
           (select count(*) from audit_events where drop_id = ${dropId}) as audit,
           (select jsonb_agg(to_jsonb(st) order by st.id) from staff st join drops d on d.shop_id = st.shop_id where d.id = ${dropId}) as staff`;
  return r;
}
