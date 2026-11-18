// Read helpers and permission walls shared by the API routes. Server only.
// Every staff check re-reads the staff row (active, same shop): a removed staff member's cookie stops working at once.
import { z } from "zod";
import type { DropState, OrderState, Product, SellerMe, ShopSettings, StaffMember } from "../types.ts";
import { fn, sql } from "./db.ts";
import { flags } from "./flags.ts";
import { fail, forbidden, notFound } from "./http.ts";
import { roomCount } from "./nexconn.ts";
import { getBuyer, getStaff, requireStaff, type StaffSession } from "./session.ts";
import { photoPrefix } from "./supabase.ts";
import { isIndianPhone, isUpiId } from "../upi.ts";

// ------------------------------------------------------------------ engine results

const ENGINE_MSG: Record<string, string> = {
  not_found: "We couldn't find that.",
  forbidden: "You don't have permission to do that.",
  bad_state: "That can't be done right now. Refresh and try again.",
  another_live: "Another piece is live. Close it first.",
  nothing_unsold: "Every unit of this piece is sold or held.",
  expired: "Your hold ran out.",
  bad_staff: "That person isn't on this shop's team.",
  bad_actor: "That can't be done right now.",
};

/** Engine `{ ok:false, error }` -> 403 forbidden / 404 not_found / 409 other, with a human message. */
export function engineOk<T extends { ok: boolean; error?: string }>(r: T | null): T {
  if (!r) return notFound();
  if (r.ok) return r;
  const code = r.error ?? "bad_state";
  return fail(code === "forbidden" ? 403 : code === "not_found" ? 404 : 409, code, ENGINE_MSG[code] ?? ENGINE_MSG.bad_state);
}

export type SweepResult = { expired: number; promoted: number; returned: number; warned: number };
/** Runs the idempotent sweep; true when it changed something (so the caller drains the outbox). */
export async function sweep(dropId: string): Promise<boolean> {
  const r = await fn<SweepResult>("sweep_drop", dropId);
  return r.expired + r.warned > 0;
}

// ------------------------------------------------------------------ staff

export type ActiveStaff = StaffSession & { displayName: string };

/** Signed-in, still-active staff (role and shop from the database, not the cookie). */
export async function activeStaff(): Promise<ActiveStaff> {
  const s = await requireStaff();
  const [row] = await sql<{ role: "owner" | "staff"; shop_id: string; display_name: string }[]>`
    select role, shop_id, display_name from staff where id = ${s.staffId} and active`;
  if (!row || row.shop_id !== s.shopId) return fail(401, "no_session", "Sign in as the seller first.");
  return { ...s, role: row.role, displayName: row.display_name };
}

export async function requireOwner(shopId: string): Promise<ActiveStaff> {
  const s = await activeStaff();
  if (s.shopId !== shopId || s.role !== "owner") forbidden();
  return s;
}

/** Staff of the drop's shop, or 404 (no drop) / 403 (another shop's drop). */
export async function staffForDrop(dropId: string): Promise<ActiveStaff> {
  const s = await activeStaff();
  const [d] = await sql<{ shop_id: string }[]>`select shop_id from drops where id = ${dropId}`;
  if (!d) notFound();
  if (d.shop_id !== s.shopId) forbidden();
  return s;
}

export async function sellerMe(staffId: string): Promise<SellerMe | null> {
  const [r] = await sql<{ id: string; role: "owner" | "staff"; display_name: string; email: string | null;
    shop_id: string; name: string; slug: string; is_sandbox: boolean; nexconn_desk_id: string | null }[]>`
    select st.id, st.role, st.display_name, st.email, s.id as shop_id, s.name, s.slug, s.is_sandbox, s.nexconn_desk_id
      from staff st join shops s on s.id = st.shop_id where st.id = ${staffId} and st.active`;
  return r ? { staffId: r.id, role: r.role, displayName: r.display_name, email: r.email,
    shop: { id: r.shop_id, name: r.name, slug: r.slug, isSandbox: r.is_sandbox, deskGroupId: r.nexconn_desk_id } } : null;
}

