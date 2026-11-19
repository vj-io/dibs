// Drops of the staff member's shop: list, and create (drop, items, stock copied from variant quantities,
// sale room via outbox SYS:EnsureRoom + the initial DB:State and its room metadata).
import { randomInt } from "node:crypto";
import { z } from "zod";
import { afterWrite } from "@/lib/server/after";
import { announceDrop } from "@/lib/server/club";
import { sql } from "@/lib/server/db";
import { body, fail, json, route } from "@/lib/server/http";
import { activeStaff, shareUrl } from "@/lib/server/queries";
import type { DropSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = route("GET /api/drops", async () => {
  const s = await activeStaff();
  const [shop] = await sql<{ slug: string }[]>`select slug from shops where id = ${s.shopId}`;
  const rows = await sql<Omit<DropSummary, "shareUrl">[]>`
    select d.id as "dropId", d.code, d.title, d.status, d.starts_at as "startsAt", d.is_sandbox as "isSandbox",
           (select count(*)::int from drop_items i where i.drop_id = d.id) as "itemCount", d.created_at as "createdAt", d.ended_at as "endedAt"
      from drops d where d.shop_id = ${s.shopId} order by d.starts_at desc limit 200`;
  return json({ drops: rows.map((d) => ({ ...d, shareUrl: shareUrl(shop.slug, d.code) })) });
});

const Body = z.object({
  title: z.string().trim().min(1).max(80),
  startsAt: z.iso.datetime({ offset: true }),
  productIds: z.array(z.uuid()).min(1).max(50).refine((a) => new Set(a).size === a.length, "a product can be in a drop once"),
});

// No 0/O/1/I: codes get read aloud and typed.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

export const POST = route("POST /api/drops", async (req: Request) => {
  const s = await activeStaff();
  const b = await body(req, Body);
  const owned = await sql<{ id: string; variants: number }[]>`
    select p.id, (select count(*)::int from product_variants v where v.product_id = p.id and v.qty > 0) as variants
      from products p where p.shop_id = ${s.shopId} and p.id = any(${b.productIds})`;
  if (owned.length !== b.productIds.length) fail(400, "invalid", "productIds: every product must be in your catalog.");
  if (owned.some((p) => p.variants === 0)) fail(400, "invalid", "productIds: every product needs at least one size with stock.");
  const [shop] = await sql<{ slug: string; is_sandbox: boolean }[]>`select slug, is_sandbox from shops where id = ${s.shopId}`;

  for (let attempt = 0; ; attempt++) {
    const code = newCode();
    try {
      const dropId = await sql.begin(async (tx) => {
        const [d] = await tx<{ id: string }[]>`
          insert into drops (shop_id, code, title, starts_at, nexconn_channel_id, is_sandbox)
          values (${s.shopId}, ${code}, ${b.title}, ${b.startsAt}, ${"dr_" + code}, ${shop.is_sandbox}) returning id`;
        for (const [i, pid] of b.productIds.entries()) {
          const [it] = await tx<{ id: string }[]>`insert into drop_items (drop_id, product_id, position) values (${d.id}, ${pid}, ${i + 1}) returning id`;
          await tx`insert into item_stock (drop_item_id, variant_id, total, available)
                   select ${it.id}, v.id, v.qty, v.qty from product_variants v where v.product_id = ${pid} and v.qty > 0`;
        }
        // the room must exist before its first card: EnsureRoom gets the lower outbox id
        await tx`select _out(${d.id}::uuid, 'room', ${"dr_" + code}, 'SYS:EnsureRoom', ${tx.json({ channelId: "dr_" + code, name: b.title })}::jsonb)`;
        // DB:State only: the drain mirrors it into the room's db_state metadata itself
        await tx`select _out(${d.id}::uuid, 'room', ${"dr_" + code}, 'DB:State', _state_card(${d.id}::uuid, 0::bigint), 'high')`;
        await tx`select _audit(${d.id}::uuid, 'staff', ${s.staffId}::uuid, 'drop_created', ${tx.json({ items: b.productIds.length })}::jsonb)`;
        return d.id;
      });
      await afterWrite(dropId);
      await announceDrop(dropId); // shop club #drops (never throws; no-op when the club flag is off)
      return json({ dropId, code, shareUrl: shareUrl(shop.slug, code) });
    } catch (e) {
      if ((e as { code?: string })?.code !== "23505" || attempt >= 4) throw e; // code collision: draw again
    }
  }
});
