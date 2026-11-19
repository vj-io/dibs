// Share-link lookups for link previews and the calendar file. Read-only: no sweep, no viewer count. Server only.
import { fn, sql } from "./db.ts";
import type { DropState } from "../types.ts";

export type SharedDrop = Omit<DropState, "viewers">;

export async function dropById(id: string): Promise<SharedDrop | null> {
  return fn<SharedDrop | null>("drop_state", id);
}

/** /s/<shop>/d/<code> -> drop, or null when the link is malformed or unknown. */
export async function dropByCode(shop: string, code: string): Promise<SharedDrop | null> {
  if (!/^[a-z0-9-]{3,30}$/.test(shop) || !/^[A-Za-z0-9]{6}$/.test(code)) return null;
  const [d] = await sql<{ id: string }[]>`
    select d.id from drops d join shops s on s.id = d.shop_id where s.slug = ${shop} and d.code = ${code.toUpperCase()}`;
  return d ? dropById(d.id) : null;
}

export const shareUrl = (d: SharedDrop, base: string) => `${base}/s/${d.shop.slug}/d/${d.code}`;