/** Pending invite = inactive row that still has an email; removal clears the email. */
export async function staffList(shopId: string): Promise<StaffMember[]> {
  const rows = await sql<{ id: string; role: "owner" | "staff"; display_name: string; email: string | null; active: boolean }[]>`
    select id, role, display_name, email, active from staff
     where shop_id = ${shopId} and (active or email is not null) order by role = 'owner' desc, created_at`;
  return rows.map((r) => ({ staffId: r.id, role: r.role, displayName: r.display_name, email: r.email, status: r.active ? "active" : "pending" }));
}

export async function shopSettings(shopId: string): Promise<ShopSettings> {
  const [s] = await sql<{ id: string; slug: string; name: string; logo_url: string | null; upi_id: string | null; payee_name: string | null;
    support_whatsapp: string | null; hold_seconds: number; max_holds: number; high_value_paise: string | null; auto_advance: boolean;
    faq: string[]; is_sandbox: boolean; nexconn_desk_id: string | null; created_at: Date }[]>`select * from shops where id = ${shopId}`;
  if (!s) notFound();
  return {
    id: s.id, slug: s.slug, name: s.name, logoUrl: s.logo_url, upiId: s.upi_id, payeeName: s.payee_name, supportWhatsapp: s.support_whatsapp,
    holdMinutes: Math.round(s.hold_seconds / 60), holdSeconds: s.hold_seconds, maxHolds: s.max_holds,
    highValuePaise: s.high_value_paise == null ? null : Number(s.high_value_paise), autoAdvance: s.auto_advance,
    faq: Array.isArray(s.faq) ? s.faq : [], isSandbox: s.is_sandbox, deskGroupId: s.nexconn_desk_id, createdAt: s.created_at.toISOString(),
    staff: await staffList(shopId),
  };
}

// ------------------------------------------------------------------ catalog and drops

export async function products(shopId: string, productId?: string): Promise<Product[]> {
  const rows = await sql<{ id: string; title: string; price_paise: string; note: string | null; photos: string[]; created_at: Date;
    variants: { key: string; label: string; qty: number }[]; in_live: boolean; used: number }[]>`
    select p.id, p.title, p.price_paise, p.note, p.photos, p.created_at,
           coalesce((select jsonb_agg(jsonb_build_object('key', v.key, 'label', v.label, 'qty', v.qty) order by v.sort, v.key)
                       from product_variants v where v.product_id = p.id), '[]') as variants,
           exists (select 1 from drop_items i join drops d on d.id = i.drop_id where i.product_id = p.id and d.status <> 'ended') as in_live,
           (select count(distinct i.drop_id)::int from drop_items i where i.product_id = p.id) as used
      from products p where p.shop_id = ${shopId} ${productId ? sql`and p.id = ${productId}` : sql``}
     order by p.created_at desc`;
  return rows.map((r) => ({ id: r.id, title: r.title, pricePaise: Number(r.price_paise), note: r.note, photos: r.photos, variants: r.variants,
    createdAt: r.created_at.toISOString(), inLiveDrop: r.in_live, usedInDrops: r.used }));
}

export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const shareUrl = (shopSlug: string, code: string) => `${appUrl()}/s/${shopSlug}/d/${code}`;

export async function dropState(dropId: string): Promise<DropState> {
  return (await fn<DropState | null>("drop_state", dropId)) ?? notFound();
}

const viewerCache = new Map<string, { at: number; n: number | null }>();
/** Sale-room participant count in nexconn mode, cached 5 s per instance; null when not measured. */
export async function viewers(channelId: string): Promise<number | null> {
  if (flags.mode !== "nexconn") return null;
  const hit = viewerCache.get(channelId);
  if (hit && Date.now() - hit.at < 5000) return hit.n;
  const n = await roomCount(channelId).catch(() => null);
  viewerCache.set(channelId, { at: Date.now(), n });
  return n;
}

// ------------------------------------------------------------------ orders

export type OrderRow = {
  id: string; shop_id: string; drop_id: string; claim_id: string; buyer_id: string; order_no: number; amount_paise: string;
  nexconn_group_id: string; assigned_staff_id: string | null; state: OrderState; utr: string | null; tracking_note: string | null;
  created_at: Date; paid_at: Date | null; shipped_at: Date | null; cancelled_at: Date | null;
};

/** The order and who is asking: its buyer, or active staff of its shop. 401 with no session, 403 otherwise. */
export async function orderAccess(orderId: string): Promise<{ order: OrderRow; as: "buyer" } | { order: OrderRow; as: "staff"; staff: ActiveStaff }> {
  const [order] = await sql<OrderRow[]>`select * from orders where id = ${orderId}`;
  const [b, s] = await Promise.all([getBuyer(), getStaff()]);
  if (!b && !s) fail(401, "no_session", "Sign in first.");
  if (!order) return notFound();
  if (b && b.buyerId === order.buyer_id) return { order, as: "buyer" };
  if (s && s.shopId === order.shop_id) {
    const staff = await activeStaff();
    return { order, as: "staff", staff };
  }
  return forbidden();
}

/** Inserts one outbox row (outside the engine, e.g. SYS:EnsureGroup for the team desk). */
export const enqueue = (dropId: string | null, type: "room" | "group" | "user", channel: string, msgType: string, payload: object) =>
  sql`insert into outbox (drop_id, channel_type, channel_id, msg_type, payload)
      values (${dropId}, ${type}, ${channel}, ${msgType}, ${sql.json(payload as never)})`;

export const deskIdFor = (shopId: string) => "desk_" + shopId.replace(/-/g, "").slice(0, 20);

// ------------------------------------------------------------------ shared input schemas

const nullableText = (max: number) => z.string().trim().max(max).transform((s) => s || null).nullable();

/** Shop settings fields (all optional: PATCH); POST adds the required ones. */
export const ShopFields = z.object({
  name: z.string().trim().min(2).max(60),
  slug: z.string().regex(/^[a-z0-9-]{3,30}$/, "3-30 lower-case letters, digits or dashes"),
  upiId: z.string().trim().refine(isUpiId, "not a UPI ID (name@bank)").nullable(),
  payeeName: nullableText(60),
  supportWhatsapp: z.string().max(20).nullable().transform((s, ctx) => {
    if (!s) return null;
    const p = isIndianPhone(s);
    if (!p) ctx.addIssue({ code: "custom", message: "not a 10-digit Indian mobile number" });
    return p;
  }),
  logoUrl: z.string().max(500).nullable(),
  holdMinutes: z.number().int().min(5).max(30),
  maxHolds: z.number().int().min(1).max(5),
  highValuePaise: z.number().int().positive().max(1e11).nullable(),
  autoAdvance: z.boolean(),
  faq: z.array(z.string().trim().min(1).max(200)).max(10),
}).partial();

/** A product photo: our public Storage URL inside the shop's folder, or a site-relative /demo/ path. */
export const isShopPhoto = (shopId: string, url: string) =>
  /^\/demo\/[\w\-./]+$/.test(url) && !url.includes("..") || (url.startsWith(photoPrefix(shopId)) && /^[\w\-./:]+$/.test(url) && !url.includes(".."));

export const VariantFields = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]{1,16}$/),
  label: z.string().trim().min(1).max(30),
  qty: z.number().int().min(1).max(999),
});
export const ProductFields = z.object({
  title: z.string().trim().min(1).max(80),
  pricePaise: z.number().int().min(100).max(1e10),
  note: nullableText(300).optional(),
  photos: z.array(z.string().max(500)).max(4).optional(),
  variants: z.array(VariantFields).min(1).max(10)
    .refine((v) => new Set(v.map((x) => x.key)).size === v.length, "variant keys must be unique"),
});

/** Narrows an orderAccess result to staff (403 for the order's buyer). */
export function staffOfOrder(a: Awaited<ReturnType<typeof orderAccess>>): { order: OrderRow; staff: ActiveStaff } {
  return a.as === "staff" ? { order: a.order, staff: a.staff } : forbidden();
}
